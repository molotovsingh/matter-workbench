import {
  PROCEDURAL_POSTURE_DIAGNOSIS_SLASH,
  createProceduralPostureDiagnosisService,
} from "../../../services/procedural-posture-diagnosis-service.mjs";

export function createProceduralPostureDiagnosisRunner({
  matterStore,
  aiProviderService = null,
  diagnosisProvider = null,
  env = process.env,
  now = () => new Date(),
} = {}) {
  const service = createProceduralPostureDiagnosisService({
    matterStore,
    aiProviderService,
    diagnosisProvider,
    env,
    now,
  });

  return {
    id: "procedural_posture_diagnosis",
    slash: PROCEDURAL_POSTURE_DIAGNOSIS_SLASH,
    version: 1,
    kind: "posture_diagnosis",
    label: "Diagnose Procedural Posture",
    async run({ request = {}, job, stages }) {
      const stageRecorder = stages && job?.id ? bindStageRecorder({ jobId: job.id, stages }) : null;
      return service.runDiagnosis({
        matterName: request.matterName,
        overwrite: Boolean(request.overwrite),
        matterRootOverride: request.matterRootOverride,
        matterRecordOverride: request.matterRecordOverride,
        matterContextPacketOverride: request.matterContextPacketOverride,
        matterJsonOverride: request.matterJsonOverride,
        artifactExistsOverride: request.artifactExistsOverride,
        artifactReader: request.artifactReader,
        artifactStatReader: request.artifactStatReader,
        artifactWriter: request.artifactWriter,
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
  };
}
