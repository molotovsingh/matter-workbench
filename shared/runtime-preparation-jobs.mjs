import { PREPARATION_STAGE_ACTIONS } from "./preparation-stage-actions.mjs";

export const RUNTIME_PREPARATION_JOB_KIND_BY_SLASH = Object.freeze({
  "/matter-init": "matter_init",
  "/extract": "extract",
  "/describe_sources": "source_labels",
  "/create_listofdates": "case_timeline",
  "/the_story": "matter_story",
  "/procedural_posture_diagnosis": "posture_diagnosis",
});

export const RUNTIME_PREPARATION_STAGE_SLASHES = Object.freeze([
  "/matter-init",
  "/extract",
  "/describe_sources",
  "/create_listofdates",
  "/the_story",
  "/procedural_posture_diagnosis",
]);

const RUNTIME_PREPARATION_STAGE_ALIASES = Object.freeze({
  "matter-init": "/matter-init",
  matter_init: "/matter-init",
  extract: "/extract",
  "describe-sources": "/describe_sources",
  describe_sources: "/describe_sources",
  source_labels: "/describe_sources",
  "create-listofdates": "/create_listofdates",
  create_listofdates: "/create_listofdates",
  case_timeline: "/create_listofdates",
  "dispute-story": "/the_story",
  the_story: "/the_story",
  matter_story: "/the_story",
  "procedural-posture-diagnosis": "/procedural_posture_diagnosis",
  procedural_posture_diagnosis: "/procedural_posture_diagnosis",
  posture_diagnosis: "/procedural_posture_diagnosis",
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

export function normalizeRuntimePreparationStageSelector(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (RUNTIME_PREPARATION_STAGE_SLASHES.includes(text)) return text;
  const key = text.replace(/^\/+/, "").trim();
  return RUNTIME_PREPARATION_STAGE_ALIASES[key] || "";
}

export function runtimePreparationStageIndex(stageOrSelector = {}) {
  const slash = typeof stageOrSelector === "string"
    ? normalizeRuntimePreparationStageSelector(stageOrSelector)
    : normalizeRuntimePreparationStageSelector(stageOrSelector?.slash || stageOrSelector?.id || stageOrSelector?.kind);
  return slash ? RUNTIME_PREPARATION_STAGE_SLASHES.indexOf(slash) : -1;
}

export function isRuntimePreparationStageCurrent(stage = {}) {
  const action = String(stage?.action || "").trim();
  const state = String(stage?.state || "").trim();
  return action === PREPARATION_STAGE_ACTIONS.SKIP_CURRENT
    || state === "current"
    || state === "current_confirmed"
    || state === "current_corrected";
}

export function firstNonCurrentRuntimePreparationStageBefore(plan = {}, startStage = "") {
  const startIndex = runtimePreparationStageIndex(startStage);
  if (startIndex <= 0) return null;
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  return stages.find((stage) => {
    const index = runtimePreparationStageIndex(stage);
    return index >= 0 && index < startIndex && !isRuntimePreparationStageCurrent(stage);
  }) || null;
}

export function firstQueueableRuntimePreparationStage(plan = {}, { startStage = "" } = {}) {
  const startIndex = runtimePreparationStageIndex(startStage);
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  return stages.find((stage) => {
    const index = runtimePreparationStageIndex(stage);
    return (startIndex < 0 || index < 0 || index >= startIndex)
      && RUNTIME_PREPARATION_QUEUEABLE_ACTIONS.has(stage?.action);
  }) || null;
}

export function firstBlockedRuntimePreparationStage(plan = {}, { startStage = "" } = {}) {
  const startIndex = runtimePreparationStageIndex(startStage);
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  return stages.find((stage) => {
    const index = runtimePreparationStageIndex(stage);
    return (startIndex < 0 || index < 0 || index >= startIndex)
      && stage?.action === PREPARATION_STAGE_ACTIONS.BLOCKED;
  }) || null;
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
