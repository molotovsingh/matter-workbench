#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { redactDatabaseUrl, runDoctor } from "./db-doctor.mjs";
import { runShadowHydrationPipeline } from "./db-shadow-hydrate-all.mjs";

const __filename = fileURLToPath(import.meta.url);

export function parsePreflightArgs(argv = []) {
  const parsed = { json: false, doctorArgv: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--url") {
      const value = argv[i + 1];
      if (!value) throw new Error("--url requires a value");
      parsed.doctorArgv.push(arg, value);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function buildShadowPreflightReport({
  argv = [],
  env = process.env,
  runDoctorFn = runDoctor,
  runHydrationFn = runShadowHydrationPipeline,
} = {}) {
  const args = parsePreflightArgs(argv);
  const doctorLines = (await runDoctorFn({ argv: args.doctorArgv, env })).map(redactLine);
  const dryRun = runHydrationFn({ args: { mode: "dry-run" } });
  const dryRunSteps = (dryRun.steps || []).map((step) => redactStep(step));
  const next = extractDoctorValue(doctorLines, "next") || deriveNextAction({ doctorLines, dryRun });

  return {
    mode: "read-only",
    databaseUrl: extractDatabaseUrlStatus(doctorLines),
    psql: extractPsqlStatus(doctorLines),
    dryRunSuccess: Boolean(dryRun.success),
    readyToApplyMigrations: extractYesNo(doctorLines, "ready_to_apply"),
    readyToHydrateShadow: extractYesNo(doctorLines, "ready_to_hydrate"),
    next: redactLine(next),
    failedDryRunStep: dryRun.failedStep?.script || "",
    dryRunSteps,
    doctorLines,
  };
}

export function renderShadowPreflightReport(report = {}) {
  const lines = [
    "Matter Workbench shadow DB preflight",
    `mode: ${report.mode || "read-only"}`,
    `database_url: ${report.databaseUrl || "unknown"}`,
    `psql: ${report.psql || "unknown"}`,
    `dry_run_success: ${report.dryRunSuccess ? "yes" : "no"}`,
    `ready_to_apply_migrations: ${report.readyToApplyMigrations ? "yes" : "no"}`,
    `ready_to_hydrate_shadow: ${report.readyToHydrateShadow ? "yes" : "no"}`,
  ];

  if (report.failedDryRunStep) {
    lines.push(`failed_dry_run_step: ${report.failedDryRunStep}`);
  }
  if (report.next) {
    lines.push(`next: ${report.next}`);
  }

  lines.push("dry_run_steps:");
  for (const step of report.dryRunSteps || []) {
    lines.push(`  ${step.script}: ${step.ok ? "ok" : "failed"}`);
    if (!step.ok && step.stdout) lines.push(`    stdout: ${step.stdout}`);
    if (!step.ok && step.stderr) lines.push(`    stderr: ${step.stderr}`);
    if (!step.ok && step.error) lines.push(`    error: ${step.error}`);
  }

  return lines.map(redactLine);
}

function extractDatabaseUrlStatus(lines) {
  const value = extractDoctorValue(lines, "database_url");
  if (value === "configured" || value === "missing") return value;
  return "unknown";
}

function extractPsqlStatus(lines) {
  const value = extractDoctorValue(lines, "psql");
  if (/^available\b/i.test(value)) return "available";
  if (/^unavailable\b/i.test(value)) return "unavailable";
  return "unknown";
}

function extractYesNo(lines, key) {
  const value = extractDoctorValue(lines, key);
  return /^yes\b/i.test(value);
}

function extractDoctorValue(lines, key) {
  const prefix = `${key}:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}

function deriveNextAction({ doctorLines = [], dryRun = {} } = {}) {
  if (!dryRun.success) return "Fix the dry-run failure before applying or hydrating the shadow database.";
  if (extractDatabaseUrlStatus(doctorLines) === "missing") {
    return "Set MWB_DATABASE_URL or DATABASE_URL before applying migrations.";
  }
  if (extractYesNo(doctorLines, "ready_to_apply")) {
    return "Apply migrations with npm run db:migrate.";
  }
  if (extractYesNo(doctorLines, "ready_to_hydrate")) {
    return "Run shadow hydration, verification, report, or snapshot.";
  }
  return "Review db:doctor output before applying or hydrating the shadow database.";
}

function redactStep(step = {}) {
  const redacted = { ...step };
  for (const key of ["stdout", "stderr", "error"]) {
    if (redacted[key]) redacted[key] = redactLine(redacted[key]);
  }
  return redacted;
}

function redactLine(value) {
  return redactSensitiveText(String(redactDatabaseUrl(value || ""))
    .replace(/\bmatter_workbench_shadow\b/g, "[redacted-database]")
    .replace(/\bsecret\b/gi, "***"))
    .replace(/\bmatter_workbench_shadow\b/g, "[redacted-database]");
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parsePreflightArgs(process.argv.slice(2));
  const report = await buildShadowPreflightReport({ argv: process.argv.slice(2) });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else for (const line of renderShadowPreflightReport(report)) console.log(line);
  if (!report.dryRunSuccess) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.message));
    process.exitCode = 1;
  });
}
