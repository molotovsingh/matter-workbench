import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { AI_TASKS } from "./shared/model-policy.mjs";
import { clusterChronologyEntries } from "./listofdates/clustering.mjs";
import { OUTPUT_SCHEMA } from "./listofdates/contracts.mjs";
import {
  createListOfDatesOutputPaths,
  writeListOfDatesArtifacts,
} from "./listofdates/artifacts.mjs";
import {
  compareEntries,
  matterSummary,
  validateAndHydrateEntries,
} from "./listofdates/entries.mjs";
import {
  DEFAULT_LIST_OF_DATES_ENGINE_VERSION,
  renderListOfDatesMarkdown,
} from "./listofdates/rendering.mjs";
import { mergeAiRunMetadata } from "./listofdates/run-metadata.mjs";
import {
  createConfiguredListOfDatesProvider,
  isTwoPassListOfDatesEnabled,
} from "./listofdates/run-config.mjs";
import { runCreateListOfDatesTwoPass } from "./listofdates/two-pass-runner.mjs";
import {
  buildSourceBlocks,
  chunkBlocks,
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

  const configured = createConfiguredListOfDatesProvider({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    options,
    env,
    injectedProvider: options.aiProvider,
  });

  const rawEntries = [];
  const responseAiRuns = [];
  for (const [index, chunk] of chunks.entries()) {
    const response = await configured.provider({
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
  const aiRun = mergeAiRunMetadata(configured.baseAiRun, responseAiRuns);

  const outputPaths = createListOfDatesOutputPaths(matterRoot);

  if (!dryRun) {
    await writeListOfDatesArtifacts({
      matterRoot,
      matterJson,
      engineVersion: ENGINE_VERSION,
      aiRun,
      records,
      sourceIndex,
      entries,
    });
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
