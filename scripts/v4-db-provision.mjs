#!/usr/bin/env node
import pg from "pg";
import process from "node:process";

import { runDocumentIntakeExtractionMigrations } from "../services/document-intake-extraction/postgres/migrate.mjs";
import { buildDocumentIntakeExtractionRuntimeRoleSql } from "../services/document-intake-extraction/postgres/runtime-role-sql.mjs";
import { configError, loadV4DatabaseOperatorConfig, redactV4DatabaseText, V4_DATABASE_NAME } from "./v4-db-operator-config.mjs";

export function assertV4FlagOff(env = process.env) {
  if (String(env.MWB_V4_INTAKE || "") === "1") throw configError("V4 must be disabled while provisioning", "v4_db.flag_must_be_off");
  return true;
}

export function buildV4RoleSql(config) {
  const migrationPassword = new URL(config.migrationUrl).password;
  const runtimePassword = new URL(config.runtimeUrl).password;
  return {
    migration: `create role ${qid(config.migrationRole)} login password ${qlit(migrationPassword)} nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
    runtime: `create role ${qid(config.runtimeRole)} login password ${qlit(runtimePassword)} nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 16`,
  };
}

export function assertProvisionState(state, config) {
  if (!state?.database || state.database.name !== config.databaseName || state.database.owner !== config.migrationRole) {
    throw configError("V4 database ownership conflicts with required posture", "v4_db.owner_conflict");
  }
  assertRole(state.migrationRole, config.migrationRole, -1, false);
  assertRole(state.runtimeRole, config.runtimeRole, 16, true);
  return true;
}

export async function runV4DbProvision({
  env = process.env,
  config = loadV4DatabaseOperatorConfig(env),
  Client = pg.Client,
  Pool = pg.Pool,
  migrate = runDocumentIntakeExtractionMigrations,
  verifyHba = verifyPgHba,
} = {}) {
  assertV4FlagOff(env);
  const admin = new Client({ connectionString: config.adminUrl });
  await admin.connect();
  let createdDatabase = false;
  try {
    const roles = await readRoles(admin, config);
    const sql = buildV4RoleSql(config);
    if (!roles.migrationRole) await admin.query(sql.migration);
    if (!roles.runtimeRole) await admin.query(sql.runtime);

    const database = await readDatabase(admin, config.databaseName);
    if (!database) {
      await admin.query(`create database ${qid(config.databaseName)} owner ${qid(config.migrationRole)}`);
      createdDatabase = true;
    }
    await admin.query(`revoke all on database ${qid(config.databaseName)} from public`);
    await admin.query(`grant connect on database ${qid(config.databaseName)} to ${qid(config.runtimeRole)}`);

    const state = {
      database: await readDatabase(admin, config.databaseName),
      ...(await readRoles(admin, config)),
    };
    assertProvisionState(state, config);
    if (!await verifyHba(admin, config.runtimeRole)) {
      throw configError("V4 cross-database pg_hba denial rules are not active", "v4_db.pg_hba_verification_failed");
    }
  } finally {
    await admin.end();
  }

  const migrationPool = new Pool({ connectionString: config.migrationUrl, max: 2 });
  try {
    const migrations = await migrate({ pool: migrationPool });
    await migrationPool.query(buildDocumentIntakeExtractionRuntimeRoleSql({ roleName: config.runtimeRole }));
    await migrationPool.query(`revoke all on document_intake_extraction.recovery_canary from ${qid(config.runtimeRole)}`);
    await verifyMigratedPosture(migrationPool);
    return {
      schemaVersion: "v4-db-provision/v1",
      success: true,
      databaseName: config.databaseName,
      migrationRole: config.migrationRole,
      runtimeRole: config.runtimeRole,
      poolMaximum: config.poolMaximum,
      createdDatabase,
      migrations: migrations.migrations.map(({ migrationName, sha256, status }) => ({ name: migrationName, sha256, status })),
    };
  } finally {
    await migrationPool.end();
  }
}

async function readRoles(client, config) {
  const result = await client.query([
    "select rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolconnlimit",
    "from pg_roles where rolname = any($1::text[])",
  ].join("\n"), [[config.migrationRole, config.runtimeRole]]);
  const byName = new Map(result.rows.map((row) => [row.rolname, {
    name: row.rolname,
    superuser: row.rolsuper,
    createDatabase: row.rolcreatedb,
    createRole: row.rolcreaterole,
    inherit: row.rolinherit,
    bypassRls: row.rolbypassrls,
    connectionLimit: Number(row.rolconnlimit),
  }]));
  return { migrationRole: byName.get(config.migrationRole) || null, runtimeRole: byName.get(config.runtimeRole) || null };
}

async function readDatabase(client, name) {
  const result = await client.query([
    "select d.datname as name, r.rolname as owner",
    "from pg_database d join pg_roles r on r.oid = d.datdba",
    "where d.datname = $1",
  ].join("\n"), [name]);
  return result.rows[0] || null;
}

async function verifyPgHba(client, runtimeRole) {
  const result = await client.query([
    "select count(*)::integer as count from pg_hba_file_rules",
    "where error is null and auth_method = 'reject'",
    "and user_name @> array[$1]::text[]",
    "and database && array['matter_workbench_runtime','matter_workbench_mothership']::text[]",
  ].join("\n"), [runtimeRole]);
  return Number(result.rows[0]?.count || 0) >= 6;
}

async function verifyMigratedPosture(pool) {
  const rls = await pool.query([
    "select count(*)::integer as bad from pg_class c",
    "join pg_namespace n on n.oid = c.relnamespace",
    "join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped",
    "where n.nspname = 'document_intake_extraction' and c.relkind = 'r'",
    "and (not c.relrowsecurity or not c.relforcerowsecurity)",
  ].join("\n"));
  if (Number(rls.rows[0]?.bad || 0) !== 0) throw configError("V4 tenant tables do not all force RLS", "v4_db.rls_invalid");
  const canary = await pool.query("select canary_value from document_intake_extraction.recovery_canary where canary_key = 'v4-recovery-canary/v1'");
  if (canary.rows[0]?.canary_value !== "matter-workbench-v4") throw configError("V4 recovery canary is missing", "v4_db.canary_missing");
}

function assertRole(role, expectedName, connectionLimit, requireLimit) {
  if (!role || role.name !== expectedName || role.superuser || role.createDatabase || role.createRole || role.inherit || role.bypassRls || (requireLimit && role.connectionLimit !== connectionLimit)) {
    throw configError(`V4 role ${expectedName} conflicts with required posture`, "v4_db.role_conflict");
  }
}

function qid(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function qlit(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function main() {
  const result = await runV4DbProvision();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(`${error.code || "v4_db.provision_failed"}: ${redactV4DatabaseText(error.message)}`); process.exitCode = 1; });
}
