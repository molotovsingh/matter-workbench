export const CONFIGURABLE_SKILL_RUN_RECEIPT_STATES = Object.freeze({
  RUNNING: "running",
  FAILED: "failed",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  OUTPUT_MISSING: "output_missing",
  UNKNOWN: "unknown",
});

export const CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY = Object.freeze({
  PRESENT: "present",
  MISSING: "missing",
  NOT_RECORDED: "not_recorded",
  UNKNOWN: "unknown",
});

export function deriveConfigurableSkillRunReceipt(run = {}) {
  const rawOutputFileStatus = normalizeOutputAvailability(run.outputAvailability?.markdown);
  const hasMarkdownOutputPath = Boolean(String(run.outputPaths?.markdown || "").trim());
  const outputFileStatus = hasMarkdownOutputPath
    ? rawOutputFileStatus
    : CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.NOT_RECORDED;
  const outputFileStatusLabel = formatConfigurableSkillRunOutputAvailability(outputFileStatus);

  if (run.status === "failed") {
    return receipt({
      receiptState: CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.FAILED,
      statusLabel: "Failed",
      statusClass: "failed",
      resultText: "Failed",
      needsAttention: true,
      outputFileStatus,
      outputFileStatusLabel,
    });
  }

  if (run.status === "running") {
    return receipt({
      receiptState: CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.RUNNING,
      statusLabel: "Running",
      statusClass: "pending",
      resultText: "Running",
      needsAttention: true,
      outputFileStatus,
      outputFileStatusLabel,
    });
  }

  if (run.status === "cancelled") {
    return receipt({
      receiptState: CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.CANCELLED,
      statusLabel: "Cancelled",
      statusClass: "not-run",
      resultText: "Cancelled - kept existing output document",
      outputFileStatus,
      outputFileStatusLabel,
    });
  }

  if (
    run.status === "succeeded"
    && (
      !hasMarkdownOutputPath
      || outputFileStatus === CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.MISSING
    )
  ) {
    const outputNotRecorded = outputFileStatus === CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.NOT_RECORDED;
    return receipt({
      receiptState: CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.OUTPUT_MISSING,
      statusLabel: outputNotRecorded ? "Output not recorded" : "Output missing",
      statusClass: "warning",
      resultText: outputNotRecorded
        ? "Output path was not recorded for this run"
        : "Output file missing from matter folder",
      needsAttention: true,
      outputFileStatus,
      outputFileStatusLabel,
    });
  }

  if (run.status === "succeeded") {
    return receipt({
      receiptState: CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.COMPLETED,
      statusLabel: "Completed",
      statusClass: "present",
      resultText: run.overwrite === "approved" ? "Replaced existing output document" : "Created output document",
      isCompletedWork: true,
      canOpenOutput: hasMarkdownOutputPath && outputFileStatus !== CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.MISSING,
      outputFileStatus,
      outputFileStatusLabel,
    });
  }

  return receipt({
    receiptState: CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.UNKNOWN,
    statusLabel: "Unknown",
    statusClass: "pending",
    resultText: "Unknown",
    outputFileStatus,
    outputFileStatusLabel,
  });
}

export function formatConfigurableSkillRunOutputAvailability(value = "") {
  const normalized = normalizeOutputAvailability(value);
  if (normalized === CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.PRESENT) return "Present in matter folder";
  if (normalized === CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.MISSING) return "Missing from matter folder";
  if (normalized === CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.NOT_RECORDED) return "No output path recorded";
  return "Not checked";
}

function receipt({
  receiptState,
  statusLabel,
  statusClass,
  resultText,
  needsAttention = false,
  isCompletedWork = false,
  canOpenOutput = false,
  outputFileStatus = CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.UNKNOWN,
  outputFileStatusLabel = "Not checked",
} = {}) {
  return {
    receiptState,
    statusLabel,
    statusClass,
    resultText,
    needsAttention,
    isCompletedWork,
    canOpenOutput,
    outputFileStatus,
    outputFileStatusLabel,
  };
}

function normalizeOutputAvailability(value = "") {
  const text = String(value || "").trim();
  if (Object.values(CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY).includes(text)) return text;
  return CONFIGURABLE_SKILL_RUN_OUTPUT_AVAILABILITY.UNKNOWN;
}
