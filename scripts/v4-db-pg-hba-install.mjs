#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import process from "node:process";

import { configError, redactV4DatabaseText } from "./v4-db-operator-config.mjs";
import { upsertV4PgHbaBlock } from "./v4-db-pg-hba.mjs";

export async function installV4PgHba({
  file,
  runtimeRole,
  assertPrivileged = assertWritable,
  reload = reloadPostgres,
  verify = verifyActiveRules,
} = {}) {
  const target = String(file || "").trim();
  if (!target) throw configError("pg_hba file is required", "v4_db.pg_hba_file_required");
  await assertPrivileged(target);
  const original = await readFile(target, "utf8");
  const updated = upsertV4PgHbaBlock(original, { runtimeRole });
  if (updated === original) {
    if (!await verify({ runtimeRole })) throw configError("active V4 pg_hba rules did not verify", "v4_db.pg_hba_verification_failed");
    return { changed: false, file: target };
  }

  const backup = `${target}.mwb-v4.backup`;
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await copyFile(target, backup);
  try {
    await writeFile(temporary, updated, { mode: 0o600 });
    await rename(temporary, target);
    await reload();
    if (!await verify({ runtimeRole })) throw configError("active V4 pg_hba rules did not verify", "v4_db.pg_hba_verification_failed");
    return { changed: true, file: target, backup };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    await copyFile(backup, target).catch(() => {});
    await reload().catch(() => {});
    throw error;
  }
}

async function assertWritable(file) {
  try { await access(file, constants.R_OK | constants.W_OK); }
  catch { throw configError("pg_hba installer requires explicit privileged file access", "v4_db.pg_hba_privilege_required"); }
}

async function reloadPostgres() {
  const version = String(process.env.MWB_V4_PG_VERSION || "16");
  const cluster = String(process.env.MWB_V4_PG_CLUSTER || "main");
  const result = spawnSync("pg_ctlcluster", [version, cluster, "reload"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw configError(redactV4DatabaseText(result.stderr || result.error?.message || "PostgreSQL reload failed"), "v4_db.pg_hba_reload_failed");
}

async function verifyActiveRules({ runtimeRole }) {
  const url = String(process.env.MWB_V4_ADMIN_URL || "");
  if (!url) throw configError("MWB_V4_ADMIN_URL is required to verify active pg_hba rules", "v4_db.url_invalid");
  const query = [
    "select count(*) from pg_hba_file_rules",
    "where error is null and auth_method = 'reject'",
    `and user_name @> array['${String(runtimeRole).replaceAll("'", "''")}']::text[]`,
    "and database && array['matter_workbench_runtime','matter_workbench_mothership']::text[]",
  ].join(" ");
  const result = spawnSync("psql", [url, "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" });
  return !result.error && result.status === 0 && Number(String(result.stdout).trim()) >= 6;
}

async function main() {
  const fileIndex = process.argv.indexOf("--file");
  const file = fileIndex >= 0 ? process.argv[fileIndex + 1] : process.env.MWB_V4_PG_HBA_FILE;
  const result = await installV4PgHba({ file, runtimeRole: process.env.MWB_V4_RUNTIME_ROLE });
  console.log(`V4 pg_hba install: ${result.changed ? "changed" : "verified"}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(`${error.code || "v4_db.pg_hba_failed"}: ${redactV4DatabaseText(error.message)}`); process.exitCode = 1; });
}
