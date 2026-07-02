import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { createListOfDatesOutputPaths } from "./listofdates/artifacts.mjs";
import { DEFAULT_LIST_OF_DATES_ENGINE_VERSION } from "./listofdates/rendering.mjs";
import { isTwoPassListOfDatesEnabled } from "./listofdates/run-config.mjs";
import { runListOfDatesStage } from "./listofdates/stage-recording.mjs";
import { runCreateListOfDatesOnePass } from "./listofdates/one-pass-runner.mjs";
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
import { readSourceSuppressionIndex } from "./services/active-source-set-service.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_VERSION = DEFAULT_LIST_OF_DATES_ENGINE_VERSION;
export { DEFAULT_OPENAI_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_MODEL } from "./shared/ai-defaults.mjs";
export { createOpenAiProvider, createOpenRouterProvider } from "./listofdates/providers.mjs";
export { renderListOfDatesMarkdown } from "./listofdates/rendering.mjs";
export { buildCreateListOfDatesFromRecords } from "./listofdates/one-pass-runner.mjs";

export async function runCreateListOfDates(options = {}) {
  const matterRoot = options.matterRoot
    ? path.resolve(options.matterRoot)
    : (process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null);
  if (!matterRoot) throw new Error("MATTER_ROOT is not set. Pass options.matterRoot or set the env var.");

  const dryRun = Boolean(options.dryRun);
  const env = options.env || process.env;

  const stageRecorder = options.stageRecorder;
  const { matterJson, records, inputs } = await runListOfDatesStage(
    stageRecorder,
    { id: "build_packet", label: "Build Case Timeline packet" },
    async () => {
      const matterJson = await readMatterJson(matterRoot);
      const intakes = getIntakes(matterJson);
      if (!intakes.length) throw new Error("No intakes recorded in matter.json. Run /matter-init first.");

      const suppressionWarnings = [];
      const sourceSuppressionIndex = await readSourceSuppressionIndex(matterRoot, { warnings: suppressionWarnings });
      const fileIndex = await readFileRegisterIndex(matterRoot, intakes, { sourceSuppressionIndex, warnings: suppressionWarnings });
      const records = await readExtractionRecords(matterRoot, intakes, { sourceSuppressionIndex, warnings: suppressionWarnings });
      if (!records.length) throw new Error("No extraction records found. Run /extract before /create_listofdates.");

      const inputs = await prepareOnePassInputs({ matterRoot, matterJson, records, fileIndex, dryRun, suppressionWarnings });
      return { matterJson, records, inputs };
    },
    ({ records = [], inputs = {} } = {}) => ({
      summary: `Prepared ${records.length} extraction record(s), ${inputs.chronologyBlocks?.length || 0} chronology block(s)`,
      salvageable: true,
    }),
  );

  if (isTwoPassListOfDatesEnabled({ env, options })) {
    return runCreateListOfDatesTwoPass({
      options,
      env,
      matterRoot,
      dryRun,
      matterJson,
      records,
      ...inputs,
      stageRecorder,
    });
  }

  return runCreateListOfDatesOnePass({
    options: { ...options, engineVersion: ENGINE_VERSION },
    env,
    matterRoot,
    dryRun,
    matterJson,
    records,
    ...inputs,
    persistArtifacts: !dryRun,
    stageRecorder,
  });
}

async function prepareOnePassInputs({ matterRoot, matterJson, records, fileIndex, dryRun, suppressionWarnings = [] }) {
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
    ...suppressionWarnings.map((warning) => `[listofdates] ${warning}`),
    `[listofdates] read ${records.length} extraction record(s)`,
    `[listofdates] sending ${chronologyBlocks.length} source block(s) in ${chunks.length} AI request(s)`,
  ];
  if (filteredBlockCount) {
    outputLines.push(`[listofdates] filtered ${filteredBlockCount} meta/index source block(s) before AI input`);
  }

  // Keep the root engine visibly tied to the artifact contract after decomposition.
  createListOfDatesOutputPaths(matterRoot);
  return { sourceIndex, chronologyBlocks, chunks, filteredBlockCount, outputLines };
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
