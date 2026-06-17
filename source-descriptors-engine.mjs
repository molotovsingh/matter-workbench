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
import { makeHttpError, toPosix } from "./shared/safe-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_VERSION = "source-descriptors-v1-skeleton";
const SOURCE_INDEX_SCHEMA_VERSION = "source-index/v1";
const DEFAULT_SOURCE_DESCRIPTOR_BATCH_SIZE = 4;
const DEFAULT_SOURCE_DESCRIPTOR_MAX_ATTEMPTS = 2;
const SOURCE_DESCRIPTOR_RETRY_STATUS_CODES = new Set([429, 500, 503, 504]);

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
  const maxAttempts = resolveSourceMaxAttempts(options);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const providerResponses = [];
  const descriptors = [];
  const reviewMessages = [];
  for (const [index, batch] of sourceBatches.entries()) {
    const batchIndex = index + 1;
    await reportSourceDescriptorProgress(onProgress, {
      stage: "source-labels-batch-start",
      batchIndex,
      batchCount: sourceBatches.length,
      sourceCount: batch.length,
      fileIds: batch.map((packet) => packet.file_id),
    });
    const batchResult = await describeSourceBatchResilient({
      provider,
      matter,
      schema: SOURCE_INDEX_OUTPUT_SCHEMA,
      batch,
      batchIndex,
      batchCount: sourceBatches.length,
      maxAttempts,
    });
    await reportSourceDescriptorProgress(onProgress, {
      stage: "source-labels-batch-complete",
      batchIndex,
      batchCount: sourceBatches.length,
      sourceCount: batch.length,
      descriptors: batchResult.descriptors.length,
      needsReview: batchResult.reviewMessages.length > 0,
    });
    providerResponses.push(batchResult.providerResponse);
    descriptors.push(...batchResult.descriptors);
    reviewMessages.push(...batchResult.reviewMessages);
  }
  assertAtLeastOneSourceDescriptorBatchSucceeded(providerResponses);
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
      reviewMessages.length ? `[source-index] ${reviewMessages.length} source descriptor batch(es) need lawyer review` : "",
      dryRun
        ? `[source-index] dry run only. Re-run with apply to write ${SOURCE_INDEX_FILENAME}.`
        : `[source-index] wrote ${toPosix(path.relative(matterRoot, outputJson))}`,
    ].filter(Boolean),
  };
}

function assertAtLeastOneSourceDescriptorBatchSucceeded(providerResponses) {
  if (!providerResponses.length) return;
  if (!providerResponses.every((response) => response?.status === "failed")) return;
  const firstError = providerResponses.find((response) => response?.error)?.error;
  const message = [
    "All source descriptor batches failed; Source Index was not written.",
    firstError?.message ? `First failure: ${firstError.message}` : "",
  ].filter(Boolean).join(" ");
  throw makeHttpError(message, firstError?.statusCode || 502, "source_descriptors.all_batches_failed");
}

async function reportSourceDescriptorProgress(onProgress, event) {
  if (!onProgress) return;
  await onProgress(event);
}

async function describeSourceBatchResilient({
  provider,
  matter,
  schema,
  batch,
  batchIndex,
  batchCount,
  maxAttempts,
}) {
  try {
    const providerResponse = await describeSourceBatchWithRetry({
      provider,
      matter,
      schema,
      batch,
      batchIndex,
      batchCount,
      maxAttempts,
    });
    const validationResult = validateSourceBatchResilient(providerResponse, batch);
    return {
      descriptors: validationResult.descriptors,
      reviewMessages: validationResult.reviewMessages.length ? [`batch ${batchIndex}/${batchCount}`] : [],
      providerResponse: {
        source_count: batch.length,
        status: validationResult.reviewMessages.length ? "needs_review" : "completed",
        ai_run: providerResponse.ai_run,
        warnings: validationResult.reviewMessages,
      },
    };
  } catch (error) {
    if (isUnrecoverableSourceDescriptorError(error)) throw error;
    const wrapped = isSourceDescriptorBatchError(error)
      ? error
      : sourceDescriptorBatchError({
        error,
        batchIndex,
        batchCount,
        attempt: maxAttempts,
        maxAttempts,
      });
    return {
      descriptors: batch.map((packet) => fallbackSourceDescriptor(packet, wrapped.message)),
      reviewMessages: [`batch ${batchIndex}/${batchCount}`],
      providerResponse: {
        source_count: batch.length,
        status: "failed",
        error: {
          statusCode: wrapped.statusCode || 502,
          code: wrapped.code || "source_descriptors.batch_failed",
          message: wrapped.message,
        },
      },
    };
  }
}

function validateSourceBatchResilient(providerResponse, batch) {
  if (!providerResponse || !Array.isArray(providerResponse.sources)) {
    const reason = "Source descriptor provider returned an invalid payload: expected sources[]";
    return {
      descriptors: batch.map((packet) => fallbackSourceDescriptor(packet, reason)),
      reviewMessages: [reason],
    };
  }

  const byFileId = new Map();
  const unexpected = [];
  const expectedFileIds = new Set(batch.map((packet) => packet.file_id));
  for (const descriptor of providerResponse.sources) {
    const fileId = typeof descriptor?.file_id === "string" ? descriptor.file_id : "";
    if (!expectedFileIds.has(fileId)) {
      unexpected.push(fileId || "(missing file_id)");
      continue;
    }
    const candidates = byFileId.get(fileId) || [];
    candidates.push(descriptor);
    byFileId.set(fileId, candidates);
  }

  const descriptors = [];
  const reviewMessages = [];
  if (unexpected.length) {
    reviewMessages.push(`Ignored unexpected source descriptor file_id(s): ${unexpected.join(", ")}`);
  }
  for (const packet of batch) {
    const candidates = byFileId.get(packet.file_id) || [];
    if (!candidates.length) {
      const reason = `Source descriptor provider did not return a descriptor for ${packet.file_id}`;
      descriptors.push(fallbackSourceDescriptor(packet, reason));
      reviewMessages.push(reason);
      continue;
    }
    if (candidates.length > 1) {
      const reason = `Source descriptor provider returned duplicate descriptors for ${packet.file_id}`;
      descriptors.push(fallbackSourceDescriptor(packet, reason));
      reviewMessages.push(reason);
      continue;
    }
    try {
      descriptors.push(...validateAndSortDescriptors({ sources: candidates }, [packet]));
    } catch (error) {
      const reason = error?.message || String(error || "Source descriptor validation failed");
      descriptors.push(fallbackSourceDescriptor(packet, reason));
      reviewMessages.push(reason);
    }
  }

  return {
    descriptors: descriptors.sort((a, b) => a.file_id.localeCompare(b.file_id)),
    reviewMessages,
  };
}

function fallbackSourceDescriptor(packet, reason) {
  const warning = String(reason || "Source descriptor needs lawyer review.");
  const displayLabel = fallbackSourceLabel(packet);
  return {
    source_id: packet.file_id,
    content_hash: packet.sha256,
    file_id: packet.file_id,
    sha256: packet.sha256,
    source_path: packet.source_path,
    display_label: displayLabel,
    short_label: displayLabel,
    suggested_label: displayLabel,
    confirmed_label: "",
    label_status: "needs_review",
    label_source: "model",
    label_reason: "Source label needs lawyer review because the model output could not be generated or validated.",
    label_revision: 1,
    confirmed_by: "",
    confirmed_at: "",
    document_type: "unknown",
    document_date: null,
    date_basis: "unknown",
    parties: {
      from: "",
      to: [],
      cc: [],
      author: "",
      court: "",
      judge: "",
      issuing_party: "",
      recipient_party: "",
      deponent: "",
      signatory: "",
    },
    confidence: 0,
    needs_review: true,
    evidence: [
      {
        citation: firstEvidenceCitation(packet),
        reason: "Source label could not be generated reliably; review this source manually.",
      },
    ],
    warnings: [warning],
  };
}

function fallbackSourceLabel(packet) {
  const name = String(packet.original_name || packet.source_path || packet.file_id)
    .replace(/FILE-\d{4,}/gi, "")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name ? `Source label needs review: ${name}` : "Source label needs review";
}

function firstEvidenceCitation(packet) {
  const citation = packet.blocks?.find((block) => typeof block?.citation === "string" && block.citation.trim())?.citation;
  return citation || `${packet.file_id} p1.b1`;
}

function resolveSourceBatchSize(options = {}) {
  const env = options.env || process.env;
  const raw = options.sourceBatchSize ?? options.batchSize ?? env.SOURCE_DESCRIPTOR_BATCH_SIZE;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SOURCE_DESCRIPTOR_BATCH_SIZE;
}

function resolveSourceMaxAttempts(options = {}) {
  const env = options.env || process.env;
  const raw = options.sourceMaxAttempts ?? options.maxAttempts ?? env.SOURCE_DESCRIPTOR_MAX_ATTEMPTS;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SOURCE_DESCRIPTOR_MAX_ATTEMPTS;
}

async function describeSourceBatchWithRetry({
  provider,
  matter,
  schema,
  batch,
  batchIndex,
  batchCount,
  maxAttempts,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await provider({
        matter,
        sources: batch,
        schema,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableSourceDescriptorError(error)) {
        throw sourceDescriptorBatchError({ error, batchIndex, batchCount, attempt, maxAttempts });
      }
    }
  }
  throw sourceDescriptorBatchError({ error: lastError, batchIndex, batchCount, attempt: maxAttempts, maxAttempts });
}

function isRetryableSourceDescriptorError(error) {
  if (!error?.statusCode) return true;
  return SOURCE_DESCRIPTOR_RETRY_STATUS_CODES.has(error.statusCode);
}

function isSourceDescriptorBatchError(error) {
  return /^Source descriptor batch \d+\/\d+ failed:/.test(error?.message || "");
}

function isUnrecoverableSourceDescriptorError(error) {
  return /OPENROUTER_API_KEY is required for source description/i.test(error?.message || "");
}

function sourceDescriptorBatchError({ error, batchIndex, batchCount, attempt, maxAttempts }) {
  const message = [
    `Source descriptor batch ${batchIndex}/${batchCount} failed`,
    `after ${attempt}/${maxAttempts} attempt(s)`,
    error?.message || String(error || "unknown error"),
  ].join(": ");
  const wrapped = makeHttpError(message, error?.statusCode || 502, "source_descriptors.batch_failed");
  wrapped.cause = error;
  return wrapped;
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
    const response = providerResponses[0] || {};
    const diagnostics = {};
    if (response.status && response.status !== "completed") diagnostics.status = response.status;
    if (response.warnings?.length) diagnostics.warnings = response.warnings;
    if (response.error) diagnostics.error = response.error;
    return mergeAiRunMetadata({ ...baseAiRun, ...diagnostics }, response.ai_run);
  }
  const batchRuns = providerResponses.map((response, index) => ({
    batch: index + 1,
    sourceCount: response.source_count,
    ...(response.status && response.status !== "completed" ? { status: response.status } : {}),
    ...(response.warnings?.length ? { warnings: response.warnings } : {}),
    ...(response.error ? { error: response.error } : {}),
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
