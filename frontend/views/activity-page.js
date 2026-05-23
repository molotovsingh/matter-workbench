import { formatConfigurableRunOutputDocumentState } from "../configurable-skill-run-labels.js";

export function activityPageSummary(configurableSkillRuns = null) {
  const runs = Array.isArray(configurableSkillRuns?.runs) ? configurableSkillRuns.runs : [];
  return {
    runs,
    total: runs.length,
    succeeded: runs.filter((run) => receiptForRun(run).isCompletedWork).length,
    missingOutput: runs.filter((run) => receiptForRun(run).receiptState === "output_missing").length,
    cancelled: runs.filter((run) => receiptForRun(run).receiptState === "cancelled").length,
    failed: runs.filter((run) => receiptForRun(run).receiptState === "failed").length,
    running: runs.filter((run) => receiptForRun(run).receiptState === "running").length,
  };
}

export function renderActivityPageHtml({
  configurableSkillRuns = null,
  configurableSkillRunsError = "",
  activeMatter = {},
  activityLogLines = [],
  activityLogText = "",
} = {}, escapeHtml) {
  const summary = activityPageSummary(configurableSkillRuns);
  const receiptGroups = groupRunsByReceiptState(summary.runs);
  const systemLogLines = latestActivityLogLines(activityLogLines.length ? activityLogLines : activityLogText);
  return `
    <div class="activity-page">
      <div class="activity-hero">
        <div>
          <h1>Activity</h1>
          <p>What ran, what it produced, and whether it worked.</p>
        </div>
        ${renderActivityStats(summary, escapeHtml)}
      </div>
      <p class="muted">
        ${activeMatter?.folderName
          ? `Current matter: <code>${escapeHtml(activeMatter.folderName)}</code>.`
          : "No matter is selected. Showing app-level custom skill activity."}
      </p>
      ${configurableSkillRunsError ? `<p class="form-warning">Activity unavailable: ${escapeHtml(configurableSkillRunsError)}</p>` : ""}

      ${receiptGroups.attention.length ? `
        <section class="activity-section">
          <h2>Needs Attention</h2>
          <div class="activity-day-list attention">
            ${receiptGroups.attention.map((run) => renderRunReceipt(run, activeMatter, escapeHtml)).join("")}
          </div>
        </section>
      ` : ""}

      <section class="activity-section">
        <h2>Work Completed</h2>
        <p class="muted">Work product stays in the matter folder. This history stores receipts.</p>
        ${receiptGroups.completed.length ? renderRunDayGroups(receiptGroups.completed, activeMatter, escapeHtml) : '<p class="muted">No completed custom skill runs recorded yet.</p>'}
      </section>

      ${receiptGroups.cancelled.length ? `
        <section class="activity-section">
          <details class="activity-cancelled-runs">
            <summary>
              <span>Cancelled Runs</span>
              <span>${escapeHtml(String(receiptGroups.cancelled.length))}</span>
            </summary>
            <div class="activity-day-list quiet">
              ${receiptGroups.cancelled.map((run) => renderRunReceipt(run, activeMatter, escapeHtml, { compact: true })).join("")}
            </div>
          </details>
        </section>
      ` : ""}

      ${systemLogLines.length ? `
        <section class="activity-section">
          <details class="activity-system-log">
            <summary>
              <span>System Log</span>
              <span>${escapeHtml(`${systemLogLines.length} recent`)}</span>
            </summary>
            <ol>
              ${systemLogLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
            </ol>
          </details>
        </section>
      ` : ""}
    </div>
  `;
}

function latestActivityLogLines(lines = []) {
  const values = Array.isArray(lines) ? lines : String(lines || "").split("\n");
  return values
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20);
}

function renderActivityStats(summary, escape) {
  const parts = [
    { label: `${summary.succeeded} completed`, className: "completed", show: true },
    { label: `${summary.missingOutput} output missing`, className: "warning", show: summary.missingOutput > 0 },
    { label: `${summary.cancelled} cancelled`, className: "", show: summary.cancelled > 0 },
    { label: `${summary.running} running`, className: "running", show: summary.running > 0 },
    { label: `${summary.failed} failed`, className: "failed", show: summary.failed > 0 },
  ].filter((part) => part.show);
  return `
    <div class="activity-summary" aria-label="Run summary">
      ${parts.map((part) => `<span class="${escape(part.className)}">${escape(part.label)}</span>`).join("")}
    </div>
  `;
}

function renderRunDayGroups(runs = [], activeMatter = {}, escape) {
  const groups = groupRunsByDay(runs);
  return `
    <div class="activity-day-list">
      ${groups.map((group, index) => `
        <details class="activity-day-group" ${index === 0 ? "open" : ""}>
          <summary>
            <span>${escape(group.label)}</span>
            <span>${escape(`${group.runs.length} ${group.runs.length === 1 ? "run" : "runs"}`)}</span>
          </summary>
          <div class="activity-day-runs">
            ${group.runs.map((run) => renderRunReceipt(run, activeMatter, escape)).join("")}
          </div>
        </details>
      `).join("")}
    </div>
  `;
}

function renderRunReceipt(run = {}, activeMatter = {}, escape, { compact = false } = {}) {
  const outputPaths = run.outputPaths || {};
  const aiRun = run.aiRun || {};
  const providerModel = [aiRun.provider, aiRun.model].filter(Boolean).join(" / ") || "Not recorded";
  const markdownPath = outputPaths.markdown || "";
  const jsonPath = outputPaths.json || "";
  const time = run.finishedAt || run.startedAt || "";
  const receipt = receiptForRun(run);
  const canOpenOutput = Boolean(
    markdownPath
    && receipt.canOpenOutput
    && activeMatter?.folderName
    && activeMatter.folderName === run.matterFolder,
  );
  return `
    <article class="activity-card ${compact ? "compact" : ""} ${escape(receipt.statusClass)}">
      <div class="activity-card-main">
        <div class="activity-card-copy">
          <div class="activity-title-row">
            <h3>${escape(run.title || run.slash || "Custom skill run")}</h3>
            <span class="pipeline-state ${escape(receipt.statusClass)}">${escape(receipt.statusLabel)}</span>
          </div>
          <div class="activity-run-line">
            <span>${escape(run.matterName || run.matterFolder || "Unknown matter")}</span>
            ${receipt.receiptState !== "cancelled" && markdownPath ? `
              <span aria-hidden="true">→</span>
              <code>${escape(humanOutputPath(markdownPath))}</code>
            ` : ""}
          </div>
        </div>
        <time datetime="${escape(time)}">${escape(formatRunTime(time))}</time>
      </div>
      <div class="activity-card-actions">
        ${!compact && canOpenOutput ? `<button type="button" class="secondary" data-activity-open-output="${escape(markdownPath)}">Open output</button>` : ""}
        <button type="button" class="secondary" data-configurable-run-copy="${escape(run.id || "")}">Copy report</button>
        <details class="activity-run-details">
          <summary>Details</summary>
          <dl class="skill-card-meta">
            <div><dt>Skill</dt><dd><code>${escape(run.slash || "")}</code></dd></div>
            <div><dt>Matter</dt><dd>${escape(run.matterName || run.matterFolder || "Unknown matter")}</dd></div>
            <div><dt>Output</dt><dd>${markdownPath ? `<code>${escape(humanOutputPath(markdownPath))}</code>` : "No output path"}</dd></div>
            <div><dt>Result</dt><dd>${escape(receipt.resultText)}</dd></div>
            <div><dt>Provider/model</dt><dd>${escape(providerModel)}</dd></div>
            <div><dt>Output document</dt><dd>${escape(formatConfigurableRunOutputDocumentState(run.overwrite))}</dd></div>
            <div><dt>File status</dt><dd>${escape(receipt.outputFileStatusLabel)}</dd></div>
            <div><dt>Started</dt><dd>${escape(run.startedAt || "Not recorded")}</dd></div>
            <div><dt>Finished</dt><dd>${escape(run.finishedAt || "Not recorded")}</dd></div>
            <div><dt>Metadata</dt><dd>${jsonPath ? `<code>${escape(jsonPath)}</code>` : "No metadata path"}</dd></div>
            <div><dt>Run ID</dt><dd><code>${escape(run.id || "")}</code></dd></div>
            ${run.errorMessage ? `<div><dt>Error</dt><dd>${escape(run.errorMessage)}</dd></div>` : ""}
          </dl>
        </details>
      </div>
    </article>
  `;
}

function groupRunsByReceiptState(runs = []) {
  const sorted = [...runs].sort((a, b) => runTimeValue(b) - runTimeValue(a));
  return {
    attention: sorted.filter((run) => receiptForRun(run).needsAttention),
    completed: sorted.filter((run) => receiptForRun(run).isCompletedWork),
    cancelled: sorted.filter((run) => receiptForRun(run).receiptState === "cancelled"),
  };
}

function groupRunsByDay(runs = []) {
  const groups = [];
  const byKey = new Map();
  runs.forEach((run) => {
    const label = formatRunDay(run.finishedAt || run.startedAt || "");
    if (!byKey.has(label)) {
      byKey.set(label, { label, runs: [] });
      groups.push(byKey.get(label));
    }
    byKey.get(label).runs.push(run);
  });
  return groups;
}

function runTimeValue(run = {}) {
  return Date.parse(run.finishedAt || run.startedAt || "") || 0;
}

function humanOutputPath(value = "") {
  return String(value || "")
    .replace(/^10_Library\//, "Source Record / ")
    .replace(/^20_Workshop\//, "Case Analysis / ")
    .replace(/^30_Drafts\//, "Drafts / ")
    .replace(/^40_Dispatch\//, "Ready to Send / ");
}

function formatRunTime(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatRunDay(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const today = new Date();
  const dateKey = localDateKey(date);
  const todayKey = localDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dateKey === todayKey) return "Today";
  if (dateKey === localDateKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function receiptForRun(run = {}) {
  return run.receipt || {
    receiptState: "unknown",
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
