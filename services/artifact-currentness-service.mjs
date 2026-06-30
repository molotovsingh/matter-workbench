import { stat } from "node:fs/promises";
import path from "node:path";

import {
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import { CASE_TIMELINE_DEPENDENCY_STATES } from "../shared/case-timeline-dependency-states.mjs";
import { RERUN_ADVICE_STATES } from "../shared/rerun-advice-states.mjs";
import { makeHttpError, toPosix } from "../shared/safe-paths.mjs";
import {
  caseTimelineRerunAdvice,
  describeSourcesRerunAdvice,
  isNewerByTrustedMtime,
} from "./matter-rerun-advice-service.mjs";
import {
  DISPUTE_STORY_BASIS_RELATIVE,
  DISPUTE_STORY_OUTPUT_RELATIVE,
} from "./matter-story-service.mjs";

export const ARTIFACT_CURRENTNESS_RECORD_SCHEMA_VERSION = "artifact-currentness-record/v1";
export const ARTIFACT_CURRENTNESS_PROJECTION_SCHEMA_VERSION = "artifact-currentness-projection/v1";

export const ARTIFACT_CURRENTNESS_FAMILIES = Object.freeze({
  SOURCE_INDEX: "source_index",
  LIST_OF_DATES: "list_of_dates",
  MATTER_STORY: "matter_story",
  CUSTOM_SKILL_OUTPUT: "custom_skill_output",
});

export const ARTIFACT_CURRENTNESS_STATES = Object.freeze({
  CURRENT: "current",
  STALE: "stale",
  MISSING: "missing",
  FAILED: "failed",
  MISSING_UPSTREAM: "missing_upstream",
  NEEDS_REVIEW: "needs_review",
  UNKNOWN: "unknown",
});

export const ARTIFACT_CURRENTNESS_DEPENDENCY_STATES = Object.freeze({
  LABEL_REFRESH_NEEDED: CASE_TIMELINE_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED,
  CHRONOLOGY_REVIEW_NEEDED: CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED,
  CHRONOLOGY_REGENERATION_NEEDED: CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED,
  SOURCE_SET_CHANGED: "source_set_changed",
  SOURCE_SET_REVIEW_NEEDED: "source_set_review_needed",
});

const ARTIFACT_FAMILY_VALUES = new Set(Object.values(ARTIFACT_CURRENTNESS_FAMILIES));
const ARTIFACT_STATE_VALUES = new Set(Object.values(ARTIFACT_CURRENTNESS_STATES));
const DEPENDENCY_STATE_VALUES = new Set(["", ...Object.values(ARTIFACT_CURRENTNESS_DEPENDENCY_STATES)]);
const FILE_ID_RE = /^FILE-\d{4,}$/;
const SAFE_REASON_CODE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const METADATA_STRING_KEYS = new Set([
  "artifactUpdatedAt",
  "basisPath",
  "basisUpdatedAt",
  "lastRunAt",
  "newestInputAt",
  "newestInputPath",
  "skill",
]);
const METADATA_NUMBER_KEYS = new Set(["inputCount"]);

export async function readLocalArtifactCurrentnessProjection(root, {
  matterName = "",
  now = () => new Date(),
} = {}) {
  if (!root) throw makeHttpError("Matter root is required.", 400, "artifact_currentness.matter_required");
  const observedAt = isoNow(now);
  const [sourceAdvice, chronologyAdvice] = await Promise.all([
    describeSourcesRerunAdvice(root),
    caseTimelineRerunAdvice(root),
  ]);
  const records = [
    currentnessRecordFromRerunAdvice(sourceAdvice, {
      artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.SOURCE_INDEX,
      artifactPath: SOURCE_INDEX_RELATIVE,
      matterName,
      observedAt,
    }),
    currentnessRecordFromRerunAdvice(chronologyAdvice, {
      artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.LIST_OF_DATES,
      artifactPath: CASE_TIMELINE_MARKDOWN_RELATIVE,
      matterName,
      observedAt,
    }),
    await readLocalMatterStoryCurrentness(root, { chronologyAdvice, matterName, observedAt }),
  ].filter(Boolean);
  return {
    schema_version: ARTIFACT_CURRENTNESS_PROJECTION_SCHEMA_VERSION,
    matterName: normalizeText(matterName),
    matterRoot: root,
    observedAt,
    records,
    staleCount: records.filter((record) => record.state === ARTIFACT_CURRENTNESS_STATES.STALE).length,
    needsReviewCount: records.filter((record) => record.state === ARTIFACT_CURRENTNESS_STATES.NEEDS_REVIEW).length,
  };
}

export function currentnessRecordFromRerunAdvice(advice = {}, {
  artifactFamily,
  artifactPath = "",
  matterName = "",
  observedAt = "",
} = {}) {
  return normalizeArtifactCurrentnessRecord({
    matterName,
    artifactFamily,
    artifactPath: normalizeText(advice.artifactPath) || artifactPath,
    state: mapRerunAdviceState(advice.state),
    dependencyState: normalizeText(advice.dependencyState),
    reasonCode: reasonCodeForRerunAdvice(advice),
    metadata: {
      skill: advice.skill,
      lastRunAt: advice.lastRunAt,
      newestInputPath: advice.newestInputPath,
      newestInputAt: advice.newestInputAt,
      inputCount: advice.inputCount,
    },
    observedAt,
    updatedAt: observedAt,
  });
}

export function buildSourceRemovalArtifactCurrentnessEffects({
  matterName = "",
  fileId = "",
  sourceIndexPresent = false,
  listOfDatesAffected = false,
  matterStoryPresent = false,
  customSkillOutputPaths = [],
  sourceEventId = "",
  observedAt = "",
} = {}) {
  const affectedFileIds = normalizeFileIds([fileId]);
  if (!affectedFileIds.length) {
    throw makeHttpError("A valid FILE-NNNN id is required.", 400, "artifact_currentness.file_id_required");
  }
  const records = [];
  if (sourceIndexPresent) {
    records.push(normalizeArtifactCurrentnessRecord({
      matterName,
      artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.SOURCE_INDEX,
      artifactPath: SOURCE_INDEX_RELATIVE,
      state: ARTIFACT_CURRENTNESS_STATES.STALE,
      dependencyState: ARTIFACT_CURRENTNESS_DEPENDENCY_STATES.SOURCE_SET_CHANGED,
      reasonCode: "source_removal.active_source_set_changed",
      affectedFileIds,
      sourceEventId,
      observedAt,
      updatedAt: observedAt,
    }));
  }
  if (listOfDatesAffected) {
    records.push(normalizeArtifactCurrentnessRecord({
      matterName,
      artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.LIST_OF_DATES,
      artifactPath: CASE_TIMELINE_MARKDOWN_RELATIVE,
      state: ARTIFACT_CURRENTNESS_STATES.STALE,
      dependencyState: ARTIFACT_CURRENTNESS_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED,
      reasonCode: "source_removal.chronology_regeneration_needed",
      affectedFileIds,
      sourceEventId,
      observedAt,
      updatedAt: observedAt,
    }));
  }
  if (matterStoryPresent) {
    records.push(normalizeArtifactCurrentnessRecord({
      matterName,
      artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.MATTER_STORY,
      artifactPath: DISPUTE_STORY_OUTPUT_RELATIVE,
      state: ARTIFACT_CURRENTNESS_STATES.NEEDS_REVIEW,
      dependencyState: ARTIFACT_CURRENTNESS_DEPENDENCY_STATES.SOURCE_SET_REVIEW_NEEDED,
      reasonCode: "source_removal.story_needs_review",
      affectedFileIds,
      sourceEventId,
      observedAt,
      updatedAt: observedAt,
    }));
  }
  for (const artifactPath of normalizeArtifactPaths(customSkillOutputPaths)) {
    records.push(normalizeArtifactCurrentnessRecord({
      matterName,
      artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.CUSTOM_SKILL_OUTPUT,
      artifactPath,
      state: ARTIFACT_CURRENTNESS_STATES.NEEDS_REVIEW,
      dependencyState: ARTIFACT_CURRENTNESS_DEPENDENCY_STATES.SOURCE_SET_REVIEW_NEEDED,
      reasonCode: "source_removal.custom_skill_output_needs_review",
      affectedFileIds,
      sourceEventId,
      observedAt,
      updatedAt: observedAt,
    }));
  }
  return records;
}

export function normalizeArtifactCurrentnessRecord(input = {}, { now = () => new Date() } = {}) {
  const artifactFamily = normalizeArtifactFamily(input.artifactFamily || input.artifact_family);
  const state = normalizeArtifactState(input.state);
  if (!artifactFamily) {
    throw makeHttpError("Artifact family is required.", 400, "artifact_currentness.artifact_family_required");
  }
  if (!state) {
    throw makeHttpError("Artifact currentness state is required.", 400, "artifact_currentness.state_required");
  }
  const observedAt = normalizeIso(input.observedAt || input.observed_at) || isoNow(now);
  return removeEmpty({
    schema_version: ARTIFACT_CURRENTNESS_RECORD_SCHEMA_VERSION,
    matterId: normalizeText(input.matterId || input.matter_id),
    matterName: normalizeText(input.matterName || input.matter_name),
    artifactId: normalizeText(input.artifactId || input.artifact_id),
    artifactFamily,
    artifactPath: normalizeArtifactPath(input.artifactPath || input.artifact_path),
    state,
    dependencyState: normalizeDependencyState(input.dependencyState || input.dependency_state),
    reasonCode: normalizeReasonCode(input.reasonCode || input.reason_code),
    sourceEventId: normalizeText(input.sourceEventId || input.source_event_id),
    affectedFileIds: normalizeFileIds(input.affectedFileIds || input.affected_file_ids || input.affected_file_ids_json),
    metadata: normalizeMetadata(input.metadata || input.metadata_json),
    observedAt,
    updatedAt: normalizeIso(input.updatedAt || input.updated_at) || observedAt,
  });
}

export function normalizeArtifactCurrentnessRecords(records = [], options = {}) {
  return (Array.isArray(records) ? records : [])
    .map((record) => {
      try {
        return normalizeArtifactCurrentnessRecord(record, options);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function readLocalMatterStoryCurrentness(root, { chronologyAdvice = {}, matterName = "", observedAt = "" } = {}) {
  const story = await statIfFile(path.join(root, DISPUTE_STORY_OUTPUT_RELATIVE));
  const listBasis = await newestStat([
    path.join(root, DISPUTE_STORY_BASIS_RELATIVE),
    path.join(root, CASE_TIMELINE_JSON_RELATIVE),
  ]);
  if (!story) {
    return normalizeArtifactCurrentnessRecord({
      matterName,
      artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.MATTER_STORY,
      artifactPath: DISPUTE_STORY_OUTPUT_RELATIVE,
      state: ARTIFACT_CURRENTNESS_STATES.MISSING,
      dependencyState: dependencyStateForStoryBasis(chronologyAdvice),
      reasonCode: "artifact_currentness.missing",
      observedAt,
      updatedAt: observedAt,
    });
  }
  if (chronologyAdvice?.state && chronologyAdvice.state !== RERUN_ADVICE_STATES.CURRENT) {
    return normalizeArtifactCurrentnessRecord({
      matterName,
      artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.MATTER_STORY,
      artifactPath: DISPUTE_STORY_OUTPUT_RELATIVE,
      state: ARTIFACT_CURRENTNESS_STATES.STALE,
      dependencyState: dependencyStateForStoryBasis(chronologyAdvice),
      reasonCode: "artifact_currentness.basis_not_current",
      metadata: {
        basisPath: chronologyAdvice.artifactPath || CASE_TIMELINE_MARKDOWN_RELATIVE,
        artifactUpdatedAt: story.mtime.toISOString(),
      },
      observedAt,
      updatedAt: observedAt,
    });
  }
  if (listBasis && isNewerByTrustedMtime({ inputMtimeMs: listBasis.mtimeMs, targetMtimeMs: story.mtimeMs })) {
    return normalizeArtifactCurrentnessRecord({
      matterName,
      artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.MATTER_STORY,
      artifactPath: DISPUTE_STORY_OUTPUT_RELATIVE,
      state: ARTIFACT_CURRENTNESS_STATES.STALE,
      dependencyState: ARTIFACT_CURRENTNESS_DEPENDENCY_STATES.SOURCE_SET_REVIEW_NEEDED,
      reasonCode: "artifact_currentness.basis_newer",
      metadata: {
        basisPath: toMatterRelative(root, listBasis.filePath),
        basisUpdatedAt: listBasis.mtime.toISOString(),
        artifactUpdatedAt: story.mtime.toISOString(),
      },
      observedAt,
      updatedAt: observedAt,
    });
  }
  return normalizeArtifactCurrentnessRecord({
    matterName,
    artifactFamily: ARTIFACT_CURRENTNESS_FAMILIES.MATTER_STORY,
    artifactPath: DISPUTE_STORY_OUTPUT_RELATIVE,
    state: ARTIFACT_CURRENTNESS_STATES.CURRENT,
    reasonCode: "artifact_currentness.current",
    metadata: {
      artifactUpdatedAt: story.mtime.toISOString(),
      ...(listBasis ? { basisPath: toMatterRelative(root, listBasis.filePath), basisUpdatedAt: listBasis.mtime.toISOString() } : {}),
    },
    observedAt,
    updatedAt: observedAt,
  });
}

function mapRerunAdviceState(state = "") {
  const normalized = normalizeText(state);
  return ARTIFACT_STATE_VALUES.has(normalized) ? normalized : ARTIFACT_CURRENTNESS_STATES.UNKNOWN;
}

function reasonCodeForRerunAdvice(advice = {}) {
  if (advice.state === RERUN_ADVICE_STATES.CURRENT) return "artifact_currentness.current";
  if (advice.state === RERUN_ADVICE_STATES.MISSING) return "artifact_currentness.missing";
  if (advice.state === RERUN_ADVICE_STATES.FAILED) return "artifact_currentness.failed";
  if (advice.state === RERUN_ADVICE_STATES.MISSING_UPSTREAM) return "artifact_currentness.missing_upstream";
  if (advice.dependencyState === CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED) {
    return "artifact_currentness.chronology_regeneration_needed";
  }
  if (/active source set/i.test(String(advice.reason || ""))) return "artifact_currentness.active_source_set_changed";
  if (advice.state === RERUN_ADVICE_STATES.STALE) return "artifact_currentness.upstream_changed";
  return "artifact_currentness.unknown";
}

function dependencyStateForStoryBasis(chronologyAdvice = {}) {
  const dependencyState = normalizeDependencyState(chronologyAdvice.dependencyState);
  if (dependencyState) return dependencyState;
  if (chronologyAdvice.state && chronologyAdvice.state !== RERUN_ADVICE_STATES.CURRENT) {
    return ARTIFACT_CURRENTNESS_DEPENDENCY_STATES.SOURCE_SET_REVIEW_NEEDED;
  }
  return "";
}

async function newestStat(filePaths = []) {
  const stats = [];
  for (const filePath of filePaths) {
    const info = await statIfFile(filePath);
    if (info) stats.push({ ...info, filePath });
  }
  return stats.reduce((newest, info) => (
    !newest || info.mtimeMs > newest.mtimeMs ? info : newest
  ), null);
}

async function statIfFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() ? fileStat : null;
  } catch {
    return null;
  }
}

function normalizeArtifactFamily(value = "") {
  const text = normalizeText(value);
  return ARTIFACT_FAMILY_VALUES.has(text) ? text : "";
}

function normalizeArtifactState(value = "") {
  const text = normalizeText(value);
  return ARTIFACT_STATE_VALUES.has(text) ? text : "";
}

function normalizeDependencyState(value = "") {
  const text = normalizeText(value);
  return DEPENDENCY_STATE_VALUES.has(text) ? text : "";
}

function normalizeReasonCode(value = "") {
  const text = normalizeText(value, 120);
  return SAFE_REASON_CODE_RE.test(text) ? text : "";
}

function normalizeArtifactPath(value = "") {
  const text = String(value || "").replace(/\0/g, "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  return normalizeText(text, 500);
}

function normalizeArtifactPaths(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(normalizeArtifactPath).filter(Boolean))];
}

function normalizeFileIds(value = []) {
  let items = value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      items = parsed;
    } catch {
      items = [value];
    }
  }
  return [...new Set((Array.isArray(items) ? items : [items])
    .map((item) => normalizeText(item).toUpperCase())
    .filter((item) => FILE_ID_RE.test(item)))];
}

function normalizeMetadata(metadata = {}) {
  const raw = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const output = {};
  for (const key of METADATA_STRING_KEYS) {
    const value = normalizeText(raw[key], 500);
    if (value) output[key] = value;
  }
  for (const key of METADATA_NUMBER_KEYS) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value >= 0) output[key] = Math.trunc(value);
  }
  return output;
}

function normalizeText(value, maxLength = 1000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function normalizeIso(value = "") {
  const text = normalizeText(value, 80);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isoNow(now = () => new Date()) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toMatterRelative(root, filePath) {
  return toPosix(path.relative(root, filePath));
}

function removeEmpty(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value) continue;
    if (Array.isArray(value) && !value.length) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = removeEmpty(value);
      if (!Object.keys(nested).length) continue;
      output[key] = nested;
      continue;
    }
    output[key] = value;
  }
  return output;
}
