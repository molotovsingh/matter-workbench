import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runV4DbRestoreDrill } from "../scripts/v4-db-restore-drill.mjs";

test("restore verifies digest before creation, checks posture and cleans up", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-restore-"));
  try {
    const backup = path.join(root, "backup.sql");
    const bytes = Buffer.from("-- V4 backup\n");
    await writeFile(backup, bytes);
    const manifest = path.join(root, "manifest.json");
    await writeFile(manifest, JSON.stringify({ schemaVersion: "v4-db-backup/v1", success: true, databaseName: "matter_workbench_v4", backup: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } }));
    const calls = [];
    const result = await runV4DbRestoreDrill({
      adminUrl: "postgresql://admin:do-not-print@localhost/postgres",
      backupPath: backup,
      manifestPath: manifest,
      outDir: root,
      timestamp: "2026-08-29T07:01:02.003Z",
      postureFingerprint: "b".repeat(64),
      spawn(command, args) {
        calls.push(args.join(" "));
        if (args.includes("-tA")) return { status: 0, stdout: "ok\n", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.cleanup, true);
    assert.match(result.restoredDatabase, /^matter_workbench_v4_restore_[a-z0-9_]+$/);
    assert.deepEqual(result.checks, { migrations: true, forcedRls: true, canary: true });
    assert.match(calls.at(-1), /DROP DATABASE IF EXISTS/);
    const evidence = JSON.parse(await readFile(result.reportPath, "utf8"));
    assert.equal(evidence.schemaVersion, "v4-db-restore-drill/v1");
    assert.doesNotMatch(JSON.stringify(evidence), /do-not-print/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("digest mismatch fails before any database command", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-restore-"));
  try {
    const backup = path.join(root, "backup.sql");
    const manifest = path.join(root, "manifest.json");
    await writeFile(backup, "changed");
    await writeFile(manifest, JSON.stringify({ schemaVersion: "v4-db-backup/v1", success: true, databaseName: "matter_workbench_v4", backup: { bytes: 7, sha256: "a".repeat(64) } }));
    let calls = 0;
    await assert.rejects(() => runV4DbRestoreDrill({ adminUrl: "postgresql://admin:x@localhost/postgres", backupPath: backup, manifestPath: manifest, outDir: root, spawn() { calls += 1; } }), { code: "v4_db.backup_digest_mismatch" });
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("missing posture fingerprint cannot report activation-grade success", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-restore-"));
  try {
    const backup = path.join(root, "backup.sql"); const content = Buffer.from("ok"); const manifest = path.join(root, "manifest.json");
    await writeFile(backup, content);
    await writeFile(manifest, JSON.stringify({ schemaVersion: "v4-db-backup/v1", success: true, databaseName: "matter_workbench_v4", backup: { bytes: 2, sha256: createHash("sha256").update(content).digest("hex") } }));
    const result = await runV4DbRestoreDrill({ adminUrl: "postgresql://admin:x@localhost/postgres", backupPath: backup, manifestPath: manifest, outDir: root, spawn(command, args) { return { status: 0, stdout: args.includes("-tA") ? "ok\n" : "", stderr: "" }; } });
    assert.equal(result.success, false);
    assert.equal(result.cleanup, true);
    assert.equal(result.postureFingerprint, "");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("--keep evidence cannot report cleanup or activation-grade success", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-restore-"));
  try {
    const backup = path.join(root, "backup.sql");
    const content = Buffer.from("ok");
    const manifest = path.join(root, "manifest.json");
    await writeFile(backup, content);
    await writeFile(manifest, JSON.stringify({ schemaVersion: "v4-db-backup/v1", success: true, databaseName: "matter_workbench_v4", backup: { bytes: 2, sha256: createHash("sha256").update(content).digest("hex") } }));
    const result = await runV4DbRestoreDrill({ adminUrl: "postgresql://admin:x@localhost/postgres", backupPath: backup, manifestPath: manifest, outDir: root, keep: true, postureFingerprint: "c".repeat(64), spawn(command, args) { return { status: 0, stdout: args.includes("-tA") ? "ok\n" : "", stderr: "" }; } });
    assert.equal(result.success, false);
    assert.equal(result.cleanup, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
