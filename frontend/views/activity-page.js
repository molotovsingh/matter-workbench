import { formatConfigurableRunOutputDocumentState } from "../configurable-skill-run-labels.js";

export function activityPageSummary(configurableSkillRuns = null) {
  const runs = Array.isArray(configurableSkillRuns?.runs) ? configurableSkillRuns.runs : [];
  return {
    runs,
    total: runs.length,
    succeeded: runs.filter((run) => run.status === "succeeded").length,
    cancelled: runs.filter((run) => run.status === "cancelled").length,
    failed: runs.filter((run) => run.status === "failed").length,
    running: runs.filter((run) => run.status === "running").length,
  };
}

export function renderActivityPageHtml({
  configurableSkillRuns = null,
  configurableSkillRunsError = "",
  activeMatter = {},
} = {}, escapeHtml) {
  const summary = activityPageSummary(configurableSkillRuns);
  return `
    <div class="activity-page">
      <h1>Activity</h1>
      <p>
        Recent work done by Matter Workbench. This page is a run history for custom skills, so you can see what ran, where it wrote output, and copy a short report if needed.
      </p>
      <p class="muted">
        ${activeMatter?.folderName
          ? `Current matter: <code>${escapeHtml(activeMatter.folderName)}</code>.`
          : "No matter is selected. Showing app-level custom skill activity."}
      </p>
      ${configurableSkillRunsError ? `<p class="form-warning">Activity unavailable: ${escapeHtml(configurableSkillRunsError)}</p>` : ""}
      ${renderActivityStats(summary, escapeHtml)}
      <section>
        <h2>Custom Skill Runs</h2>
        <p class="muted">Run receipts only. Generated work product stays in the matter folder; this history stores metadata.</p>
        ${summary.runs.length ? `
          <div class="activity-list">
            ${summary.runs.map((run) => renderRunReceipt(run, activeMatter, escapeHtml)).join("")}
          </div>
        ` : '<p class="muted">No custom skill runs recorded yet.</p>'}
      </section>
    </div>
  `;
}

function renderActivityStats(summary, escape) {
  return `
    <dl class="skill-contract activity-summary">
      <div><dt>Total</dt><dd>${escape(String(summary.total))}</dd></div>
      <div><dt>Completed</dt><dd>${escape(String(summary.succeeded))}</dd></div>
      <div><dt>Cancelled</dt><dd>${escape(String(summary.cancelled))}</dd></div>
      <div><dt>Failed</dt><dd>${escape(String(summary.failed))}</dd></div>
      <div><dt>Running</dt><dd>${escape(String(summary.running))}</dd></div>
    </dl>
  `;
}

function renderRunReceipt(run = {}, activeMatter = {}, escape) {
  const outputPaths = run.outputPaths || {};
  const aiRun = run.aiRun || {};
  const providerModel = [aiRun.provider, aiRun.model].filter(Boolean).join(" / ") || "Not recorded";
  const markdownPath = outputPaths.markdown || "";
  const jsonPath = outputPaths.json || "";
  const time = run.finishedAt || run.startedAt || "";
  const canOpenOutput = Boolean(
    markdownPath
    && run.status === "succeeded"
    && activeMatter?.folderName
    && activeMatter.folderName === run.matterFolder,
  );
  return `
    <article class="activity-card">
      <div class="activity-card-header">
        <div>
          <div class="skill-slash"><code>${escape(run.slash || "")}</code></div>
          <h3>${escape(run.title || run.slash || "Custom skill run")}</h3>
        </div>
        <span class="pipeline-state ${escape(runStatusClass(run.status))}">${escape(runStatusLabel(run.status))}</span>
      </div>
      <dl class="skill-card-meta">
        <div><dt>Matter</dt><dd>${escape(run.matterName || run.matterFolder || "Unknown matter")}</dd></div>
        <div><dt>Output</dt><dd>${markdownPath ? `<code>${escape(humanOutputPath(markdownPath))}</code>` : "No output path"}</dd></div>
        <div><dt>Result</dt><dd>${escape(runResultText(run))}</dd></div>
        <div><dt>Time</dt><dd>${escape(time || "Not recorded")}</dd></div>
      </dl>
      <div class="form-actions">
        ${canOpenOutput ? `<button type="button" class="secondary" data-activity-open-output="${escape(markdownPath)}">Open output</button>` : ""}
        <button type="button" class="secondary" data-configurable-run-copy="${escape(run.id || "")}">Copy report</button>
      </div>
      <details class="activity-run-details">
        <summary>Details</summary>
        <dl class="skill-card-meta">
          <div><dt>Run ID</dt><dd><code>${escape(run.id || "")}</code></dd></div>
          <div><dt>Matter folder</dt><dd>${escape(run.matterFolder || "Unknown")}</dd></div>
          <div><dt>AI details</dt><dd>${escape(providerModel)}</dd></div>
          <div><dt>Output document</dt><dd>${escape(formatConfigurableRunOutputDocumentState(run.overwrite))}</dd></div>
          <div><dt>Started</dt><dd>${escape(run.startedAt || "Not recorded")}</dd></div>
          <div><dt>Finished</dt><dd>${escape(run.finishedAt || "Not recorded")}</dd></div>
          <div><dt>Metadata</dt><dd>${jsonPath ? `<code>${escape(jsonPath)}</code>` : "No metadata path"}</dd></div>
          ${run.errorMessage ? `<div><dt>Error</dt><dd>${escape(run.errorMessage)}</dd></div>` : ""}
        </dl>
      </details>
    </article>
  `;
}

function runResultText(run = {}) {
  if (run.status === "cancelled") return "Cancelled - kept existing output document";
  if (run.status === "failed") return "Failed";
  if (run.status === "running") return "Running";
  if (run.overwrite === "approved") return "Replaced existing output document";
  return "Created output document";
}

function humanOutputPath(value = "") {
  return String(value || "")
    .replace(/^10_Library\//, "Source Record / ")
    .replace(/^20_Workshop\//, "Case Analysis / ")
    .replace(/^30_Drafts\//, "Drafts / ")
    .replace(/^40_Dispatch\//, "Ready to Send / ");
}

function runStatusLabel(status) {
  if (status === "succeeded") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "running") return "Running";
  return "Unknown";
}

function runStatusClass(status) {
  if (status === "succeeded") return "present";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "not-run";
  return "pending";
}
