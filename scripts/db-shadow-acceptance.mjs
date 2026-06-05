#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { redactDatabaseUrl, runDoctor } from "./db-doctor.mjs";
import { collectLocalStorageHydrationPlan } from "./db-hydrate-local-storage.mjs";
import { defaultMattersHome } from "./db-hydrate-local-matters.mjs";
import { runShadowHydrationPipeline } from "./db-shadow-hydrate-all.mjs";
import { runShadowStorageRestoreCheck } from "./db-shadow-storage-restore-check.mjs";

const __filename = fileURLToPath(import.meta.url);
const RUNTIME_CUTOVER_BLOCKERS = Object.freeze([
  "hosted_auth_and_tenant_session_model",
  "object_storage_or_single_host_volume_policy",
  "pdf_storage_backup_restore_policy",
  "worker_process_owner_and_recovery",
  "postgres_unavailable_user_behavior",
]);

export async function buildShadowAcceptanceReport({
  env = process.env,
  runDoctorFn = runDoctor,
  runHydrationFn = runShadowHydrationPipeline,
  checkStorageBackupEvidenceFn = checkShadowStorageBackupEvidence,
  checkPostgresUnavailableRuntimePolicyFn = checkPostgresUnavailableRuntimePolicy,
  checkLocalWorkerRuntimePolicyFn = checkLocalWorkerRuntimePolicy,
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
      runtimeCutoverReady: false,
      runtimeCutoverBlockers: runtimeCutoverBlockers(),
      storageBackupEvidence: { accepted: false },
      next: redactLine(next),
      verifySteps: [],
      doctorLines,
    };
  }

  const verifyResult = runHydrationFn({ args: { mode: "verify" } });
  const verifySteps = (verifyResult.steps || []).map(redactStep);
  const storageBackupEvidence = await checkStorageBackupEvidenceFn({ env });
  const postgresUnavailablePolicy = await checkPostgresUnavailableRuntimePolicyFn({ env });
  const workerRuntimePolicy = await checkLocalWorkerRuntimePolicyFn();
  return {
    mode: "read-only verify",
    accepted: Boolean(verifyResult.success),
    databaseUrl,
    psql,
    readyToApplyMigrations,
    readyToHydrateShadow,
    verifySuccess: Boolean(verifyResult.success),
    runtimeCutoverReady: false,
    runtimeCutoverBlockers: runtimeCutoverBlockers({
      storageBackupAccepted: Boolean(storageBackupEvidence?.accepted),
      postgresUnavailablePolicyAccepted: Boolean(postgresUnavailablePolicy?.accepted),
      workerRuntimePolicyAccepted: Boolean(workerRuntimePolicy?.accepted),
    }),
    storageBackupEvidence: storageBackupEvidence || { accepted: false },
    postgresUnavailablePolicy: postgresUnavailablePolicy || { accepted: false },
    workerRuntimePolicy: workerRuntimePolicy || { accepted: false },
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
    `runtime_cutover_ready: ${report.runtimeCutoverReady ? "yes" : "no"}`,
  ];

  if (report.failedVerifyStep) lines.push(`failed_verify_step: ${report.failedVerifyStep}`);
  if (report.next) lines.push(`next: ${redactLine(report.next)}`);
  const storageEvidence = report.storageBackupEvidence || {};
  lines.push(`storage_backup_evidence: ${storageEvidence.accepted ? "accepted" : "missing"}`);
  if (storageEvidence.checkedObjects != null) lines.push(`  checked_objects: ${storageEvidence.checkedObjects}`);
  if (storageEvidence.missingCurrentObjects != null) lines.push(`  missing_current_objects: ${storageEvidence.missingCurrentObjects}`);
  if (storageEvidence.hashMismatches != null) lines.push(`  hash_mismatches: ${storageEvidence.hashMismatches}`);
  const postgresPolicy = report.postgresUnavailablePolicy || {};
  lines.push(`postgres_unavailable_policy: ${postgresPolicy.accepted ? "accepted" : "missing"}`);
  if (postgresPolicy.behavior) lines.push(`  behavior: ${redactLine(postgresPolicy.behavior)}`);
  if (postgresPolicy.reason) lines.push(`  reason: ${redactLine(postgresPolicy.reason)}`);
  const workerPolicy = report.workerRuntimePolicy || {};
  lines.push(`worker_runtime_policy: ${workerPolicy.accepted ? "accepted" : "missing"}`);
  if (workerPolicy.behavior) lines.push(`  behavior: ${redactLine(workerPolicy.behavior)}`);
  if (workerPolicy.reason) lines.push(`  reason: ${redactLine(workerPolicy.reason)}`);

  lines.push("runtime_cutover_blockers:");
  for (const blocker of report.runtimeCutoverBlockers || []) {
    lines.push(`  ${blocker}`);
  }
  if (!report.runtimeCutoverBlockers?.length) lines.push("  (none)");

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

function runtimeCutoverBlockers({
  storageBackupAccepted = false,
  postgresUnavailablePolicyAccepted = false,
  workerRuntimePolicyAccepted = false,
} = {}) {
  return RUNTIME_CUTOVER_BLOCKERS.filter((blocker) => (
    !(
      (storageBackupAccepted && (
        blocker === "pdf_storage_backup_restore_policy"
        || blocker === "object_storage_or_single_host_volume_policy"
      ))
      || (postgresUnavailablePolicyAccepted && blocker === "postgres_unavailable_user_behavior")
      || (workerRuntimePolicyAccepted && blocker === "worker_process_owner_and_recovery")
    )
  ));
}

export async function checkPostgresUnavailableRuntimePolicy({
  appDir = process.cwd(),
  createWorkbenchServerFn = null,
  invalidDatabaseUrl = "postgres://mwb_user:invalid@127.0.0.1:1/matter_workbench_shadow",
} = {}) {
  try {
    const createServerFn = createWorkbenchServerFn || await loadCreateWorkbenchServer(appDir);
    const app = await createServerFn({
      appDir,
      env: {
        NODE_ENV: "test",
        PORT: "0",
        MATTER_ROOT: "",
        MWB_DATABASE_URL: invalidDatabaseUrl,
        DATABASE_URL: invalidDatabaseUrl,
      },
      port: 0,
    });

    return {
      accepted: app?.uiShell === "react",
      behavior: app?.uiShell === "react"
        ? "local_filesystem_runtime_continues_without_postgres"
        : "local_runtime_created_with_unexpected_shell",
      reason: app?.uiShell === "react" ? "" : `unexpected ui shell: ${app?.uiShell || "unknown"}`,
    };
  } catch (error) {
    return {
      accepted: false,
      behavior: "local_runtime_creation_failed",
      reason: error?.message || "runtime could not be created without Postgres",
    };
  }
}

async function loadCreateWorkbenchServer(appDir) {
  const serverModule = await import(pathToFileURL(path.join(appDir, "server.mjs")).href);
  return serverModule.createWorkbenchServer;
}

export async function checkLocalWorkerRuntimePolicy({
  appDir = process.cwd(),
  readFileFn = readFile,
} = {}) {
  try {
    const serverSource = await readFileFn(path.join(appDir, "server.mjs"), "utf8");
    const workerFunctionsSql = await readFileFn(path.join(appDir, "db", "migrations", "008_job_worker_functions.sql"), "utf8");
    const localRuntimeAvoidsDbWorker = !/\bclaim_next_processing_job\b|\bclaim_next_job_outbox_event\b|\bprocessing_jobs\b|\bjob_outbox\b/i.test(serverSource);
    const dbWorkerRecoveryPrepared = /create or replace function claim_next_processing_job\(/i.test(workerFunctionsSql)
      && /create or replace function heartbeat_processing_job\(/i.test(workerFunctionsSql)
      && /create or replace function complete_processing_job\(/i.test(workerFunctionsSql)
      && /create or replace function claim_next_job_outbox_event\(/i.test(workerFunctionsSql)
      && /create or replace function complete_job_outbox_event\(/i.test(workerFunctionsSql);

    return {
      accepted: Boolean(localRuntimeAvoidsDbWorker && dbWorkerRecoveryPrepared),
      behavior: localRuntimeAvoidsDbWorker && dbWorkerRecoveryPrepared
        ? "local_preparation_runs_foreground_db_worker_recovery_functions_exist"
        : "local_worker_runtime_policy_incomplete",
      reason: localRuntimeAvoidsDbWorker
        ? dbWorkerRecoveryPrepared ? "" : "database worker recovery functions are incomplete"
        : "local runtime is already coupled to DB worker queues",
    };
  } catch (error) {
    return {
      accepted: false,
      behavior: "local_worker_runtime_policy_check_failed",
      reason: error?.message || "worker runtime policy could not be checked",
    };
  }
}

function extractDatabaseUrlStatus(lines) {
  const value = extractDoctorValue(lines, "database_url");
  if (value === "configured" || value === "missing") return value;
  return "unknown";
}

export async function checkShadowStorageBackupEvidence({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
  backupRoot = path.resolve(".local", "shadow-storage-backups"),
  storagePlan,
  collectStoragePlan = collectLocalStorageHydrationPlan,
  restoreCheckFn = runShadowStorageRestoreCheck,
} = {}) {
  const manifestPath = await latestStorageBackupManifest(backupRoot);
  if (!manifestPath) {
    return {
      accepted: false,
      reason: "no storage backup manifest",
      checkedObjects: 0,
      missingCurrentObjects: 0,
      hashMismatches: 0,
    };
  }

  const plan = storagePlan || await collectStoragePlan({ appDir, mattersHome });
  const currentObjects = currentPdfObjectMap(plan);
  const restoreCheck = await restoreCheckFn({ manifestPath }).catch((error) => ({
    success: false,
    checkedObjects: 0,
    failedObjects: 1,
    failures: [{ reason: error?.message || "restore check failed" }],
  }));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifestObjects = new Map((manifest.objects || []).map((object) => [
    normalizeObjectKey(object.objectKey),
    object,
  ]));
  const missingCurrentObjects = [];
  const hashMismatches = [];

  for (const [objectKey, current] of currentObjects) {
    const backedUp = manifestObjects.get(objectKey);
    if (!backedUp) {
      missingCurrentObjects.push(objectKey);
      continue;
    }
    if (current.sha256 && backedUp.sha256 && current.sha256 !== backedUp.sha256) {
      hashMismatches.push(objectKey);
    }
  }

  return {
    accepted: Boolean(restoreCheck.success && missingCurrentObjects.length === 0 && hashMismatches.length === 0),
    reason: restoreCheck.success ? "" : "storage restore check failed",
    manifest: path.basename(manifestPath),
    checkedObjects: restoreCheck.checkedObjects || 0,
    missingCurrentObjects: missingCurrentObjects.length,
    hashMismatches: hashMismatches.length,
    failedObjects: restoreCheck.failedObjects || 0,
  };
}

async function latestStorageBackupManifest(backupRoot) {
  const entries = await readdir(backupRoot, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(backupRoot, entry.name, "manifest.json");
    const stats = await stat(manifestPath).catch(() => null);
    if (!stats) continue;
    candidates.push({ manifestPath, mtimeMs: stats.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.manifestPath || "";
}

function currentPdfObjectMap(plan = {}) {
  const objects = new Map();
  for (const object of plan.storageObjects || []) {
    if (!isLocalPdfStorageObject(object)) continue;
    objects.set(normalizeObjectKey(object.objectKey), {
      objectKey: normalizeObjectKey(object.objectKey),
      sha256: String(object.sha256 || ""),
    });
  }
  return objects;
}

function isLocalPdfStorageObject(object = {}) {
  if (object.storageProvider !== "local-filesystem") return false;
  const objectKey = String(object.objectKey || "").toLowerCase();
  const mimeType = String(object.mimeType || "").toLowerCase();
  return mimeType === "application/pdf" || objectKey.endsWith(".pdf");
}

function normalizeObjectKey(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
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
