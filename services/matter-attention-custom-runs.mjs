import {
  CONFIGURABLE_SKILL_RUN_RECEIPT_STATES,
} from "../shared/configurable-skill-run-receipts.mjs";

const DEFAULT_CUSTOM_RUN_LIMIT = 100;

export async function buildCustomSkillRunAttentionItems({
  configurableSkillRunsService,
  matterName,
  customRunLimit = DEFAULT_CUSTOM_RUN_LIMIT,
} = {}) {
  if (typeof configurableSkillRunsService?.listRuns !== "function") return [];
  let runs = [];
  try {
    const result = await configurableSkillRunsService.listRuns({
      matterFolder: matterName,
      limit: customRunLimit,
    });
    runs = Array.isArray(result?.runs) ? result.runs : [];
  } catch (error) {
    return [{
      severity: "warning",
      category: "custom_skill",
      code: "custom_skill_runs_unreadable",
      title: "Custom skill run ledger could not be read",
      detail: error?.message || "Unable to read configurable skill runs.",
      action: "Inspect configurable-skill-runs.json.",
    }];
  }

  const items = [];
  const warningKeys = new Set();
  for (const run of runs) {
    const receipt = receiptForRun(run);
    if (receipt.receiptState === CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.FAILED) {
      items.push({
        severity: "blocker",
        category: "custom_skill",
        code: "custom_skill_failed",
        title: `Custom skill failed: ${run.title || run.slash || "unknown skill"}`,
        detail: run.errorMessage || "The run receipt is marked failed.",
        action: "Inspect the custom skill receipt and rerun after fixing the cause.",
        evidence: outputEvidence(run),
        occurredAt: run.finishedAt || run.startedAt || "",
      });
    } else if (receipt.receiptState === CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.OUTPUT_MISSING) {
      const outputNotRecorded = receipt.outputFileStatus === "not_recorded";
      items.push({
        severity: "warning",
        category: "custom_skill",
        code: "custom_skill_output_missing",
        title: `Custom skill output missing: ${run.title || run.slash || "unknown skill"}`,
        detail: outputNotRecorded
          ? "The run receipt says this skill completed, but the output document was not recorded."
          : "The run receipt says this skill completed, but the output document is no longer present in the matter folder.",
        action: outputNotRecorded
          ? "Rerun the skill so the output document is written and tracked."
          : "Rerun the skill if this output is still needed, or ignore it if the matter was intentionally reset.",
        evidence: outputEvidence(run),
        occurredAt: run.finishedAt || run.startedAt || "",
      });
    } else if (
      receipt.receiptState === CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.UNKNOWN
      && receipt.needsAttention
    ) {
      items.push({
        severity: "warning",
        category: "custom_skill",
        code: "custom_skill_receipt_unavailable",
        title: `Custom skill receipt unavailable: ${run.title || run.slash || "unknown skill"}`,
        detail: "The custom skill run is missing its canonical receipt.",
        action: "Refresh Activity or inspect configurable-skill-runs.json.",
        evidence: outputEvidence(run),
        occurredAt: run.finishedAt || run.startedAt || "",
      });
    } else if (Array.isArray(run.warnings) && run.warnings.length) {
      const warningKey = [
        run.title || run.slash || "unknown skill",
        run.outputPaths?.markdown || "",
        run.warnings.join("\n"),
      ].join("\n");
      if (warningKeys.has(warningKey)) continue;
      warningKeys.add(warningKey);
      items.push({
        severity: "warning",
        category: "custom_skill",
        code: "custom_skill_warnings",
        title: `Custom skill warning: ${run.title || run.slash || "unknown skill"}`,
        detail: run.warnings.join("; "),
        action: "Review the run warning before relying on the output.",
        evidence: outputEvidence(run),
        occurredAt: run.finishedAt || run.startedAt || "",
      });
    }
  }
  return items;
}

function outputEvidence(run) {
  if (run.outputPaths?.markdown) return [{ path: run.outputPaths.markdown, runId: run.id }];
  return [{ runId: run.id }];
}

function receiptForRun(run = {}) {
  return run.receipt || {
    receiptState: CONFIGURABLE_SKILL_RUN_RECEIPT_STATES.UNKNOWN,
    statusLabel: "Receipt unavailable",
    statusClass: "warning",
    resultText: "Run receipt is unavailable",
    needsAttention: true,
    isCompletedWork: false,
    canOpenOutput: false,
    outputFileStatus: "unknown",
    outputFileStatusLabel: "Not checked",
  };
}
