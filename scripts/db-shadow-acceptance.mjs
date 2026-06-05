#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { redactDatabaseUrl, runDoctor } from "./db-doctor.mjs";
import { runShadowHydrationPipeline } from "./db-shadow-hydrate-all.mjs";

const __filename = fileURLToPath(import.meta.url);

export async function buildShadowAcceptanceReport({
  env = process.env,
  runDoctorFn = runDoctor,
  runHydrationFn = runShadowHydrationPipeline,
} = {}) {
  const doctorLines = (await runDoctorFn({ argv: [], env })).map(redactLine);
  const readyToHydrateShadow = extractYesNo(doctorLines, "ready_to_hydrate");
  const readyToApplyMigrations = extractYesNo(doctorLines, "ready_to_apply");
  const databaseUrl = extractDatabaseUrlStatus(doctorLines);
  const psql = extractPsqlStatus(doctorLines);
  const next = extractDoctorValue(doctorLines, "next") || deriveNextAction({
    readyToApplyMigrations,
    readyToHydrateShadow,
    databaseUrl,
  });

  if (!readyToHydrateShadow) {
    return {
      mode: "read-only verify",
      accepted: false,
      databaseUrl,
      psql,
      readyToApplyMigrations,
      readyToHydrateShadow,
      verifySuccess: false,
      next: redactLine(next),
      verifySteps: [],
      doctorLines,
    };
  }

  const verifyResult = runHydrationFn({ args: { mode: "verify" } });
  const verifySteps = (verifyResult.steps || []).map(redactStep);
  return {
    mode: "read-only verify",
    accepted: Boolean(verifyResult.success),
    databaseUrl,
    psql,
    readyToApplyMigrations,
    readyToHydrateShadow,
    verifySuccess: Boolean(verifyResult.success),
    failedVerifyStep: verifyResult.failedStep?.script || "",
    next: verifyResult.success
      ? "Shadow database accepted for handoff evidence; runtime remains filesystem-backed."
      : "Fix the failed verification step before treating the shadow database as accepted.",
    verifySteps,
    doctorLines,
  };
}

export function renderShadowAcceptanceReport(report = {}) {
  const lines = [
    "Matter Workbench shadow DB acceptance",
    `mode: ${report.mode || "read-only verify"}`,
    `accepted: ${report.accepted ? "yes" : "no"}`,
    `database_url: ${report.databaseUrl || "unknown"}`,
    `psql: ${report.psql || "unknown"}`,
    `ready_to_apply_migrations: ${report.readyToApplyMigrations ? "yes" : "no"}`,
    `ready_to_hydrate_shadow: ${report.readyToHydrateShadow ? "yes" : "no"}`,
    `verify_success: ${report.verifySuccess ? "yes" : "no"}`,
  ];

  if (report.failedVerifyStep) lines.push(`failed_verify_step: ${report.failedVerifyStep}`);
  if (report.next) lines.push(`next: ${redactLine(report.next)}`);

  lines.push("verify_steps:");
  for (const step of report.verifySteps || []) {
    lines.push(`  ${step.script}: ${step.ok ? "ok" : "failed"}`);
    if (!step.ok && step.stdout) lines.push(`    stdout: ${step.stdout}`);
    if (!step.ok && step.stderr) lines.push(`    stderr: ${step.stderr}`);
    if (!step.ok && step.error) lines.push(`    error: ${step.error}`);
  }
  if (!report.verifySteps?.length) lines.push("  (not run)");

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

function deriveNextAction({ readyToApplyMigrations, readyToHydrateShadow, databaseUrl }) {
  if (databaseUrl === "missing") return "Set MWB_DATABASE_URL or DATABASE_URL before acceptance.";
  if (readyToApplyMigrations) return "Apply migrations with npm run db:migrate.";
  if (readyToHydrateShadow) return "Run shadow verification.";
  return "Review db:doctor output before acceptance.";
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
  const report = await buildShadowAcceptanceReport();
  for (const line of renderShadowAcceptanceReport(report)) console.log(line);
  if (!report.accepted) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.message));
    process.exitCode = 1;
  });
}
