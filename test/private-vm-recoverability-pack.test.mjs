import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const packPath = new URL("../scripts/private-vm-recoverability-pack.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const privateVmReadmePath = new URL("../deployment/private-vm/README.md", import.meta.url);
const V4_STEPS = {
  backupV4DbFn: async () => ({ success: true, backupPath: "/tmp/v4.sql", manifestPath: "/tmp/v4.json", bytes: 11, sha256: "v4" }),
  restoreV4DbFn: async () => ({ success: true, restoredDatabase: "matter_workbench_v4_restore_test", cleanup: true, reportPath: "/tmp/v4-restore.json" }),
};

test("private VM recoverability pack runs DB, storage, and service checks in order", async () => {
  const { runPrivateVmRecoverabilityPack, renderPrivateVmRecoverabilityPackResult } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-recoverability-pack-"));
  const calls = [];

  const result = await runPrivateVmRecoverabilityPack({
    outDir,
    timestamp: "2026-06-06T14:00:00.000Z",
    baseUrl: "http://172.16.37.128:4191",
    backupDbFn: async ({ outDir: stepOutDir, timestamp }) => {
      calls.push(["db-backup", path.basename(stepOutDir), timestamp]);
      return {
        success: true,
        backupPath: path.join(stepOutDir, "shadow-db-backup.sql"),
        manifestPath: path.join(stepOutDir, "shadow-db-backup.json"),
        bytes: 123,
        sha256: "abc123",
      };
    },
    restoreDbFn: async ({ backupPath, outDir: stepOutDir, verificationMode }) => {
      calls.push(["db-restore", path.basename(backupPath), path.basename(stepOutDir), verificationMode]);
      return { success: true, restoredDatabase: "matter_workbench_shadow_restore_test", cleanup: true };
    },
    backupV4DbFn: async ({ outDir: stepOutDir, timestamp }) => {
      calls.push(["v4-db-backup", path.basename(stepOutDir), timestamp]);
      return { success: true, backupPath: path.join(stepOutDir, "v4.sql"), manifestPath: path.join(stepOutDir, "v4.json"), bytes: 456, sha256: "def456" };
    },
    restoreV4DbFn: async ({ backupPath, manifestPath, outDir: stepOutDir }) => {
      calls.push(["v4-db-restore", path.basename(backupPath), path.basename(manifestPath), path.basename(stepOutDir)]);
      return { success: true, restoredDatabase: "matter_workbench_v4_restore_test", cleanup: true, reportPath: path.join(stepOutDir, "report.json") };
    },
    storageBackupFn: async ({ outDir: stepOutDir, timestamp }) => {
      calls.push(["storage-backup", path.basename(stepOutDir), timestamp]);
      return {
        success: true,
        backupDir: path.join(stepOutDir, "shadow-storage-backup"),
        manifestPath: path.join(stepOutDir, "shadow-storage-backup", "manifest.json"),
        pdfObjects: 2,
        objectsCopied: 2,
        failedObjects: 0,
      };
    },
    storageRestoreCheckFn: async ({ manifestPath, outDir: stepOutDir }) => {
      calls.push(["storage-check", path.basename(manifestPath), path.basename(stepOutDir)]);
      return {
        success: true,
        checkedObjects: 2,
        failedObjects: 0,
      };
    },
    serviceCheckFn: async ({ baseUrl }) => {
      calls.push(["service-check", baseUrl]);
      return {
        passed: true,
        matterCount: 15,
        targetMatter: "Atlas Constuction vs Diptishree",
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.packDir.endsWith("private-vm-recoverability-pack-2026-06-06T14-00-00-000Z"), true);
  assert.deepEqual(calls, [
    ["db-backup", "db", "2026-06-06T14:00:00.000Z"],
    ["db-restore", "shadow-db-backup.sql", "db-restore-drills", "sql-summary"],
    ["v4-db-backup", "v4-db", "2026-06-06T14:00:00.000Z"],
    ["v4-db-restore", "v4.sql", "v4.json", "v4-db-restore-drills"],
    ["storage-backup", "storage", "2026-06-06T14:00:00.000Z"],
    ["storage-check", "manifest.json", "storage-restore-checks"],
    ["service-check", "http://172.16.37.128:4191"],
  ]);
  assert.equal(existsSync(result.files.json), true);
  assert.equal(existsSync(result.files.markdown), true);

  const evidence = JSON.parse(await readFile(result.files.json, "utf8"));
  assert.equal(evidence.schemaVersion, "private-vm-recoverability-pack/v1");
  assert.equal(evidence.success, true);
  assert.equal(evidence.steps.dbBackup.ok, true);
  assert.equal(evidence.steps.dbRestore.ok, true);
  assert.equal(evidence.steps.v4DbBackup.ok, true);
  assert.equal(evidence.steps.v4DbRestore.ok, true);
  assert.equal(evidence.steps.storageBackup.ok, true);
  assert.equal(evidence.steps.storageRestoreCheck.ok, true);
  assert.equal(evidence.steps.serviceCheck.ok, true);

  const rendered = renderPrivateVmRecoverabilityPackResult(result).join("\n");
  assert.match(rendered, /Matter Workbench private VM recoverability pack/);
  assert.match(rendered, /success: yes/);
  assert.match(rendered, /db_restore: ok/);
  assert.match(rendered, /storage_restore_check: ok/);
});

test("private VM recoverability pack fails atomically when V4 restore proof fails", async () => {
  const { runPrivateVmRecoverabilityPack } = await import(packPath.href);
  const result = await runPrivateVmRecoverabilityPack({
    outDir: await mkdtemp(path.join(os.tmpdir(), "mwb-recoverability-pack-v4-fail-")),
    timestamp: "2026-06-06T14:00:00.000Z", skipServiceCheck: true, storageMode: "postgres",
    backupDbFn: async () => ({ success: true, backupPath: "/tmp/db.sql", manifestPath: "/tmp/db.json", bytes: 10, sha256: "db" }),
    restoreDbFn: async () => ({ success: true, cleanup: true }),
    backupV4DbFn: async () => ({ success: true, backupPath: "/tmp/v4.sql", manifestPath: "/tmp/v4.json", bytes: 11, sha256: "v4" }),
    restoreV4DbFn: async () => ({ success: false, cleanup: true }),
  });
  assert.equal(result.success, false);
  assert.equal(result.steps.v4DbRestore.ok, false);
  assert.match(result.failedSteps.join(","), /v4_db_restore/);
});

test("private VM recoverability pack fails closed when storage backup bytes do not verify", async () => {
  const { runPrivateVmRecoverabilityPack } = await import(packPath.href);

  const result = await runPrivateVmRecoverabilityPack({
    outDir: await mkdtemp(path.join(os.tmpdir(), "mwb-recoverability-pack-fail-")),
    timestamp: "2026-06-06T14:00:00.000Z",
    skipServiceCheck: true,
    ...V4_STEPS,
    backupDbFn: async () => ({ success: true, backupPath: "/tmp/db.sql", manifestPath: "/tmp/db.json", bytes: 10, sha256: "db" }),
    restoreDbFn: async () => ({ success: true, cleanup: true }),
    storageBackupFn: async () => ({ success: true, manifestPath: "/tmp/storage/manifest.json", pdfObjects: 3, objectsCopied: 3, failedObjects: 0 }),
    storageRestoreCheckFn: async () => ({
      success: false,
      checkedObjects: 3,
      failedObjects: 1,
      failures: [{ objectKey: "Matter/a.pdf", reason: "hash mismatch" }],
    }),
    serviceCheckFn: async () => {
      throw new Error("should not run");
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.steps.storageRestoreCheck.ok, false);
  assert.equal(result.steps.serviceCheck.ok, true);
  assert.equal(result.steps.serviceCheck.skipped, true);
  assert.match(result.failedSteps.join(","), /storage_restore_check/);
});

test("private VM recoverability pack passes beta auth to service check", async () => {
  const { parseRecoverabilityPackArgs, runPrivateVmRecoverabilityPack } = await import(packPath.href);
  const parsed = parseRecoverabilityPackArgs([
    "--auth-username",
    "operator",
    "--auth-password",
    "private-secret",
  ], {});
  assert.equal(parsed.authUsername, "operator");
  assert.equal(parsed.authPassword, "private-secret");

  let serviceOptions = null;
  const result = await runPrivateVmRecoverabilityPack({
    outDir: await mkdtemp(path.join(os.tmpdir(), "mwb-recoverability-pack-auth-")),
    timestamp: "2026-06-06T14:00:00.000Z",
    ...V4_STEPS,
    authUsername: "operator",
    authPassword: "private-secret",
    backupDbFn: async () => ({ success: true, backupPath: "/tmp/db.sql", manifestPath: "/tmp/db.json", bytes: 10, sha256: "db" }),
    restoreDbFn: async () => ({ success: true, cleanup: true }),
    storageBackupFn: async () => ({ success: true, manifestPath: "/tmp/storage/manifest.json", pdfObjects: 0, objectsCopied: 0, failedObjects: 0 }),
    storageRestoreCheckFn: async () => ({ success: true, checkedObjects: 0, failedObjects: 0 }),
    serviceCheckFn: async (options) => {
      serviceOptions = options;
      return { passed: true, matterCount: 2, targetMatter: "Atlas" };
    },
  });

  assert.equal(result.success, true);
  assert.equal(serviceOptions.authUsername, "operator");
  assert.equal(serviceOptions.authPassword, "private-secret");
});

test("private VM recoverability pack skips local storage backup in postgres storage mode", async () => {
  const { parseRecoverabilityPackArgs, runPrivateVmRecoverabilityPack } = await import(packPath.href);
  const parsed = parseRecoverabilityPackArgs(["--storage-mode", "postgres"], {});
  assert.equal(parsed.storageMode, "postgres");

  const result = await runPrivateVmRecoverabilityPack({
    outDir: await mkdtemp(path.join(os.tmpdir(), "mwb-recoverability-pack-db-storage-")),
    timestamp: "2026-06-06T14:00:00.000Z",
    storageMode: "postgres",
    skipServiceCheck: true,
    ...V4_STEPS,
    backupDbFn: async () => ({ success: true, backupPath: "/tmp/db.sql", manifestPath: "/tmp/db.json", bytes: 10, sha256: "db" }),
    restoreDbFn: async () => ({ success: true, cleanup: true }),
    storageBackupFn: async () => {
      throw new Error("local storage backup should not run");
    },
    storageRestoreCheckFn: async () => {
      throw new Error("local storage restore check should not run");
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.steps.storageBackup.ok, true);
  assert.equal(result.steps.storageBackup.skipped, true);
  assert.equal(result.steps.storageRestoreCheck.ok, true);
  assert.equal(result.steps.storageRestoreCheck.skipped, true);
});

test("package and private VM docs expose the recoverability pack command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["private-vm:recoverability-pack"], "node scripts/private-vm-recoverability-pack.mjs");

  const readme = await readFile(privateVmReadmePath, "utf8");
  assert.match(readme, /private-vm:recoverability-pack/);
  assert.match(readme, /database backup/i);
  assert.match(readme, /storage backup/i);
});
