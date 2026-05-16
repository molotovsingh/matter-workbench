import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./shared/atomic-file.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";
import {
  MATTER_LIBRARY_DIR,
  SOURCE_INDEX_FILENAME,
} from "./shared/matter-artifacts.mjs";
import {
  mergeAiRunMetadata,
  resolveSourceDescriptorProvider,
} from "./source-descriptors-provider.mjs";
import {
  SOURCE_INDEX_OUTPUT_SCHEMA,
  validateAndSortDescriptors,
} from "./source-descriptors-validation.mjs";
import { toPosix } from "./shared/safe-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_VERSION = "source-descriptors-v1-skeleton";
const SOURCE_INDEX_SCHEMA_VERSION = "source-index/v1";
const BLOCK_CHAR_LIMIT = 1200;
const MAX_BLOCKS_PER_SOURCE = 12;

export { createOpenRouterSourceDescriptorProvider } from "./source-descriptors-provider.mjs";
export { SOURCE_INDEX_OUTPUT_SCHEMA, validateAndSortDescriptors } from "./source-descriptors-validation.mjs";

export async function runSourceDescriptors(options = {}) {
  const matterRoot = options.matterRoot
    ? path.resolve(options.matterRoot)
    : (process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null);
  if (!matterRoot) throw new Error("MATTER_ROOT is not set. Pass options.matterRoot or set the env var.");

  const providerSetup = resolveSourceDescriptorProvider(options);
  const provider = providerSetup.provider;

  const dryRun = Boolean(options.dryRun);
  const matterJson = await readMatterJson(matterRoot);
  const intakes = getIntakes(matterJson);
  if (!intakes.length) throw new Error("No intakes recorded in matter.json. Run /matter-init first.");

  const records = await readExtractionRecords(matterRoot, intakes);
  if (!records.length) throw new Error("No extraction records found. Run /extract before creating a source index.");

  const sourcePackets = buildSourcePackets(records);
  if (!sourcePackets.length) throw new Error("Extraction records contain no source packets to describe.");

  const matter = matterSummary(matterJson);
  const providerResponse = await provider({
    matter,
    sources: sourcePackets,
    schema: SOURCE_INDEX_OUTPUT_SCHEMA,
  });
  const descriptors = validateAndSortDescriptors(providerResponse, sourcePackets);
  const aiRun = options.aiRun || mergeAiRunMetadata(providerSetup.aiRun, providerResponse.ai_run);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const artifact = {
    schema_version: SOURCE_INDEX_SCHEMA_VERSION,
    engine_version: ENGINE_VERSION,
    generated_at: generatedAt,
    matter,
    ai_run: aiRun,
    source_record_count: records.length,
    sources: descriptors,
  };

  const outputDir = path.join(matterRoot, MATTER_LIBRARY_DIR);
  const outputJson = path.join(outputDir, SOURCE_INDEX_FILENAME);
  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    await writeFileAtomic(outputJson, `${JSON.stringify(artifact, null, 2)}\n`);
  }

  return {
    dryRun,
    matterRoot,
    engineVersion: ENGINE_VERSION,
    counts: {
      recordsRead: records.length,
      sourcePackets: sourcePackets.length,
      descriptors: descriptors.length,
    },
    outputPaths: {
      directory: toPosix(path.relative(matterRoot, outputDir)),
      json: toPosix(path.relative(matterRoot, outputJson)),
    },
    aiRun,
    sourcePackets,
    sources: descriptors,
    artifact,
    outputLines: [
      `> workbench.run /describe_sources${dryRun ? " (dry-run)" : ""}`,
      `[source-index] read ${records.length} extraction record(s)`,
      `[source-index] built ${sourcePackets.length} bounded source packet(s)`,
      dryRun
        ? `[source-index] dry run only. Re-run with apply to write ${SOURCE_INDEX_FILENAME}.`
        : `[source-index] wrote ${toPosix(path.relative(matterRoot, outputJson))}`,
    ],
  };
}

export function buildSourcePackets(records) {
  const packets = [];
  const seen = new Set();
  for (const record of records) {
    if (!record?.file_id) continue;
    if (seen.has(record.file_id)) throw new Error(`Duplicate extraction record for ${record.file_id}`);
    seen.add(record.file_id);

    const blocks = collectSourceBlocks(record);
    packets.push({
      file_id: record.file_id,
      sha256: record.sha256 || "",
      source_path: record.source_path || "",
      original_name: path.basename(record.source_path || ""),
      extraction: {
        engine: record.engine || "",
        page_count: record.page_count ?? (Array.isArray(record.pages) ? record.pages.length : 0),
        warnings: Array.isArray(record.warnings) ? record.warnings : [],
      },
      blocks,
    });
  }
  return packets.sort((a, b) => a.file_id.localeCompare(b.file_id));
}

async function readMatterJson(matterRoot) {
  const matterJsonPath = path.join(matterRoot, "matter.json");
  try {
    return JSON.parse(await readFile(matterJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`matter.json not found or invalid at ${matterJsonPath}. Run /matter-init first. (${error.message})`);
  }
}

function getIntakes(matterJson) {
  const intakes = Array.isArray(matterJson.intakes) ? [...matterJson.intakes] : [];
  if (!intakes.length && matterJson.phase_1_intake) {
    intakes.push({
      intake_id: matterJson.phase_1_intake.intake_id || "INTAKE-01",
      intake_dir: matterJson.phase_1_intake.intake_dir || "00_Inbox/Intake 01 - Initial",
    });
  }
  return intakes.filter((intake) => intake && intake.intake_dir);
}

async function readExtractionRecords(matterRoot, intakes) {
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
        if (record.schema_version === "extraction-record/v1" && record.file_id) records.push(record);
      } catch {
        // /doctor owns invalid extraction-record reporting; this skeleton skips bad records.
      }
    }
  }
  return records.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id)));
}

function collectSourceBlocks(record) {
  const blocks = [];
  for (const page of record.pages || []) {
    for (const block of page.blocks || []) {
      if (!block?.id || typeof block.text !== "string" || !block.text.trim()) continue;
      blocks.push({
        citation: `${record.file_id} ${block.id}`,
        page: page.page,
        block_id: block.id,
        block_type: block.type || "",
        confidence: page.confidence_avg ?? 1,
        needs_review: Boolean(page.needs_review),
        text: truncateText(block.text),
      });
    }
  }
  return selectLabelRelevantBlocks(blocks);
}

function selectLabelRelevantBlocks(blocks) {
  const selected = [];
  for (const block of blocks) {
    if (selected.length >= MAX_BLOCKS_PER_SOURCE) break;
    selected.push(block);
  }
  return selected;
}

function truncateText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > BLOCK_CHAR_LIMIT
    ? `${normalized.slice(0, BLOCK_CHAR_LIMIT)} [block truncated for source descriptor input]`
    : normalized;
}

function matterSummary(matterJson) {
  return {
    matter_name: matterJson.matter_name || "",
    client_name: matterJson.client_name || "",
    opposite_party: matterJson.opposite_party || "",
    matter_type: matterJson.matter_type || "",
    jurisdiction: matterJson.jurisdiction || "",
    brief_description: matterJson.brief_description || "",
  };
}

if (process.argv[1] === __filename) {
  const dryRun = !process.argv.includes("--apply");
  await loadLocalEnv({ appDir: path.dirname(__filename), override: false });
  runSourceDescriptors({ dryRun })
    .then((result) => {
      console.log(result.outputLines.join("\n"));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
