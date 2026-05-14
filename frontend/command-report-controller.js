import {
  buildCommandInteractionLogBody,
  deriveReportPatchFromStatus,
  formatCommandReport,
} from "./command-reporting.js";

export function createCommandReportController({
  ctx,
  now = () => new Date(),
  loadMatterStatus,
  logCommandInteraction,
  writeClipboardText,
  copyReportButton,
  reportStatusElement,
  statusBarRight,
  terminalOutput,
} = {}) {
  let latestReport = null;

  function startReport({
    typedInput,
    matchedCommand,
    status,
    plannerSource = "",
    plannerModel = "",
    plannerFallbackReason = "",
  }) {
    const activeMatter = ctx?.getActiveMatter?.() || {};
    latestReport = {
      timestamp: now().toISOString(),
      matterName: activeMatter.metadata?.matterName || activeMatter.folderName || "No active matter",
      matterFolder: activeMatter.folderName || "",
      typedInput,
      matchedCommand,
      status,
      routerDecision: "",
      routerMatchedSkill: "",
      sampleId: "",
      runId: "",
      runRecord: null,
      overwrite: "",
      providerModel: "",
      artifacts: [],
      statusBar: getStatusBarText(),
      terminalLines: getLatestTerminalLines(),
      error: "",
      plannerSource,
      plannerModel,
      plannerFallbackReason,
    };
    setReportStatus("Report tracking current command.");
    setCopyReportEnabled(true);
  }

  function updateReport(patch) {
    if (!latestReport) return;
    latestReport = { ...latestReport, ...patch };
    setCopyReportEnabled(true);
  }

  function recordCommandInteraction(patch = {}) {
    if (!latestReport) return;
    const body = buildCommandInteractionLogBody(latestReport, patch, {
      statusBar: getStatusBarText(),
      terminalLines: getLatestTerminalLines(),
    });
    try {
      Promise.resolve(logCommandInteraction?.(body)).catch(() => {});
    } catch {
      // Local beta diagnostics must never block Command rail behavior.
    }
  }

  function captureStatusDuringCommand() {
    const originalSetStatus = ctx.setStatus;
    ctx.setStatus = (status = {}) => {
      originalSetStatus(status);
      captureStatusForReport(status);
    };
    return () => {
      ctx.setStatus = originalSetStatus;
    };
  }

  function captureStatusForReport(status = {}) {
    if (!latestReport) return;
    const patch = deriveReportPatchFromStatus(status, {
      statusBar: getStatusBarText(),
      terminalLines: getLatestTerminalLines(),
    });
    updateReport(patch);
  }

  async function copyLatestReport() {
    if (!latestReport) {
      setReportStatus("Run or check a command first.", true);
      return;
    }
    setReportStatus("Copying report...");
    if (copyReportButton) copyReportButton.disabled = true;
    try {
      const report = await enrichReport(latestReport);
      await writeClipboardText(formatCommandReport(report));
      latestReport = report;
      setReportStatus("Report copied.");
    } catch (error) {
      setReportStatus(`Copy failed: ${error.message}`, true);
    } finally {
      setCopyReportEnabled(Boolean(latestReport));
    }
  }

  async function enrichReport(report) {
    if (!report?.matchedCommand || report.matchedCommand === "router/check" || report.matchedCommand === "status") {
      return {
        ...report,
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      };
    }
    try {
      const status = await loadMatterStatus?.();
      const stage = Array.isArray(status?.stages)
        ? status.stages.find((candidate) => candidate.slash === report.matchedCommand)
        : null;
      if (!stage) return report;
      const aiRun = stage.aiRun || {};
      const provider = aiRun.returnedProvider || aiRun.provider || stage.rerunAdvice?.provider || "";
      const model = aiRun.model || stage.rerunAdvice?.model || "";
      return {
        ...report,
        providerModel: [provider, model].filter(Boolean).join(" / "),
        artifacts: Array.isArray(stage.artifacts) ? stage.artifacts : [],
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      };
    } catch {
      return {
        ...report,
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      };
    }
  }

  function setCopyReportEnabled(enabled) {
    if (copyReportButton) {
      copyReportButton.disabled = !enabled;
      copyReportButton.hidden = !enabled;
    }
  }

  function setReportStatus(message, isError = false) {
    if (!reportStatusElement) return;
    reportStatusElement.textContent = message;
    reportStatusElement.classList?.toggle?.("form-error", Boolean(isError));
  }

  function getStatusBarText() {
    return statusBarRight?.textContent?.trim?.() || "";
  }

  function getLatestTerminalLines() {
    const existing = terminalOutput?.textContent
      ? terminalOutput.textContent.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
    return existing.slice(-8);
  }

  function clear() {
    latestReport = null;
    setReportStatus("");
    setCopyReportEnabled(false);
  }

  function getReport() {
    return latestReport;
  }

  return {
    captureStatusDuringCommand,
    captureStatusForReport,
    clear,
    copyLatestReport,
    getLatestTerminalLines,
    getReport,
    getStatusBarText,
    recordCommandInteraction,
    setCopyReportEnabled,
    setReportStatus,
    startReport,
    updateReport,
  };
}
