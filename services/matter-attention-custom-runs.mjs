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
    if (run.status === "failed") {
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
