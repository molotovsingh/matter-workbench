#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  applyMigrations,
  listMigrationFiles,
  planMigrations,
} from "../scripts/db-migrate.mjs";
import { loadMothershipScriptEnv } from "../scripts/mothership-env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const defaultMothershipMigrationsDir = path.join(__dirname, "db", "migrations");

export function resolveMothershipDatabaseUrl({ env = process.env } = {}) {
  return String(env.MOTHERSHIP_DATABASE_URL || "").trim();
}

export async function listMothershipMigrations() {
  return listMigrationFiles({ migrationsDir: defaultMothershipMigrationsDir });
}

export async function runMothershipMigrations({ mode = "apply", env = process.env } = {}) {
  const databaseUrl = resolveMothershipDatabaseUrl({ env });
  if (mode === "list") return listMothershipMigrations();
  if (mode === "dry-run") {
    return planMigrations({ databaseUrl, migrationsDir: defaultMothershipMigrationsDir });
  }
  return applyMigrations({ databaseUrl, migrationsDir: defaultMothershipMigrationsDir });
}

function parseArgs(argv = []) {
  if (argv.length === 0) return "apply";
  if (argv.length === 1 && argv[0] === "--list") return "list";
  if (argv.length === 1 && argv[0] === "--dry-run") return "dry-run";
  throw new Error(`Unknown option: ${argv[0]}`);
}

if (process.argv[1] === __filename) {
  try {
    await loadMothershipScriptEnv();
    const mode = parseArgs(process.argv.slice(2));
    const result = await runMothershipMigrations({ mode });
    if (mode === "list") {
      for (const migration of result) console.log(`${migration.version}\t${migration.fileName}`);
    } else if (mode === "dry-run") {
      for (const migration of result) console.log(`${migration.status}\t${migration.version}\t${migration.fileName}`);
    } else {
      for (const version of result.skipped) console.log(`skipped\t${version}`);
      for (const version of result.applied) console.log(`applied\t${version}`);
    }
  } catch (error) {
    console.error(String(error?.message || error).replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@"));
    process.exitCode = 1;
  }
}
