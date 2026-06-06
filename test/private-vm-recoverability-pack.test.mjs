import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const packPath = new URL("../scripts/private-vm-recoverability-pack.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const privateVmReadmePath = new URL("../deployment/private-vm/README.md", import.meta.url);

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
      return {
        success: true,
        restoredDatabase: "matter_workbench_shadow_restore_test",
        cleanup: true,
      };
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
  assert.equal(evidence.steps.storageBackup.ok, true);
  assert.equal(evidence.steps.storageRestoreCheck.ok, true);
  assert.equal(evidence.steps.serviceCheck.ok, true);

  const rendered = renderPrivateVmRecoverabilityPackResult(result).join("\n");
  assert.match(rendered, /Matter Workbench private VM recoverability pack/);
  assert.match(rendered, /success: yes/);
  assert.match(rendered, /db_restore: ok/);
  assert.match(rendered, /storage_restore_check: ok/);
});

test("private VM recoverability pack fails closed when storage backup bytes do not verify", async () => {
  const { runPrivateVmRecoverabilityPack } = await import(packPath.href);

  const result = await runPrivateVmRecoverabilityPack({
    outDir: await mkdtemp(path.join(os.tmpdir(), "mwb-recoverability-pack-fail-")),
    timestamp: "2026-06-06T14:00:00.000Z",
    skipServiceCheck: true,
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

test("package and private VM docs expose the recoverability pack command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["private-vm:recoverability-pack"], "node scripts/private-vm-recoverability-pack.mjs");

  const readme = await readFile(privateVmReadmePath, "utf8");
  assert.match(readme, /private-vm:recoverability-pack/);
  assert.match(readme, /database backup/i);
  assert.match(readme, /storage backup/i);
});
