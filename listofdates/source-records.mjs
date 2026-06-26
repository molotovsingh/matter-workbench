import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseCsv } from "../shared/csv.mjs";
import { sourceLabelMetadata } from "../shared/source-labels.mjs";
import {
  addInactiveRegisterRowsToSuppressionIndex,
  addSuppressedSource,
  isInactiveSourceStatus,
  readSourceSuppressionIndex,
  sourceSuppressionEntryFor,
} from "../services/active-source-set-service.mjs";

const BLOCK_CHAR_LIMIT = 2800;
const CHUNK_CHAR_LIMIT = 18000;
const META_DOCUMENT_TYPE_SET = new Set([
  "readme",
  "manifest",
  "index",
  "file_index",
  "bundle_index",
  "exhibit_index",
  "metadata",
]);
const META_SOURCE_NAME_RE = /\b(readme|manifest|(?:file|document|exhibit|bundle)\s*index|(?:file|document|exhibit|bundle)\s*list|table\s*of\s*contents|metadata)\b/i;

export async function readMatterJson(matterRoot) {
  const matterJsonPath = path.join(matterRoot, "matter.json");
  try {
    return JSON.parse(await readFile(matterJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`matter.json not found or invalid at ${matterJsonPath}. Run /matter-init first. (${error.message})`);
  }
}

export function getIntakes(matterJson) {
  const intakes = Array.isArray(matterJson.intakes) ? [...matterJson.intakes] : [];
  if (!intakes.length && matterJson.phase_1_intake) {
    intakes.push({
      intake_id: matterJson.phase_1_intake.intake_id || "INTAKE-01",
      intake_dir: matterJson.phase_1_intake.intake_dir || "00_Inbox/Intake 01 - Initial",
    });
  }
  return intakes.filter((intake) => intake && intake.intake_dir);
}

export async function readFileRegisterIndex(matterRoot, intakes, { sourceSuppressionIndex = null, warnings = [] } = {}) {
  const suppressionIndex = sourceSuppressionIndex || await readSourceSuppressionIndex(matterRoot, { warnings });
  const index = new Map();
  for (const intake of intakes) {
    const registerPath = path.join(matterRoot, intake.intake_dir, "File Register.csv");
    try {
      const rows = parseCsv(await readFile(registerPath, "utf8"));
      for (const row of rows) {
        if (!row.file_id) continue;
        if (isInactiveSourceStatus(row.status)) {
          addSuppressedSource(suppressionIndex, row, {
            status: row.status,
            reason: "File Register row is not active",
          });
          continue;
        }
        if (sourceSuppressionEntryFor(row, suppressionIndex)) continue;
        index.set(row.file_id, row);
      }
    } catch {
      // Missing historical registers should not block chronology from records.
    }
  }
  return index;
}

export async function readExtractionRecords(matterRoot, intakes, { sourceSuppressionIndex = null, warnings = [] } = {}) {
  const suppressionIndex = sourceSuppressionIndex || await readSourceSuppressionIndex(matterRoot, { warnings });
  if (!sourceSuppressionIndex) {
    await addInactiveRegisterRowsToSuppressionIndex(matterRoot, intakes, suppressionIndex, { warnings });
  }
  const records = [];
  for (const intake of intakes) {
    const extractedDir = path.join(matterRoot, intake.intake_dir, "_extracted");
    let entries = [];
    try {
      entries = await readdir(extractedDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.filter((item) => item.isFile() && /^FILE-\d+\.json$/.test(item.name))) {
      const recordPath = path.join(extractedDir, entry.name);
      try {
        const record = JSON.parse(await readFile(recordPath, "utf8"));
        if (record.schema_version !== "extraction-record/v1" || !record.file_id) continue;
        if (sourceSuppressionEntryFor(record, suppressionIndex)) continue;
        records.push(record);
      } catch {
        // /doctor will own invalid-record reporting; this skill skips them.
      }
    }
  }
  return records.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id)));
}

export function buildSourceBlocks(records, fileIndex) {
  const blocks = [];
  for (const record of records) {
    const fileInfo = fileIndex.get(record.file_id) || {};
    for (const page of record.pages || []) {
      for (const block of page.blocks || []) {
        if (!block?.id || typeof block.text !== "string" || !block.text.trim()) continue;
        const citation = `${record.file_id} ${block.id}`;
        blocks.push({
          citation,
          file_id: record.file_id,
          source_path: record.source_path,
          original_name: fileInfo.original_name || path.basename(record.source_path || ""),
          category: fileInfo.category || "",
          page: page.page,
          block_id: block.id,
          block_type: block.type || "",
          confidence: page.confidence_avg ?? 1,
          needs_review: Boolean(page.needs_review),
          engine: record.engine,
          sha256: record.sha256,
          text: block.text.length > BLOCK_CHAR_LIMIT
            ? `${block.text.slice(0, BLOCK_CHAR_LIMIT)}\n[block truncated for AI input]`
            : block.text,
        });
      }
    }
  }
  return blocks;
}

export function chunkBlocks(blocks) {
  const chunks = [];
  let current = [];
  let currentSize = 0;
  for (const block of blocks) {
    const size = block.text.length + block.citation.length + 120;
    if (current.length && currentSize + size > CHUNK_CHAR_LIMIT) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(block);
    currentSize += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function readSourceIndex(matterRoot, blocks) {
  const indexPath = path.join(matterRoot, "10_Library", "Source Index.json");
  let artifact;
  try {
    artifact = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    return new Map();
  }
  return sourceIndexFromArtifact(artifact, blocks);
}

export function sourceIndexFromArtifact(artifact, blocks = []) {
  if (artifact?.schema_version !== "source-index/v1" || !Array.isArray(artifact.sources)) return new Map();

  const blockByFileId = new Map(blocks.map((block) => [block.file_id, block]));
  const index = new Map();
  for (const source of artifact.sources) {
    const block = blockByFileId.get(source?.file_id);
    if (!block || source.sha256 !== block.sha256) continue;
    if (source.source_path !== block.source_path) continue;
    const metadata = {
      ...sourceLabelMetadata(source, { includeDisplayFields: true }),
    };
    index.set(source.file_id, metadata);
  }
  return index;
}

export function createSourceSnapshot(sourceIndex = new Map()) {
  return [...sourceIndex.entries()]
    .map(([fileId, source]) => ({
      file_id: fileId,
      source_id: source.source_id || fileId,
      content_hash: source.content_hash || "",
      source_label: source.source_label || "",
      source_short_label: source.source_short_label || "",
      document_type: source.document_type || "",
      document_date: source.document_date || "",
      needs_review: Boolean(source.needs_review),
      label_status: source.label_status || "",
      label_revision: Number.isInteger(source.label_revision) ? source.label_revision : 0,
    }))
    .sort((a, b) => a.file_id.localeCompare(b.file_id, undefined, { numeric: true }));
}

export function filterChronologyCandidateBlocks(blocks, sourceIndex = new Map()) {
  return blocks.filter((block) => !isMetaChronologySource(block, sourceIndex.get(block.file_id)));
}

function isMetaChronologySource(block, sourceMetadata = {}) {
  const documentType = normalizeEligibilityText(sourceMetadata.document_type).toLowerCase();
  if (META_DOCUMENT_TYPE_SET.has(documentType)) return true;

  const names = [
    sourceMetadata.display_label,
    sourceMetadata.short_label,
    block.original_name,
    path.basename(block.source_path || ""),
  ].map(normalizeEligibilityText).filter(Boolean);

  return names.some((name) => META_SOURCE_NAME_RE.test(name));
}

function normalizeEligibilityText(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceLabelFields(sourceMetadata = {}) {
  const fields = {};
  if (sourceMetadata.source_id) fields.source_id = sourceMetadata.source_id;
  if (sourceMetadata.content_hash) fields.content_hash = sourceMetadata.content_hash;
  if (sourceMetadata.source_label) fields.source_label = sourceMetadata.source_label;
  if (sourceMetadata.source_short_label) fields.source_short_label = sourceMetadata.source_short_label;
  return fields;
}

export function withSourceLabels(blocks, sourceIndex = new Map()) {
  return blocks.map((block) => ({
    ...block,
    ...sourceLabelFields(sourceIndex.get(block.file_id)),
  }));
}
