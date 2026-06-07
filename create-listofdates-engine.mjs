import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./shared/atomic-file.mjs";
import { modelPolicyMetadata, resolveProviderConfig } from "./shared/ai-provider-policy.mjs";
import { toCsv } from "./shared/csv.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { AI_TASKS, resolveModelPolicy } from "./shared/model-policy.mjs";
import { toPosix } from "./shared/safe-paths.mjs";
import { clusterChronologyEntries } from "./listofdates/clustering.mjs";
import {
  CANDIDATE_SCHEMA,
  CSV_HEADERS,
  OUTPUT_SCHEMA,
} from "./listofdates/contracts.mjs";
import {
  compareEntries,
  matterSummary,
  validateAndHydrateCandidates,
  validateAndHydrateEntries,
} from "./listofdates/entries.mjs";
import {
  createListOfDatesProvider,
  LIST_OF_DATES_CANDIDATE_SYSTEM_PROMPT,
  LIST_OF_DATES_EDITOR_SYSTEM_PROMPT,
  listOfDatesCandidatePromptPayload,
  listOfDatesEditorPromptPayload,
} from "./listofdates/providers.mjs";
import {
  DEFAULT_LIST_OF_DATES_ENGINE_VERSION,
  renderListOfDatesMarkdown,
} from "./listofdates/rendering.mjs";
import {
  TWO_PASS_ENGINE_VERSION,
  createCandidateLedger,
  mergeAiRunMetadata,
  twoPassAiRunMetadata,
} from "./listofdates/run-metadata.mjs";
import {
  buildSourceBlocks,
  chunkBlocks,
  createSourceSnapshot,
  filterChronologyCandidateBlocks,
  getIntakes,
  readExtractionRecords,
  readFileRegisterIndex,
  readMatterJson,
  readSourceIndex,
  withSourceLabels,
} from "./listofdates/source-records.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_VERSION = DEFAULT_LIST_OF_DATES_ENGINE_VERSION;
export { DEFAULT_OPENAI_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_MODEL } from "./shared/ai-defaults.mjs";
export { createOpenAiProvider, createOpenRouterProvider } from "./listofdates/providers.mjs";
export { renderListOfDatesMarkdown } from "./listofdates/rendering.mjs";
const TWO_PASS_ENV_FLAG = "CREATE_LISTOFDATES_TWO_PASS_ENABLED";
const CANDIDATE_LEDGER_FILE = "List of Dates Candidates.json";

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

async function writeJsonFile(filePath, value) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
