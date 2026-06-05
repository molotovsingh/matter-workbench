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
} = {}) {
  const acceptance = await buildAcceptanceReport();
  const blockers = uniqueStrings([
    ...(acceptance.accepted ? [] : ["shadow_database_not_accepted"]),
    ...(acceptance.runtimeCutoverBlockers || []),
  ]);
  const runtimeCutoverReady = Boolean(
    acceptance.accepted
    && acceptance.runtimeCutoverReady
    && blockers.length === 0,
  );

  return {
    mode: "runtime cutover stop-check",
    shadowEvidenceAccepted: Boolean(acceptance.accepted),
    verifySuccess: Boolean(acceptance.verifySuccess),
    runtimeCutoverReady,
    blockers,
    failedVerifyStep: acceptance.failedVerifyStep || "",
    next: runtimeCutoverReady
      ? "Runtime cutover guard is clear. Confirm deployment approvals before changing product storage."
      : acceptance.next || "Resolve runtime cutover blockers before changing product storage.",
  };
}

export function renderRuntimeCutoverReport(report = {}) {
  const lines = [
    "Matter Workbench DB runtime cutover check",
    `mode: ${report.mode || "runtime cutover stop-check"}`,
    `shadow_evidence_accepted: ${report.shadowEvidenceAccepted ? "yes" : "no"}`,
    `verify_success: ${report.verifySuccess ? "yes" : "no"}`,
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
