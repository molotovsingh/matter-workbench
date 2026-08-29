#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

import { loadV4DatabaseOperatorConfig, postureFingerprint, redactV4DatabaseText } from "./v4-db-operator-config.mjs";

const POLICY = "private-vm-recoverability-pack/v1";

export function readinessPostureFingerprint(posture = {}) {
  return postureFingerprint({
    databaseName: posture.database?.name,
    databaseHost: posture.databaseHost,
    databaseOwner: posture.database?.owner,
    migrationRole: posture.database?.owner,
    runtimeRole: posture.runtimeIdentity?.role,
    runtimeIdentity: posture.runtimeIdentity,
    poolMaximum: posture.runtimeConfiguration?.poolMaximum,
    autoMigrate: posture.runtimeConfiguration?.autoMigrate,
    migrations: posture.migrations?.entries,
    backupPolicy: posture.backupPolicy,
  });
}

export async function runV4DbReadiness({
  backupManifestPath,
  restoreReportPath,
  outDir = path.resolve(".local", "v4-db-readiness"),
  timestamp = new Date().toISOString(),
  inspect = inspectCurrentV4Posture,
  config,
  env = process.env,
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const failedChecks = [];
  let current;
  try { current = await inspect({ config, env }); }
  catch { current = emptyPosture(); failedChecks.push("v4_readiness.posture_unavailable"); }
  const fingerprint = readinessPostureFingerprint(current);
  const backup = await readJsonOrNull(backupManifestPath);
  const restore = await readJsonOrNull(restoreReportPath);

  if (!(current.database?.configured && current.database?.name === "matter_workbench_v4" && current.database?.owner)) failedChecks.push("v4_readiness.database_invalid");
  if (!(current.runtimeConfiguration?.poolMaximum === 16 && current.runtimeConfiguration?.autoMigrate === false)) failedChecks.push("v4_readiness.runtime_configuration_invalid");
  if (!validRuntimeIdentity(current.runtimeIdentity)) failedChecks.push("v4_readiness.runtime_identity_invalid");
  if (!(current.migrations?.complete && current.migrations?.immutable && current.migrations?.entries?.length)) failedChecks.push("v4_readiness.migrations_invalid");
  if (!(current.backupPolicy === POLICY)) failedChecks.push("v4_readiness.backup_policy_invalid");
  if (!validBackup(backup)) failedChecks.push("v4_readiness.backup_invalid");
  if (!validRestore(restore, backup)) failedChecks.push("v4_readiness.restore_invalid");
  if (restore?.postureFingerprint !== fingerprint) failedChecks.push("v4_readiness.posture_stale");

  const uniqueFailures = [...new Set(failedChecks)];
  const activationReady = uniqueFailures.length === 0;
  const record = {
    schemaVersion: "v4-db-readiness/v1", generatedAt,
    success: activationReady, activationReady, postureFingerprint: fingerprint,
    database: current.database,
    runtimeConfiguration: current.runtimeConfiguration,
    runtimeIdentity: current.runtimeIdentity,
    migrations: current.migrations,
    backup: {
      policy: POLICY, manifest: backupManifestPath ? path.resolve(backupManifestPath) : "",
      generatedAt: backup?.generatedAt || "", bytes: Number(backup?.backup?.bytes || 0), sha256: backup?.backup?.sha256 || "",
    },
    restore: {
      report: restoreReportPath ? path.resolve(restoreReportPath) : "", success: Boolean(restore?.success),
      cleanup: Boolean(restore?.cleanup), sourceSha256: restore?.sourceSha256 || "",
    },
    failedChecks: uniqueFailures,
  };
  await mkdir(outDir, { recursive: true });
  const slug = generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `v4-db-readiness-${slug}.json`);
  const markdownPath = path.join(outDir, `v4-db-readiness-${slug}.md`);
  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderReadinessMarkdown(record), "utf8");
  return { ...record, jsonPath, markdownPath };
}

export async function inspectCurrentV4Posture({ config, env = process.env } = {}) {
  const effective = config || loadV4DatabaseOperatorConfig(env);
  const admin = new pg.Client({ connectionString: effective.adminUrl });
  const migration = new pg.Pool({ connectionString: effective.migrationUrl, max: 2 });
  await admin.connect();
  try {
    const databaseResult = await admin.query("select d.datname as name, r.rolname as owner from pg_database d join pg_roles r on r.oid=d.datdba where d.datname=$1", [effective.databaseName]);
    const roleResult = await admin.query("select rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolconnlimit from pg_roles where rolname=$1", [effective.runtimeRole]);
    const hba = await admin.query([
      "select database, count(*)::integer as count from pg_hba_file_rules",
      "where error is null and auth_method='reject' and user_name @> array[$1]::text[]",
      "and database && array['matter_workbench_runtime','matter_workbench_mothership']::text[] group by database",
    ].join("\n"), [effective.runtimeRole]);
    const hbaCounts = new Map(hba.rows.flatMap((row) => row.database.map((name) => [name, Number(row.count)])));
    const privileges = await migration.query([
      "select has_schema_privilege($1, 'document_intake_extraction', 'USAGE')",
      "and has_table_privilege($1, 'document_intake_extraction.intakes', 'SELECT,INSERT,UPDATE')",
      "and has_function_privilege($1, 'document_intake_extraction.claim_page_work(text,integer,jsonb)', 'EXECUTE')",
      "and not has_table_privilege($1, 'document_intake_extraction.recovery_canary', 'SELECT') as ok",
    ].join("\n"), [effective.runtimeRole]);
    const migrationRows = await migration.query("select migration_name as name, sha256 from document_intake_extraction.schema_migrations order by migration_name");
    const expected = await migrationFiles();
    const entries = migrationRows.rows.map((row) => ({ name: row.name, sha256: String(row.sha256) }));
    const migrationValid = JSON.stringify(entries) === JSON.stringify(expected);
    const role = roleResult.rows[0] || {};
    return {
      databaseHost: `${new URL(effective.migrationUrl).hostname}:${new URL(effective.migrationUrl).port || "5432"}`,
      database: { name: effective.databaseName, configured: databaseResult.rowCount === 1, owner: databaseResult.rows[0]?.owner || "" },
      runtimeConfiguration: { poolMaximum: effective.poolMaximum, autoMigrate: effective.autoMigrate },
      runtimeIdentity: {
        role: effective.runtimeRole, superuser: Boolean(role.rolsuper), createDatabase: Boolean(role.rolcreatedb),
        createRole: Boolean(role.rolcreaterole), inherit: Boolean(role.rolinherit), bypassRls: Boolean(role.rolbypassrls),
        connectionLimit: Number(role.rolconnlimit), runtimeDatabaseDenied: (hbaCounts.get("matter_workbench_runtime") || 0) >= 3,
        mothershipDatabaseDenied: (hbaCounts.get("matter_workbench_mothership") || 0) >= 3,
        requiredPrivileges: privileges.rows[0]?.ok === true,
      },
      migrations: { complete: migrationValid, immutable: migrationValid, entries },
      backupPolicy: POLICY,
    };
  } finally { await migration.end(); await admin.end(); }
}

async function migrationFiles() {
  const directory = new URL("../services/document-intake-extraction/postgres/migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  return await Promise.all(names.map(async (name) => ({ name, sha256: createHash("sha256").update(await readFile(new URL(name, directory))).digest("hex") })));
}
function validRuntimeIdentity(value = {}) { return Boolean(value.role && !value.superuser && !value.createDatabase && !value.createRole && !value.inherit && !value.bypassRls && value.connectionLimit === 16 && value.runtimeDatabaseDenied && value.mothershipDatabaseDenied && value.requiredPrivileges); }
function validBackup(value) { return value?.schemaVersion === "v4-db-backup/v1" && value.success === true && value.databaseName === "matter_workbench_v4" && Number(value.backup?.bytes) > 0 && /^[a-f0-9]{64}$/.test(value.backup?.sha256 || ""); }
function validRestore(value, backup) { return value?.schemaVersion === "v4-db-restore-drill/v1" && value.success === true && value.cleanup === true && value.keep !== true && value.checks?.migrations === true && value.checks?.forcedRls === true && value.checks?.canary === true && value.sourceSha256 === backup?.backup?.sha256; }
async function readJsonOrNull(file) { if (!file) return null; try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } }
function emptyPosture() { return { databaseHost: "", database: { name: "matter_workbench_v4", configured: false, owner: "" }, runtimeConfiguration: { poolMaximum: 0, autoMigrate: true }, runtimeIdentity: {}, migrations: { complete: false, immutable: false, entries: [] }, backupPolicy: "" }; }
function renderReadinessMarkdown(r) { return `# V4 Database Readiness\n\nGenerated at: ${r.generatedAt}\nActivation ready: ${r.activationReady ? "yes" : "no"}\nPosture fingerprint: ${r.postureFingerprint}\nFailed checks: ${r.failedChecks.length ? r.failedChecks.join(", ") : "none"}\n`; }
function parseArgs(argv) { const r={}; for(let i=0;i<argv.length;i+=1){ if(argv[i]==="--backup-manifest"&&argv[i+1])r.backupManifestPath=path.resolve(argv[++i]); else if(argv[i]==="--restore-report"&&argv[i+1])r.restoreReportPath=path.resolve(argv[++i]); else if(argv[i]==="--out-dir"&&argv[i+1])r.outDir=path.resolve(argv[++i]); else throw new Error(`Unknown or incomplete option: ${argv[i]}`); } return r; }
if (import.meta.url === `file://${process.argv[1]}`) runV4DbReadiness(parseArgs(process.argv.slice(2))).then((r)=>{console.log(`V4 database readiness: ${r.activationReady?"ready":"not ready"}`);console.log(`record: ${r.jsonPath}`);if(!r.activationReady)process.exitCode=1;}).catch((e)=>{console.error(redactV4DatabaseText(e.message));process.exitCode=1;});
