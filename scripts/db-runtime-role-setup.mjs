#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { psqlConnectionArgs } from "./db-psql.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const __filename = fileURLToPath(import.meta.url);

export async function setupRuntimeDbRole({
  env = process.env,
  appDir = process.cwd(),
  spawn = spawnSync,
} = {}) {
  const adminUrl = String(env.MWB_DATABASE_URL || env.DATABASE_URL || "").trim();
  if (!adminUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL to an admin database URL before runtime role setup.");
  const roleName = String(env.MWB_RUNTIME_DATABASE_ROLE || "mwb_runtime_app").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(roleName)) throw new Error("MWB_RUNTIME_DATABASE_ROLE must be a valid PostgreSQL role identifier.");
  const password = String(env.MWB_RUNTIME_DATABASE_PASSWORD || "").trim() || randomBytes(24).toString("base64url");
  const runtimeUrl = runtimeUrlForRole({ adminUrl, roleName, password });
  const sql = buildRuntimeRoleSetupSql({ roleName, password });
  const { command, args, env: psqlEnv } = psqlConnectionArgs(adminUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, ...psqlEnv },
  });
  if (result.error) throw new Error(`psql failed: ${redactLine(result.error.message)}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactLine(detail)}`);
  }

  const writeEnvShadow = hasArg("--write-env-shadow");
  let envShadowPath = "";
  if (writeEnvShadow) {
    envShadowPath = await upsertEnvShadowRuntimeUrl({ appDir, runtimeUrl });
  }

  return {
    roleName,
    runtimeUrlRedacted: redactDatabaseUrl(runtimeUrl),
    wroteEnvShadow: writeEnvShadow,
    envShadowPath,
  };
}

export function buildRuntimeRoleSetupSql({ roleName, password }) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(String(roleName || ""))) {
    throw new Error("roleName must be a valid PostgreSQL role identifier.");
  }
  const ident = sqlIdentifier(roleName);
  return [
    "do $$",
    "begin",
    `  if not exists (select 1 from pg_roles where rolname = ${sqlString(roleName)}) then`,
    `    create role ${ident} login password ${sqlString(password)};`,
    "  else",
    `    alter role ${ident} with login password ${sqlString(password)};`,
    "  end if;",
    "end",
    "$$;",
    `alter role ${ident} nosuperuser nocreatedb nocreaterole noinherit nobypassrls;`,
    `grant usage on schema public to ${ident};`,
    `grant select, insert, update, delete on all tables in schema public to ${ident};`,
    `grant execute on all functions in schema public to ${ident};`,
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${ident};`,
    `alter default privileges in schema public grant execute on functions to ${ident};`,
    "",
  ].join("\n");
}

export function runtimeUrlForRole({ adminUrl, roleName, password }) {
  const url = new URL(adminUrl);
  url.username = roleName;
  url.password = password;
  return url.toString();
}

async function upsertEnvShadowRuntimeUrl({ appDir, runtimeUrl }) {
  const envPath = path.join(path.resolve(appDir || process.cwd()), ".env.shadow");
  let existing = "";
  try {
    existing = await readFile(envPath, "utf8");
  } catch {
    existing = "";
  }
  const lines = existing.split(/\r?\n/);
  const nextLine = `MWB_RUNTIME_DATABASE_URL=${runtimeUrl}`;
  let replaced = false;
  const next = lines.map((line) => {
    if (/^\s*MWB_RUNTIME_DATABASE_URL\s*=/.test(line)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });
  if (!replaced) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(nextLine);
  }
  await writeFile(envPath, `${next.join("\n").replace(/\n+$/, "")}\n`);
  return envPath;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function sqlIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function redactDatabaseUrl(value) {
  return String(value || "").replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@");
}

function redactLine(value) {
  return redactSensitiveText(redactDatabaseUrl(value));
}

export function renderRuntimeRoleSetupReport(report = {}) {
  return [
    "Matter Workbench runtime DB role setup",
    `role_name: ${report.roleName || ""}`,
    `runtime_url: ${report.runtimeUrlRedacted || ""}`,
    `wrote_env_shadow: ${report.wroteEnvShadow ? "yes" : "no"}`,
    `env_shadow_path: ${report.envShadowPath || ""}`,
  ].map(redactLine);
}

async function main() {
  await loadDatabaseScriptEnv();
  const report = await setupRuntimeDbRole();
  for (const line of renderRuntimeRoleSetupReport(report)) console.log(line);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.message));
    process.exitCode = 1;
  });
}
