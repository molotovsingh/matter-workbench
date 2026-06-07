import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./shared/atomic-file.mjs";
import { modelPolicyMetadata, resolveProviderConfig } from "./shared/ai-provider-policy.mjs";
import { parseCsv, toCsv } from "./shared/csv.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { AI_TASKS, resolveModelPolicy } from "./shared/model-policy.mjs";
import { toPosix } from "./shared/safe-paths.mjs";
import { sourceLabelMetadata } from "./shared/source-labels.mjs";
import { clusterChronologyEntries } from "./listofdates/clustering.mjs";
import {
  CANDIDATE_SCHEMA,
  CSV_HEADERS,
  OUTPUT_SCHEMA,
} from "./listofdates/contracts.mjs";
import {
  createListOfDatesProvider,
  EVENT_TYPES,
  LAWYER_FACING_PERSPECTIVE,
  LIST_OF_DATES_CANDIDATE_SYSTEM_PROMPT,
  LIST_OF_DATES_EDITOR_SYSTEM_PROMPT,
  listOfDatesCandidatePromptPayload,
  listOfDatesEditorPromptPayload,
} from "./listofdates/providers.mjs";
import {
  DEFAULT_LIST_OF_DATES_ENGINE_VERSION,
  renderListOfDatesMarkdown,
} from "./listofdates/rendering.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_VERSION = DEFAULT_LIST_OF_DATES_ENGINE_VERSION;
const TWO_PASS_ENGINE_VERSION = "create-listofdates-v2-two-pass";
export { DEFAULT_OPENAI_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_MODEL } from "./shared/ai-defaults.mjs";
export { createOpenAiProvider, createOpenRouterProvider } from "./listofdates/providers.mjs";
export { renderListOfDatesMarkdown } from "./listofdates/rendering.mjs";
const BLOCK_CHAR_LIMIT = 2800;
const CHUNK_CHAR_LIMIT = 18000;
const TWO_PASS_ENV_FLAG = "CREATE_LISTOFDATES_TWO_PASS_ENABLED";
const CANDIDATE_LEDGER_FILE = "List of Dates Candidates.json";
const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const HIGH_RISK_CONCLUSION_TERMS = [
  "fraud",
  "bad faith",
  "breach proved",
  "liability admitted",
];
const RAW_CITATION_RE = /\bFILE-\d{4,}\s+p\d+\.b\d+\b/g;
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
const NON_MERITS_EVENT_RE = /\b(?:client\s+interview\s+transcript\s+recorded|transcript\s+(?:was\s+)?recorded|email\s+correspondence\s+exported|e-?mail\s+export(?:ed)?|gmail\s+export(?:ed)?|file\s+export(?:ed)?|vakalatnama(?:\s+(?:was\s+)?executed|\s+execution)?|executed\s+vakalatnama)\b/i;

export async function runCreateListOfDates(options = {}) {
  const matterRoot = options.matterRoot
    ? path.resolve(options.matterRoot)
    : (process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null);
  if (!matterRoot) throw new Error("MATTER_ROOT is not set. Pass options.matterRoot or set the env var.");

  const dryRun = Boolean(options.dryRun);
  const env = options.env || process.env;

  const matterJson = await readMatterJson(matterRoot);
  const intakes = getIntakes(matterJson);
  if (!intakes.length) throw new Error("No intakes recorded in matter.json. Run /matter-init first.");

  const fileIndex = await readFileRegisterIndex(matterRoot, intakes);
  const records = await readExtractionRecords(matterRoot, intakes);
  if (!records.length) throw new Error("No extraction records found. Run /extract before /create_listofdates.");

  const blocks = buildSourceBlocks(records, fileIndex);
  if (!blocks.length) throw new Error("Extraction records contain no text blocks to analyze.");
  const sourceIndex = await readSourceIndex(matterRoot, blocks);
  const labeledBlocks = withSourceLabels(blocks, sourceIndex);
  const chronologyBlocks = filterChronologyCandidateBlocks(labeledBlocks, sourceIndex);
  if (!chronologyBlocks.length) {
    throw new Error("Extraction records contain no chronology-eligible text blocks to analyze.");
  }

  const chunks = chunkBlocks(chronologyBlocks);
  const filteredBlockCount = blocks.length - chronologyBlocks.length;
  const outputLines = [
    `> workbench.run /create_listofdates${dryRun ? " (dry-run)" : ""}`,
    `[listofdates] read ${records.length} extraction record(s)`,
    `[listofdates] sending ${chronologyBlocks.length} source block(s) in ${chunks.length} AI request(s)`,
  ];
  if (filteredBlockCount) {
    outputLines.push(`[listofdates] filtered ${filteredBlockCount} meta/index source block(s) before AI input`);
  }

  if (isTwoPassListOfDatesEnabled({ env, options })) {
    return runCreateListOfDatesTwoPass({
      options,
      env,
      matterRoot,
      dryRun,
      matterJson,
      records,
      sourceIndex,
      chronologyBlocks,
      chunks,
      filteredBlockCount,
      outputLines,
    });
  }

  const modelPolicy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env });
  const providerConfig = resolveProviderConfig(modelPolicy, {
    endpoint: options.endpoint,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
  });
  const baseAiRun = modelPolicyMetadata(modelPolicy, providerConfig);
  const provider = options.aiProvider || createListOfDatesProvider({
    providerConfig,
    apiKey: options.apiKey,
    env,
    fetchImpl: options.fetchImpl || fetch,
  });

  const rawEntries = [];
  const responseAiRuns = [];
  for (const [index, chunk] of chunks.entries()) {
    const response = await provider({
      matter: matterSummary(matterJson),
      chunk,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      schema: OUTPUT_SCHEMA,
    });
    if (!response || !Array.isArray(response.entries)) {
      const error = new Error(`AI provider returned an invalid list-of-dates payload for chunk ${index + 1}`);
      error.statusCode = 502;
      throw error;
    }
    rawEntries.push(...response.entries);
    if (response.ai_run) responseAiRuns.push(response.ai_run);
    outputLines.push(`[listofdates] AI chunk ${index + 1}/${chunks.length}: ${response.entries.length} candidate event(s)`);
  }

  const validEntries = validateAndHydrateEntries(rawEntries, chronologyBlocks, sourceIndex);
  const acceptedEntries = validEntries.sort(compareEntries);
  const entries = clusterChronologyEntries(acceptedEntries, { compareEntries }).sort(compareEntries);
  const aiRun = mergeAiRunMetadata(baseAiRun, responseAiRuns);

  const outputDir = path.join(matterRoot, "10_Library");
  const outputPaths = {
    directory: toPosix(path.relative(matterRoot, outputDir)),
    json: toPosix(path.relative(matterRoot, path.join(outputDir, "List of Dates.json"))),
    csv: toPosix(path.relative(matterRoot, path.join(outputDir, "List of Dates.csv"))),
    markdown: toPosix(path.relative(matterRoot, path.join(outputDir, "List of Dates.md"))),
  };

  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    await writeJsonFile(
      path.join(outputDir, "List of Dates.json"),
      {
        schema_version: "list-of-dates/v1",
        engine_version: ENGINE_VERSION,
        generated_at: new Date().toISOString(),
        matter: matterSummary(matterJson),
        ai_run: aiRun,
        source_record_count: records.length,
        source_snapshot: createSourceSnapshot(sourceIndex),
        entries,
      },
    );
    await writeFileAtomic(path.join(outputDir, "List of Dates.csv"), toCsv(entries, CSV_HEADERS));
    await writeFileAtomic(path.join(outputDir, "List of Dates.md"), renderListOfDatesMarkdown(matterJson, entries));
  }

  outputLines.push(`[listofdates] accepted ${acceptedEntries.length} cited date event(s)`);
  if (acceptedEntries.length !== entries.length) {
    outputLines.push(`[listofdates] rendered ${entries.length} chronology row(s) after cluster classification`);
  }
  outputLines.push(`[listofdates] provider ${aiRun.provider}: ${aiRun.model}`);
  outputLines.push(dryRun
    ? "[listofdates] dry run only. Re-run with apply to write list of dates."
    : `[listofdates] wrote ${outputPaths.json}, ${outputPaths.csv}, ${outputPaths.markdown}`);

  return {
    dryRun,
    matterRoot,
    engineVersion: ENGINE_VERSION,
    counts: {
      recordsRead: records.length,
      blocksSent: chronologyBlocks.length,
      blocksFiltered: filteredBlockCount,
      aiRequests: chunks.length,
      candidateEntries: rawEntries.length,
      acceptedEntries: acceptedEntries.length,
      clusteredEntries: acceptedEntries.length - entries.length,
      entries: entries.length,
      rejectedEntries: rawEntries.length - acceptedEntries.length,
    },
    outputPaths,
    aiRun,
    entries,
    outputLines,
  };
}

async function runCreateListOfDatesTwoPass({
  options,
  env,
  matterRoot,
  dryRun,
  matterJson,
  records,
  sourceIndex,
  chronologyBlocks,
  chunks,
  filteredBlockCount,
  outputLines,
}) {
  const pass1 = createConfiguredListOfDatesProvider({
    task: AI_TASKS.CREATE_LISTOFDATES_PASS1,
    options,
    env,
    prompt: {
      systemPrompt: LIST_OF_DATES_CANDIDATE_SYSTEM_PROMPT,
      payloadBuilder: listOfDatesCandidatePromptPayload,
      schemaName: "list_of_dates_candidate_chunk",
      schemaDescription: "Verbose source-backed chronology candidate ledger.",
    },
    injectedProvider: options.pass1Provider,
  });
  const pass2 = createConfiguredListOfDatesProvider({
    task: AI_TASKS.CREATE_LISTOFDATES_PASS2,
    options,
    env,
    prompt: {
      systemPrompt: LIST_OF_DATES_EDITOR_SYSTEM_PROMPT,
      payloadBuilder: listOfDatesEditorPromptPayload,
      schemaName: "list_of_dates_editor",
      schemaDescription: "Final lawyer-facing List of Dates entries edited from a candidate ledger.",
    },
    injectedProvider: options.pass2Provider,
  });
  outputLines.push("[listofdates] two-pass mode enabled");

  const rawCandidates = [];
  const pass1ResponseAiRuns = [];
  for (const [index, chunk] of chunks.entries()) {
    const response = await pass1.provider({
      matter: matterSummary(matterJson),
      chunk,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      schema: CANDIDATE_SCHEMA,
    });
    if (!response || !Array.isArray(response.candidates)) {
      const error = new Error(`AI provider returned an invalid candidate-ledger payload for chunk ${index + 1}`);
      error.statusCode = 502;
      throw error;
    }
    rawCandidates.push(...response.candidates);
    if (response.ai_run) pass1ResponseAiRuns.push(response.ai_run);
    outputLines.push(`[listofdates] pass 1 chunk ${index + 1}/${chunks.length}: ${response.candidates.length} candidate(s)`);
  }

  const pass1AiRun = mergeAiRunMetadata(pass1.baseAiRun, pass1ResponseAiRuns);
  const candidates = validateAndHydrateCandidates(rawCandidates, chronologyBlocks, sourceIndex);
  const outputDir = path.join(matterRoot, "10_Library");
  const outputPaths = {
    directory: toPosix(path.relative(matterRoot, outputDir)),
    candidates: toPosix(path.relative(matterRoot, path.join(outputDir, CANDIDATE_LEDGER_FILE))),
    json: toPosix(path.relative(matterRoot, path.join(outputDir, "List of Dates.json"))),
    csv: toPosix(path.relative(matterRoot, path.join(outputDir, "List of Dates.csv"))),
    markdown: toPosix(path.relative(matterRoot, path.join(outputDir, "List of Dates.md"))),
  };
  let candidateLedger = createCandidateLedger({
    matterJson,
    candidates,
    records,
    chronologyBlocks,
    filteredBlockCount,
    pass1AiRun,
    status: "pass1_complete",
  });

  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    await writeJsonFile(path.join(outputDir, CANDIDATE_LEDGER_FILE), candidateLedger);
  }

  try {
    const pass2Response = await pass2.provider({
      matter: matterSummary(matterJson),
      candidates,
      schema: OUTPUT_SCHEMA,
    });
    if (!pass2Response || !Array.isArray(pass2Response.entries)) {
      const error = new Error("AI provider returned an invalid two-pass list-of-dates editor payload");
      error.statusCode = 502;
      throw error;
    }

    const pass2AiRun = mergeAiRunMetadata(pass2.baseAiRun, pass2Response.ai_run ? [pass2Response.ai_run] : []);
    const candidateCitations = new Set(candidates.map((candidate) => candidate.citation));
    const editorEntries = pass2Response.entries.filter((entry) => candidateCitations.has(entry?.citation));
    const validEntries = validateAndHydrateEntries(editorEntries, chronologyBlocks, sourceIndex);
    const acceptedEntries = validEntries.sort(compareEntries);
    const entries = clusterChronologyEntries(acceptedEntries, { compareEntries }).sort(compareEntries);
    const aiRun = twoPassAiRunMetadata(pass1AiRun, pass2AiRun);
    candidateLedger = {
      ...candidateLedger,
      status: "succeeded",
      finished_at: new Date().toISOString(),
      pass2_ai_run: pass2AiRun,
      final_entry_count: entries.length,
    };

    if (!dryRun) {
      const listJson = {
        schema_version: "list-of-dates/v1",
        engine_version: TWO_PASS_ENGINE_VERSION,
        generation_mode: "two_pass",
        candidate_ledger_path: outputPaths.candidates,
        generated_at: new Date().toISOString(),
        matter: matterSummary(matterJson),
        ai_run: aiRun,
        pass1_ai_run: pass1AiRun,
        pass2_ai_run: pass2AiRun,
        source_record_count: records.length,
        source_snapshot: createSourceSnapshot(sourceIndex),
        validation: {
          candidate_count: candidates.length,
          accepted_entries: acceptedEntries.length,
          final_entries: entries.length,
          clustered_entries: acceptedEntries.length - entries.length,
        },
        entries,
      };
      await writeJsonFile(path.join(outputDir, "List of Dates.json"), listJson);
      await writeFileAtomic(path.join(outputDir, "List of Dates.csv"), toCsv(entries, CSV_HEADERS));
      await writeFileAtomic(path.join(outputDir, "List of Dates.md"), renderListOfDatesMarkdown(matterJson, entries, TWO_PASS_ENGINE_VERSION));
      await writeJsonFile(path.join(outputDir, CANDIDATE_LEDGER_FILE), candidateLedger);
    }

    outputLines.push(`[listofdates] pass 1 accepted ${candidates.length} candidate(s) into ${outputPaths.candidates}`);
    outputLines.push(`[listofdates] pass 2 accepted ${acceptedEntries.length} cited date event(s)`);
    if (acceptedEntries.length !== entries.length) {
      outputLines.push(`[listofdates] rendered ${entries.length} chronology row(s) after cluster classification`);
    }
    outputLines.push(`[listofdates] provider ${aiRun.provider}: ${aiRun.model}`);
    outputLines.push(dryRun
      ? "[listofdates] dry run only. Re-run with apply to write list of dates."
      : `[listofdates] wrote ${outputPaths.json}, ${outputPaths.csv}, ${outputPaths.markdown}`);

    return {
      dryRun,
      matterRoot,
      engineVersion: TWO_PASS_ENGINE_VERSION,
      generationMode: "two_pass",
      counts: {
        recordsRead: records.length,
        blocksSent: chronologyBlocks.length,
        blocksFiltered: filteredBlockCount,
        aiRequests: chunks.length + 1,
        candidateEntries: rawCandidates.length,
        acceptedCandidates: candidates.length,
        acceptedEntries: acceptedEntries.length,
        clusteredEntries: acceptedEntries.length - entries.length,
        entries: entries.length,
        rejectedCandidates: rawCandidates.length - candidates.length,
        rejectedEntries: pass2Response.entries.length - acceptedEntries.length,
      },
      outputPaths,
      candidateLedger,
      pass1AiRun,
      pass2AiRun,
      aiRun,
      entries,
      outputLines,
    };
  } catch (error) {
    if (!dryRun && candidateLedger?.candidates?.length) {
      await writeJsonFile(path.join(outputDir, CANDIDATE_LEDGER_FILE), {
        ...candidateLedger,
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: error.message,
      });
    }
    throw error;
  }
}

function isTwoPassListOfDatesEnabled({ env, options }) {
  if (typeof options.twoPass === "boolean") return options.twoPass;
  return ["1", "true", "yes", "on"].includes(String(env[TWO_PASS_ENV_FLAG] || "").trim().toLowerCase());
}

function createConfiguredListOfDatesProvider({ task, options, env, prompt, injectedProvider }) {
  const modelPolicy = resolveModelPolicy(task, { env });
  const providerConfig = resolveProviderConfig(modelPolicy, {
    endpoint: options.endpoint,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
  });
  const baseAiRun = modelPolicyMetadata(modelPolicy, providerConfig);
  const provider = injectedProvider || createListOfDatesProvider({
    providerConfig,
    apiKey: options.apiKey,
    env,
    fetchImpl: options.fetchImpl || fetch,
    prompt,
  });
  return { provider, baseAiRun };
}

function mergeAiRunMetadata(baseAiRun, responseAiRuns) {
  const aiRuns = Array.isArray(responseAiRuns) ? responseAiRuns : [responseAiRuns].filter(Boolean);
  if (!aiRuns.length) return baseAiRun;
  const merged = { ...baseAiRun };
  const usage = {};
  for (const aiRun of aiRuns) {
    if (!aiRun || typeof aiRun !== "object" || Array.isArray(aiRun)) continue;
    if (aiRun.returnedModel) merged.returnedModel = aiRun.returnedModel;
    if (aiRun.returnedProvider) merged.returnedProvider = aiRun.returnedProvider;
    if (aiRun.usage) {
      addNumber(usage, "promptTokens", aiRun.usage.promptTokens);
      addNumber(usage, "completionTokens", aiRun.usage.completionTokens);
      addNumber(usage, "totalTokens", aiRun.usage.totalTokens);
      addNumber(usage, "cost", aiRun.usage.cost);
    }
  }
  if (Object.keys(usage).length) merged.usage = usage;
  return merged;
}

function twoPassAiRunMetadata(pass1AiRun, pass2AiRun) {
  return {
    policyVersion: pass2AiRun.policyVersion || pass1AiRun.policyVersion,
    policyPromptVersion: pass2AiRun.policyPromptVersion || pass1AiRun.policyPromptVersion,
    task: "create_listofdates_two_pass",
    tier: "source_backed_analysis",
    provider: "two-pass",
    model: `${pass1AiRun.model} -> ${pass2AiRun.model}`,
    fallback: "fail_closed",
    pass1: pass1AiRun,
    pass2: pass2AiRun,
  };
}

function createCandidateLedger({
  matterJson,
  candidates,
  records,
  chronologyBlocks,
  filteredBlockCount,
  pass1AiRun,
  status,
}) {
  return {
    schema_version: "list-of-dates-candidates/v1",
    engine_version: TWO_PASS_ENGINE_VERSION,
    status,
    generated_at: new Date().toISOString(),
    matter: matterSummary(matterJson),
    source_record_count: records.length,
    source_block_count: chronologyBlocks.length,
    filtered_block_count: filteredBlockCount,
    ai_run: pass1AiRun,
    candidates,
  };
}

async function writeJsonFile(filePath, value) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function addNumber(target, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  target[key] = (target[key] || 0) + number;
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

async function readFileRegisterIndex(matterRoot, intakes) {
  const index = new Map();
  for (const intake of intakes) {
    const registerPath = path.join(matterRoot, intake.intake_dir, "File Register.csv");
    try {
      const rows = parseCsv(await readFile(registerPath, "utf8"));
      for (const row of rows) {
        if (row.file_id) index.set(row.file_id, row);
      }
    } catch {
      // Missing historical registers should not block chronology from records.
    }
  }
  return index;
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
        // /doctor will own invalid-record reporting; this skill skips them.
      }
    }
  }
  return records.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id)));
}

function buildSourceBlocks(records, fileIndex) {
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

function chunkBlocks(blocks) {
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

async function readSourceIndex(matterRoot, blocks) {
  const indexPath = path.join(matterRoot, "10_Library", "Source Index.json");
  let artifact;
  try {
    artifact = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    return new Map();
  }
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

function createSourceSnapshot(sourceIndex = new Map()) {
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

function filterChronologyCandidateBlocks(blocks, sourceIndex = new Map()) {
  return blocks.filter((block) => !isMetaChronologySource(block, sourceIndex.get(block.file_id)));
}

function isMetaChronologySource(block, sourceMetadata = {}) {
  const documentType = normalizeDisplayText(sourceMetadata.document_type).toLowerCase();
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

function validateAndHydrateEntries(rawEntries, blocks, sourceIndex = new Map()) {
  const blockByCitation = new Map(blocks.map((block) => [block.citation, block]));
  const entries = [];
  for (const raw of rawEntries) {
    const block = blockByCitation.get(raw.citation);
    if (!block) continue;
    if (!isValidDateIso(raw.date_iso)) continue;
    const event = normalizeEventText(raw.event, block.text);
    const dateText = String(raw.date_text || "").replace(/\s+/g, " ").trim();
    const eventType = normalizeEventType(raw.event_type);
    const legalRelevance = normalizeLegalRelevance(raw.legal_relevance, block.text);
    const issueTags = normalizeIssueTags(raw.issue_tags);
    const perspective = String(raw.perspective || "").replace(/\s+/g, " ").trim();
    if (!event || !dateText || !eventType || !legalRelevance || !issueTags.length) continue;
    if (perspective !== LAWYER_FACING_PERSPECTIVE) continue;
    if (isNonMeritsChronologyEntry({ event, legalRelevance, eventType, issueTags })) continue;
    entries.push({
      date_iso: raw.date_iso,
      date_text: dateText,
      event,
      event_type: eventType,
      legal_relevance: legalRelevance,
      issue_tags: issueTags,
      perspective,
      citation: raw.citation,
      file_id: block.file_id,
      source_file_id: block.file_id,
      ...sourceLabelFields(sourceIndex.get(block.file_id)),
      source_path: block.source_path,
      original_name: block.original_name,
      page: block.page,
      block_id: block.block_id,
      block_type: block.block_type,
      needs_review: Boolean(raw.needs_review || block.needs_review),
      confidence: normalizeConfidence(raw.confidence),
      source_excerpt: block.text.slice(0, 500),
    });
  }
  return entries;
}

function validateAndHydrateCandidates(rawCandidates, blocks, sourceIndex = new Map()) {
  const blockByCitation = new Map(blocks.map((block) => [block.citation, block]));
  const candidates = [];
  for (const raw of rawCandidates) {
    const block = blockByCitation.get(raw?.citation);
    if (!block) continue;
    if (!isValidDateIso(raw.date_iso)) continue;
    const eventCandidate = normalizeNarrativeText(raw.event_candidate, block.text).slice(0, 1000);
    const legalMateriality = normalizeNarrativeText(raw.legal_materiality, block.text).slice(0, 1000);
    const dateText = String(raw.date_text || "").replace(/\s+/g, " ").trim();
    if (!eventCandidate || !legalMateriality || !dateText) continue;
    const candidateType = normalizeCandidateType(raw.candidate_type);
    const partyPosture = normalizePartyPosture(raw.party_posture);
    candidates.push({
      candidate_id: `cand_${String(candidates.length + 1).padStart(4, "0")}`,
      date_iso: raw.date_iso,
      date_text: dateText,
      event_candidate: eventCandidate,
      legal_materiality: legalMateriality,
      citation: raw.citation,
      source_excerpt: normalizeCandidateExcerpt(raw.source_excerpt, block.text),
      candidate_type: candidateType,
      party_posture: partyPosture,
      same_fact_hint: normalizeCandidateNote(raw.same_fact_hint),
      date_uncertainty: normalizeCandidateNote(raw.date_uncertainty),
      ocr_suspicion: normalizeCandidateNote(raw.ocr_suspicion),
      file_id: block.file_id,
      source_file_id: block.file_id,
      ...sourceLabelFields(sourceIndex.get(block.file_id)),
      source_path: block.source_path,
      original_name: block.original_name,
      page: block.page,
      block_id: block.block_id,
      block_type: block.block_type,
      needs_review: Boolean(raw.needs_review || block.needs_review),
      confidence: normalizeConfidence(raw.confidence),
    });
  }
  return candidates.sort(compareEntries);
}

function normalizeCandidateType(value) {
  const type = String(value || "").trim().toLowerCase();
  return [
    "agreement",
    "payment",
    "notice",
    "pleading",
    "order",
    "filing",
    "inspection",
    "correspondence",
    "other",
  ].includes(type) ? type : "other";
}

function normalizePartyPosture(value) {
  const posture = String(value || "").trim().toLowerCase();
  return ["helps_client", "hurts_client", "neutral", "unclear"].includes(posture) ? posture : "unclear";
}

function normalizeCandidateExcerpt(value, sourceText) {
  const excerpt = String(value || "").replace(/\s+/g, " ").trim();
  return (excerpt || String(sourceText || "").replace(/\s+/g, " ").trim()).slice(0, 700);
}

function normalizeCandidateNote(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function sourceLabelFields(sourceMetadata = {}) {
  const fields = {};
  if (sourceMetadata.source_id) fields.source_id = sourceMetadata.source_id;
  if (sourceMetadata.content_hash) fields.content_hash = sourceMetadata.content_hash;
  if (sourceMetadata.source_label) fields.source_label = sourceMetadata.source_label;
  if (sourceMetadata.source_short_label) fields.source_short_label = sourceMetadata.source_short_label;
  return fields;
}

function withSourceLabels(blocks, sourceIndex = new Map()) {
  return blocks.map((block) => ({
    ...block,
    ...sourceLabelFields(sourceIndex.get(block.file_id)),
  }));
}

function normalizeEventType(value) {
  const eventType = String(value || "").trim().toLowerCase();
  return EVENT_TYPE_SET.has(eventType) ? eventType : "";
}

function normalizeEventText(value, sourceText) {
  const event = normalizeNarrativeText(value, sourceText);
  if (!event) return "";
  if (hasUnsupportedHighRiskConclusion(event, sourceText)) return "";
  return event.slice(0, 1000);
}

function normalizeNarrativeText(value, sourceText) {
  return softenUnsupportedConclusionLanguage(String(value || ""))
    .replace(RAW_CITATION_RE, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

function normalizeLegalRelevance(value, sourceText) {
  const relevance = sharpenLegalRelevanceLanguage(normalizeNarrativeText(value, sourceText));
  if (!relevance) return "";
  if (hasUnsupportedHighRiskConclusion(relevance, sourceText)) return "";
  return relevance.slice(0, 1000);
}

function isNonMeritsChronologyEntry({ event, legalRelevance, eventType, issueTags }) {
  const text = `${event} ${legalRelevance} ${eventType} ${(issueTags || []).join(" ")}`;
  return NON_MERITS_EVENT_RE.test(text);
}

function sharpenLegalRelevanceLanguage(value) {
  return String(value || "")
    .replace(/\bThis event is relevant to the client's case because\b/gi, "Supports the client's case because")
    .replace(/\bThis event is relevant because\b/gi, "Supports the client's chronology because")
    .replace(/\bThis payment is relevant as it shows\b/gi, "Supports")
    .replace(/\bThis notice is relevant as it marks\b/gi, "Shows notice by marking")
    .replace(/\bThis notice is relevant because\b/gi, "Shows notice because")
    .replace(/\bThis communication is relevant because\b/gi, "Records")
    .replace(/\bcrucial\b/gi, "relevant")
    .replace(/\bfoundational\b/gi, "relevant")
    .replace(/\bdemonstrates\b/gi, "may support")
    .replace(/\bshows\s+(?:their|its|Skyline'?s|the opposing party'?s)\s+willingness\s+to\s+(?:accommodate|resolve)(?:\s+(?:it|the dispute|the issue|the grievance))?/gi, "records the opposing party's stated response to the complaint")
    .replace(/\bwillingness\s+to\s+(?:accommodate|resolve)(?:\s+(?:it|the dispute|the issue|the grievance))?/gi, "stated response to the complaint")
    .replace(/\bmay support\s+(?:the\s+)?emotional and financial impact\b/gi, "may support hardship and consequential prejudice, subject to proof")
    .replace(/\bemotional and financial impact\b/gi, "hardship and consequential prejudice, subject to proof")
    .replace(/\s+/g, " ")
    .trim();
}

function softenUnsupportedConclusionLanguage(value) {
  return value
    .replace(/\bproves?\b/gi, "supports")
    .replace(/\bproved\b/gi, "supported")
    .replace(/\bconstitutes\s+a\s+breach\b/gi, "supports a contractual default issue")
    .replace(/\bestablishing\s+the\s+breach\b/gi, "supporting the client's default issue")
    .replace(/\bbreach\s+of\s+(?:the\s+)?agreement\b/gi, "contractual default issue")
    .replace(/\bbreached\b/gi, "missed")
    .replace(/\bbreach\b/gi, "default issue");
}

function hasUnsupportedHighRiskConclusion(relevance, sourceText) {
  const source = String(sourceText || "").toLowerCase();
  const text = relevance.toLowerCase();
  return HIGH_RISK_CONCLUSION_TERMS.some((term) => text.includes(term) && !source.includes(term));
}

function normalizeIssueTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || "").split(/[,;]/);
  const tags = [];
  const seen = new Set();
  for (const rawTag of rawTags) {
    const tag = String(rawTag || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag.slice(0, 64));
    if (tags.length >= 8) break;
  }
  return tags;
}

function normalizeDisplayText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isValidDateIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function compareEntries(a, b) {
  return a.date_iso.localeCompare(b.date_iso)
    || a.file_id.localeCompare(b.file_id)
    || String(a.block_id).localeCompare(String(b.block_id))
    || a.date_text.localeCompare(b.date_text);
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
  await loadLocalEnv({ appDir: path.dirname(__filename), override: true });
  runCreateListOfDates({ dryRun })
    .then((result) => {
      console.log(result.outputLines.join("\n"));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
