import { runSourceDescriptors } from "../../../source-descriptors-engine.mjs";

export const DESCRIBE_SOURCES_SLASH = "/describe_sources";

export function createDescribeSourcesRunner({
  env = process.env,
  sourceDescriptorProvider = null,
} = {}) {
  return {
    id: "describe_sources",
    slash: DESCRIBE_SOURCES_SLASH,
    version: 1,
    kind: "source_labels",
    label: "Label Sources",
    supportsStageRetry: false,
    async run({ request = {}, job, stages, jobStatusService }) {
      const onProgress = sourceLabelProgressReporter({ job, stages, jobStatusService });
      const options = {
        dryRun: Boolean(request.dryRun),
        env,
        sourceDescriptorProvider,
        onProgress,
      };
      if (typeof request.runtimeDbDescribeSources === "function") {
        return runtimeDbDescribeSourcesResult(
          await request.runtimeDbDescribeSources(options),
          request.runtimeDbMatter || { name: request.matterName },
        );
      }
      return withSourceIndexOutputAvailability(
        await runSourceDescriptors({ ...options, matterRoot: request.matterRootOverride || request.matterRoot }),
        { artifactsPersisted: !options.dryRun },
      );
    },
  };
}

function sourceLabelProgressReporter({ job, stages, jobStatusService } = {}) {
  if (!job?.id || !stages?.startStage || !jobStatusService?.updateJobStage) return null;
  let labelStageStarted = false;
  let labelStageFinished = false;
  let completedBatchCount = 0;
  let successfulBatchCount = 0;
  return async (event = {}) => {
    if (labelStageFinished) return;
    if (event.stage === "source-labels-batch-complete") {
      completedBatchCount += 1;
      const descriptors = Number.isInteger(event.descriptors) ? event.descriptors : 0;
      const batchStatus = typeof event.batchStatus === "string" ? event.batchStatus.trim() : "";
      if (batchStatus ? batchStatus !== "failed" : (descriptors > 0 || event.needsReview !== true)) {
        successfulBatchCount += 1;
      }
    }
    const summary = sourceLabelProgressSummary(event);
    const stage = {
      id: "label_pass",
      label: "Describe source labels",
      metadata: { sourceLabelProgress: event },
    };
    if (!labelStageStarted) {
      await stages.startStage(job.id, stage);
      labelStageStarted = true;
    }
    if (event.stage === "source-labels-batch-complete" && event.batchIndex === event.batchCount && completedBatchCount > 0 && successfulBatchCount > 0) {
      await stages.succeedStage(job.id, { ...stage, summary, salvageable: true });
      labelStageFinished = true;
      return;
    }
    await jobStatusService.updateJobStage(job.id, {
      ...stage,
      status: "running",
      summary,
    });
    if (jobStatusService.updateJob) await jobStatusService.updateJob(job.id, { summary, metadata: { sourceLabelProgress: event } });
  };
}

function sourceLabelProgressSummary(event = {}) {
  const batch = `${event.batchIndex || "?"}/${event.batchCount || "?"}`;
  const sourceCount = Number.isInteger(event.sourceCount) ? event.sourceCount : 0;
  if (event.stage === "source-labels-batch-complete") {
    return `Source Labels batch ${batch} complete (${sourceCount} source${sourceCount === 1 ? "" : "s"})`;
  }
  return `Source Labels batch ${batch} running (${sourceCount} source${sourceCount === 1 ? "" : "s"})`;
}

function runtimeDbDescribeSourcesResult(result = {}, matter = {}) {
  const operationResult = result && typeof result.operationResult === "object" && result.operationResult !== null
    ? { ...result.operationResult }
    : { result: result?.operationResult };
  operationResult.matterRoot = matter.matterPath || `postgres:${matter.name || ""}`;
  operationResult.matterName = operationResult.matterName || matter.matterName || matter.name || "";
  operationResult.dbPersistence = {
    persisted: Array.isArray(result.persisted) ? result.persisted : [],
  };
  return withSourceIndexOutputAvailability(operationResult, {
    persisted: operationResult.dbPersistence.persisted,
  });
}

function withSourceIndexOutputAvailability(result = {}, { artifactsPersisted = false, persisted = [] } = {}) {
  const outputPaths = result.outputPaths && typeof result.outputPaths === "object" ? result.outputPaths : {};
  const persistedPaths = new Set((Array.isArray(persisted) ? persisted : [])
    .map((item) => item?.relativePath)
    .filter((value) => typeof value === "string" && value.trim()));
  const jsonPresent = artifactsPersisted || (outputPaths.json && persistedPaths.has(outputPaths.json));
  return {
    ...result,
    outputAvailability: {
      ...(result.outputAvailability && typeof result.outputAvailability === "object" && !Array.isArray(result.outputAvailability)
        ? result.outputAvailability
        : {}),
      ...(outputPaths.json ? { json: jsonPresent ? "present" : "not_recorded" } : {}),
    },
  };
}
