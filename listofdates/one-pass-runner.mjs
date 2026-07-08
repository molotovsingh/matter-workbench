import { AI_TASKS } from "../shared/model-policy.mjs";
import { clusterChronologyEntries } from "./clustering.mjs";
import { OUTPUT_SCHEMA } from "./contracts.mjs";
import { buildListOfDatesArtifactFiles, createListOfDatesOutputPaths, writeListOfDatesArtifacts } from "./artifacts.mjs";
import { compareEntries, matterSummary, validateAndHydrateEntries } from "./entries.mjs";
import { DEFAULT_LIST_OF_DATES_ENGINE_VERSION } from "./rendering.mjs";
import { mergeAiRunMetadata } from "./run-metadata.mjs";
import { runListOfDatesStage, skipListOfDatesStage } from "./stage-recording.mjs";
import { createConfiguredListOfDatesProvider } from "./run-config.mjs";
import {
  buildSourceBlocks,
  chunkBlocks,
  filterChronologyCandidateBlocks,
  sourceIndexFromArtifact,
  withSourceLabels,
} from "./source-records.mjs";

export async function buildCreateListOfDatesFromRecords(options = {}) {
  const prepared = prepareCreateListOfDatesInputsFromRecords(options);
  const { matterRoot, dryRun, env, matterJson, records } = prepared;

  return runCreateListOfDatesOnePass({
    options,
    env,
    matterRoot,
    dryRun,
    matterJson,
    records,
    sourceIndex: prepared.sourceIndex,
    chronologyBlocks: prepared.chronologyBlocks,
    chunks: prepared.chunks,
    filteredBlockCount: prepared.filteredBlockCount,
    outputLines: prepared.outputLines,
    persistArtifacts: false,
    stageRecorder: options.stageRecorder,
  });
}

export function prepareCreateListOfDatesInputsFromRecords(options = {}) {
  const matterRoot = options.matterRoot || "";
  const dryRun = Boolean(options.dryRun);
  const env = options.env || process.env;
  const matterJson = options.matterJson || {};
  const records = Array.isArray(options.records) ? options.records : [];
  if (!records.length) throw new Error("No extraction records found. Run /extract before /create_case_timeline.");

  const fileIndex = options.fileIndex instanceof Map ? options.fileIndex : new Map();
  const blocks = buildSourceBlocks(records, fileIndex);
  if (!blocks.length) throw new Error("Extraction records contain no text blocks to analyze.");
  const sourceIndex = options.sourceIndex instanceof Map
    ? options.sourceIndex
    : sourceIndexFromArtifact(options.sourceIndexArtifact, blocks);
  const labeledBlocks = withSourceLabels(blocks, sourceIndex);
  const chronologyBlocks = filterChronologyCandidateBlocks(labeledBlocks, sourceIndex);
  if (!chronologyBlocks.length) {
    throw new Error("Extraction records contain no chronology-eligible text blocks to analyze.");
  }

  const chunks = chunkBlocks(chronologyBlocks);
  const filteredBlockCount = blocks.length - chronologyBlocks.length;
  const outputLines = [
    `> workbench.run /create_case_timeline${dryRun ? " (dry-run)" : ""}`,
    `[listofdates] read ${records.length} extraction record(s)`,
    `[listofdates] sending ${chronologyBlocks.length} source block(s) in ${chunks.length} AI request(s)`,
  ];
  if (filteredBlockCount) {
    outputLines.push(`[listofdates] filtered ${filteredBlockCount} meta/index source block(s) before AI input`);
  }

  return {
    matterRoot,
    dryRun,
    env,
    matterJson,
    records,
    sourceIndex,
    chronologyBlocks,
    chunks,
    filteredBlockCount,
    outputLines,
  };
}

export async function runCreateListOfDatesOnePass({
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
  persistArtifacts = false,
  stageRecorder,
}) {
  const configured = createConfiguredListOfDatesProvider({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    options,
    env,
    injectedProvider: options.aiProvider,
  });
  const engineVersion = options.engineVersion || DEFAULT_LIST_OF_DATES_ENGINE_VERSION;

  const rawEntries = [];
  const responseAiRuns = [];
  await runListOfDatesStage(
    stageRecorder,
    {
      id: "generate",
      label: "Generate Case Timeline candidates",
      provider: configured.baseAiRun.provider,
      model: configured.baseAiRun.model,
    },
    async () => {
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
    },
    () => ({
      summary: `Generated ${rawEntries.length} candidate event(s) from ${chunks.length} chunk(s)`,
      salvageable: true,
    }),
  );

  const validation = await runListOfDatesStage(
    stageRecorder,
    { id: "validate", label: "Validate Case Timeline citations" },
    async () => {
      const validEntries = validateAndHydrateEntries(rawEntries, chronologyBlocks, sourceIndex);
      const acceptedEntries = validEntries.sort(compareEntries);
      const entries = clusterChronologyEntries(acceptedEntries, { compareEntries }).sort(compareEntries);
      const aiRun = mergeAiRunMetadata(configured.baseAiRun, responseAiRuns);
      const artifactFiles = buildListOfDatesArtifactFiles({
        matterJson,
        engineVersion,
        generatedAt: options.generatedAt,
        aiRun,
        records,
        sourceIndex,
        entries,
      });
      const outputPaths = persistArtifacts ? createListOfDatesOutputPaths(matterRoot) : artifactFiles.outputPaths;
      return { validEntries, acceptedEntries, entries, aiRun, artifactFiles, outputPaths };
    },
    ({ acceptedEntries = [], entries = [] } = {}) => ({
      summary: `Accepted ${acceptedEntries.length} cited event(s), rendering ${entries.length} row(s)`,
      salvageable: true,
    }),
  );
  const { acceptedEntries, entries, aiRun, artifactFiles, outputPaths } = validation;

  if (persistArtifacts) {
    await runListOfDatesStage(
      stageRecorder,
      { id: "persist", label: "Persist Case Timeline artifacts" },
      () => writeListOfDatesArtifacts({
        matterRoot,
        matterJson,
        engineVersion,
        generatedAt: options.generatedAt,
        aiRun,
        records,
        sourceIndex,
        entries,
      }),
      () => ({ summary: `Wrote ${outputPaths.json}, ${outputPaths.csv}, ${outputPaths.markdown}` }),
    );
  } else {
    await skipListOfDatesStage(stageRecorder, { id: "persist", label: "Persist Case Timeline artifacts" }, { summary: "Dry run or in-memory build; artifacts were not written here." });
  }

  outputLines.push(`[listofdates] accepted ${acceptedEntries.length} cited date event(s)`);
  if (acceptedEntries.length !== entries.length) {
    outputLines.push(`[listofdates] rendered ${entries.length} chronology row(s) after cluster classification`);
  }
  outputLines.push(`[listofdates] provider ${aiRun.provider}: ${aiRun.model}`);
  outputLines.push(dryRun
    ? "[listofdates] dry run only. Re-run with apply to write the Case Timeline."
    : `[listofdates] wrote ${outputPaths.json}, ${outputPaths.csv}, ${outputPaths.markdown}`);

  return {
    dryRun,
    matterRoot,
    engineVersion,
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
    artifact: artifactFiles.jsonArtifact,
    artifactFiles: artifactFiles.files,
    outputLines,
  };
}
