#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { runShadowBackup } from "./db-shadow-backup.mjs";
import { runShadowRestoreDrill } from "./db-shadow-restore-drill.mjs";
import { runShadowStorageBackup } from "./db-shadow-storage-backup.mjs";
import { runShadowStorageRestoreCheck } from "./db-shadow-storage-restore-check.mjs";
import { runPrivateVmServiceCheck } from "./private-vm-service-check.mjs";
import { runV4DbBackup } from "./v4-db-backup.mjs";
import { runV4DbRestoreDrill } from "./v4-db-restore-drill.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-vm-recoverability-pack/v1";

export function parseRecoverabilityPackArgs(argv = [], env = process.env) {
  const parsed = {
    outDir: path.resolve(".local", "private-vm-recoverability-packs"),
    timestamp: "",
    baseUrl: env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191",
    mattersHome: "",
    storageMode: env.MWB_RUNTIME_DB_STORAGE || "",
    authUsername: env.MWB_PRIVATE_BETA_USERNAME || "",
    authPassword: env.MWB_PRIVATE_BETA_PASSWORD || "",
    skipServiceCheck: false,
    skipDbRestore: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a value");
      parsed.outDir = path.resolve(value);
      i += 1;
    } else if (arg === "--timestamp") {
      const value = argv[i + 1];
      if (!value) throw new Error("--timestamp requires a value");
      parsed.timestamp = value;
      i += 1;
    } else if (arg === "--base-url") {
      const value = argv[i + 1];
      if (!value) throw new Error("--base-url requires a value");
      parsed.baseUrl = value.replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--matters-home") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matters-home requires a value");
      parsed.mattersHome = path.resolve(value);
      i += 1;
    } else if (arg === "--storage-mode") {
      const value = argv[i + 1];
      if (!value) throw new Error("--storage-mode requires a value");
      parsed.storageMode = value;
      i += 1;
    } else if (arg === "--auth-username") {
      const value = argv[i + 1];
      if (!value) throw new Error("--auth-username requires a value");
      parsed.authUsername = value;
      i += 1;
    } else if (arg === "--auth-password") {
      const value = argv[i + 1];
      if (!value) throw new Error("--auth-password requires a value");
      parsed.authPassword = value;
      i += 1;
    } else if (arg === "--skip-service-check") {
      parsed.skipServiceCheck = true;
    } else if (arg === "--skip-db-restore") {
      parsed.skipDbRestore = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runPrivateVmRecoverabilityPack({
  outDir = path.resolve(".local", "private-vm-recoverability-packs"),
  timestamp = new Date().toISOString(),
  baseUrl = "http://127.0.0.1:4191",
  mattersHome = "",
  storageMode = process.env.MWB_RUNTIME_DB_STORAGE || "",
  authUsername = "",
  authPassword = "",
  skipServiceCheck = false,
  skipDbRestore = false,
  backupDbFn = runShadowBackup,
  restoreDbFn = runShadowRestoreDrill,
  backupV4DbFn = runV4DbBackup,
  restoreV4DbFn = runV4DbRestoreDrill,
  storageBackupFn = runShadowStorageBackup,
  storageRestoreCheckFn = runShadowStorageRestoreCheck,
  serviceCheckFn = runPrivateVmServiceCheck,
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const packDir = path.join(outDir, `private-vm-recoverability-pack-${slug}`);
  await mkdir(packDir, { recursive: true });

  const steps = {
    dbBackup: await runStep("db_backup", async () => {
      const result = await backupDbFn({
        outDir: path.join(packDir, "db"),
        timestamp: generatedAt,
      });
      return {
        ok: Boolean(result.success),
        backupPath: result.backupPath || "",
        manifestPath: result.manifestPath || "",
        bytes: result.bytes || 0,
        sha256: result.sha256 || "",
        error: result.success ? "" : result.error || result.stderr || "database backup failed",
      };
    }),
    dbRestore: null,
    v4DbBackup: null,
    v4DbRestore: null,
    storageBackup: null,
    storageRestoreCheck: null,
    serviceCheck: null,
  };

  steps.dbRestore = skipDbRestore
    ? skippedStep("db_restore", "skipped by --skip-db-restore")
    : await runStep("db_restore", async () => {
      if (!steps.dbBackup.ok) return { ok: false, error: "database backup did not succeed" };
      const result = await restoreDbFn({
        backupPath: steps.dbBackup.backupPath,
        outDir: path.join(packDir, "db-restore-drills"),
        verificationMode: "sql-summary",
        timestamp: generatedAt,
      });
      return {
        ok: Boolean(result.success),
        restoredDatabase: result.restoredDatabase || "",
        cleanup: Boolean(result.cleanup),
        failedStep: result.failedStep?.label || "",
        error: result.success ? "" : result.failedStep?.label || "database restore drill failed",
      };
    });

  steps.v4DbBackup = await runStep("v4_db_backup", async () => {
    const result = await backupV4DbFn({ outDir: path.join(packDir, "v4-db"), timestamp: generatedAt });
    return {
      ok: Boolean(result.success), backupPath: result.backupPath || "", manifestPath: result.manifestPath || "",
      bytes: result.bytes || 0, sha256: result.sha256 || "",
      error: result.success ? "" : result.error || "V4 database backup failed",
    };
  });

  steps.v4DbRestore = await runStep("v4_db_restore", async () => {
    if (!steps.v4DbBackup.ok) return { ok: false, error: "V4 database backup did not succeed" };
    const result = await restoreV4DbFn({
      backupPath: steps.v4DbBackup.backupPath, manifestPath: steps.v4DbBackup.manifestPath,
      outDir: path.join(packDir, "v4-db-restore-drills"), timestamp: generatedAt,
    });
    return {
      ok: Boolean(result.success), restoredDatabase: result.restoredDatabase || "", cleanup: Boolean(result.cleanup),
      reportPath: result.reportPath || "", error: result.success ? "" : "V4 database restore drill failed",
    };
  });

  const dbBackedStorage = String(storageMode || "").trim().toLowerCase() === "postgres" && !mattersHome;
  steps.storageBackup = dbBackedStorage
    ? skippedStep("storage_backup", "runtime DB storage mode is postgres; local filesystem storage backup is not required")
    : await runStep("storage_backup", async () => {
      const options = {
        outDir: path.join(packDir, "storage"),
        timestamp: generatedAt,
      };
      if (mattersHome) options.mattersHome = mattersHome;
      const result = await storageBackupFn(options);
      return {
        ok: Boolean(result.success),
        backupDir: result.backupDir || "",
        manifestPath: result.manifestPath || "",
        pdfObjects: result.pdfObjects || 0,
        objectsCopied: result.objectsCopied || 0,
        failedObjects: result.failedObjects || 0,
        error: result.success ? "" : summarizeFailures(result.failures) || "storage backup failed",
      };
    });

  steps.storageRestoreCheck = dbBackedStorage
    ? skippedStep("storage_restore_check", "runtime DB storage mode is postgres; database restore covers stored payloads")
    : await runStep("storage_restore_check", async () => {
      if (!steps.storageBackup.ok) return { ok: false, error: "storage backup did not succeed" };
      const result = await storageRestoreCheckFn({
        manifestPath: steps.storageBackup.manifestPath,
        outDir: path.join(packDir, "storage-restore-checks"),
        timestamp: generatedAt,
      });
      return {
        ok: Boolean(result.success),
        checkedObjects: result.checkedObjects || 0,
        failedObjects: result.failedObjects || 0,
        error: result.success ? "" : summarizeFailures(result.failures) || "storage restore check failed",
      };
    });

  steps.serviceCheck = skipServiceCheck
    ? skippedStep("service_check", "skipped by --skip-service-check")
    : await runStep("service_check", async () => {
      const result = await serviceCheckFn({ baseUrl, authUsername, authPassword });
      return {
        ok: Boolean(result.passed),
        baseUrl,
        matterCount: result.matterCount || 0,
        targetMatter: result.targetMatter || "",
        error: result.passed ? "" : result.error || "private VM service check failed",
      };
    });

  const failedSteps = Object.values(steps)
    .filter((step) => !step.ok)
    .map((step) => step.label);
  const result = {
    schemaVersion: SCHEMA_VERSION,
    success: failedSteps.length === 0,
    generatedAt,
    packDir,
    baseUrl: skipServiceCheck ? "" : baseUrl,
    failedSteps,
    steps,
  };
  result.files = await writeEvidence(result);
  return result;
}

export function renderPrivateVmRecoverabilityPackResult(result = {}) {
  const lines = [
    "Matter Workbench private VM recoverability pack",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `pack_dir: ${result.packDir || ""}`,
    `db_backup: ${result.steps?.dbBackup?.ok ? "ok" : "failed"}`,
    `db_restore: ${result.steps?.dbRestore?.ok ? "ok" : "failed"}`,
    `v4_db_backup: ${result.steps?.v4DbBackup?.ok ? "ok" : "failed"}`,
    `v4_db_restore: ${result.steps?.v4DbRestore?.ok ? "ok" : "failed"}`,
    `storage_backup: ${result.steps?.storageBackup?.ok ? "ok" : "failed"}`,
    `storage_restore_check: ${result.steps?.storageRestoreCheck?.ok ? "ok" : "failed"}`,
    `service_check: ${result.steps?.serviceCheck?.ok ? "ok" : "failed"}`,
  ];
  if (result.failedSteps?.length) lines.push(`failed_steps: ${result.failedSteps.join(", ")}`);
  if (result.files?.markdown) lines.push(`evidence_md: ${result.files.markdown}`);
  if (result.files?.json) lines.push(`evidence_json: ${result.files.json}`);
  return lines.map(redactLine);
}

async function runStep(label, fn) {
  try {
    return normalizeStep(label, await fn());
  } catch (error) {
    return normalizeStep(label, {
      ok: false,
      error: error?.message || `${label} failed`,
    });
  }
}

function skippedStep(label, reason) {
  return normalizeStep(label, {
    ok: true,
    skipped: true,
    reason,
  });
}

function normalizeStep(label, fields = {}) {
  return {
    label,
    ok: Boolean(fields.ok),
    skipped: Boolean(fields.skipped),
    ...fields,
    error: redactLine(fields.error || ""),
  };
}

async function writeEvidence(result) {
  const jsonPath = path.join(result.packDir, "recoverability-pack.json");
  const markdownPath = path.join(result.packDir, "recoverability-pack.md");
  const evidence = toPortableEvidence(result);
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderEvidenceMarkdown(evidence).join("\n")}\n`, "utf8");
  return {
    json: jsonPath,
    markdown: markdownPath,
  };
}

function toPortableEvidence(result) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: result.generatedAt || "",
    success: Boolean(result.success),
    baseUrl: result.baseUrl || "",
    failedSteps: result.failedSteps || [],
    steps: {
      dbBackup: pickStep(result.steps?.dbBackup, ["ok", "backupPath", "manifestPath", "bytes", "sha256", "error"]),
      dbRestore: pickStep(result.steps?.dbRestore, ["ok", "skipped", "restoredDatabase", "cleanup", "failedStep", "error"]),
      v4DbBackup: pickStep(result.steps?.v4DbBackup, ["ok", "backupPath", "manifestPath", "bytes", "sha256", "error"]),
      v4DbRestore: pickStep(result.steps?.v4DbRestore, ["ok", "restoredDatabase", "cleanup", "reportPath", "error"]),
      storageBackup: pickStep(result.steps?.storageBackup, ["ok", "backupDir", "manifestPath", "pdfObjects", "objectsCopied", "failedObjects", "error"]),
      storageRestoreCheck: pickStep(result.steps?.storageRestoreCheck, ["ok", "checkedObjects", "failedObjects", "error"]),
      serviceCheck: pickStep(result.steps?.serviceCheck, ["ok", "skipped", "baseUrl", "matterCount", "targetMatter", "error"]),
    },
  };
}

function pickStep(step = {}, keys = []) {
  const picked = {};
  for (const key of keys) {
    if (step[key] !== undefined) picked[key] = typeof step[key] === "string" ? redactLine(step[key]) : step[key];
  }
  return picked;
}

function renderEvidenceMarkdown(evidence = {}) {
  const lines = [
    "# Matter Workbench Private VM Recoverability Pack",
    "",
    `Generated at: ${evidence.generatedAt || ""}`,
    `Success: ${evidence.success ? "yes" : "no"}`,
    `Service URL: ${evidence.baseUrl || "(service check skipped)"}`,
    "",
    "This pack is the private-VM recovery proof. It ties together the Postgres backup, restored-database drill, local storage-object backup, storage hash check, and optional live service check.",
    "",
    "## Result",
    "",
    `- Database backup: ${evidence.steps?.dbBackup?.ok ? "ok" : "failed"}`,
    `- Database restore drill: ${evidence.steps?.dbRestore?.ok ? "ok" : "failed"}`,
    `- V4 database backup: ${evidence.steps?.v4DbBackup?.ok ? "ok" : "failed"}`,
    `- V4 database restore drill: ${evidence.steps?.v4DbRestore?.ok ? "ok" : "failed"}`,
    `- Storage backup: ${evidence.steps?.storageBackup?.ok ? "ok" : "failed"}`,
    `- Storage restore check: ${evidence.steps?.storageRestoreCheck?.ok ? "ok" : "failed"}`,
    `- Service check: ${evidence.steps?.serviceCheck?.ok ? "ok" : "failed"}`,
    "",
    "## Storage Boundary",
    "",
    "A DB backup alone is not a complete recovery artifact if any DB row points at local filesystem storage. The storage backup and restore check prove that those file bytes travel with the database backup.",
  ];
  if (evidence.failedSteps?.length) {
    lines.push("", "## Failed Steps", "");
    for (const step of evidence.failedSteps) lines.push(`- ${step}`);
  }
  return lines.map(redactLine);
}

function summarizeFailures(failures = []) {
  return failures.slice(0, 3).map((failure) => `${failure.objectKey || "object"}: ${failure.reason || "failed"}`).join("; ");
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function redactLine(value) {
  return redactSensitiveText(String(value || "")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@([^/\s]+)\/[^\s]+/g, "postgres://$1:***@$3")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***"));
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseRecoverabilityPackArgs(process.argv.slice(2));
  const result = await runPrivateVmRecoverabilityPack(args);
  for (const line of renderPrivateVmRecoverabilityPackResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.message));
    process.exitCode = 1;
  });
}
