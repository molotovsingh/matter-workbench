#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { pgDumpConnectionArgs } from "./db-psql.mjs";
import { assertV4DatabaseUrl, redactV4DatabaseText } from "./v4-db-operator-config.mjs";

export async function runV4DbBackup({
  databaseUrl = process.env.MWB_V4_MIGRATION_URL || "",
  outDir = path.resolve(".local", "v4-db-backups"),
  timestamp = new Date().toISOString(),
  env = process.env,
  spawn = spawnSync,
} = {}) {
  const safeUrl = assertV4DatabaseUrl(databaseUrl, "MWB_V4_MIGRATION_URL");
  const generatedAt = timestamp || new Date().toISOString();
  const slug = generatedAt.replace(/[:.]/g, "-");
  await mkdir(outDir, { recursive: true });
  const backupPath = path.join(outDir, `v4-db-backup-${slug}.sql`);
  const manifestPath = path.join(outDir, `v4-db-backup-${slug}.json`);
  const connection = pgDumpConnectionArgs(safeUrl, { env, outputPath: backupPath });
  const child = spawn(connection.command, connection.args, { encoding: "utf8", env: { ...process.env, ...env, ...connection.env } });
  const stats = !child.error && Number(child.status) === 0 ? await stat(backupPath).catch(() => null) : null;
  const bytes = Number(stats?.size || 0);
  const sha256 = bytes > 0 ? await sha256File(backupPath) : "";
  const success = !child.error && Number(child.status) === 0 && bytes > 0 && /^[a-f0-9]{64}$/.test(sha256);
  const errorCode = success ? "" : (!bytes || !sha256 ? "v4_db.backup_empty" : "v4_db.backup_failed");
  const manifest = {
    schemaVersion: "v4-db-backup/v1",
    generatedAt,
    success,
    databaseName: "matter_workbench_v4",
    pgDumpSource: connection.source,
    files: { sql: path.basename(backupPath), manifest: path.basename(manifestPath) },
    backup: { bytes, sha256 },
    errorCode,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { ...manifest, backupPath, manifestPath, bytes, sha256, error: success ? "" : redactV4DatabaseText(child.stderr || child.error?.message || errorCode) };
}

async function sha256File(file) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256"); const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk)); stream.on("error", reject); stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out-dir" && argv[i + 1]) out.outDir = path.resolve(argv[++i]);
    else if (argv[i] === "--timestamp" && argv[i + 1]) out.timestamp = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runV4DbBackup(parseArgs(process.argv.slice(2))).then((result) => {
    console.log(`V4 database backup: ${result.success ? "ok" : "failed"}`);
    console.log(`manifest: ${result.manifestPath}`);
    if (!result.success) process.exitCode = 1;
  }).catch((error) => { console.error(redactV4DatabaseText(error.message)); process.exitCode = 1; });
}
