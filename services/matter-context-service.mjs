import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../shared/csv.mjs";
import { normalizeMatterMetadata } from "../shared/matter-contract.mjs";
import { toPosix } from "../shared/safe-paths.mjs";

export const MATTER_CONTEXT_PACKET_SCHEMA_VERSION = "matter-context-packet/v1";

const SOURCE_INDEX_RELATIVE = "10_Library/Source Index.json";
const LIST_OF_DATES_JSON_RELATIVE = "10_Library/List of Dates.json";
const LIST_OF_DATES_MARKDOWN_RELATIVE = "10_Library/List of Dates.md";
const EXTRACTION_RECORD_SCHEMA_VERSION = "extraction-record/v1";
const SOURCE_INDEX_SCHEMA_VERSION = "source-index/v1";

const DEFAULT_LIMITS = {
  maxSources: 80,
  maxBlocks: 120,
  maxCharsPerBlock: 1600,
  maxLibraryArtifacts: 4,
};

const MACHINE_JUNK_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
]);

const EXCLUDED_PATH_SEGMENTS = new Set([
  ".git",
  "node_modules",
]);

const SECRET_OR_LOG_EXTENSIONS = new Set([
  ".env",
  ".log",
  ".sqlite",
  ".db",
]);

export async function buildMatterContextPacket(matterRoot, options = {}) {
  if (!matterRoot) throw new Error("matterRoot is required");
  const root = path.resolve(matterRoot);
  const limits = normalizeLimits(options);
  const warnings = [];
  const generatedAt = options.generatedAt || new Date().toISOString();

  const matterJson = await readMatterJson(root);
  const metadata = normalizeMatterMetadata(matterJson, path.basename(root));
  const intakes = await discoverIntakes(root, matterJson);
  const fileRegisters = await readFileRegisters(root, intakes, warnings);
  const registerByFileId = buildRegisterIndex(fileRegisters);
  const sourceDescriptors = await readTrustedSourceDescriptors(root, registerByFileId, warnings);
  const records = await readExtractionRecords(root, intakes, warnings);
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
    sources: sources.map(({ blocks, ...source }) => source),
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

async function readMatterJson(root) {
  const matterJsonPath = path.join(root, "matter.json");
  try {
    return JSON.parse(await readFile(matterJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`matter.json not found or invalid at ${matterJsonPath}: ${error.message}`);
  }
}

async function discoverIntakes(root, matterJson) {
  const byDir = new Map();
  for (const intake of matterIntakes(matterJson)) {
    if (!intake?.intake_dir) continue;
    byDir.set(toPosix(intake.intake_dir), {
      intake_id: intake.intake_id || intakeIdFromDir(intake.intake_dir),
      intake_dir: toPosix(intake.intake_dir),
    });
  }

  const inboxDir = path.join(root, "00_Inbox");
  let entries = [];
  try {
    entries = await readdir(inboxDir, { withFileTypes: true });
  } catch {
    return [...byDir.values()].sort(compareIntakes);
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("Intake ")) continue;
    const intakeDir = `00_Inbox/${entry.name}`;
    if (!byDir.has(intakeDir)) {
      byDir.set(intakeDir, {
        intake_id: intakeIdFromDir(entry.name),
        intake_dir: intakeDir,
      });
    }
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

async function readFileRegisters(root, intakes, warnings) {
  const registers = [];
  for (const intake of intakes) {
    const relativePath = `${intake.intake_dir}/File Register.csv`;
    const registerPath = path.join(root, relativePath);
    let rows = [];
    try {
      rows = parseCsv(await readFile(registerPath, "utf8"))
        .filter((row) => !shouldExcludeRegisterRow(row))
        .map((row) => normalizeRegisterRow(row, intake));
    } catch (error) {
      if (error.code !== "ENOENT") {
        warnings.push(`Skipped invalid file register ${relativePath}: ${error.message}`);
      }
      continue;
    }

    registers.push({
      intake_id: intake.intake_id,
      intake_dir: intake.intake_dir,
      path: relativePath,
      rows,
    });
  }
  return registers;
}

function normalizeRegisterRow(row, intake) {
  return {
    file_id: row.file_id || "",
    intake_id: row.intake_id || intake.intake_id,
    source_path: toPacketPath(row.source_path || ""),
    original_path: toPacketPath(row.original_path || ""),
    working_copy_path: toPacketPath(row.working_copy_path || ""),
    category: row.category || "",
    original_name: row.original_name || path.basename(row.source_path || ""),
    sha256: row.sha256 || "",
    size_bytes: row.size_bytes || "",
    duplicate_of: row.duplicate_of || "",
    status: row.status || "",
  };
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
  return candidates.some(isExcludedMatterPath);
}

function isExcludedMatterPath(value) {
  const normalized = toPacketPath(value);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment))) return true;
  const basename = segments.at(-1) || "";
  if (!basename) return false;
  if (MACHINE_JUNK_NAMES.has(basename)) return true;
  if (basename.startsWith("~$")) return true;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if (SECRET_OR_LOG_EXTENSIONS.has(path.extname(basename).toLowerCase())) return true;
  return false;
}

async function readTrustedSourceDescriptors(root, registerByFileId, warnings) {
  const sourceIndexPath = path.join(root, SOURCE_INDEX_RELATIVE);
  let artifact = null;
  try {
    artifact = JSON.parse(await readFile(sourceIndexPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      warnings.push(`Skipped invalid ${SOURCE_INDEX_RELATIVE}: ${error.message}`);
    }
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
    if (labelContainsFileId(descriptor.display_label) || labelContainsFileId(descriptor.short_label)) {
      warnings.push(`Ignored Source Index labels for ${fileId}: human label contains a FILE-NNNN identifier`);
      continue;
    }
    byFileId.set(fileId, descriptor);
  }
  return byFileId;
}

function labelContainsFileId(value) {
  return /\bFILE-\d{4,}\b/.test(String(value || ""));
}

async function readExtractionRecords(root, intakes, warnings) {
  const records = [];
  for (const intake of intakes) {
    const extractedRelative = `${intake.intake_dir}/_extracted`;
    const extractedDir = path.join(root, extractedRelative);
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
        if (record.schema_version !== EXTRACTION_RECORD_SCHEMA_VERSION || !record.file_id) continue;
        records.push({
          ...record,
          intake_id: intake.intake_id,
          intake_dir: intake.intake_dir,
          record_path: `${extractedRelative}/${entry.name}`,
        });
      } catch (error) {
        warnings.push(`Skipped invalid extraction record ${extractedRelative}/${entry.name}: ${error.message}`);
      }
    }
  }
  return records.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id), undefined, { numeric: true }));
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

async function readLibraryArtifactSummaries(root, limits, warnings) {
  const candidates = [
    SOURCE_INDEX_RELATIVE,
    LIST_OF_DATES_JSON_RELATIVE,
    LIST_OF_DATES_MARKDOWN_RELATIVE,
  ];
  const summaries = [];
  for (const relativePath of candidates) {
    if (summaries.length >= limits.maxLibraryArtifacts) break;
    const summary = await summarizeLibraryArtifact(root, relativePath, warnings);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

async function summarizeLibraryArtifact(root, relativePath, warnings) {
  const artifactPath = path.join(root, relativePath);
  let body = "";
  let info = null;
  try {
    body = await readFile(artifactPath, "utf8");
    info = await stat(artifactPath);
  } catch (error) {
    if (error.code !== "ENOENT") warnings.push(`Skipped library artifact ${relativePath}: ${error.message}`);
    return null;
  }

  if (relativePath.endsWith(".json")) {
    try {
      const json = JSON.parse(body);
      return summarizeJsonArtifact(relativePath, json, info);
    } catch (error) {
      warnings.push(`Skipped invalid JSON library artifact ${relativePath}: ${error.message}`);
      return null;
    }
  }

  if (relativePath.endsWith(".md")) {
    return {
      path: relativePath,
      kind: "markdown",
      heading: firstMarkdownHeading(body),
      char_count: body.length,
      line_count: body.split(/\r?\n/).length,
      mtime: info.mtime.toISOString(),
    };
  }

  return null;
}

function summarizeJsonArtifact(relativePath, json, info) {
  if (relativePath === SOURCE_INDEX_RELATIVE) {
    return {
      path: relativePath,
      kind: "source_index",
      schema_version: json.schema_version || "",
      summary: `${Array.isArray(json.sources) ? json.sources.length : 0} source descriptor(s)`,
      source_count: Array.isArray(json.sources) ? json.sources.length : 0,
      generated_at: json.generated_at || "",
      ai_run: sanitizeAiRun(json.ai_run),
      mtime: info.mtime.toISOString(),
    };
  }

  if (relativePath === LIST_OF_DATES_JSON_RELATIVE) {
    const entries = Array.isArray(json.entries) ? json.entries : [];
    return {
      path: relativePath,
      kind: "list_of_dates",
      schema_version: json.schema_version || "",
      summary: `${entries.length} accepted chronology entr${entries.length === 1 ? "y" : "ies"} with preserved raw citations`,
      entry_count: entries.length,
      generated_at: json.generated_at || "",
      ai_run: sanitizeAiRun(json.ai_run),
      mtime: info.mtime.toISOString(),
    };
  }

  return {
    path: relativePath,
    kind: "json",
    schema_version: json.schema_version || "",
    summary: "Selected JSON library artifact",
    mtime: info.mtime.toISOString(),
  };
}

function sanitizeAiRun(aiRun = {}) {
  if (!aiRun || typeof aiRun !== "object") return null;
  const sanitized = {};
  for (const key of [
    "policyVersion",
    "task",
    "tier",
    "provider",
    "model",
    "maxOutputTokens",
    "fallback",
    "returnedModel",
    "returnedProvider",
  ]) {
    if (aiRun[key] !== undefined && aiRun[key] !== null && aiRun[key] !== "") {
      sanitized[key] = aiRun[key];
    }
  }
  if (aiRun.usage && typeof aiRun.usage === "object") {
    sanitized.usage = {};
    for (const key of ["promptTokens", "completionTokens", "totalTokens", "cost"]) {
      if (aiRun.usage[key] !== undefined && aiRun.usage[key] !== null) sanitized.usage[key] = aiRun.usage[key];
    }
  }
  return Object.keys(sanitized).length ? sanitized : null;
}

function firstMarkdownHeading(markdown) {
  const line = String(markdown || "").split(/\r?\n/).find((candidate) => /^#\s+/.test(candidate));
  return line ? line.replace(/^#\s+/, "").trim() : "";
}

function toPacketPath(value) {
  return toPosix(String(value || ""));
}
