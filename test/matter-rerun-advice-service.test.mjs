import assert from "node:assert/strict";
import test from "node:test";
import {
  isNewerByTrustedMtime,
  readRerunAdviceForSkill,
} from "../services/matter-rerun-advice-service.mjs";

test("rerun advice mtime comparison ignores unknown zero timestamps", () => {
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 0, targetMtimeMs: 0 }), false);
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 1000, targetMtimeMs: 0 }), false);
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 0, targetMtimeMs: 1000 }), false);
});

test("rerun advice mtime comparison only marks stale when both timestamps are trusted", () => {
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 1003, targetMtimeMs: 1000 }), true);
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 1000, targetMtimeMs: 1000 }), false);
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 1001, targetMtimeMs: 1000 }), false);
});

test("rerun advice exposes a stable code for unsupported skills", async () => {
  let thrown;
  try {
    await readRerunAdviceForSkill("/unknown_skill", "/tmp/matter");
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.code, "rerun_advice.unsupported_skill");
  assert.equal(thrown?.statusCode, 400);
});
