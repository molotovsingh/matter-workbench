import { escapeHtml } from "../dom-utils.js";

export function renderMatterAttentionLoading() {
  return `
    <details class="matter-attention-disclosure">
      <summary>
        <span>Developer diagnostics</span>
        <span class="pipeline-state not-run">Checking</span>
      </summary>
      <p class="muted">Checking matter-level blockers and warnings...</p>
    </details>
  `;
}

export function renderMatterAttentionUnavailable(message) {
  return `
    <details class="matter-attention-disclosure">
      <summary>
        <span>Developer diagnostics</span>
        <span class="pipeline-state failed">Unavailable</span>
      </summary>
      <p class="muted">Developer diagnostics are unavailable: ${escapeHtml(message || "Unknown error")}</p>
    </details>
  `;
}

export function renderMatterAttentionStatus(attention, escape) {
  const summary = attention?.summary || {};
  const state = summary.state || "clear";
  const items = Array.isArray(attention?.items) ? attention.items : [];
  const visibleItems = items.slice(0, 5);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const stateLabel = attentionStateLabel(summary);
  const stateClass = attentionStateClass(state);

  return `
    <details class="matter-attention-disclosure">
      <summary>
        <span>Developer diagnostics</span>
        <span class="pipeline-state ${escape(stateClass)}">${escape(stateLabel)}</span>
      </summary>
      <p class="muted">Read-only checks for intake, extraction, source labels, chronology, skill runs, and command failures.</p>
      ${renderMatterAttentionSummary(summary, escape)}
      ${items.length ? `
        <div class="matter-attention-list">
          ${visibleItems.map((item) => renderMatterAttentionItem(item, escape)).join("")}
        </div>
        ${hiddenCount ? `<p class="matter-attention-more muted">+${hiddenCount} more item${hiddenCount === 1 ? "" : "s"} in the full matter-attention report.</p>` : ""}
      ` : '<p class="matter-attention-clear muted">No developer blockers or warnings found for this matter.</p>'}
    </details>
  `;
}

function renderMatterAttentionSummary(summary, escape) {
  const chips = [
    ["Blockers", summary.blocker || 0],
    ["Warnings", summary.warning || 0],
    ["Info", summary.info || 0],
  ];
  return `
    <div class="matter-attention-summary">
      ${chips.map(([label, count]) => `
        <span><strong>${escape(String(count))}</strong> ${escape(label)}</span>
      `).join("")}
    </div>
  `;
}

function renderMatterAttentionItem(item, escape) {
  const severity = item?.severity || "warning";
  const evidence = Array.isArray(item?.evidence) ? item.evidence.slice(0, 2) : [];
  return `
    <article class="matter-attention-item ${escape(attentionSeverityClass(severity))}">
      <div class="matter-attention-item-main">
        <div>
          <strong>${escape(item?.title || "Developer attention needed")}</strong>
          ${item?.category ? `<span class="pipeline-stage-label">${escape(item.category)}</span>` : ""}
        </div>
        <span class="pipeline-state ${escape(attentionSeverityStateClass(severity))}">${escape(attentionSeverityLabel(severity))}</span>
      </div>
      ${item?.detail ? `<p>${escape(item.detail)}</p>` : ""}
      ${item?.action ? `<div class="matter-attention-action"><strong>Action</strong><span>${escape(item.action)}</span></div>` : ""}
      ${evidence.length ? `
        <div class="matter-attention-evidence">
          ${evidence.map((entry) => `<code>${escape(formatAttentionEvidence(entry))}</code>`).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

function attentionStateLabel(summary = {}) {
  if (summary.state === "blocked" || summary.blocker) return "Blocked";
  if (summary.state === "attention_needed" || summary.warning) return "Needs attention";
  return "Clear";
}

function attentionStateClass(state) {
  return ({
    blocked: "failed",
    attention_needed: "warning",
    clear: "present",
  })[state] || "not-run";
}

function attentionSeverityLabel(severity) {
  return ({
    blocker: "Blocker",
    warning: "Warning",
    info: "Info",
  })[severity] || "Warning";
}

function attentionSeverityStateClass(severity) {
  return ({
    blocker: "failed",
    warning: "warning",
    info: "not-run",
  })[severity] || "warning";
}

function attentionSeverityClass(severity) {
  return ({
    blocker: "blocker",
    warning: "warning",
    info: "info",
  })[severity] || "warning";
}

function formatAttentionEvidence(entry) {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return "";
  return [
    entry.path,
    entry.source_id,
    entry.file_id,
    entry.row,
    entry.runId,
    entry.status,
    entry.label_status,
    entry.detail,
    entry.value,
    entry.notes,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 5)
    .join(" - ");
}
