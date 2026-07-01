import assert from "node:assert/strict";
import test from "node:test";

import {
  firstBlockedRuntimePreparationStage,
  firstQueueableRuntimePreparationStage,
  RUNTIME_PREPARATION_ACTIVE_JOB_STATUSES,
  RUNTIME_PREPARATION_JOB_KIND_BY_SLASH,
  runtimePreparationJobKindForStage,
  runtimePreparationJobMetadataForStage,
  runtimePreparationStageShouldOverwrite,
  safeRuntimePreparationChainId,
} from "../shared/runtime-preparation-jobs.mjs";

test("runtime preparation job mapping covers the preparation chain", () => {
  assert.deepEqual(RUNTIME_PREPARATION_JOB_KIND_BY_SLASH, {
    "/matter-init": "matter_init",
    "/extract": "extract",
    "/describe_sources": "source_labels",
    "/create_listofdates": "case_timeline",
    "/the_story": "matter_story",
    "/procedural_posture_diagnosis": "posture_diagnosis",
  });
  assert.equal(runtimePreparationJobKindForStage({ slash: "/create_listofdates" }), "case_timeline");
  assert.equal(runtimePreparationJobKindForStage({ slash: "/procedural_posture_diagnosis" }), "posture_diagnosis");
  assert.equal(runtimePreparationJobKindForStage({ slash: "/unknown" }), "");
});

test("runtime preparation helpers select queueable and blocked stages", () => {
  const plan = {
    stages: [
      { id: "matter-init", slash: "/matter-init", action: "skip_current", state: "current" },
      { id: "create-listofdates", slash: "/create_listofdates", action: "confirm_paid_run", state: "missing" },
      { id: "dispute-story", slash: "/the_story", action: "blocked", reason: "Case Timeline required." },
    ],
  };
  assert.equal(firstQueueableRuntimePreparationStage(plan)?.id, "create-listofdates");
  assert.equal(firstBlockedRuntimePreparationStage(plan)?.id, "dispute-story");
  assert.deepEqual([...RUNTIME_PREPARATION_ACTIVE_JOB_STATUSES], ["queued", "running", "retrying"]);
});

test("runtime preparation stale Story and posture jobs request overwrite", () => {
  assert.equal(runtimePreparationStageShouldOverwrite({ slash: "/the_story", state: "stale" }), true);
  assert.equal(runtimePreparationStageShouldOverwrite({ slash: "/procedural_posture_diagnosis", state: "stale" }), true);
  assert.equal(runtimePreparationStageShouldOverwrite({ slash: "/the_story", state: "ready_to_run" }), false);
  assert.equal(runtimePreparationStageShouldOverwrite({ slash: "/create_listofdates", state: "stale" }), false);
  assert.deepEqual(runtimePreparationJobMetadataForStage({
    id: "dispute-story",
    slash: "/the_story",
    state: "stale",
    action: "confirm_paid_run",
  }), {
    preparationStage: {
      id: "dispute-story",
      slash: "/the_story",
      state: "stale",
      action: "confirm_paid_run",
    },
    forceOverwrite: true,
  });
});

test("runtime preparation chain ids are safe and bounded", () => {
  assert.equal(safeRuntimePreparationChainId(" manual run / with spaces "), "manual-run-with-spaces");
  assert.equal(safeRuntimePreparationChainId("a".repeat(200)).length, 120);
});
