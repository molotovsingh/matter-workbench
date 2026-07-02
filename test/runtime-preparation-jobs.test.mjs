import assert from "node:assert/strict";
import test from "node:test";

import {
  firstBlockedRuntimePreparationStage,
  firstNonCurrentRuntimePreparationStageBefore,
  firstQueueableRuntimePreparationStage,
  isRuntimePreparationStageCurrent,
  normalizeRuntimePreparationStageSelector,
  RUNTIME_PREPARATION_ACTIVE_JOB_STATUSES,
  RUNTIME_PREPARATION_JOB_KIND_BY_SLASH,
  RUNTIME_PREPARATION_STAGE_SLASHES,
  runtimePreparationJobKindForStage,
  runtimePreparationJobMetadataForStage,
  runtimePreparationStageIndex,
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
  assert.equal(firstQueueableRuntimePreparationStage(plan, { startStage: "/the_story" }), null);
  assert.equal(firstBlockedRuntimePreparationStage(plan)?.id, "dispute-story");
  assert.equal(firstBlockedRuntimePreparationStage(plan, { startStage: "matter_story" })?.id, "dispute-story");
  assert.deepEqual([...RUNTIME_PREPARATION_ACTIVE_JOB_STATUSES], ["queued", "running", "retrying"]);
});

test("runtime preparation helpers support targeted start stages", () => {
  const plan = {
    stages: [
      { id: "matter-init", slash: "/matter-init", action: "skip_current", state: "current" },
      { id: "extract", slash: "/extract", action: "skip_current", state: "current" },
      { id: "describe-sources", slash: "/describe_sources", action: "skip_current", state: "current" },
      { id: "create-listofdates", slash: "/create_listofdates", action: "confirm_paid_run", state: "stale" },
      { id: "dispute-story", slash: "/the_story", action: "confirm_paid_run", state: "missing" },
      { id: "procedural-posture-diagnosis", slash: "/procedural_posture_diagnosis", action: "blocked", state: "blocked" },
    ],
  };

  assert.deepEqual([...RUNTIME_PREPARATION_STAGE_SLASHES], ["/matter-init", "/extract", "/describe_sources", "/create_listofdates", "/the_story", "/procedural_posture_diagnosis"]);
  assert.equal(normalizeRuntimePreparationStageSelector("case_timeline"), "/create_listofdates");
  assert.equal(normalizeRuntimePreparationStageSelector("/procedural_posture_diagnosis"), "/procedural_posture_diagnosis");
  assert.equal(runtimePreparationStageIndex("matter_story"), 4);
  assert.equal(isRuntimePreparationStageCurrent(plan.stages[2]), true);
  assert.equal(firstQueueableRuntimePreparationStage(plan, { startStage: "case_timeline" })?.id, "create-listofdates");
  assert.equal(firstQueueableRuntimePreparationStage(plan, { startStage: "matter_story" })?.id, "dispute-story");
  assert.equal(firstNonCurrentRuntimePreparationStageBefore(plan, "matter_story")?.id, "create-listofdates");
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
