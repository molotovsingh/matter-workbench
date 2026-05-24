#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  planMigrations,
  resolveDatabaseUrl,
} from "./db-migrate.mjs";

const __filename = fileURLToPath(import.meta.url);

export function parseDoctorArgs(argv) {
  const parsed = { databaseUrl: "" };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") {
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

export function detectPsql({ spawn = spawnSync } = {}) {
  const result = spawn("psql", ["--version"], { encoding: "utf8" });
  if (result.error) {
    return { available: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      available: false,
      error: result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`,
    };
  }
  return {
    available: true,
    version: result.stdout?.trim() || result.stderr?.trim() || "psql available",
  };
}

export function redactDatabaseUrl(databaseUrl) {
  return String(databaseUrl || "")
    .replace(/^([a-z][a-z0-9+.-]*:\/\/[^:@/?#\s]+):([^@/?#\s]+)@/i, "$1:***@")
    .replace(/([?&](?:password|pass|pwd|token|sslpassword)=)[^&#]*/gi, "$1***")
    .replace(/\b((?:password|pass|pwd|token|sslpassword)=)[^\s;,)]+/gi, "$1***");
}

export function buildDoctorReport({
  databaseUrl = "",
  psql = { available: false, error: "not checked" },
  migrations = [],
  planError = "",
} = {}) {
  const lines = [
    "Matter Workbench database doctor",
    "mode: read-only",
    `database_url: ${databaseUrl ? "configured" : "missing"}`,
  ];

  if (databaseUrl) {
    lines.push(`database_url_redacted: ${redactDatabaseUrl(databaseUrl)}`);
  }

  if (psql.available) {
    lines.push(`psql: available - ${psql.version || "version unknown"}`);
  } else {
    lines.push(`psql: unavailable - ${psql.error || "not found"}`);
  }

  if (planError) {
    lines.push(`database_inspection: failed - ${redactDatabaseUrl(planError)}`);
  } else if (databaseUrl && psql.available) {
    lines.push("database_inspection: completed");
  } else {
    lines.push("database_inspection: skipped");
  }

  lines.push("migrations:");
  for (const migration of migrations) {
    lines.push(`${migration.version}\t${migration.status}\t${migration.fileName}`);
  }

  const hasChecksumMismatch = migrations.some((migration) => migration.status === "checksum_mismatch");
  const readyToApply = Boolean(databaseUrl && psql.available && !planError && !hasChecksumMismatch);
  lines.push(`ready_to_apply: ${readyToApply ? "yes" : "no"}`);

  if (!databaseUrl) {
    lines.push("next: Set MWB_DATABASE_URL or DATABASE_URL before applying migrations.");
  } else if (!psql.available) {
    lines.push("next: Install or expose the psql command-line client before applying migrations.");
  } else if (planError) {
    lines.push("next: Fix database connectivity or credentials before applying migrations.");
  } else if (hasChecksumMismatch) {
    lines.push("next: Add a new migration instead of editing an already-applied migration.");
  } else {
    lines.push("next: Apply with MWB_DATABASE_URL set and npm run db:migrate.");
  }

  return lines;
}

export async function runDoctor({ argv = process.argv.slice(2), env = process.env, spawn = spawnSync, plan = planMigrations } = {}) {
  const args = parseDoctorArgs(argv);
  const databaseUrl = resolveDatabaseUrl({ cliUrl: args.databaseUrl, env });
  const psql = detectPsql({ spawn });

  let migrations;
  let planError = "";
  try {
    migrations = await plan({
      databaseUrl: databaseUrl && psql.available ? databaseUrl : "",
    });
  } catch (error) {
    planError = error.message;
    try {
      migrations = await plan({ databaseUrl: "" });
    } catch {
      migrations = [];
    }
  }

  return buildDoctorReport({ databaseUrl, psql, migrations, planError });
}

if (process.argv[1] === __filename) {
  runDoctor().then((lines) => {
    for (const line of lines) console.log(line);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
