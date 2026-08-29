import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import process from "node:process";
import test from "node:test";
import pg from "pg";

import { runV4DbProvision } from "../scripts/v4-db-provision.mjs";

const adminUrl = String(process.env.MWB_POSTGRES_TEST_ADMIN_URL || "").trim();

test("V4 fixed-database provisioning is idempotent, least-privileged and bounded", { timeout: 120_000 }, async () => {
  assert.ok(adminUrl, "Set MWB_POSTGRES_TEST_ADMIN_URL to a disposable PostgreSQL admin database.");
  const passwordA = randomBytes(18).toString("base64url");
  const passwordB = randomBytes(18).toString("base64url");
  const migrationRole = "mwb_v4_migrator";
  const runtimeRole = "mwb_v4_runtime";
  const databaseName = "matter_workbench_v4";
  const maintenance = new pg.Client({ connectionString: adminUrl });
  await maintenance.connect();
  const initialDatabases = await databaseNames(maintenance);
  assert.ok(!initialDatabases.includes(databaseName), "disposable cluster must not already contain the fixed V4 database");
  assert.ok(!(await roleExists(maintenance, migrationRole)) && !(await roleExists(maintenance, runtimeRole)), "disposable cluster must not contain fixed V4 roles");
  const config = {
    databaseName,
    migrationRole,
    runtimeRole,
    adminUrl,
    migrationUrl: asDatabaseUrl(adminUrl, databaseName, migrationRole, passwordA),
    runtimeUrl: asDatabaseUrl(adminUrl, databaseName, runtimeRole, passwordB),
    poolMaximum: 16,
    autoMigrate: false,
  };
  try {
    const options = { env: { MWB_V4_INTAKE: "0" }, config, verifyHba: async () => true };
    const first = await runV4DbProvision(options);
    assert.equal(first.createdDatabase, true);
    assert.ok(first.migrations.every((item) => item.status === "applied"));
    const second = await runV4DbProvision(options);
    assert.equal(second.createdDatabase, false);
    assert.ok(second.migrations.every((item) => item.status === "already_applied"));

    const currentDatabases = await databaseNames(maintenance);
    assert.deepEqual(currentDatabases.filter((name) => name !== databaseName), initialDatabases, "existing databases are unchanged");
    const role = await maintenance.query("select rolconnlimit, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls from pg_roles where rolname=$1", [runtimeRole]);
    assert.deepEqual(role.rows[0], { rolconnlimit: 16, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolbypassrls: false });

    const runtime = new pg.Client({ connectionString: config.runtimeUrl });
    await runtime.connect();
    await assert.rejects(() => runtime.query("create table document_intake_extraction.operator_escape(id integer)"), /permission denied/);
    await assert.rejects(() => runtime.query("select * from document_intake_extraction.recovery_canary"), /permission denied/);
    await runtime.end();

    const workload = Array.from({ length: 8 }, (_, index) => new pg.Client({
      connectionString: config.runtimeUrl,
      application_name: index < 4 ? `v4-primary-${index}` : `v4-repair-${index - 4}`,
    }));
    await Promise.all(workload.map((client) => client.connect()));
    try {
      await Promise.all(workload.map((client) => client.query("select 1")));
      const sampled = await maintenance.query("select count(*)::integer as count from pg_stat_activity where usename=$1", [runtimeRole]);
      assert.equal(sampled.rows[0].count, 8);
      assert.ok(sampled.rows[0].count <= 16);
    } finally { await Promise.all(workload.map((client) => client.end())); }
  } finally {
    await maintenance.query(`drop database if exists ${qid(databaseName)} with (force)`);
    await maintenance.query(`drop role if exists ${qid(runtimeRole)}`);
    await maintenance.query(`drop role if exists ${qid(migrationRole)}`);
    await maintenance.end();
  }
});

async function databaseNames(client) {
  const result = await client.query("select datname from pg_database where datistemplate=false order by datname");
  return result.rows.map((row) => row.datname);
}
async function roleExists(client, name) { return Boolean((await client.query("select 1 from pg_roles where rolname=$1", [name])).rowCount); }
function asDatabaseUrl(base, database, user, password) { const url = new URL(base); url.pathname = `/${database}`; url.username = user; url.password = password; return url.toString(); }
function qid(value) { return `"${String(value).replaceAll('"', '""')}"`; }
