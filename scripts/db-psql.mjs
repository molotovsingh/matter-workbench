#!/usr/bin/env node
import { existsSync } from "node:fs";
import process from "node:process";

const DISCOVERED_PSQL_CANDIDATES = [
  "/opt/homebrew/opt/libpq/bin/psql",
  "/usr/local/opt/libpq/bin/psql",
  "/opt/local/lib/postgresql17/bin/psql",
  "/opt/local/lib/postgresql16/bin/psql",
  "/usr/lib/postgresql/17/bin/psql",
  "/usr/lib/postgresql/16/bin/psql",
];

const DISCOVERED_PG_DUMP_CANDIDATES = [
  "/opt/homebrew/opt/libpq/bin/pg_dump",
  "/usr/local/opt/libpq/bin/pg_dump",
  "/opt/local/lib/postgresql17/bin/pg_dump",
  "/opt/local/lib/postgresql16/bin/pg_dump",
  "/usr/lib/postgresql/17/bin/pg_dump",
  "/usr/lib/postgresql/16/bin/pg_dump",
];

export function resolvePsqlCommand({
  env = process.env,
  exists = existsSync,
} = {}) {
  const explicit = String(env.MWB_PSQL_BIN || "").trim();
  if (explicit) {
    return { command: explicit, source: "MWB_PSQL_BIN" };
  }

  for (const candidate of DISCOVERED_PSQL_CANDIDATES) {
    if (exists(candidate)) {
      return { command: candidate, source: "discovered" };
    }
  }

  return { command: "psql", source: "PATH" };
}

export function resolvePgDumpCommand({
  env = process.env,
  exists = existsSync,
} = {}) {
  const explicit = String(env.MWB_PG_DUMP_BIN || "").trim();
  if (explicit) {
    return { command: explicit, source: "MWB_PG_DUMP_BIN" };
  }

  for (const candidate of DISCOVERED_PG_DUMP_CANDIDATES) {
    if (exists(candidate)) {
      return { command: candidate, source: "discovered" };
    }
  }

  return { command: "pg_dump", source: "PATH" };
}

export function psqlConnectionArgs(databaseUrl, { env = process.env } = {}) {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const psql = resolvePsqlCommand({ env });
  return {
    command: psql.command,
    source: psql.source,
    args: [
      "-h",
      url.hostname,
      "-p",
      url.port || "5432",
      "-U",
      decodeURIComponent(url.username),
      "-d",
      database,
    ],
    env: {
      ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {}),
    },
  };
}

export function pgDumpConnectionArgs(databaseUrl, { env = process.env, outputPath } = {}) {
  if (!outputPath) throw new Error("outputPath is required");
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const pgDump = resolvePgDumpCommand({ env });
  return {
    command: pgDump.command,
    source: pgDump.source,
    args: [
      "-h",
      url.hostname,
      "-p",
      url.port || "5432",
      "-U",
      decodeURIComponent(url.username),
      "-d",
      database,
      "--no-owner",
      "--no-privileges",
      "--format=plain",
      "--file",
      outputPath,
    ],
    env: {
      ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {}),
    },
  };
}
