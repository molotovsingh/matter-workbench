import { stat } from "node:fs/promises";
import path from "node:path";

import {
  CASE_TIMELINE_ARTIFACT_RELATIVE_CANDIDATES,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import {
  isInactiveSourceStatus,
  readSourceSuppressionIndex,
  sourceSuppressionEntryFor,
} from "./active-source-set-service.mjs";
import { listLocalConfigurableSkillOutputPaths } from "./configurable-skill-run-artifacts.mjs";
import { findLocalSourceRegisterRecord } from "./local-source-register-service.mjs";
import { buildMatterContextPacket } from "./matter-context-service.mjs";
import { DISPUTE_STORY_OUTPUT_RELATIVE } from "./matter-story-service.mjs";

export const SOURCE_REMOVAL_IMPACT_PREVIEW_SCHEMA_VERSION = "source-removal-impact-preview/v1";

const FILE_ID_RE = /^FILE-\d{4,}$/;

export async function previewSourceRemovalImpact({ matterRoot, fileId, matterContextBuilder = buildMatterContextPacket } = {}) {
  if (!matterRoot) throw makeHttpError("Matter root is required.", 400, "source_removal_preview.matter_required");
  const normalizedFileId = requireFileId(fileId);
  const [packet, registerRecord, suppressionIndex, customSkillOutputPaths] = await Promise.all([
    matterContextBuilder(matterRoot),
    findLocalSourceRegisterRecord(matterRoot, normalizedFileId),
    readSourceSuppressionIndex(matterRoot),
    listLocalConfigurableSkillOutputPaths({ matterRoot }),
  ]);
  const suppressedSource = sourceSuppressionEntryFor(registerRecord || { file_id: normalizedFileId }, suppressionIndex);
  return buildSourceRemovalImpactPreviewFromPacket(packet, {
    fileId: normalizedFileId,
    sourceRecord: suppressedSource || registerRecord,
    artifactInventory: {
      sourceIndexPresent: await fileExists(path.join(matterRoot, SOURCE_INDEX_RELATIVE)),
      listOfDatesPresent: await anyFileExists(matterRoot, CASE_TIMELINE_ARTIFACT_RELATIVE_CANDIDATES),
      matterStoryPresent: await fileExists(path.join(matterRoot, DISPUTE_STORY_OUTPUT_RELATIVE)),
      customSkillOutputPaths,
    },
  });
}

export function buildSourceRemovalImpactPreviewFromPacket(packet = {}, options = {}) {
  const normalizedFileId = requireFileId(options.fileId);
  const packetSource = activeSourceForFileId(packet, normalizedFileId);
  const hasSourceOverride = Object.hasOwn(options, "sourceRecord");
  const sourceRecord = hasSourceOverride ? options.sourceRecord : packetSource;
  const source = sourceRecord && !isInactiveSourceStatus(sourceRecord.status)
    ? { ...sourceRecord, ...(packetSource || {}), file_id: normalizedFileId }
    : null;
  const evidenceBlockCount = activeEvidenceBlockCount(packet, normalizedFileId);
  const listOfDatesReferences = listOfDatesReferenceCount(packet, normalizedFileId);
  const artifactInventory = normalizeArtifactInventory(packet, options.artifactInventory);
  const affectedArtifacts = affectedArtifactsFor({
    source,
    listOfDatesReferences,
    artifactInventory,
  });
  const canRemove = Boolean(source);
  const warnings = [];
  if (!canRemove) {
    warnings.push(`${normalizedFileId} is not in the active source register or is already inactive.`);
  } else {
    warnings.push("Removal must not delete bytes, extracted records, source descriptors, or generated artifacts.");
    warnings.push("Paid/model regeneration must be a separate explicit action.");
  }

  return removeEmpty({
    schema_version: SOURCE_REMOVAL_IMPACT_PREVIEW_SCHEMA_VERSION,
    file_id: normalizedFileId,
    can_remove: canRemove,
    action_label: "Remove from active record",
    requires_reason: true,
    requires_idempotency_key: true,
    physical_deletion: false,
    source: source ? sanitizeSource(source) : null,
    active_context: {
      source_records: source ? 1 : 0,
      evidence_blocks: evidenceBlockCount,
    },
    affected_artifacts: affectedArtifacts,
    warnings,
  });
}

function activeSourceForFileId(packet = {}, fileId = "") {
  return (Array.isArray(packet.sources) ? packet.sources : []).find((source) => source?.file_id === fileId) || null;
}

function activeEvidenceBlockCount(packet = {}, fileId = "") {
  return (Array.isArray(packet.evidence_blocks) ? packet.evidence_blocks : [])
    .filter((block) => block?.file_id === fileId || citationMentionsFileId(block?.citation, fileId))
    .length;
}

function listOfDatesReferenceCount(packet = {}, fileId = "") {
  let count = 0;
  for (const artifact of Array.isArray(packet.library_artifacts) ? packet.library_artifacts : []) {
    if (artifact?.kind !== "list_of_dates") continue;
    for (const entry of Array.isArray(artifact.entries) ? artifact.entries : []) {
      if (chronologyEntryMentionsFileId(entry, fileId)) count += 1;
    }
    for (const entry of Array.isArray(artifact.citation_index) ? artifact.citation_index : []) {
      if (chronologyEntryMentionsFileId(entry, fileId)) count += 1;
    }
  }
  return count;
}

function normalizeArtifactInventory(packet = {}, input = undefined) {
  const inventory = input && typeof input === "object" ? input : {};
  const artifacts = Array.isArray(packet.library_artifacts) ? packet.library_artifacts : [];
  return {
    sourceIndexPresent: typeof inventory.sourceIndexPresent === "boolean"
      ? inventory.sourceIndexPresent
      : artifacts.some((artifact) => artifact?.kind === "source_index"),
    listOfDatesPresent: typeof inventory.listOfDatesPresent === "boolean"
      ? inventory.listOfDatesPresent
      : artifacts.some((artifact) => artifact?.kind === "list_of_dates" || artifact?.kind === "list_of_dates_markdown"),
    matterStoryPresent: inventory.matterStoryPresent === true,
    customSkillOutputPaths: normalizeArtifactPaths(inventory.customSkillOutputPaths),
  };
}

function affectedArtifactsFor({ source, listOfDatesReferences, artifactInventory }) {
  if (!source) return [];
  const affected = [];
  if (artifactInventory.sourceIndexPresent) {
    affected.push({
      family: "source_index",
      effect: "mark_stale_or_refresh_needed",
      reason: "Source labels and active source inventory include the target source.",
    });
  }
  if (artifactInventory.listOfDatesPresent) {
    affected.push({
      family: "list_of_dates",
      effect: "chronology_regeneration_needed",
      reference_count: listOfDatesReferences,
      reason: "Chronology may cite or depend on the target source.",
    });
  }
  if (artifactInventory.matterStoryPresent) {
    affected.push({
      family: "matter_story",
      effect: "needs_review",
      reason: "Matter Story may depend on the active source set.",
    });
  }
  for (const artifactPath of artifactInventory.customSkillOutputPaths) {
    affected.push({
      family: "custom_skill_output",
      artifact_path: artifactPath,
      effect: "needs_review",
      reason: "Custom skill output may depend on the active source set.",
    });
  }
  return affected;
}

function sanitizeSource(source = {}) {
  return removeEmpty({
    file_id: normalizeText(source.file_id),
    source_id: normalizeText(source.source_id),
    source_label: normalizeText(source.source_label),
    source_short_label: normalizeText(source.source_short_label),
    original_name: normalizeText(source.original_name),
    document_type: normalizeText(source.document_type),
    source_path: normalizeText(source.source_path),
    status: normalizeText(source.status),
  });
}

function chronologyEntryMentionsFileId(entry = {}, fileId = "") {
  if (citationMentionsFileId(entry.citation, fileId)) return true;
  if (citationMentionsFileId(entry.source_label, fileId)) return true;
  if (citationMentionsFileId(entry.source_short_label, fileId)) return true;
  return (Array.isArray(entry.supporting_sources) ? entry.supporting_sources : [])
    .some((source) => chronologyEntryMentionsFileId(source, fileId));
}

function citationMentionsFileId(value = "", fileId = "") {
  return new RegExp(`(^|[^A-Z0-9-])${escapeRegExp(fileId)}([^A-Z0-9-]|$)`).test(String(value || "").toUpperCase());
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireFileId(value = "") {
  const fileId = normalizeFileId(value);
  if (!fileId) throw makeHttpError("A valid FILE-NNNN id is required.", 400, "source_removal_preview.file_id_required");
  return fileId;
}

function normalizeFileId(value = "") {
  const text = normalizeText(value).toUpperCase();
  return FILE_ID_RE.test(text) ? text : "";
}

function normalizeArtifactPaths(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().replaceAll("\\", "/").replace(/^\/+/, ""))
    .filter(Boolean))].sort();
}

async function anyFileExists(root, relativePaths = []) {
  for (const relativePath of relativePaths) {
    if (await fileExists(path.join(root, relativePath))) return true;
  }
  return false;
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function removeEmpty(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value) continue;
    if (Array.isArray(value) && value.length === 0) continue;
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
