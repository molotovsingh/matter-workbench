import {
  MW_LIST_OF_DATES_SLASH,
  createMwListOfDatesService,
} from "../../../services/mw-list-of-dates-service.mjs";

export function createMwListOfDatesRunner({
  matterStore,
  service: providedService = null,
  aiProviderService = null,
  mwListOfDatesProvider = null,
  now = () => new Date(),
} = {}) {
  const service = providedService || createMwListOfDatesService({
    matterStore,
    aiProviderService,
    mwListOfDatesProvider,
    now,
  });

  return {
    id: "create_mw_listofdates",
    slash: MW_LIST_OF_DATES_SLASH,
    version: 1,
    kind: "mw_list_of_dates",
    label: "Create MW List of Dates",
    supportsStageRetry: false,
    async run({ request = {}, job, stages }) {
      const stageRecorder = stages && job?.id ? bindStageRecorder({ jobId: job.id, stages }) : null;
      return service.runMwListOfDates({
        matterName: request.matterName,
        overwrite: Boolean(request.overwrite),
        proceedUnconfirmed: Boolean(request.proceedUnconfirmed),
        proceedUnconfirmedReason: request.proceedUnconfirmedReason,
        matterRootOverride: request.matterRootOverride,
        matterJsonOverride: request.matterJsonOverride,
        artifactReader: request.artifactReader,
        artifactStatReader: request.artifactStatReader,
        artifactWriter: request.artifactWriter,
        runId: job?.id || request.runId,
        stageRecorder,
      });
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
