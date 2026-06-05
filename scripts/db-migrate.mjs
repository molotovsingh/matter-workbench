#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";

import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { resolvePsqlCommand } from "./db-psql.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");
const defaultMigrationsDir = path.join(appDir, "db", "migrations");

export function parseArgs(argv) {
  const parsed = {
    mode: "apply",
    databaseUrl: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list") {
      parsed.mode = "list";
    } else if (arg === "--dry-run") {
      parsed.mode = "dry-run";
    } else if (arg === "--url") {
      const value = argv[i + 1];
      if (!value) throw new Error("--url requires a value");
      parsed.databaseUrl = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export function migrationVersionFromFile(fileName) {
  const match = fileName.match(/^(\d{3}_[a-z0-9_]+)\.sql$/i);
  if (!match) {
    throw new Error(`Expected a numbered migration like 001_name.sql, got ${fileName}`);
  }
  return match[1];
}

export function migrationNumberFromFile(fileName) {
  const version = migrationVersionFromFile(fileName);
  return Number(version.slice(0, 3));
}

export function validateMigrationSequence(migrations) {
  const seen = new Map();

  for (const migration of migrations) {
    const number = migrationNumberFromFile(migration.fileName);
    const padded = String(number).padStart(3, "0");
    const existing = seen.get(number);
    if (existing) {
      throw new Error(`Duplicate database migration number ${padded}: ${existing} and ${migration.fileName}`);
    }
    seen.set(number, migration.fileName);
  }

  for (let index = 0; index < migrations.length; index += 1) {
    const expected = index + 1;
    const actual = migrationNumberFromFile(migrations[index].fileName);
    if (actual !== expected) {
      const expectedPadded = String(expected).padStart(3, "0");
      throw new Error(`Missing database migration number ${expectedPadded} before ${migrations[index].fileName}`);
    }
  }

  return migrations;
}

export async function listMigrationFiles({ migrationsDir = defaultMigrationsDir } = {}) {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({
      fileName: entry.name,
      path: path.join(migrationsDir, entry.name),
      version: migrationVersionFromFile(entry.name),
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  return validateMigrationSequence(migrations);
}

export function buildSchemaMigrationsSql() {
  return `
create table if not exists schema_migrations (
  version text primary key,
  file_name text not null,
  checksum_sha256 text not null default '',
  applied_at timestamptz not null default now()
);
alter table schema_migrations
  add column if not exists checksum_sha256 text not null default '';
`;
}

export function buildMigrationApplySql({ version, fileName, sql, checksumSha256 = computeMigrationChecksum(sql) }) {
  return `
begin;
select pg_advisory_xact_lock(hashtext('matter-workbench-migrations'));
${sql}
insert into schema_migrations (version, file_name, checksum_sha256)
values ('${escapeSqlLiteral(version)}', '${escapeSqlLiteral(fileName)}', '${escapeSqlLiteral(checksumSha256)}');
commit;
`;
}

export function computeMigrationChecksum(sql) {
  return createHash("sha256").update(String(sql)).digest("hex");
}

export function resolveDatabaseUrl({ cliUrl = "", env = process.env } = {}) {
  return cliUrl || env.MWB_DATABASE_URL || env.DATABASE_URL || "";
}

export async function loadMigrationSql(migration) {
  return readFile(migration.path, "utf8");
}

export function runPsql({ databaseUrl, sql, env = process.env, spawn = spawnSync } = {}) {
  const psql = resolvePsqlCommand({ env });
  const result = spawn(psql.command, [databaseUrl, "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    env,
  });

  if (result.error) {
    throw new Error(`psql failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${detail}`);
  }
  return result.stdout;
}

export function readAppliedVersions({ databaseUrl, env = process.env, spawn = spawnSync } = {}) {
  return new Set([...readAppliedMigrations({ databaseUrl, env, spawn }).keys()]);
}

export function readAppliedMigrations({ databaseUrl, env = process.env, spawn = spawnSync } = {}) {
  const ensure = runPsql({ databaseUrl, sql: buildSchemaMigrationsSql(), env, spawn });
  void ensure;
  const psql = resolvePsqlCommand({ env });
  const result = spawn(psql.command, [
    databaseUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    "select version || E'\\t' || checksum_sha256 from schema_migrations order by version",
  ], {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`psql failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${detail}`);
  }
  return parseAppliedMigrationRows(result.stdout);
}

export function parseAppliedMigrationRows(stdout) {
  const applied = new Map();
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [version, checksumSha256 = ""] = trimmed.split("\t");
    applied.set(version, { checksumSha256 });
  }
  return applied;
}

export function classifyMigrationStatus({ migration, applied }) {
  const appliedRecord = applied.get(migration.version);
  if (!appliedRecord) return "pending";
  if (appliedRecord.checksumSha256 !== migration.checksumSha256) return "checksum_mismatch";
  return "applied";
}

export async function planMigrations({ databaseUrl = "", migrationsDir = defaultMigrationsDir } = {}) {
  const migrations = await hydrateMigrationChecksums(await listMigrationFiles({ migrationsDir }));
  if (!databaseUrl) {
    return migrations.map((migration) => ({ ...migration, status: "unknown" }));
  }

  const applied = readAppliedMigrations({ databaseUrl });
  return migrations.map((migration) => ({
    ...migration,
    status: classifyMigrationStatus({ migration, applied }),
  }));
}

export async function applyMigrations({ databaseUrl, migrationsDir = defaultMigrationsDir } = {}) {
  if (!databaseUrl) {
    throw new Error("Set MWB_DATABASE_URL or DATABASE_URL, or pass --url postgres://...");
  }

  runPsql({ databaseUrl, sql: buildSchemaMigrationsSql() });
  const plan = await planMigrations({ databaseUrl, migrationsDir });
  const mismatched = plan.filter((migration) => migration.status === "checksum_mismatch");
  if (mismatched.length > 0) {
    const versions = mismatched.map((migration) => migration.version).join(", ");
    throw new Error(`Applied migration checksum mismatch: ${versions}`);
  }
  const pending = plan.filter((migration) => migration.status === "pending");

  for (const migration of pending) {
    const sql = await loadMigrationSql(migration);
    runPsql({
      databaseUrl,
      sql: buildMigrationApplySql({
        version: migration.version,
        fileName: migration.fileName,
        sql,
        checksumSha256: migration.checksumSha256,
      }),
    });
  }

  return { applied: pending.map((migration) => migration.version), skipped: plan.filter((migration) => migration.status === "applied").map((migration) => migration.version) };
}

async function hydrateMigrationChecksums(migrations) {
  return Promise.all(
    migrations.map(async (migration) => {
      const sql = await loadMigrationSql(migration);
      return {
        ...migration,
        checksumSha256: computeMigrationChecksum(sql),
      };
    }),
  );
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = resolveDatabaseUrl({ cliUrl: args.databaseUrl });

  if (args.mode === "list") {
    const migrations = await listMigrationFiles();
    for (const migration of migrations) {
      console.log(`${migration.version}\t${migration.fileName}`);
    }
    return;
  }

  if (args.mode === "dry-run") {
    const plan = await planMigrations({ databaseUrl });
    for (const migration of plan) {
      console.log(`${migration.status}\t${migration.version}\t${migration.fileName}`);
    }
    if (!databaseUrl) {
      console.log("No database URL provided; statuses are unknown.");
    }
    return;
  }

  const result = await applyMigrations({ databaseUrl });
  for (const version of result.skipped) console.log(`skipped\t${version}`);
  for (const version of result.applied) console.log(`applied\t${version}`);
}

function escapeSqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
