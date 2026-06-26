import path from "node:path";

import { parseCsv } from "../shared/csv.mjs";
import { classifyFile } from "../shared/matter-contract.mjs";
import {
  LIST_OF_DATES_JSON_RELATIVE,
  LIST_OF_DATES_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import { AI_RUN_CONTEXT_FIELDS, normalizeAiRunMetadata } from "../shared/ai-run-metadata.mjs";
import {
  effectiveShortSourceLabel,
  effectiveSourceLabel,
  sourceLabelContainsFileId,
} from "../shared/source-labels.mjs";
import { buildMatterContextPacketFromParts, normalizeMatterContextPacketLimits } from "./matter-context-packet.mjs";
import {
  isExcludedMatterContextPath,
  toMatterContextPacketPath,
} from "./matter-context-path-policy.mjs";
import { readRuntimeDbPayloadText } from "./runtime-db-payload-read-model.mjs";
import { runtimeWorkspaceFilePaths } from "./runtime-db-workspace-read-model.mjs";
import {
  addSuppressedSource,
  createSourceSuppressionIndex,
  hasSuppressedCitation,
  isInactiveSourceStatus,
  isSourceSuppressed,
  sourceSuppressionEntryFor,
  sourceSuppressionWarning,
} from "./active-source-set-service.mjs";

const EXTRACTION_RECORD_SCHEMA_VERSION = "extraction-record/v1";
const SOURCE_INDEX_SCHEMA_VERSION = "source-index/v1";

export function buildRuntimeDbMatterContextPacket({
  matter = {},
  workspace = {},
  readPayloadRow,
  options = {},
} = {}) {
  if (!matter?.name) throw new Error("runtime DB matter is required");
  if (typeof readPayloadRow !== "function") throw new Error("runtime DB payload reader is required");
  const limits = normalizeMatterContextPacketLimits(options);
  const warnings = [];
  const generatedAt = options.generatedAt || new Date().toISOString();
  const paths = runtimeWorkspaceFilePaths(workspace.tree || workspace.root || {});
  const pathByRelative = new Map(paths.map((item) => [item.path, item]));
  const readText = (relativePath) => readRuntimeDbPayloadText({ matter, relativePath, readPayloadRow, warnings });

  const matterJson = readMatterJson({ matter, workspace, readText, warnings });
  const intakes = discoverIntakes({ matterJson, paths });
  const sourceSuppressionIndex = createSourceSuppressionIndex();
  const fileRegisters = readFileRegisters({ intakes, readText, warnings, sourceSuppressionIndex });
  synthesizeMissingRegisters({ fileRegisters, intakes, paths });
  const registerByFileId = buildRegisterIndex(fileRegisters);
  const sourceDescriptors = readTrustedSourceDescriptors({ readText, registerByFileId, warnings });
  const records = readExtractionRecords({ intakes, paths, readText, warnings, sourceSuppressionIndex });
  const libraryArtifacts = readLibraryArtifactSummaries({ pathByRelative, readText, limits, warnings, sourceSuppressionIndex });

  return buildMatterContextPacketFromParts({
    folderName: matter.name,
    matterJson,
    fileRegisters,
    registerByFileId,
    sourceDescriptors,
    records,
    libraryArtifacts,
    limits,
    warnings,
    generatedAt,
  });
}

function readMatterJson({ matter, workspace, readText, warnings }) {
  const text = readText("matter.json");
  if (text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      warnings.push(`Skipped invalid matter.json from DB payload custody: ${error.message}`);
    }
  }
  const metadata = workspace.metadata || matter;
  return {
    matter_name: stringValue(metadata.matterName || matter.matterName || matter.name),
    client_name: stringValue(metadata.clientName),
    opposite_party: stringValue(metadata.oppositeParty),
    matter_type: stringValue(metadata.matterType),
    jurisdiction: stringValue(metadata.jurisdiction),
    brief_description: stringValue(metadata.briefDescription),
    intakes: [],
  };
}

function discoverIntakes({ matterJson, paths = [] }) {
  const byDir = new Map();
  for (const intake of matterIntakes(matterJson)) {
    if (!intake?.intake_dir) continue;
    const intakeDir = toMatterContextPacketPath(intake.intake_dir);
    byDir.set(intakeDir, {
      intake_id: intake.intake_id || intakeIdFromDir(intake.intake_dir),
      intake_dir: intakeDir,
    });
  }
  for (const item of paths) {
    const match = item.path.match(/^(00_Inbox\/Intake [^/]+)\//);
    if (!match || byDir.has(match[1])) continue;
    byDir.set(match[1], {
      intake_id: intakeIdFromDir(match[1]),
      intake_dir: match[1],
    });
  }
  return [...byDir.values()].sort(compareIntakes);
}

function matterIntakes(matterJson) {
  const intakes = Array.isArray(matterJson.intakes) ? [...matterJson.intakes] : [];
  if (!intakes.length && matterJson.phase_1_intake) {
    intakes.push({
      intake_id: matterJson.phase_1_intake.intake_id || "INTAKE-01",
      intake_dir: matterJson.phase_1_intake.intake_dir || "00_Inbox/Intake 01 - Initial",
    });
  }
  return intakes;
}

function intakeIdFromDir(intakeDir) {
  const match = String(intakeDir).match(/Intake\s+(\d+)/i);
  return match ? `INTAKE-${match[1].padStart(2, "0")}` : "INTAKE-XX";
}

function compareIntakes(a, b) {
  return a.intake_dir.localeCompare(b.intake_dir, undefined, { numeric: true });
}

function readFileRegisters({ intakes, readText, warnings, sourceSuppressionIndex }) {
  const registers = [];
  for (const intake of intakes) {
    const relativePath = `${intake.intake_dir}/File Register.csv`;
    const body = readText(relativePath);
    if (!body) continue;
    try {
      const rows = parseCsv(body)
        .filter((row) => !shouldExcludeRegisterRow(row))
        .map((row) => normalizeRegisterRow(row, intake))
        .filter((row) => isActiveRegisterRow(row, sourceSuppressionIndex, warnings));
      registers.push({
        intake_id: intake.intake_id,
        intake_dir: intake.intake_dir,
        path: relativePath,
        rows,
      });
    } catch (error) {
      warnings.push(`Skipped invalid file register ${relativePath}: ${error.message}`);
    }
  }
  return registers;
}

function synthesizeMissingRegisters({ fileRegisters, intakes, paths }) {
  const registeredDirs = new Set(fileRegisters.map((register) => register.intake_dir));
  for (const intake of intakes) {
    if (registeredDirs.has(intake.intake_dir)) continue;
    const sourcePrefix = `${intake.intake_dir}/Source Files/`;
    const rows = paths
      .filter((item) => item.path.startsWith(sourcePrefix) && item.fileId)
      .sort((a, b) => a.fileId.localeCompare(b.fileId, undefined, { numeric: true }))
      .map((item) => ({
        file_id: item.fileId,
        intake_id: intake.intake_id,
        source_path: item.path,
        original_path: item.path,
        working_copy_path: item.path,
        category: classifyFile(item.path),
        original_name: item.originalName || path.posix.basename(item.path),
        sha256: item.documentSha || item.sha256 || "",
        size_bytes: String(item.documentSizeBytes || item.size || ""),
        duplicate_of: item.duplicateOf || "",
        status: item.duplicateOf ? "exact-duplicate" : "unique",
      }));
    if (!rows.length) continue;
    fileRegisters.push({
      intake_id: intake.intake_id,
      intake_dir: intake.intake_dir,
      path: `${intake.intake_dir}/File Register.csv`,
      rows,
      synthesized: true,
    });
  }
}

function normalizeRegisterRow(row, intake) {
  return {
    file_id: row.file_id || "",
    intake_id: row.intake_id || intake.intake_id,
    source_path: toMatterContextPacketPath(row.source_path || ""),
    original_path: toMatterContextPacketPath(row.original_path || ""),
    working_copy_path: toMatterContextPacketPath(row.working_copy_path || ""),
    category: row.category || "",
    original_name: row.original_name || path.basename(row.source_path || ""),
    sha256: row.sha256 || "",
    size_bytes: row.size_bytes || "",
    duplicate_of: row.duplicate_of || "",
    status: row.status || "",
  };
}

function isActiveRegisterRow(row, sourceSuppressionIndex, warnings) {
  if (isInactiveSourceStatus(row.status)) {
    addSuppressedSource(sourceSuppressionIndex, row, {
      status: row.status,
      reason: "File Register row is not active",
    });
    warnings.push(sourceSuppressionWarning(row, { status: row.status }));
    return false;
  }
  return true;
}

function buildRegisterIndex(fileRegisters) {
  const byFileId = new Map();
  for (const register of fileRegisters) {
    for (const row of register.rows) {
      if (!row.file_id || byFileId.has(row.file_id)) continue;
      byFileId.set(row.file_id, {
        ...row,
        intake_dir: register.intake_dir,
      });
    }
  }
  return byFileId;
}

function shouldExcludeRegisterRow(row = {}) {
  const candidates = [
    row.source_path,
    row.original_path,
    row.working_copy_path,
    row.original_name,
  ].filter(Boolean);
  return candidates.some(isExcludedMatterContextPath);
}

export function readTrustedSourceDescriptors({ readText, registerByFileId, warnings }) {
  const body = readText(SOURCE_INDEX_RELATIVE);
  if (!body) return new Map();
  let artifact;
  try {
    artifact = JSON.parse(body);
  } catch (error) {
    warnings.push(`Skipped invalid ${SOURCE_INDEX_RELATIVE}: ${error.message}`);
    return new Map();
  }
  if (artifact?.schema_version !== SOURCE_INDEX_SCHEMA_VERSION || !Array.isArray(artifact.sources)) {
    warnings.push(`Skipped ${SOURCE_INDEX_RELATIVE}: unrecognized source index schema`);
    return new Map();
  }

  const byFileId = new Map();
  for (const descriptor of artifact.sources) {
    const fileId = descriptor?.file_id || "";
    if (!fileId) continue;
    const row = registerByFileId.get(fileId);
    if (!row) {
      warnings.push(`Ignored Source Index descriptor for ${fileId}: file_id is not in current registers`);
      continue;
    }
    if (descriptor.sha256 && row.sha256 && descriptor.sha256 !== row.sha256) {
      warnings.push(`Ignored Source Index descriptor for ${fileId}: sha256 does not match current register`);
      continue;
    }
    const registeredPaths = [row.working_copy_path, row.source_path].filter(Boolean);
    if (descriptor.source_path && registeredPaths.length && !registeredPaths.includes(descriptor.source_path)) {
      warnings.push(`Ignored Source Index descriptor for ${fileId}: source_path does not match current register`);
      continue;
    }
    if (
      sourceLabelContainsFileId(descriptor.display_label)
      || sourceLabelContainsFileId(descriptor.short_label)
      || sourceLabelContainsFileId(descriptor.suggested_label)
      || sourceLabelContainsFileId(descriptor.confirmed_label)
    ) {
      warnings.push(`Ignored Source Index labels for ${fileId}: human label contains a FILE-NNNN identifier`);
      continue;
    }
    byFileId.set(fileId, normalizeTrustedSourceDescriptor(descriptor));
  }
  return byFileId;
}

function normalizeTrustedSourceDescriptor(descriptor = {}) {
  const displayLabel = effectiveSourceLabel(descriptor);
  const shortLabel = effectiveShortSourceLabel(descriptor, displayLabel);
  return {
    ...descriptor,
    source_id: descriptor.source_id || descriptor.file_id || "",
    content_hash: descriptor.content_hash || descriptor.sha256 || "",
    display_label: displayLabel,
    short_label: shortLabel,
  };
}

function readExtractionRecords({ intakes, paths, readText, warnings, sourceSuppressionIndex }) {
  const intakeByDir = new Map(intakes.map((intake) => [intake.intake_dir, intake]));
  const records = [];
  const recordPaths = paths
    .map((item) => item.path)
    .filter((relativePath) => /(^|\/)00_Inbox\/Intake [^/]+\/_extracted\/FILE-\d+\.json$/i.test(relativePath));
  for (const relativePath of recordPaths) {
    const intakeDir = relativePath.replace(/\/_extracted\/[^/]+$/, "");
    const intake = intakeByDir.get(intakeDir) || { intake_id: intakeIdFromDir(intakeDir), intake_dir: intakeDir };
    const body = readText(relativePath);
    if (!body) continue;
    try {
      const record = JSON.parse(body);
      if (record.schema_version !== EXTRACTION_RECORD_SCHEMA_VERSION || !record.file_id) continue;
      const recordWithPath = {
        ...record,
        intake_id: intake.intake_id,
        intake_dir: intake.intake_dir,
        record_path: relativePath,
      };
      if (isSourceSuppressed(recordWithPath, sourceSuppressionIndex)) {
        warnings.push(sourceSuppressionWarning(recordWithPath, sourceSuppressionEntryFor(recordWithPath, sourceSuppressionIndex)));
        continue;
      }
      records.push(recordWithPath);
    } catch (error) {
      warnings.push(`Skipped invalid extraction record ${relativePath}: ${error.message}`);
    }
  }
  return records.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id), undefined, { numeric: true }));
}

function readLibraryArtifactSummaries({ pathByRelative, readText, limits, warnings, sourceSuppressionIndex }) {
  const candidates = [
    SOURCE_INDEX_RELATIVE,
    LIST_OF_DATES_JSON_RELATIVE,
    LIST_OF_DATES_MARKDOWN_RELATIVE,
  ];
  const summaries = [];
  for (const relativePath of candidates) {
    if (summaries.length >= limits.maxLibraryArtifacts) break;
    const item = pathByRelative.get(relativePath);
    if (!item) continue;
    const body = readText(relativePath);
    if (!body) continue;
    const summary = summarizeLibraryArtifact({ relativePath, body, updatedAt: item.updatedAt, limits, warnings, sourceSuppressionIndex });
    if (summary) summaries.push(summary);
  }
  return summaries;
}

function summarizeLibraryArtifact({ relativePath, body, updatedAt, limits, warnings, sourceSuppressionIndex }) {
  if (relativePath.endsWith(".json")) {
    try {
      return summarizeJsonArtifact(relativePath, JSON.parse(body), updatedAt, limits, warnings, sourceSuppressionIndex);
    } catch (error) {
      warnings.push(`Skipped invalid JSON library artifact ${relativePath}: ${error.message}`);
      return null;
    }
  }
  if (relativePath.endsWith(".md")) {
    if (relativePath === LIST_OF_DATES_MARKDOWN_RELATIVE && hasSuppressedCitation(body, sourceSuppressionIndex)) {
      warnings.push(`Skipped ${relativePath}: cites suppressed source(s)`);
      return null;
    }
    const maxChars = Number.isInteger(limits.maxChronologyMarkdownChars) ? limits.maxChronologyMarkdownChars : 32000;
    const markdown = boundedText(body, maxChars);
    return {
      path: relativePath,
      kind: relativePath === LIST_OF_DATES_MARKDOWN_RELATIVE ? "list_of_dates_markdown" : "markdown",
      heading: firstMarkdownHeading(body),
      markdown,
      markdown_truncated: markdown.length < normalizeText(body).length,
      char_count: body.length,
      line_count: body.split(/\r?\n/).length,
      mtime: isoOrEmpty(updatedAt),
    };
  }
  return null;
}

function summarizeJsonArtifact(relativePath, json, updatedAt, limits = {}, warnings = [], sourceSuppressionIndex = null) {
  if (relativePath === SOURCE_INDEX_RELATIVE) {
    const sources = Array.isArray(json.sources) ? json.sources : [];
    const activeSources = sources.filter((source) => !isSourceSuppressed(source, sourceSuppressionIndex));
    const suppressedCount = sources.length - activeSources.length;
    if (suppressedCount > 0) warnings.push(`Suppressed ${suppressedCount} Source Index descriptor(s) from active context`);
    return {
      path: relativePath,
      kind: "source_index",
      schema_version: json.schema_version || "",
      summary: `${activeSources.length} active source descriptor(s)`,
      source_count: activeSources.length,
      source_count_total: sources.length,
      sources_suppressed: suppressedCount,
      generated_at: json.generated_at || "",
      ai_run: sanitizeAiRun(json.ai_run),
      mtime: isoOrEmpty(updatedAt),
    };
  }
  if (relativePath === LIST_OF_DATES_JSON_RELATIVE) {
    const entries = Array.isArray(json.entries) ? json.entries : [];
    const activeEntries = entries.filter((entry) => !chronologyEntryHasSuppressedCitation(entry, sourceSuppressionIndex));
    const suppressedCount = entries.length - activeEntries.length;
    if (suppressedCount > 0) warnings.push(`Suppressed ${suppressedCount} List of Dates entr${suppressedCount === 1 ? "y" : "ies"} from active context`);
    const maxEntries = Number.isInteger(limits.maxChronologyEntries) ? limits.maxChronologyEntries : 120;
    const includedEntries = activeEntries.slice(0, maxEntries);
    return {
      path: relativePath,
      kind: "list_of_dates",
      schema_version: json.schema_version || "",
      summary: `${activeEntries.length} active chronology entr${activeEntries.length === 1 ? "y" : "ies"} with preserved raw citations`,
      entry_count: activeEntries.length,
      entry_count_total: entries.length,
      entries_suppressed: suppressedCount,
      entries_included: includedEntries.length,
      entries_omitted: Math.max(0, activeEntries.length - includedEntries.length),
      entries: includedEntries.map(summarizeChronologyEntry),
      citation_index: activeEntries.map(summarizeChronologyCitation).filter((entry) => entry.citation),
      generated_at: json.generated_at || "",
      ai_run: sanitizeAiRun(json.ai_run),
      mtime: isoOrEmpty(updatedAt),
    };
  }
  return {
    path: relativePath,
    kind: "json",
    schema_version: json.schema_version || "",
    summary: "Selected JSON library artifact",
    mtime: isoOrEmpty(updatedAt),
  };
}

function summarizeChronologyEntry(entry = {}) {
  return {
    date_iso: normalizeText(entry.date_iso),
    date_text: normalizeText(entry.date_text),
    event: boundedText(entry.event, 900),
    legal_relevance: boundedText(entry.legal_relevance, 700),
    issue_tags: Array.isArray(entry.issue_tags) ? entry.issue_tags.map(normalizeText).filter(Boolean).slice(0, 8) : [],
    perspective: normalizeText(entry.perspective),
    citation: normalizeText(entry.citation),
    source_label: normalizeText(entry.source_label),
    source_short_label: normalizeText(entry.source_short_label),
    source_excerpt: boundedText(entry.source_excerpt, 700),
    needs_review: Boolean(entry.needs_review),
    supporting_sources: Array.isArray(entry.supporting_sources)
      ? entry.supporting_sources.slice(0, 4).map((source) => ({
          citation: normalizeText(source.citation),
          source_label: normalizeText(source.source_label),
          source_short_label: normalizeText(source.source_short_label),
          event: boundedText(source.event, 400),
        }))
      : [],
  };
}

function summarizeChronologyCitation(entry = {}) {
  return {
    citation: normalizeText(entry.citation),
    source_label: normalizeText(entry.source_label),
    source_short_label: normalizeText(entry.source_short_label),
    source_excerpt: boundedText(entry.source_excerpt, 300),
    event: boundedText(entry.event, 300),
  };
}

function chronologyEntryHasSuppressedCitation(entry = {}, sourceSuppressionIndex = null) {
  if (hasSuppressedCitation(entry.citation, sourceSuppressionIndex)) return true;
  if (hasSuppressedCitation(entry.source_label, sourceSuppressionIndex)) return true;
  if (hasSuppressedCitation(entry.source_short_label, sourceSuppressionIndex)) return true;
  if (!Array.isArray(entry.supporting_sources)) return false;
  return entry.supporting_sources.some((source) => (
    hasSuppressedCitation(source?.citation, sourceSuppressionIndex)
    || hasSuppressedCitation(source?.source_label, sourceSuppressionIndex)
    || hasSuppressedCitation(source?.source_short_label, sourceSuppressionIndex)
  ));
}

function sanitizeAiRun(aiRun = {}) {
  return normalizeAiRunMetadata(aiRun, {
    fields: AI_RUN_CONTEXT_FIELDS,
    includeUsage: true,
  });
}

function firstMarkdownHeading(markdown) {
  const line = String(markdown || "").split(/\r?\n/).find((candidate) => /^#\s+/.test(candidate));
  return line ? line.replace(/^#\s+/, "").trim() : "";
}

function boundedText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length > maxLength) return text.slice(0, maxLength).trimEnd();
  return text;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isoOrEmpty(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
