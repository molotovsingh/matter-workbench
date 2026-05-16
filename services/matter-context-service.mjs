import path from "node:path";
import { normalizeMatterMetadata } from "../shared/matter-contract.mjs";
import { toPosix } from "../shared/safe-paths.mjs";
import { readLibraryArtifactSummaries } from "./matter-context-library-artifacts.mjs";
import { searchMatterContextPacket } from "./matter-context-search.mjs";
import {
  readMatterContextSources,
  SOURCE_INDEX_RELATIVE,
} from "./matter-context-sources.mjs";

export { MATTER_CONTEXT_SEARCH_SCHEMA_VERSION, searchMatterContextPacket } from "./matter-context-search.mjs";

export const MATTER_CONTEXT_PACKET_SCHEMA_VERSION = "matter-context-packet/v1";
export const MATTER_CONTEXT_PREVIEW_SCHEMA_VERSION = "matter-context-preview/v1";

const DEFAULT_LIMITS = {
  maxSources: 80,
  maxBlocks: 120,
  maxCharsPerBlock: 1600,
  maxLibraryArtifacts: 4,
};

export function createMatterContextService({ matterStore } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function readMatterContextPreview(root = matterStore.ensureMatterRoot()) {
    const packet = await buildMatterContextPacket(root);
    return summarizeMatterContextPacket(packet);
  }

  async function searchMatterContext({
    root = matterStore.ensureMatterRoot(),
    query = "",
    maxResults,
    snippetChars,
  } = {}) {
    const packet = await buildMatterContextPacket(root);
    return searchMatterContextPacket(packet, query, { maxResults, snippetChars });
  }

  return { readMatterContextPreview, searchMatterContext };
}

export async function buildMatterContextPacket(matterRoot, options = {}) {
  if (!matterRoot) throw new Error("matterRoot is required");
  const root = path.resolve(matterRoot);
  const limits = normalizeLimits(options);
  const warnings = [];
  const generatedAt = options.generatedAt || new Date().toISOString();

  const {
    matterJson,
    fileRegisters,
    registerByFileId,
    sourceDescriptors,
    records,
  } = await readMatterContextSources(root, warnings);
  const metadata = normalizeMatterMetadata(matterJson, path.basename(root));
  const sources = buildSources(records, registerByFileId, sourceDescriptors, limits, warnings);
  const evidenceBlocks = buildEvidenceBlocks(sources, limits, warnings);
  const libraryArtifacts = await readLibraryArtifactSummaries(root, limits, warnings);

  return {
    schema_version: MATTER_CONTEXT_PACKET_SCHEMA_VERSION,
    generated_at: generatedAt,
    matter: {
      folder_name: path.basename(root),
      matter_name: metadata.matterName,
      client_name: metadata.clientName,
      opposite_party: metadata.oppositeParty,
      matter_type: metadata.matterType,
      jurisdiction: metadata.jurisdiction,
      brief_description: metadata.briefDescription,
    },
    file_registers: fileRegisters,
    sources: sources.map(({ blocks, ...source }) => ({
      ...source,
      sample_citations: blocks.slice(0, 3).map((block) => block.citation),
    })),
    evidence_blocks: evidenceBlocks,
    library_artifacts: libraryArtifacts,
    limits: {
      max_sources: limits.maxSources,
      max_blocks: limits.maxBlocks,
      max_chars_per_block: limits.maxCharsPerBlock,
      max_library_artifacts: limits.maxLibraryArtifacts,
      included_sources: sources.length,
      omitted_sources: Math.max(0, records.length - sources.length),
      included_blocks: evidenceBlocks.length,
      omitted_blocks: countSourceBlocks(sources) - evidenceBlocks.length,
    },
    warnings,
  };
}

export function summarizeMatterContextPacket(packet) {
  const warnings = Array.isArray(packet?.warnings) ? [...packet.warnings] : [];
  const libraryArtifacts = Array.isArray(packet?.library_artifacts) ? packet.library_artifacts : [];
  const hasSourceIndex = libraryArtifacts.some((artifact) => artifact.path === SOURCE_INDEX_RELATIVE);
  if (!hasSourceIndex) {
    warnings.push("10_Library/Source Index.json not found; source labels may be blank.");
  }

  const fileRegisters = Array.isArray(packet?.file_registers) ? packet.file_registers : [];
  const sources = Array.isArray(packet?.sources) ? packet.sources : [];
  const evidenceBlocks = Array.isArray(packet?.evidence_blocks) ? packet.evidence_blocks : [];

  return {
    schema_version: MATTER_CONTEXT_PREVIEW_SCHEMA_VERSION,
    packet_schema_version: packet?.schema_version || "",
    generated_at: packet?.generated_at || "",
    matter: packet?.matter || {},
    counts: {
      file_registers: fileRegisters.length,
      registered_files: fileRegisters.reduce((sum, register) => sum + (Array.isArray(register.rows) ? register.rows.length : 0), 0),
      sources: sources.length,
      evidence_blocks_included: evidenceBlocks.length,
      evidence_blocks_omitted: Number(packet?.limits?.omitted_blocks || 0),
      library_artifacts: libraryArtifacts.length,
      warnings: warnings.length,
    },
    limits: packet?.limits || {},
    source_index_present: hasSourceIndex,
    warnings,
    library_artifacts: libraryArtifacts.map((artifact) => ({
      path: artifact.path || "",
      kind: artifact.kind || "",
      summary: artifact.summary || artifact.heading || "",
      schema_version: artifact.schema_version || "",
      source_count: artifact.source_count ?? null,
      entry_count: artifact.entry_count ?? null,
    })),
    top_sources: sources.slice(0, 12).map((source) => ({
      source_id: source.source_id || source.file_id || "",
      content_hash: source.content_hash || source.sha256 || "",
      file_id: source.file_id || "",
      source_label: source.source_label || "",
      source_short_label: source.source_short_label || "",
      document_type: source.document_type || "",
      source_path: source.source_path || "",
      needs_review: Boolean(source.needs_review),
      sample_citations: Array.isArray(source.sample_citations) && source.sample_citations.length
        ? source.sample_citations
        : evidenceBlocks
          .filter((block) => block.file_id === source.file_id)
          .slice(0, 3)
          .map((block) => block.citation),
    })),
  };
}

function normalizeLimits(options) {
  return {
    maxSources: parseLimit(options.maxSources, DEFAULT_LIMITS.maxSources),
    maxBlocks: parseLimit(options.maxBlocks, DEFAULT_LIMITS.maxBlocks),
    maxCharsPerBlock: parseLimit(options.maxCharsPerBlock, DEFAULT_LIMITS.maxCharsPerBlock),
    maxLibraryArtifacts: parseLimit(options.maxLibraryArtifacts, DEFAULT_LIMITS.maxLibraryArtifacts),
  };
}

function parseLimit(value, fallback) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0) return number;
  return fallback;
}

function buildSources(records, registerByFileId, sourceDescriptors, limits, warnings) {
  const sources = [];
  const limitedRecords = records.slice(0, limits.maxSources);
  if (records.length > limitedRecords.length) {
    warnings.push(`Omitted ${records.length - limitedRecords.length} source record(s) due to maxSources=${limits.maxSources}`);
  }

  for (const record of limitedRecords) {
    const register = registerByFileId.get(record.file_id);
    if (!register) {
      warnings.push(`Extraction record ${record.record_path} has no matching current file register row`);
    } else if (register.sha256 && record.sha256 && register.sha256 !== record.sha256) {
      warnings.push(`Extraction record ${record.file_id} sha256 differs from current file register`);
    }

    const descriptor = sourceDescriptors.get(record.file_id);
    const sourcePath = toPacketPath(record.source_path || register?.source_path || "");
    sources.push({
      source_id: descriptor?.source_id || record.file_id,
      content_hash: descriptor?.content_hash || record.sha256 || register?.sha256 || "",
      file_id: record.file_id,
      sha256: record.sha256 || register?.sha256 || "",
      source_path: sourcePath,
      original_name: register?.original_name || path.basename(sourcePath),
      category: register?.category || "",
      intake_id: record.intake_id || register?.intake_id || "",
      intake_dir: record.intake_dir || register?.intake_dir || "",
      extraction_record_path: record.record_path,
      extraction_engine: record.engine || "",
      page_count: record.page_count ?? (Array.isArray(record.pages) ? record.pages.length : 0),
      source_label: descriptor?.display_label || "",
      source_short_label: descriptor?.short_label || "",
      document_type: descriptor?.document_type || "",
      document_date: descriptor?.document_date ?? null,
      needs_review: Boolean(descriptor?.needs_review || recordNeedsReview(record)),
      warnings: Array.isArray(record.warnings) ? record.warnings : [],
      blocks: collectEvidenceBlocks(record, descriptor),
    });
  }
  return sources;
}

function recordNeedsReview(record) {
  return (record.pages || []).some((page) => page?.needs_review === true);
}

function collectEvidenceBlocks(record, descriptor) {
  const blocks = [];
  for (const page of record.pages || []) {
    const pageNumber = Number(page?.page);
    const pageBlocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const block of pageBlocks) {
      const blockId = String(block?.id || "");
      const text = typeof block?.text === "string" ? block.text.trim() : "";
      if (!/^p\d+\.b\d+$/.test(blockId) || !text) continue;
      blocks.push({
        citation: `${record.file_id} ${blockId}`,
        source_id: descriptor?.source_id || record.file_id,
        content_hash: descriptor?.content_hash || record.sha256 || "",
        file_id: record.file_id,
        page: Number.isInteger(pageNumber) ? pageNumber : null,
        block_id: blockId,
        block_type: block.type || "",
        text,
        confidence: page.confidence_avg ?? null,
        needs_review: Boolean(page.needs_review),
        source_label: descriptor?.display_label || "",
        source_short_label: descriptor?.short_label || "",
        source_path: toPacketPath(record.source_path || ""),
        extraction_engine: record.engine || "",
      });
    }
  }
  return blocks;
}

function buildEvidenceBlocks(sources, limits, warnings) {
  const blocks = [];
  let truncatedBlocks = 0;
  for (const source of sources) {
    for (const block of source.blocks) {
      if (blocks.length >= limits.maxBlocks) continue;
      const { text, truncated } = truncateText(block.text, limits.maxCharsPerBlock);
      if (truncated) truncatedBlocks += 1;
      blocks.push({
        ...block,
        text,
      });
    }
  }
  const omitted = countSourceBlocks(sources) - blocks.length;
  if (omitted > 0) warnings.push(`Omitted ${omitted} evidence block(s) due to maxBlocks=${limits.maxBlocks}`);
  if (truncatedBlocks > 0) warnings.push(`Truncated ${truncatedBlocks} evidence block(s) due to maxCharsPerBlock=${limits.maxCharsPerBlock}`);
  return blocks;
}

function countSourceBlocks(sources) {
  return sources.reduce((sum, source) => sum + source.blocks.length, 0);
}

function truncateText(text, maxChars) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!Number.isInteger(maxChars) || maxChars <= 0) return { text: "", truncated: normalized.length > 0 };
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, maxChars).trimEnd(), truncated: true };
}

function toPacketPath(value) {
  return toPosix(String(value || ""));
}
