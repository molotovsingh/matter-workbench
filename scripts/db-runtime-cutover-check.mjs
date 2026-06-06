#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { buildShadowAcceptanceReport } from "./db-shadow-acceptance.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { redactDatabaseUrl } from "./db-doctor.mjs";

const __filename = fileURLToPath(import.meta.url);

export async function buildRuntimeCutoverReport({
  buildAcceptanceReport = buildShadowAcceptanceReport,
  env = process.env,
} = {}) {
  const acceptance = await buildAcceptanceReport({ env });
  const technicalBlockers = uniqueStrings([
    ...(acceptance.accepted ? [] : ["shadow_database_not_accepted"]),
    ...(acceptance.runtimeCutoverBlockers || []),
  ]);
  const runtimeCutoverApproved = isRuntimeCutoverApproved(env);
  const blockers = uniqueStrings([
    ...technicalBlockers,
    ...(acceptance.accepted && technicalBlockers.length === 0 && !runtimeCutoverApproved
      ? ["runtime_cutover_not_approved"]
      : []),
  ]);
  const runtimeCutoverReady = Boolean(
    acceptance.accepted
    && runtimeCutoverApproved
    && blockers.length === 0,
  );

  return {
    mode: "runtime cutover stop-check",
    shadowEvidenceAccepted: Boolean(acceptance.accepted),
    verifySuccess: Boolean(acceptance.verifySuccess),
    runtimeCutoverApproved,
    runtimeCutoverReady,
    blockers,
    failedVerifyStep: acceptance.failedVerifyStep || "",
    next: runtimeCutoverReady
      ? "Runtime cutover guard is clear. Confirm deployment approvals before changing product storage."
      : deriveNextAction({ acceptance, blockers, runtimeCutoverApproved }),
  };
}

export function renderRuntimeCutoverReport(report = {}) {
  const lines = [
    "Matter Workbench DB runtime cutover check",
    `mode: ${report.mode || "runtime cutover stop-check"}`,
    `shadow_evidence_accepted: ${report.shadowEvidenceAccepted ? "yes" : "no"}`,
    `verify_success: ${report.verifySuccess ? "yes" : "no"}`,
    `runtime_cutover_approved: ${report.runtimeCutoverApproved ? "yes" : "no"}`,
    `runtime_cutover_ready: ${report.runtimeCutoverReady ? "yes" : "no"}`,
  ];
  if (report.failedVerifyStep) lines.push(`failed_verify_step: ${report.failedVerifyStep}`);
  if (report.next) lines.push(`next: ${redactLine(report.next)}`);
  lines.push("runtime_cutover_blockers:");
  for (const blocker of report.blockers || []) lines.push(`  ${blocker}`);
  if (!report.blockers?.length) lines.push("  (none)");
  return lines.map(redactLine);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function isRuntimeCutoverApproved(env = {}) {
  return /^(1|true|yes|approved)$/i.test(String(env.MWB_DB_RUNTIME_CUTOVER_APPROVED || "").trim());
}

function deriveNextAction({ acceptance = {}, blockers = [], runtimeCutoverApproved = false } = {}) {
  if (blockers.includes("runtime_cutover_not_approved") && !runtimeCutoverApproved) {
    return "Set MWB_DB_RUNTIME_CUTOVER_APPROVED=yes only after explicit runtime-storage approval.";
  }
  return acceptance.next || "Resolve runtime cutover blockers before changing product storage.";
}

function redactLine(value) {
  return redactSensitiveText(String(redactDatabaseUrl(value || ""))
    .replace(/\bmatter_workbench_shadow\b/g, "[redacted-database]")
    .replace(/\bsecret\b/gi, "***"))
    .replace(/\bmatter_workbench_shadow\b/g, "[redacted-database]");
}

async function main() {
  await loadDatabaseScriptEnv();
  const report = await buildRuntimeCutoverReport();
  for (const line of renderRuntimeCutoverReport(report)) console.log(line);
  if (!report.runtimeCutoverReady) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.message));
    process.exitCode = 1;
  });
}
