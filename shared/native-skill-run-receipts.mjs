import {
  CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY,
  formatConfigurableSkillRunOutputAvailability,
} from "./configurable-skill-run-receipts.mjs";

export const NATIVE_SKILL_RUN_RECEIPT_SCHEMA_VERSION = "native-skill-run-receipt/v1";

export const NATIVE_SKILL_RUN_RECEIPT_STATES = Object.freeze({
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  INSUFFICIENT_RECORD: "insufficient_record",
  OUTPUT_MISSING: "output_missing",
  UNKNOWN: "unknown",
});

export function deriveNativeSkillRunReceipt(input = {}) {
  const job = input.job && typeof input.job === "object" ? input.job : input;
  const outputPaths = normalizeOutputPaths(input.outputPaths || job.outputPaths || {});
  const outputAvailability = normalizeOutputAvailabilityMap(input.outputAvailability || job.outputAvailability || {});
  const stages = normalizeReceiptStages(job.stages || input.stages || []);
  const failedStage = stages.find((stage) => stage.status === "failed") || null;
  const receiptState = deriveReceiptState({ job, input, outputPaths, outputAvailability });
  const failure = deriveFailure({ job, failedStage, stages });

  return {
    schema_version: NATIVE_SKILL_RUN_RECEIPT_SCHEMA_VERSION,
    runId: normalizeText(input.runId || job.id),
    jobId: normalizeText(job.id),
    kind: normalizeText(input.kind || job.kind),
    slash: normalizeText(input.slash || job.slash),
    skillId: normalizeText(input.skillId || job.skillId),
    skillVersion: normalizePositiveInteger(input.skillVersion || job.skillVersion, 1),
    matterName: normalizeText(input.matterName || job.matterName),
    matterId: normalizeText(input.matterId || job.matterId),
    status: normalizeText(job.status),
    state: receiptState,
    startedAt: normalizeText(job.startedAt),
    finishedAt: normalizeText(job.finishedAt),
    stages,
    outputPaths,
    outputAvailability,
    outputFileStatus: outputAvailability.markdown,
    outputFileStatusLabel: formatConfigurableSkillRunOutputAvailability(outputAvailability.markdown),
    warnings: normalizeWarnings(input.warnings || job.warnings || []),
    ...(failure ? { failure } : {}),
    recovery: deriveRecovery({ receiptState, failure, failedStage }),
  };
}

function deriveReceiptState({ job, input, outputPaths, outputAvailability }) {
  const explicitState = normalizeText(input.state || job.resultState);
  if (explicitState === NATIVE_SKILL_RUN_RECEIPT_STATES.INSUFFICIENT_RECORD) {
    return NATIVE_SKILL_RUN_RECEIPT_STATES.INSUFFICIENT_RECORD;
  }
  if (job.status === "running") return NATIVE_SKILL_RUN_RECEIPT_STATES.RUNNING;
  if (job.status === "failed") return NATIVE_SKILL_RUN_RECEIPT_STATES.FAILED;
  if (job.status === "cancelled") return NATIVE_SKILL_RUN_RECEIPT_STATES.CANCELLED;
  if (job.status === "succeeded") {
    if (outputPaths.markdown && outputAvailability.markdown === CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.MISSING) {
      return NATIVE_SKILL_RUN_RECEIPT_STATES.OUTPUT_MISSING;
    }
    return NATIVE_SKILL_RUN_RECEIPT_STATES.SUCCEEDED;
  }
  return NATIVE_SKILL_RUN_RECEIPT_STATES.UNKNOWN;
}

function deriveFailure({ job, failedStage, stages = [] }) {
  const code = normalizeText(failedStage?.failureCode || job.errorCode);
  const failureClass = normalizeText(failedStage?.failureClass || job.failureClass || "unknown") || "unknown";
  const message = normalizeText(failedStage?.errorMessage || job.errorMessage, 800);
  if (!code && !message && !failedStage) return null;
  return {
    code,
    class: failureClass,
    stageId: normalizeText(failedStage?.id),
    message,
    retryable: isRetryableFailure({ code, failureClass }),
    salvageableStageIds: salvageableStageIdsBeforeFailure(stages, failedStage),
  };
}

function salvageableStageIdsBeforeFailure(stages = [], failedStage = null) {
  const ids = [];
  for (const stage of Array.isArray(stages) ? stages : []) {
    if (failedStage?.id && stage.id === failedStage.id) break;
    if (stage.salvageable && stage.status === "succeeded" && stage.id) ids.push(stage.id);
  }
  return ids;
}

function deriveRecovery({ receiptState, failure, failedStage }) {
  if (receiptState === NATIVE_SKILL_RUN_RECEIPT_STATES.RUNNING) {
    return { action: "observe", reason: "run_in_progress" };
  }
  if (receiptState === NATIVE_SKILL_RUN_RECEIPT_STATES.INSUFFICIENT_RECORD) {
    return { action: "review_questions", reason: "insufficient_record" };
  }
  if (!failure) return { action: "none", reason: "terminal_without_failure" };
  if (failure.retryable && failedStage?.id) {
    return { action: "retry_stage", retryStageId: failedStage.id, reason: failure.code || failure.class };
  }
  if (failure.retryable) return { action: "retry_run", reason: failure.code || failure.class };
  return { action: "operator_review", reason: failure.code || failure.class || "unknown_failure" };
}

function isRetryableFailure({ code = "", failureClass = "" } = {}) {
  if (/^provider\.(timeout|invalid_json|truncated_output|empty_output|error)$/.test(code)) return true;
  return failureClass === "provider";
}

function normalizeReceiptStages(stages = []) {
  return (Array.isArray(stages) ? stages : [])
    .map((stage) => ({
      id: normalizeText(stage.id),
      status: normalizeText(stage.status),
      label: normalizeText(stage.label),
      startedAt: normalizeText(stage.startedAt),
      finishedAt: normalizeText(stage.finishedAt),
      durationMs: normalizePositiveInteger(stage.durationMs, 0),
      provider: normalizeText(stage.provider),
      model: normalizeText(stage.model),
      failureCode: normalizeText(stage.failureCode),
      failureClass: normalizeText(stage.failureClass),
      errorMessage: normalizeText(stage.errorMessage, 800),
      summary: normalizeText(stage.summary),
      salvageable: Boolean(stage.salvageable),
    }))
    .filter((stage) => stage.id)
    .slice(0, 50)
    .map((stage) => Object.fromEntries(Object.entries(stage).filter(([, value]) => value !== "" && value !== 0 && value !== false)));
}

function normalizeOutputPaths(outputPaths = {}) {
  return {
    markdown: normalizeText(outputPaths.markdown),
    json: normalizeText(outputPaths.json),
  };
}

function normalizeOutputAvailabilityMap(outputAvailability = {}) {
  return {
    markdown: normalizeOutputAvailability(outputAvailability.markdown),
    json: normalizeOutputAvailability(outputAvailability.json),
  };
}

function normalizeOutputAvailability(value = "") {
  const text = normalizeText(value);
  if (Object.values(CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY).includes(text)) return text;
  return CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.NOT_RECORDED;
}

function normalizeWarnings(warnings = []) {
  return (Array.isArray(warnings) ? warnings : warnings ? [warnings] : [])
    .map((warning) => normalizeText(warning, 800))
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeText(value, maxLength = 1200) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}
