import {
  DISPUTE_STORY_SKILL_SLASH,
  createMatterStoryService,
} from "../../../services/matter-story-service.mjs";

export function createMatterStoryRunner({
  matterStore,
  configurableSkillsService,
  service: providedService = null,
  nativeRunProvider = null,
  env = process.env,
  fetchImpl = fetch,
  endpoint,
  now = () => new Date(),
} = {}) {
  const service = providedService || createMatterStoryService({
    matterStore,
    configurableSkillsService,
    nativeRunProvider,
    env,
    fetchImpl,
    endpoint,
    now,
  });

  return {
    id: "builtin_the_story",
    slash: DISPUTE_STORY_SKILL_SLASH,
    version: 1,
    kind: "custom_skill",
    label: "The Story",
    async run({ request = {}, job, stages }) {
      const stageRecorder = stages && job?.id ? bindStageRecorder({ jobId: job.id, stages }) : null;
      return service.runDisputeStory({
        matterName: request.matterName,
        overwrite: Boolean(request.overwrite),
        matterRootOverride: request.matterRootOverride,
        matterRecordOverride: request.matterRecordOverride,
        matterContextPacketOverride: request.matterContextPacketOverride,
        artifactExistsOverride: request.artifactExistsOverride,
        artifactWriter: request.artifactWriter,
        matterJsonOverride: request.matterJsonOverride,
        matterJsonWriter: request.matterJsonWriter,
        storyMarkdownReader: request.storyMarkdownReader,
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
