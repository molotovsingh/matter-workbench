import { classifyFailure } from "./job-status-service.mjs";

export async function runRecordedStage(stageRecorder, stage, operation, { successPatch = null } = {}) {
  if (typeof operation !== "function") throw new Error("stage operation is required");
  if (!stageRecorder) return operation();
  await stageRecorder.startStage(stage);
  try {
    const result = await operation();
    const patch = typeof successPatch === "function" ? successPatch(result) : {};
    await stageRecorder.succeedStage({ ...stage, ...patch });
    return result;
  } catch (error) {
    await stageRecorder.failStage(stage, error);
    throw error;
  }
}

export function createSkillStageService({
  jobStatusService,
  now = () => new Date(),
} = {}) {
  if (!jobStatusService?.updateJobStage) {
    throw new Error("jobStatusService.updateJobStage is required");
  }

  async function startStage(jobId, stage = {}) {
    return jobStatusService.updateJobStage(jobId, {
      ...baseStagePatch(stage),
      status: "running",
      startedAt: isoNow(now),
    });
  }

  async function succeedStage(jobId, stage = {}) {
    return jobStatusService.updateJobStage(jobId, {
      ...baseStagePatch(stage),
      status: "succeeded",
      finishedAt: isoNow(now),
      salvageable: stage.salvageable !== undefined ? Boolean(stage.salvageable) : true,
      ...(stage.summary ? { summary: stage.summary } : {}),
      ...(stage.aiRun ? { aiRun: stage.aiRun } : {}),
    });
  }

  async function failStage(jobId, stage = {}, error = null) {
    const errorCode = safeStageErrorCode(stage.failureCode || error?.code);
    const message = errorToMessage(error || stage.errorMessage || "Stage failed");
    return jobStatusService.updateJobStage(jobId, {
      ...baseStagePatch(stage),
      status: "failed",
      finishedAt: isoNow(now),
      ...(errorCode ? { failureCode: errorCode } : {}),
      failureClass: stage.failureClass || classifyFailure(message, { errorCode }),
      errorMessage: message,
      salvageable: stage.salvageable !== undefined ? Boolean(stage.salvageable) : false,
    });
  }

  async function skipStage(jobId, stage = {}) {
    return jobStatusService.updateJobStage(jobId, {
      ...baseStagePatch(stage),
      status: "skipped",
      finishedAt: isoNow(now),
      ...(stage.summary ? { summary: stage.summary } : {}),
      ...(stage.salvageable !== undefined ? { salvageable: Boolean(stage.salvageable) } : {}),
    });
  }

  return {
    startStage,
    succeedStage,
    failStage,
    skipStage,
  };
}

function baseStagePatch(stage = {}) {
  return {
    id: stage.id,
    ...(stage.label ? { label: stage.label } : {}),
    ...(stage.provider ? { provider: stage.provider } : {}),
    ...(stage.model ? { model: stage.model } : {}),
    ...(stage.metadata ? { metadata: stage.metadata } : {}),
  };
}

function errorToMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "Unknown stage failure");
}

function safeStageErrorCode(value) {
  const code = String(value || "").trim();
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(code) ? code : "";
}

function isoNow(now) {
  const value = now();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
