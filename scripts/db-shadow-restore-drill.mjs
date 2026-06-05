#!/usr/bin/env node
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { psqlConnectionArgs } from "./db-psql.mjs";

const __filename = fileURLToPath(import.meta.url);
const RESTORE_PREFIX = "matter_workbench_shadow_restore_";

export function parseRestoreDrillArgs(argv = []) {
  const parsed = {
    backupPath: "",
    restoredDatabase: "",
    timestamp: "",
    keep: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--backup") {
      const value = argv[i + 1];
      if (!value) throw new Error("--backup requires a value");
      parsed.backupPath = path.resolve(value);
      i += 1;
    } else if (arg === "--database") {
      const value = argv[i + 1];
      if (!value) throw new Error("--database requires a value");
      parsed.restoredDatabase = value;
      i += 1;
    } else if (arg === "--timestamp") {
      const value = argv[i + 1];
      if (!value) throw new Error("--timestamp requires a value");
      parsed.timestamp = value;
      i += 1;
    } else if (arg === "--keep") {
      parsed.keep = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runShadowRestoreDrill({
  databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "",
  backupPath,
  restoredDatabase = "",
  timestamp = new Date().toISOString(),
  keep = false,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before running a shadow restore drill.");
  if (!backupPath) throw new Error("Pass --backup /path/to/shadow-db-backup.sql before running a restore drill.");
  await access(backupPath);

  const generatedAt = timestamp || new Date().toISOString();
  const restoreName = restoredDatabase || `${RESTORE_PREFIX}${timestampSlug(generatedAt)}`;
  assertSafeRestoreDatabaseName(restoreName);

  const maintenanceUrl = databaseUrl;
  const restoreUrl = databaseUrlForDatabase(databaseUrl, restoreName);
  const maintenance = psqlConnectionArgs(maintenanceUrl, { env });
  const restore = psqlConnectionArgs(restoreUrl, { env });

  const steps = [];
  let created = false;
  try {
    const create = runCommand({
      label: "create restore database",
      command: maintenance.command,
      args: [...maintenance.args, "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${quoteIdentifier(restoreName)}`],
      env: { ...process.env, ...maintenance.env },
      spawn,
    });
    steps.push(create);
    if (create.ok) created = true;

    if (create.ok) {
      const restoreStep = runCommand({
        label: "restore backup",
        command: restore.command,
        args: [...restore.args, "-v", "ON_ERROR_STOP=1", "-f", backupPath],
        env: { ...process.env, ...restore.env },
        spawn,
      });
      steps.push(restoreStep);
    }

    if (lastRequiredStepOk(steps)) {
      const verify = runCommand({
        label: "verify restored database",
        command: "npm",
        args: ["run", "db:shadow:report", "--silent"],
        env: { ...process.env, MWB_DATABASE_URL: restoreUrl },
        spawn,
      });
      steps.push(verify);
    }
  } finally {
    if (created && !keep) {
      const drop = runCommand({
        label: "drop restore database",
        command: maintenance.command,
        args: [
          ...maintenance.args,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `DROP DATABASE IF EXISTS ${quoteIdentifier(restoreName)}`,
        ],
        env: { ...process.env, ...maintenance.env },
        spawn,
      });
      steps.push(drop);
    }
  }

  return finish({ generatedAt, restoreName, backupPath, keep, steps });
}

export function renderShadowRestoreDrillResult(result = {}) {
  const lines = [
    "Matter Workbench shadow DB restore drill",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `backup: ${result.backupPath || ""}`,
    `restored_database: ${result.restoredDatabase || ""}`,
    `cleanup: ${result.cleanup ? "yes" : "no"}`,
  ];

  for (const step of result.steps || []) {
    lines.push(`  ${step.label}: ${step.ok ? "ok" : "failed"}`);
    if (!step.ok && step.stdout) lines.push(`    stdout: ${step.stdout}`);
    if (!step.ok && step.stderr) lines.push(`    stderr: ${step.stderr}`);
    if (!step.ok && step.error) lines.push(`    error: ${step.error}`);
  }
  if (result.failedStep) lines.push(`failed_step: ${result.failedStep.label}`);
  return lines.map(redactLine);
}

function finish({ generatedAt, restoreName, backupPath, keep, steps }) {
  const requiredSteps = steps.filter((step) => step.label !== "drop restore database");
  const failedStep = requiredSteps.find((step) => !step.ok) || null;
  const cleanupStep = steps.find((step) => step.label === "drop restore database") || null;
  const cleanup = keep ? false : Boolean(cleanupStep?.ok);
  const success = !failedStep && (keep || cleanup);
  return {
    success,
    generatedAt,
    backupPath,
    restoredDatabase: restoreName,
    cleanup,
    keep,
    steps,
    failedStep,
  };
}

function runCommand({ label, command, args, env, spawn }) {
  const result = spawn(command, args, {
    encoding: "utf8",
    env,
  });
  const ok = !result.error && Number(result.status) === 0;
  const step = {
    label,
    command,
    ok,
  };
  if (!ok && result.error) step.error = redactLine(result.error.message);
  if (!ok && result.stdout) step.stdout = compactOutput(result.stdout);
  if (!ok && result.stderr) step.stderr = compactOutput(result.stderr);
  return step;
}

function lastRequiredStepOk(steps) {
  const requiredSteps = steps.filter((step) => step.label !== "drop restore database");
  return Boolean(requiredSteps.length) && requiredSteps.every((step) => step.ok);
}

function assertSafeRestoreDatabaseName(name) {
  if (!name.startsWith(RESTORE_PREFIX)) {
    throw new Error(`Restore database name must start with ${RESTORE_PREFIX}`);
  }
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error("Restore database name may only contain letters, numbers, and underscores");
  }
}

function databaseUrlForDatabase(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[-:.]/g, "_");
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
  const args = parseRestoreDrillArgs(process.argv.slice(2));
  const result = await runShadowRestoreDrill(args);
  for (const line of renderShadowRestoreDrillResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.message));
    process.exitCode = 1;
  });
}
