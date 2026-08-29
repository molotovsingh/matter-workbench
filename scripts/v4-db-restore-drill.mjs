#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { psqlConnectionArgs } from "./db-psql.mjs";
import { configError, redactV4DatabaseText } from "./v4-db-operator-config.mjs";
import { inspectCurrentV4Posture, readinessPostureFingerprint } from "./v4-db-readiness.mjs";

const PREFIX = "matter_workbench_v4_restore_";
const VERIFY_SQL = `
select case when
  (select count(*) from document_intake_extraction.schema_migrations) >= 11
  and not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped
    where n.nspname='document_intake_extraction' and c.relkind='r'
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  )
  and exists (
    select 1 from document_intake_extraction.recovery_canary
    where canary_key='v4-recovery-canary/v1' and canary_value='matter-workbench-v4'
  ) then 'ok' else 'failed' end;
`;

export async function runV4DbRestoreDrill({
  adminUrl = process.env.MWB_V4_ADMIN_URL || "",
  backupPath,
  manifestPath,
  outDir = path.resolve(".local", "v4-db-restore-drills"),
  timestamp = new Date().toISOString(),
  keep = false,
  spawn = spawnSync,
  env = process.env,
  config,
  postureFingerprint = "",
} = {}) {
  if (!adminUrl) throw configError("MWB_V4_ADMIN_URL is required", "v4_db.url_invalid");
  if (!backupPath || !manifestPath) throw configError("backup and manifest are required", "v4_db.restore_input_missing");
  const bytes = await readFile(backupPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (manifest.schemaVersion !== "v4-db-backup/v1" || !manifest.success || manifest.databaseName !== "matter_workbench_v4" || manifest.backup?.bytes !== bytes.length || manifest.backup?.sha256 !== digest) {
    throw configError("backup integrity manifest does not match SQL bytes", "v4_db.backup_digest_mismatch");
  }
  const generatedAt = timestamp || new Date().toISOString();
  const restoredDatabase = `${PREFIX}${generatedAt.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
  assertRestoreName(restoredDatabase);
  const maintenance = psqlConnectionArgs(adminUrl, { env });
  const restoreUrl = databaseUrlFor(adminUrl, restoredDatabase);
  const restore = psqlConnectionArgs(restoreUrl, { env });
  const steps = [];
  let created = false;
  let verified = false;
  try {
    const create = command(spawn, maintenance, ["-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${qid(restoredDatabase)}`], "create");
    steps.push(create); created = create.ok;
    if (created) {
      const load = command(spawn, restore, ["-v", "ON_ERROR_STOP=1", "-f", backupPath], "restore");
      steps.push(load);
      if (load.ok) {
        const verify = command(spawn, restore, ["-v", "ON_ERROR_STOP=1", "-tA", "-c", VERIFY_SQL], "verify");
        steps.push(verify); verified = verify.ok && verify.stdout.trim() === "ok";
      }
    }
  } finally {
    if (created && !keep) steps.push(command(spawn, maintenance, ["-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS ${qid(restoredDatabase)} WITH (FORCE)`], "cleanup"));
  }
  const cleanup = !keep && Boolean(steps.find((step) => step.label === "cleanup")?.ok);
  const checks = { migrations: verified, forcedRls: verified, canary: verified };
  const success = verified && cleanup && !keep;
  let boundPostureFingerprint = postureFingerprint;
  if (!boundPostureFingerprint) {
    try { boundPostureFingerprint = readinessPostureFingerprint(await inspectCurrentV4Posture({ config, env })); } catch { boundPostureFingerprint = ""; }
  }
  await mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, `v4-db-restore-drill-${generatedAt.replace(/[:.]/g, "-")}.json`);
  const evidence = {
    schemaVersion: "v4-db-restore-drill/v1", generatedAt, success,
    backup: path.basename(backupPath), manifest: path.basename(manifestPath), restoredDatabase,
    sourceSha256: digest, postureFingerprint: boundPostureFingerprint,
    checks, cleanup, keep: Boolean(keep),
    steps: steps.map(({ label, ok, error }) => ({ label, ok, error })),
  };
  await writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return { ...evidence, reportPath };
}

function command(spawn, connection, extra, label) {
  const result = spawn(connection.command, [...connection.args, ...extra], { encoding: "utf8", env: { ...process.env, ...connection.env } });
  return { label, ok: !result.error && Number(result.status) === 0, stdout: String(result.stdout || ""), error: redactV4DatabaseText(result.stderr || result.error?.message || "") };
}
function assertRestoreName(name) { if (!name.startsWith(PREFIX) || !/^[a-z0-9_]+$/.test(name)) throw configError("unsafe restore database name", "v4_db.restore_name_invalid"); }
function databaseUrlFor(value, database) { const url = new URL(value); url.pathname = `/${database}`; return url.toString(); }
function qid(value) { return `"${String(value).replaceAll('"', '""')}"`; }

function parseArgs(argv) {
  const result = { keep: false };
  for (let i=0;i<argv.length;i+=1) {
    if (argv[i] === "--backup" && argv[i+1]) result.backupPath=path.resolve(argv[++i]);
    else if (argv[i] === "--manifest" && argv[i+1]) result.manifestPath=path.resolve(argv[++i]);
    else if (argv[i] === "--out-dir" && argv[i+1]) result.outDir=path.resolve(argv[++i]);
    else if (argv[i] === "--timestamp" && argv[i+1]) result.timestamp=argv[++i];
    else if (argv[i] === "--keep") result.keep=true;
    else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  return result;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  runV4DbRestoreDrill(parseArgs(process.argv.slice(2))).then((r) => { console.log(`V4 restore drill: ${r.success ? "ok" : "failed"}`); console.log(`report: ${r.reportPath}`); if (!r.success) process.exitCode=1; }).catch((e) => { console.error(`${e.code || "v4_db.restore_failed"}: ${redactV4DatabaseText(e.message)}`); process.exitCode=1; });
}
