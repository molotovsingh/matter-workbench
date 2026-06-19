export function presentAiSettingsForScopedUser(settings = {}) {
  return {
    provider: null,
    apiKeyConfigured: Boolean(settings.apiKeyConfigured),
    aiTasks: Array.isArray(settings.aiTasks)
      ? settings.aiTasks.map((task) => ({
        task: task.task,
        label: userFacingAiTaskLabel(task),
        surface: userFacingAiTaskSurface(task),
        ready: Boolean(task.ready),
        note: task.ready ? "Ready" : "Temporarily unavailable",
      }))
      : [],
    startupChecks: settings.startupChecks?.copilot
      ? { copilot: { ok: Boolean(settings.startupChecks.copilot.ok), checkedAt: settings.startupChecks.copilot.checkedAt || "" } }
      : {},
  };
}

export function presentMatterCopilotAnswerForScopedUser(answer = {}) {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return answer;
  const { ai_run: _aiRun, ...rest } = answer;
  return rest;
}

function userFacingAiTaskLabel(task = {}) {
  if (task.task === "copilot_answer") return "Assistant readiness";
  if (task.task === "source_description") return "Document labels";
  if (task.task === "source_backed_analysis") return "Document analysis";
  if (task.task === "skill_router") return "Command routing";
  return task.label || "Workbench service";
}

function userFacingAiTaskSurface(task = {}) {
  if (task.task === "copilot_answer") return "Matter assistant";
  if (task.task === "source_description") return "Document services";
  if (task.task === "source_backed_analysis") return "Document services";
  if (task.task === "skill_router") return "Command box";
  return task.surface || "Workbench service";
}
