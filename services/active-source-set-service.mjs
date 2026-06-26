import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseCsv } from "../shared/csv.mjs";
import { toPosix } from "../shared/safe-paths.mjs";

export const SOURCE_TOMBSTONES_SCHEMA_VERSION = "matter-source-tombstones/v1";
export const SOURCE_TOMBSTONES_RELATIVE = ".matter-workbench/source-tombstones.json";

const SUPPRESSING_SOURCE_STATUSES = new Set([
  "removed_from_active_record",
  "quarantined",
  "deleted_pending",
  "deleted",
]);

export async function readSourceSuppressionIndex(root, { warnings = [] } = {}) {
  const manifestPath = path.join(root, SOURCE_TOMBSTONES_RELATIVE);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      warnings.push(`Skipped invalid ${SOURCE_TOMBSTONES_RELATIVE}: ${error.message}`);
    }
    return createSourceSuppressionIndex();
  }

  if (parsed?.schema_version !== SOURCE_TOMBSTONES_SCHEMA_VERSION) {
    warnings.push(`Skipped ${SOURCE_TOMBSTONES_RELATIVE}: unrecognized tombstone schema`);
    return createSourceSuppressionIndex();
  }
  const entries = Array.isArray(parsed.sources)
    ? parsed.sources
    : Array.isArray(parsed.tombstones)
      ? parsed.tombstones
      : [];
  return createSourceSuppressionIndex(entries);
}

export function createSourceSuppressionIndex(entries = []) {
  const index = {
    byFileId: new Map(),
    bySourcePath: new Map(),
  };
  for (const entry of entries) {
    addSourceSuppressionEntry(index, entry);
  }
  return index;
}

export async function addInactiveRegisterRowsToSuppressionIndex(root, intakes = [], index = createSourceSuppressionIndex(), { warnings = [] } = {}) {
  for (const intake of intakes) {
    if (!intake?.intake_dir) continue;
    const relativePath = `${toPosix(intake.intake_dir)}/File Register.csv`;
    try {
      const rows = parseCsv(await readFile(path.join(root, relativePath), "utf8"));
      for (const row of rows) {
        if (!isInactiveSourceStatus(row.status)) continue;
        addSuppressedSource(index, row, {
          status: row.status,
          reason: "File Register row is not active",
        });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") warnings.push(`Skipped invalid file register ${relativePath}: ${error.message}`);
    }
  }
  return index;
}

export function addSuppressedSource(index, source = {}, overrides = {}) {
  addSourceSuppressionEntry(index, {
    file_id: source.file_id || source.fileId,
    source_path: source.source_path || source.sourcePath || source.working_copy_path || source.workingCopyPath,
    original_path: source.original_path || source.originalPath,
    working_copy_path: source.working_copy_path || source.workingCopyPath,
    status: overrides.status || source.status || "removed_from_active_record",
    reason: overrides.reason || source.reason || "suppressed from active source set",
  });
}

export function addSourceSuppressionEntry(index, entry = {}) {
  if (!index?.byFileId || !index?.bySourcePath) return index;
  const normalized = normalizeSourceSuppressionEntry(entry);
  if (!normalized.file_id && !normalized.source_path && !normalized.working_copy_path && !normalized.original_path) return index;
  for (const fileId of uniqueValues([normalized.file_id])) {
    index.byFileId.set(fileId, normalized);
  }
  for (const sourcePath of uniqueValues([normalized.source_path, normalized.working_copy_path, normalized.original_path])) {
    index.bySourcePath.set(sourcePath, normalized);
  }
  return index;
}

export function sourceSuppressionEntryFor(source = {}, index = createSourceSuppressionIndex()) {
  const lookupIndex = index || createSourceSuppressionIndex();
  const fileId = normalizeText(source.file_id || source.fileId);
  const paths = sourcePathsForLookup(source);
  const candidates = [];
  if (fileId && lookupIndex.byFileId?.has(fileId)) candidates.push(lookupIndex.byFileId.get(fileId));
  for (const sourcePath of paths) {
    if (lookupIndex.bySourcePath?.has(sourcePath)) candidates.push(lookupIndex.bySourcePath.get(sourcePath));
  }
  return candidates.find((entry) => isInactiveSourceStatus(entry?.status)) || null;
}

export function isSourceSuppressed(source = {}, index = createSourceSuppressionIndex()) {
  return Boolean(sourceSuppressionEntryFor(source, index));
}

export function suppressedCitationFileIds(value = "", index = createSourceSuppressionIndex()) {
  return extractCitationFileIds(value).filter((fileId) => isSourceSuppressed({ file_id: fileId }, index));
}

export function hasSuppressedCitation(value = "", index = createSourceSuppressionIndex()) {
  return suppressedCitationFileIds(value, index).length > 0;
}

export function isInactiveSourceStatus(status = "") {
  return SUPPRESSING_SOURCE_STATUSES.has(normalizeStatus(status));
}

export function normalizeSourceSuppressionEntry(entry = {}) {
  return removeEmpty({
    file_id: normalizeText(entry.file_id || entry.fileId),
    source_path: normalizePath(entry.source_path || entry.sourcePath),
    original_path: normalizePath(entry.original_path || entry.originalPath),
    working_copy_path: normalizePath(entry.working_copy_path || entry.workingCopyPath),
    status: normalizeStatus(entry.status || entry.state || entry.event_type || entry.eventType),
    event_id: normalizeText(entry.event_id || entry.eventId),
    occurred_at: normalizeText(entry.occurred_at || entry.occurredAt || entry.removed_at || entry.removedAt),
    reason: normalizeText(entry.reason || entry.note || entry.notes),
  });
}

export function sourceSuppressionWarning(source = {}, entry = {}) {
  const fileId = normalizeText(source.file_id || source.fileId || entry.file_id) || "unknown source";
  const status = normalizeStatus(entry.status) || "suppressed";
  return `Suppressed ${fileId} from active source set (${status})`;
}

function extractCitationFileIds(value = "") {
  return uniqueValues(String(value || "").match(/FILE-\d{4,}/g) || []);
}

function sourcePathsForLookup(source = {}) {
  return uniqueValues([
    source.source_path,
    source.sourcePath,
    source.working_copy_path,
    source.workingCopyPath,
    source.original_path,
    source.originalPath,
  ].map(normalizePath));
}

function normalizeStatus(value = "") {
  return normalizeText(value).replace(/[\s-]+/g, "_").toLowerCase();
}

function normalizePath(value = "") {
  return toPosix(normalizeText(value));
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function uniqueValues(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function removeEmpty(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}
