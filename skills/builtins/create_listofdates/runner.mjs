import { runCreateListOfDates } from "../../../create-listofdates-engine.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../../../shared/model-policy.mjs";

export const CREATE_LISTOFDATES_SLASH = "/create_listofdates";

export function createListOfDatesRunner({
  aiProvider = null,
  env = process.env,
} = {}) {
  return {
    id: "create_listofdates",
    slash: CREATE_LISTOFDATES_SLASH,
    version: 1,
    kind: "list_of_dates",
    label: "Build Case Timeline",
    supportsStageRetry: false,
    async run({ request = {}, job, stages }) {
      const stageRecorder = stages && job?.id ? bindStageRecorder({ jobId: job.id, stages }) : null;
      const options = listOfDatesRunOptions({ request, aiProvider, env, stageRecorder });
      if (typeof request.runtimeDbCreateListOfDates === "function") {
        return runtimeDbListOfDatesResult(
          await request.runtimeDbCreateListOfDates(options),
          request.runtimeDbMatter || { name: request.matterName },
        );
      }
      return withListOfDatesOutputAvailability(
        await runCreateListOfDates(options),
        { artifactsPersisted: !options.dryRun },
      );
    },
  };
}

function listOfDatesRunOptions({ request = {}, aiProvider, env, stageRecorder }) {
  const options = {
    matterRoot: request.matterRootOverride || request.matterRoot,
    dryRun: Boolean(request.dryRun),
    aiProvider,
    env,
    stageRecorder,
  };
  const modelPolicy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env });
  if (modelPolicy.provider === AI_PROVIDERS.OPENAI_DIRECT) {
    options.apiKey = env.OPENAI_API_KEY;
    options.maxOutputTokens = env.OPENAI_MAX_OUTPUT_TOKENS;
  }
  return options;
}

function runtimeDbListOfDatesResult(result = {}, matter = {}) {
  const operationResult = result && typeof result.operationResult === "object" && result.operationResult !== null
    ? { ...result.operationResult }
    : { result: result?.operationResult };
  operationResult.matterRoot = matter.matterPath || `postgres:${matter.name || ""}`;
  operationResult.matterName = operationResult.matterName || matter.matterName || matter.name || "";
  operationResult.dbPersistence = {
    persisted: Array.isArray(result.persisted) ? result.persisted : [],
  };
  return withListOfDatesOutputAvailability(operationResult, {
    persisted: operationResult.dbPersistence.persisted,
  });
}

function withListOfDatesOutputAvailability(result = {}, { artifactsPersisted = false, persisted = [] } = {}) {
  const outputPaths = result.outputPaths && typeof result.outputPaths === "object" ? result.outputPaths : {};
  const persistedPaths = new Set((Array.isArray(persisted) ? persisted : [])
    .map((item) => item?.relativePath)
    .filter((value) => typeof value === "string" && value.trim()));
  const markdownPresent = artifactsPersisted || (outputPaths.markdown && persistedPaths.has(outputPaths.markdown));
  const jsonPresent = artifactsPersisted || (outputPaths.json && persistedPaths.has(outputPaths.json));
  return {
    ...result,
    outputAvailability: {
      ...(result.outputAvailability && typeof result.outputAvailability === "object" && !Array.isArray(result.outputAvailability)
        ? result.outputAvailability
        : {}),
      ...(outputPaths.markdown ? { markdown: markdownPresent ? "present" : "not_recorded" } : {}),
      ...(outputPaths.json ? { json: jsonPresent ? "present" : "not_recorded" } : {}),
    },
  };
}

function bindStageRecorder({ jobId, stages }) {
  return {
    startStage: (stage) => stages.startStage(jobId, stage),
    succeedStage: (stage) => stages.succeedStage(jobId, stage),
    failStage: (stage, error) => stages.failStage(jobId, stage, error),
    skipStage: (stage) => stages.skipStage(jobId, stage),
  };
}
