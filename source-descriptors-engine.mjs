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
import { buildSourcePackets } from "./source-descriptors-packets.mjs";
import {
  SOURCE_INDEX_OUTPUT_SCHEMA,
  validateAndSortDescriptors,
} from "./source-descriptors-validation.mjs";
import { toPosix } from "./shared/safe-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_VERSION = "source-descriptors-v1-skeleton";
const SOURCE_INDEX_SCHEMA_VERSION = "source-index/v1";
const DEFAULT_SOURCE_DESCRIPTOR_BATCH_SIZE = 8;

export { createOpenRouterSourceDescriptorProvider } from "./source-descriptors-provider.mjs";
export { buildSourcePackets } from "./source-descriptors-packets.mjs";
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
  const sourceBatches = chunk(sourcePackets, resolveSourceBatchSize(options));
  const providerResponses = [];
  const descriptors = [];
  for (const batch of sourceBatches) {
    const providerResponse = await provider({
      matter,
      sources: batch,
      schema: SOURCE_INDEX_OUTPUT_SCHEMA,
    });
    providerResponses.push({
      source_count: batch.length,
      ai_run: providerResponse.ai_run,
    });
    descriptors.push(...validateAndSortDescriptors(providerResponse, batch));
  }
  const aiRun = options.aiRun || mergeSourceDescriptorAiRunMetadata(providerSetup.aiRun, providerResponses);
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
      sourceBatches.length > 1 ? `[source-index] described sources in ${sourceBatches.length} batch(es)` : "",
      dryRun
        ? `[source-index] dry run only. Re-run with apply to write ${SOURCE_INDEX_FILENAME}.`
        : `[source-index] wrote ${toPosix(path.relative(matterRoot, outputJson))}`,
    ].filter(Boolean),
  };
}

function resolveSourceBatchSize(options = {}) {
  const env = options.env || process.env;
  const raw = options.sourceBatchSize ?? options.batchSize ?? env.SOURCE_DESCRIPTOR_BATCH_SIZE;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SOURCE_DESCRIPTOR_BATCH_SIZE;
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function mergeSourceDescriptorAiRunMetadata(baseAiRun, providerResponses) {
  if (providerResponses.length === 1) {
    return mergeAiRunMetadata(baseAiRun, providerResponses[0]?.ai_run);
  }
  const batchRuns = providerResponses.map((response, index) => ({
    batch: index + 1,
    sourceCount: response.source_count,
    ...(response.ai_run && typeof response.ai_run === "object" ? response.ai_run : {}),
  }));
  const merged = {
    ...baseAiRun,
    batchCount: providerResponses.length,
    batches: batchRuns,
  };
  const usage = sumUsage(batchRuns.map((run) => run.usage));
  if (usage) merged.usage = usage;
  const returnedModels = uniqueStrings(batchRuns.map((run) => run.returnedModel));
  const returnedProviders = uniqueStrings(batchRuns.map((run) => run.returnedProvider));
  if (returnedModels.length === 1) merged.returnedModel = returnedModels[0];
  if (returnedProviders.length === 1) merged.returnedProvider = returnedProviders[0];
  return merged;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function sumUsage(usages) {
  const totals = {};
  for (const usage of usages) {
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) continue;
    for (const key of ["promptTokens", "completionTokens", "totalTokens", "cost"]) {
      const value = usage[key];
      if (typeof value === "number" && Number.isFinite(value)) totals[key] = (totals[key] || 0) + value;
    }
  }
  return Object.keys(totals).length ? totals : null;
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
