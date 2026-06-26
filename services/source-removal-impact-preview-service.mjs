import { buildMatterContextPacket } from "./matter-context-service.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const SOURCE_REMOVAL_IMPACT_PREVIEW_SCHEMA_VERSION = "source-removal-impact-preview/v1";

const FILE_ID_RE = /^FILE-\d{4,}$/;

export async function previewSourceRemovalImpact({ matterRoot, fileId, matterContextBuilder = buildMatterContextPacket } = {}) {
  if (!matterRoot) throw makeHttpError("Matter root is required.", 400, "source_removal_preview.matter_required");
  const packet = await matterContextBuilder(matterRoot);
  return buildSourceRemovalImpactPreviewFromPacket(packet, { fileId });
}

export function buildSourceRemovalImpactPreviewFromPacket(packet = {}, { fileId } = {}) {
  const normalizedFileId = normalizeFileId(fileId);
  if (!normalizedFileId) {
    throw makeHttpError("A valid FILE-NNNN id is required.", 400, "source_removal_preview.file_id_required");
  }

  const source = activeSourceForFileId(packet, normalizedFileId);
  const evidenceBlockCount = activeEvidenceBlockCount(packet, normalizedFileId);
  const listOfDatesReferences = listOfDatesReferenceCount(packet, normalizedFileId);
  const sourceIndexPresent = hasSourceIndex(packet);
  const affectedArtifacts = affectedArtifactsFor({
    source,
    evidenceBlockCount,
    listOfDatesReferences,
    sourceIndexPresent,
  });
  const canRemove = Boolean(source);
  const warnings = [];
  if (!canRemove) {
    warnings.push(`${normalizedFileId} is not in the active source set or is already inactive.`);
  }
  if (canRemove) {
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

function hasSourceIndex(packet = {}) {
  return (Array.isArray(packet.library_artifacts) ? packet.library_artifacts : [])
    .some((artifact) => artifact?.kind === "source_index");
}

function affectedArtifactsFor({ source, evidenceBlockCount, listOfDatesReferences, sourceIndexPresent }) {
  if (!source) return [];
  const affected = [];
  if (sourceIndexPresent) {
    affected.push({
      family: "source_index",
      effect: "mark_stale_or_refresh_needed",
      reason: "Source labels and active source inventory include the target source.",
    });
  }
  if (listOfDatesReferences > 0 || evidenceBlockCount > 0) {
    affected.push({
      family: "list_of_dates",
      effect: "chronology_regeneration_needed",
      reference_count: listOfDatesReferences,
      reason: "Chronology may cite or depend on the target source.",
    });
  }
  affected.push({
    family: "matter_story_and_source_backed_outputs",
    effect: "needs_review",
    reason: "Source-backed generated outputs may depend on the active source set.",
  });
  return affected;
}

function sanitizeSource(source = {}) {
  return removeEmpty({
    file_id: normalizeText(source.file_id),
    source_id: normalizeText(source.source_id),
    source_label: normalizeText(source.source_label),
    source_short_label: normalizeText(source.source_short_label),
    document_type: normalizeText(source.document_type),
    source_path: normalizeText(source.source_path),
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

function normalizeFileId(value = "") {
  const text = normalizeText(value).toUpperCase();
  return FILE_ID_RE.test(text) ? text : "";
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
