import { PREPARATION_STAGE_ACTIONS } from "./preparation-stage-actions.mjs";

export const RUNTIME_PREPARATION_JOB_KIND_BY_SLASH = Object.freeze({
  "/matter-init": "matter_init",
  "/extract": "extract",
  "/describe_sources": "source_labels",
  "/create_listofdates": "case_timeline",
  "/the_story": "matter_story",
  "/procedural_posture_diagnosis": "posture_diagnosis",
});

export const RUNTIME_PREPARATION_ACTIVE_JOB_STATUSES = Object.freeze(["queued", "running", "retrying"]);

export const RUNTIME_PREPARATION_QUEUEABLE_ACTIONS = new Set([
  PREPARATION_STAGE_ACTIONS.RUN,
  PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN,
]);

const RUNTIME_PREPARATION_OVERWRITE_STALE_SLASHES = new Set([
  "/the_story",
  "/procedural_posture_diagnosis",
]);

export function normalizeRuntimePreparationJobKind(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]*$/.test(text) ? text : "";
}

export function runtimePreparationJobKindForStage(stage = {}) {
  return normalizeRuntimePreparationJobKind(
    RUNTIME_PREPARATION_JOB_KIND_BY_SLASH[String(stage?.slash || "").trim()] || "",
  );
}

export function firstQueueableRuntimePreparationStage(plan = {}) {
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  return stages.find((stage) => RUNTIME_PREPARATION_QUEUEABLE_ACTIONS.has(stage?.action)) || null;
}

export function firstBlockedRuntimePreparationStage(plan = {}) {
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  return stages.find((stage) => stage?.action === PREPARATION_STAGE_ACTIONS.BLOCKED) || null;
}

export function runtimePreparationStageShouldOverwrite(stage = {}) {
  const slash = String(stage?.slash || "").trim();
  const state = String(stage?.state || "").trim().toLowerCase();
  return RUNTIME_PREPARATION_OVERWRITE_STALE_SLASHES.has(slash) && state === "stale";
}

export function runtimePreparationJobMetadataForStage(stage = {}) {
  const preparationStage = {};
  for (const key of ["id", "slash", "state", "action"]) {
    const value = String(stage?.[key] || "").trim();
    if (value) preparationStage[key] = value;
  }
  return {
    ...(Object.keys(preparationStage).length ? { preparationStage } : {}),
    forceOverwrite: runtimePreparationStageShouldOverwrite(stage),
  };
}

export function safeRuntimePreparationChainId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
