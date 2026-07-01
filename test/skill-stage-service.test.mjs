import assert from "node:assert/strict";
import test from "node:test";

import { runRecordedStage } from "../services/skill-stage-service.mjs";

test("runRecordedStage records success with computed stage patch", async () => {
  const events = [];
  const result = await runRecordedStage(recordingStageRecorder(events), {
    id: "generate",
    label: "Generate artifact",
  }, async () => ({ tokens: 42 }), {
    successPatch: (value) => ({ summary: `${value.tokens} tokens`, salvageable: false }),
  });

  assert.deepEqual(result, { tokens: 42 });
  assert.deepEqual(events, [
    { status: "running", stage: { id: "generate", label: "Generate artifact" } },
    { status: "succeeded", stage: { id: "generate", label: "Generate artifact", summary: "42 tokens", salvageable: false } },
  ]);
});

test("runRecordedStage records failure and rethrows", async () => {
  const events = [];
  const error = new Error("Unexpected end of JSON input");
  error.code = "provider.invalid_json";

  await assert.rejects(
    () => runRecordedStage(recordingStageRecorder(events), { id: "finalizer" }, async () => {
      throw error;
    }),
    /Unexpected end of JSON input/,
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].status, "running");
  assert.equal(events[1].status, "failed");
  assert.equal(events[1].stage.id, "finalizer");
  assert.equal(events[1].error.code, "provider.invalid_json");
});

function recordingStageRecorder(events) {
  return {
    startStage: async (stage) => events.push({ status: "running", stage }),
    succeedStage: async (stage) => events.push({ status: "succeeded", stage }),
    failStage: async (stage, error) => events.push({ status: "failed", stage, error }),
  };
}
