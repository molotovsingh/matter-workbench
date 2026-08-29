import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import pg from "pg";

import { runV4DbActivation } from "../scripts/v4-db-activate.mjs";
import { runV4DbBackup } from "../scripts/v4-db-backup.mjs";
import { runV4DbProvision } from "../scripts/v4-db-provision.mjs";
import { inspectCurrentV4Posture, readinessPostureFingerprint, runV4DbReadiness } from "../scripts/v4-db-readiness.mjs";
import { runV4DbRestoreDrill } from "../scripts/v4-db-restore-drill.mjs";

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
    const migrator = await maintenance.query("select rolbypassrls from pg_roles where rolname=$1", [migrationRole]);
    assert.equal(migrator.rows[0].rolbypassrls, true, "operator-only migration owner must be able to dump forced-RLS rows");

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

    const recoveryRoot = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-db-recovery-"));
    try {
      const runtimeEnvPath = path.join(recoveryRoot, "runtime.env");
      await writeFile(runtimeEnvPath, "MWB_V4_DB_POOL_MAX=16\nMWB_V4_AUTO_MIGRATE=0\n");
      const assertFlagOff = async () => assert.doesNotMatch(await readFile(runtimeEnvPath, "utf8"), /^MWB_V4_INTAKE=/m);
      await assertFlagOff();
      const backup = await runV4DbBackup({ databaseUrl: config.migrationUrl, outDir: recoveryRoot, env: process.env });
      assert.equal(backup.success, true);
      assert.ok(backup.bytes > 0);
      await assertFlagOff();
      const inspected = await inspectCurrentV4Posture({ config, env: process.env });
      // Local disposable PostgreSQL has no privileged pg_hba install; that installer
      // has its own tests and VM acceptance. Bind the remainder of this flow to the
      // posture it would expose after its six active reject rules are installed.
      const activationPosture = { ...inspected, runtimeIdentity: { ...inspected.runtimeIdentity, runtimeDatabaseDenied: true, mothershipDatabaseDenied: true } };
      const postureFingerprint = readinessPostureFingerprint(activationPosture);
      const restore = await runV4DbRestoreDrill({ adminUrl, backupPath: backup.backupPath, manifestPath: backup.manifestPath, outDir: recoveryRoot, env: process.env, config, postureFingerprint });
      assert.equal(restore.success, true);
      assert.deepEqual(restore.checks, { migrations: true, forcedRls: true, canary: true });
      assert.equal(restore.cleanup, true);
      assert.equal((await databaseNames(maintenance)).some((name) => name.startsWith("matter_workbench_v4_restore_")), false);
      await assertFlagOff();
      const readiness = await runV4DbReadiness({ backupManifestPath: backup.manifestPath, restoreReportPath: restore.reportPath, outDir: recoveryRoot, config, inspect: async () => activationPosture });
      assert.equal(readiness.activationReady, true);
      await assertFlagOff();
      const activatePreview = await runV4DbActivation({ action: "activate", readinessPath: readiness.jsonPath, runtimeEnvPath, dryRun: true, env: { MWB_V4_AUTO_MIGRATE: "0" }, currentPostureFingerprint: postureFingerprint });
      assert.equal(activatePreview.changed, true);
      await assertFlagOff();
      const disablePreview = await runV4DbActivation({ action: "disable", runtimeEnvPath, dryRun: true });
      assert.equal(disablePreview.changed, false);
      await assertFlagOff();
    } finally { await rm(recoveryRoot, { recursive: true, force: true }); }
  } finally {
    await maintenance.query(`drop database if exists ${qid(databaseName)} with (force)`);
    await maintenance.query(`drop role if exists ${qid(runtimeRole)}`);
    await maintenance.query(`drop role if exists ${qid(migrationRole)}`);
    await maintenance.end();
  }
});

test("real process contains unreachable V4 as a degraded 503", { timeout: 60_000 }, async () => {
  const port = await freePort();
  const secret = "must-not-escape";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env, PORT: String(port), MWB_RUNTIME_HOST: "127.0.0.1", MWB_V4_INTAKE: "1",
      MWB_V4_DB_URL: `postgresql://mwb_v4_runtime:${secret}@127.0.0.1:1/matter_workbench_v4`,
      MWB_V4_DB_POOL_MAX: "16", MWB_V4_AUTO_MIGRATE: "0",
      GEMINI_API_KEY: "integration-placeholder", MISTRAL_API_KEY: "integration-placeholder", OPENAI_API_KEY: "integration-placeholder",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  try {
    let response = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { response = await fetch(`${base}/api/v4/status`); if (response.status === 503) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(response?.status, 503, output);
    assert.equal((await response.json()).code, "v4.database_unavailable");
    assert.equal((await fetch(`${base}/api/config`)).status, 200);
    assert.equal((await fetch(`${base}/api/v4/v1/intakes`)).status, 404);
    assert.doesNotMatch(output, new RegExp(secret));
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 2_000).unref(); });
  }
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function databaseNames(client) {
  const result = await client.query("select datname from pg_database where datistemplate=false order by datname");
  return result.rows.map((row) => row.datname);
}
async function roleExists(client, name) { return Boolean((await client.query("select 1 from pg_roles where rolname=$1", [name])).rowCount); }
function asDatabaseUrl(base, database, user, password) { const url = new URL(base); url.pathname = `/${database}`; url.username = user; url.password = password; return url.toString(); }
function qid(value) { return `"${String(value).replaceAll('"', '""')}"`; }
