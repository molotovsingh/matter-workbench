import path from "node:path";
import { normalizeMatterMetadata } from "../shared/matter-contract.mjs";
import { toPosix } from "../shared/safe-paths.mjs";
import { readLibraryArtifactSummaries } from "./matter-context-library-artifacts.mjs";
import { readMatterContextSources } from "./matter-context-sources.mjs";

export const MATTER_CONTEXT_PACKET_SCHEMA_VERSION = "matter-context-packet/v1";

const DEFAULT_LIMITS = {
  maxSources: 80,
  maxBlocks: 120,
  maxCharsPerBlock: 1600,
  maxLibraryArtifacts: 4,
};

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
