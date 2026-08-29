import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readinessPostureFingerprint, runV4DbReadiness } from "../scripts/v4-db-readiness.mjs";

const SHA = "a".repeat(64);
const posture = {
  databaseHost: "beta-postgres:5432",
  database: { name: "matter_workbench_v4", configured: true, owner: "mwb_v4_migrator" },
  runtimeConfiguration: { poolMaximum: 16, autoMigrate: false },
  runtimeIdentity: {
    role: "mwb_v4_runtime", superuser: false, createDatabase: false, createRole: false,
    inherit: false, bypassRls: false, connectionLimit: 16,
    runtimeDatabaseDenied: true, mothershipDatabaseDenied: true, requiredPrivileges: true,
  },
  migrations: { complete: true, immutable: true, entries: [{ name: "001_control_plane.sql", sha256: SHA }] },
  backupPolicy: "private-vm-recoverability-pack/v1",
};

test("readiness emits the complete authoritative contract without secrets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-ready-"));
  try {
    const { backup, restore } = await evidence(root, posture);
    const result = await runV4DbReadiness({
      backupManifestPath: backup, restoreReportPath: restore, outDir: root,
      timestamp: "2026-08-29T08:00:00.000Z", inspect: async () => posture,
    });
    assert.equal(result.success, true);
    assert.equal(result.activationReady, true);
    assert.match(result.postureFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.failedChecks, []);
    assert.equal(result.database.name, "matter_workbench_v4");
    assert.equal(result.runtimeConfiguration.poolMaximum, 16);
    assert.equal(result.runtimeConfiguration.autoMigrate, false);
    assert.equal(result.runtimeIdentity.connectionLimit, 16);
    assert.equal(result.migrations.entries[0].sha256, SHA);
    assert.equal(result.backup.policy, "private-vm-recoverability-pack/v1");
    assert.equal(result.restore.cleanup, true);
    const text = `${await readFile(result.jsonPath, "utf8")}\n${await readFile(result.markdownPath, "utf8")}`;
    assert.doesNotMatch(text, /postgres(?:ql)?:\/\/|password|token=|super-secret/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fingerprint ignores evidence paths, timestamps and routine flag cycles", () => {
  const first = readinessPostureFingerprint({ ...posture, generatedAt: "a", evidencePath: "/one", flag: "0" });
  const second = readinessPostureFingerprint({ ...posture, generatedAt: "b", evidencePath: "/two", flag: "1" });
  assert.equal(first, second);
});

test("migration, role, budget, policy and location drift invalidate older restore proof", async () => {
  const variants = [
    { ...posture, migrations: { ...posture.migrations, entries: [{ name: "002_changed.sql", sha256: SHA }] } },
    { ...posture, runtimeIdentity: { ...posture.runtimeIdentity, connectionLimit: 15 } },
    { ...posture, runtimeConfiguration: { ...posture.runtimeConfiguration, poolMaximum: 15 } },
    { ...posture, backupPolicy: "different-policy/v2" },
    { ...posture, databaseHost: "moved-postgres:5432" },
  ];
  for (const [index, current] of variants.entries()) {
    const root = await mkdtemp(path.join(os.tmpdir(), `v4-stale-${index}-`));
    try {
      const { backup, restore } = await evidence(root, posture);
      const result = await runV4DbReadiness({ backupManifestPath: backup, restoreReportPath: restore, outDir: root, inspect: async () => current });
      assert.equal(result.activationReady, false);
      assert.ok(result.failedChecks.length > 0);
      assert.ok(result.failedChecks.every((code) => /^v4_readiness\.[a-z_]+$/.test(code)));
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

async function evidence(root, boundPosture) {
  const backup = path.join(root, "backup.json");
  const restore = path.join(root, "restore.json");
  await writeFile(backup, JSON.stringify({
    schemaVersion: "v4-db-backup/v1", generatedAt: "2026-08-29T07:30:00.000Z", success: true,
    databaseName: "matter_workbench_v4", backup: { bytes: 123, sha256: SHA },
  }));
  await writeFile(restore, JSON.stringify({
    schemaVersion: "v4-db-restore-drill/v1", generatedAt: "2026-08-29T07:31:00.000Z", success: true,
    cleanup: true, keep: false, sourceSha256: SHA, postureFingerprint: readinessPostureFingerprint(boundPosture),
    checks: { migrations: true, forcedRls: true, canary: true },
  }));
  return { backup, restore };
}
