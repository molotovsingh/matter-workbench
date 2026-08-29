import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runV4DbActivation } from "../scripts/v4-db-activate.mjs";

const FINGERPRINT = "b".repeat(64);

test("activation refuses absent, failed, stale evidence and auto-migration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-activate-"));
  try {
    const runtimeEnvPath = path.join(root, "runtime.env"); await writeFile(runtimeEnvPath, "OTHER=value\n");
    await assert.rejects(() => runV4DbActivation({ action: "activate", readinessPath: path.join(root, "missing.json"), runtimeEnvPath, env: { MWB_V4_AUTO_MIGRATE: "0" }, currentPostureFingerprint: FINGERPRINT, restart: async () => {} }), { code: "v4_db.readiness_missing" });
    const readinessPath = path.join(root, "readiness.json");
    await writeFile(readinessPath, JSON.stringify({ schemaVersion: "v4-db-readiness/v1", success: false, activationReady: false, postureFingerprint: FINGERPRINT }));
    await assert.rejects(() => runV4DbActivation({ action: "activate", readinessPath, runtimeEnvPath, env: { MWB_V4_AUTO_MIGRATE: "0" }, currentPostureFingerprint: FINGERPRINT, restart: async () => {} }), { code: "v4_db.readiness_failed" });
    await writeFile(readinessPath, JSON.stringify({ schemaVersion: "v4-db-readiness/v1", success: true, activationReady: true, postureFingerprint: "c".repeat(64) }));
    await assert.rejects(() => runV4DbActivation({ action: "activate", readinessPath, runtimeEnvPath, env: { MWB_V4_AUTO_MIGRATE: "0" }, currentPostureFingerprint: FINGERPRINT, restart: async () => {} }), { code: "v4_db.readiness_stale" });
    await writeFile(readinessPath, JSON.stringify({ schemaVersion: "v4-db-readiness/v1", success: true, activationReady: true, postureFingerprint: FINGERPRINT }));
    await assert.rejects(() => runV4DbActivation({ action: "activate", readinessPath, runtimeEnvPath, env: { MWB_V4_AUTO_MIGRATE: "1" }, currentPostureFingerprint: FINGERPRINT, restart: async () => {} }), { code: "v4_db.auto_migrate_invalid" });
    assert.equal(await readFile(runtimeEnvPath, "utf8"), "OTHER=value\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("activation atomically edits only the flag before restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-activate-"));
  try {
    const runtimeEnvPath = path.join(root, "runtime.env");
    await writeFile(runtimeEnvPath, "# preserved\nOTHER=value\nMWB_V4_INTAKE=0\n");
    const readinessPath = path.join(root, "readiness.json");
    await writeFile(readinessPath, JSON.stringify({ schemaVersion: "v4-db-readiness/v1", success: true, activationReady: true, postureFingerprint: FINGERPRINT }));
    let restarts = 0;
    const result = await runV4DbActivation({
      action: "activate", readinessPath, runtimeEnvPath,
      env: { MWB_V4_AUTO_MIGRATE: "0" }, currentPostureFingerprint: FINGERPRINT,
      restart: async () => { restarts += 1; assert.match(await readFile(runtimeEnvPath, "utf8"), /^MWB_V4_INTAKE=1$/m, "flag edit precedes restart"); },
    });
    assert.equal(result.success, true); assert.equal(restarts, 1);
    assert.equal(await readFile(runtimeEnvPath, "utf8"), "# preserved\nOTHER=value\nMWB_V4_INTAKE=1\n");
    assert.doesNotMatch(JSON.stringify(result), /password|postgres:\/\//i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("disable removes only the flag, preserves database state and dry-run mutates nothing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-disable-"));
  try {
    const runtimeEnvPath = path.join(root, "runtime.env"); await writeFile(runtimeEnvPath, "A=1\nMWB_V4_INTAKE=1\nB=2\n");
    let restarts = 0;
    const preview = await runV4DbActivation({ action: "disable", runtimeEnvPath, dryRun: true, restart: async () => { restarts += 1; } });
    assert.equal(preview.changed, true); assert.match(await readFile(runtimeEnvPath, "utf8"), /MWB_V4_INTAKE=1/); assert.equal(restarts, 0);
    const result = await runV4DbActivation({ action: "disable", runtimeEnvPath, restart: async () => { restarts += 1; } });
    assert.equal(result.success, true); assert.equal(restarts, 1);
    assert.equal(await readFile(runtimeEnvPath, "utf8"), "A=1\nB=2\n");
    assert.equal(result.databaseChanged, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
