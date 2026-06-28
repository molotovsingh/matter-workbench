#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { pgDumpConnectionArgs } from "./db-psql.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "shadow-db-backup/v1";

export function parseBackupArgs(argv = []) {
  const parsed = {
    outDir: path.resolve(".local", "shadow-db-backups"),
    timestamp: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a value");
      parsed.outDir = path.resolve(value);
      i += 1;
    } else if (arg === "--timestamp") {
      const value = argv[i + 1];
      if (!value) throw new Error("--timestamp requires a value");
      parsed.timestamp = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runShadowBackup({
  databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "",
  outDir = path.resolve(".local", "shadow-db-backups"),
  timestamp = new Date().toISOString(),
  env = process.env,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before backing up the shadow database.");

  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const backupPath = path.join(outDir, `shadow-db-backup-${slug}.sql`);
  const manifestPath = path.join(outDir, `shadow-db-backup-${slug}.json`);
  await mkdir(outDir, { recursive: true });

  const connection = pgDumpConnectionArgs(databaseUrl, { env, outputPath: backupPath });
  const result = spawn(connection.command, connection.args, {
    encoding: "utf8",
    env: { ...process.env, ...connection.env },
  });
  const success = !result.error && Number(result.status) === 0;
  const backupStats = success ? await stat(backupPath).catch(() => null) : null;
  const sha256 = backupStats ? await sha256File(backupPath) : "";

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    databaseUrl: "configured",
    pgDump: connection.command,
    pgDumpSource: connection.source,
    success,
    files: {
      sql: path.basename(backupPath),
      manifest: path.basename(manifestPath),
    },
    backup: {
      bytes: backupStats?.size || 0,
      sha256,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    success,
    generatedAt,
    backupPath,
    manifestPath,
    pgDump: connection.command,
    pgDumpSource: connection.source,
    bytes: manifest.backup.bytes,
    sha256,
    stdout: success ? "" : compactOutput(result.stdout),
    stderr: success ? "" : compactOutput(result.stderr),
    error: result.error ? redactLine(result.error.message) : "",
  };
}

export function renderShadowBackupResult(result = {}) {
  const lines = [
    "Matter Workbench shadow DB backup",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `backup: ${result.backupPath || ""}`,
    `manifest: ${result.manifestPath || ""}`,
    `pg_dump: ${result.pgDump || "unknown"}`,
    `pg_dump_source: ${result.pgDumpSource || "unknown"}`,
    `bytes: ${result.bytes || 0}`,
  ];
  if (result.sha256) lines.push(`sha256: ${result.sha256}`);
  if (!result.success && result.stdout) lines.push(`stdout: ${result.stdout}`);
  if (!result.success && result.stderr) lines.push(`stderr: ${result.stderr}`);
  if (!result.success && result.error) lines.push(`error: ${result.error}`);
  return lines.map(redactLine);
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function compactOutput(value) {
  return redactLine(String(value || "").trim().replace(/\s+/g, " ")).slice(0, 500);
}

function redactLine(value) {
  return redactSensitiveText(String(value || "")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@([^/\s]+)\/[^\s]+/g, "postgres://$1:***@$3")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@")
    .replace(/\bmatter_workbench_shadow\b/g, "[redacted-database]")
    .replace(/\bsecret\b/gi, "***"));
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseBackupArgs(process.argv.slice(2));
  const result = await runShadowBackup(args);
  for (const line of renderShadowBackupResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.message));
    process.exitCode = 1;
  });
}
