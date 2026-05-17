import { getJson } from "../api-client.js";
import { escapeHtml, validateMetadata } from "../dom-utils.js";
import { LIST_OF_DATES_DEPENDENCY_STATES } from "../listofdates-dependency-state.js";

export function createMatterOverview(ctx, skills) {
  const { editorContent } = ctx.elements;

  function renderSkillOverview() {
    ctx.setActivityActive("explorer");
    const activeMatter = ctx.getActiveMatter();
    const meta = activeMatter.metadata || {};
    const fmt = (value, fallback) => escapeHtml(value && value.trim() ? value : fallback);
    const missing = validateMetadata(meta);
    const missingNote = missing.length
      ? `<p class="form-error">Missing metadata: ${escapeHtml(missing.join(", "))}. Edit <code>matter.json</code> on disk and refresh, or recreate the matter via <code>Add new matter</code>.</p>`
      : "";

    editorContent.innerHTML = `
      <section class="matter-overview-hero">
        <h1>${fmt(meta.matterName, activeMatter.folderName || "Matter")}</h1>
        <p>${activeMatter.fileCount} files and ${activeMatter.directoryCount} folders loaded from local workspace.</p>
      </section>

      <dl class="matter-info-card">
        <dt>Client</dt><dd>${fmt(meta.clientName, "—")}</dd>
        <dt>Matter name</dt><dd>${fmt(meta.matterName, "—")}</dd>
        <dt>Opposite party</dt><dd>${fmt(meta.oppositeParty, "—")}</dd>
        <dt>Matter type</dt><dd>${fmt(meta.matterType, "—")}</dd>
        <dt>Jurisdiction</dt><dd>${fmt(meta.jurisdiction, "—")}</dd>
        ${meta.briefDescription && meta.briefDescription.trim() ? `<dt>Description</dt><dd>${escapeHtml(meta.briefDescription)}</dd>` : ""}
      </dl>

      ${missingNote}

      <section class="matter-pipeline-card" id="matterPipelineStatus">
        ${renderMatterPipelineStatusLoading()}
      </section>

      <section class="matter-pipeline-card matter-attention-card" id="matterAttentionStatus">
        ${renderMatterAttentionLoading()}
      </section>

      <div class="form-actions matter-run-actions">
        <button type="button" class="run-skill-button" id="runPrepareMatterButton">Prepare matter <span>/prepare_matter</span></button>
        <button type="button" class="run-skill-button" id="runMatterInitButton" ${missing.length ? "disabled" : ""}>Set up matter <span>/matter-init</span></button>
        <button type="button" class="run-skill-button secondary" id="runExtractButton">Extract documents <span>/extract</span></button>
        <button type="button" class="run-skill-button secondary" id="runDescribeSourcesButton">Label sources <span>/describe_sources</span></button>
        <button type="button" class="run-skill-button secondary" id="runListOfDatesButton">Create list of dates <span>/create_listofdates</span></button>
        <button type="button" class="run-skill-button secondary" id="runDoctorButton">Check matter <span>/doctor</span></button>
      </div>
    `;

    const runPrepareMatterButton = document.getElementById("runPrepareMatterButton");
    if (runPrepareMatterButton) {
      runPrepareMatterButton.addEventListener("click", () => skills.runPrepareMatter("/prepare_matter"));
    }
    const runInitButton = document.getElementById("runMatterInitButton");
    if (runInitButton) {
      runInitButton.addEventListener("click", () => skills.runMatterInit("/matter-init"));
    }
    const runExtractButton = document.getElementById("runExtractButton");
    if (runExtractButton) {
      runExtractButton.addEventListener("click", () => skills.runExtract("/extract"));
    }
    const runDescribeSourcesButton = document.getElementById("runDescribeSourcesButton");
    if (runDescribeSourcesButton) {
      runDescribeSourcesButton.addEventListener("click", () => skills.runDescribeSources("/describe_sources"));
    }
    const runListOfDatesButton = document.getElementById("runListOfDatesButton");
    if (runListOfDatesButton) {
      runListOfDatesButton.addEventListener("click", () => skills.runCreateListOfDates("/create_listofdates"));
    }
    const runDoctorButton = document.getElementById("runDoctorButton");
    if (runDoctorButton) {
      runDoctorButton.addEventListener("click", () => skills.runDoctor("/doctor"));
    }
    loadMatterPipelineStatus(activeMatter.inputLabel);
    loadMatterAttentionStatus(activeMatter.inputLabel);
  }

  return { renderSkillOverview };

  async function loadMatterPipelineStatus(expectedMatterPath) {
    const container = document.getElementById("matterPipelineStatus");
    if (!container) return;
    try {
      const status = await getJson("/api/matter-status");
      if (expectedMatterPath && ctx.getActiveMatter().inputLabel !== expectedMatterPath) return;
      container.innerHTML = renderMatterPipelineStatus(status, escapeHtml);
    } catch (error) {
      container.innerHTML = renderMatterPipelineStatusUnavailable(error.message);
    }
  }

  async function loadMatterAttentionStatus(expectedMatterPath) {
    const container = document.getElementById("matterAttentionStatus");
    if (!container) return;
    try {
      const attention = await getJson("/api/matter-attention");
      if (expectedMatterPath && ctx.getActiveMatter().inputLabel !== expectedMatterPath) return;
      container.innerHTML = renderMatterAttentionStatus(attention, escapeHtml);
    } catch (error) {
      container.innerHTML = renderMatterAttentionUnavailable(error.message);
    }
  }
}

export function renderMatterPipelineStatusLoading() {
  return `
    <h2>Matter readiness</h2>
    <p class="muted">Checking what has already been prepared for this matter...</p>
  `;
}

export function renderMatterPipelineStatusUnavailable(message) {
  return `
    <h2>Matter readiness</h2>
    <p class="muted">Matter readiness is unavailable: ${escapeHtml(message || "Unknown error")}</p>
  `;
}

export function renderMatterAttentionLoading() {
  return `
    <h2>Developer attention</h2>
    <p class="muted">Checking matter-level blockers and warnings...</p>
  `;
}

export function renderMatterAttentionUnavailable(message) {
  return `
    <h2>Developer attention</h2>
    <p class="muted">Developer attention is unavailable: ${escapeHtml(message || "Unknown error")}</p>
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
    <div class="matter-attention-heading">
      <h2>Developer attention</h2>
      <span class="pipeline-state ${escape(stateClass)}">${escape(stateLabel)}</span>
    </div>
    <p class="muted">Read-only diagnostics gathered from intake, extraction, source labels, chronology, skill runs, and command failures.</p>
    ${renderMatterAttentionSummary(summary, escape)}
    ${items.length ? `
      <div class="matter-attention-list">
        ${visibleItems.map((item) => renderMatterAttentionItem(item, escape)).join("")}
      </div>
      ${hiddenCount ? `<p class="matter-attention-more muted">+${hiddenCount} more item${hiddenCount === 1 ? "" : "s"} in the full matter-attention report.</p>` : ""}
    ` : '<p class="matter-attention-clear muted">No developer blockers or warnings found for this matter.</p>'}
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

export function renderMatterPipelineStatus(status, escape) {
  const stages = Array.isArray(status?.stages) ? status.stages : [];
  const rows = stages.length
    ? stages.map((stage) => `
      <div class="pipeline-stage ${stage.present ? "present" : "not-run"}">
        <div class="pipeline-stage-main">
          <div>
            <strong>${escape(stageDisplayLabel(stage))}</strong>
            ${stage.slash ? `<span class="pipeline-stage-label">${escape(stage.slash)}</span>` : ""}
          </div>
          <span class="pipeline-state ${stage.present ? "present" : "not-run"}">${stage.present ? "Done" : "Not started"}</span>
        </div>
        ${renderStageArtifacts(stage.artifacts, escape)}
        ${renderStageAiRun(stage.aiRun, escape)}
        ${renderStageRerunHint(stage, escape)}
      </div>
    `).join("")
    : '<p class="muted">No pipeline status available.</p>';

  return `
    <h2>Matter readiness</h2>
    <p class="muted">Based on files already saved for this matter. Missing work products are shown as not started.</p>
    <div class="pipeline-stage-list">${rows}</div>
  `;
}

function renderStageArtifacts(artifacts, escape) {
  if (!Array.isArray(artifacts) || !artifacts.length) return '<div class="pipeline-artifacts muted">No output document found.</div>';
  return `
    <div class="pipeline-artifacts">
      ${artifacts.slice(0, 4).map((artifact) => `<code>${escape(artifact)}</code>`).join("")}
      ${artifacts.length > 4 ? `<span class="muted">+${artifacts.length - 4} more</span>` : ""}
    </div>
  `;
}

function renderStageAiRun(aiRun, escape) {
  if (!aiRun) return "";
  const provider = aiRun.returnedProvider || aiRun.provider || "";
  const model = aiRun.returnedModel || aiRun.model || "";
  if (!provider && !model) return "";
  return `
    <div class="pipeline-ai-run">
      ${provider ? `<span>${escape(provider)}</span>` : ""}
      ${model ? `<code>${escape(model)}</code>` : ""}
    </div>
  `;
}

function renderStageRerunHint(stage, escape) {
  const advice = stage?.rerunAdvice;
  if (!advice) return "";
  const state = advice.state || "unknown";
  const stateLabel = rerunStateLabel(state);
  const hint = rerunHintText(advice);
  const meta = rerunHintMeta(stage, advice);

  return `
    <div class="pipeline-rerun-hint ${escape(rerunStateClass(state))}">
      <strong>${escape(stateLabel)}</strong>
      <span>${escape(hint)}</span>
      ${meta.length ? `<div class="pipeline-rerun-meta">${meta.map((item) => `<span>${escape(item)}</span>`).join("")}</div>` : ""}
    </div>
  `;
}

function rerunHintText(advice) {
  if (advice.state === "stale") {
    if (advice.dependencyState === LIST_OF_DATES_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED) {
      return "Source labels changed after this chronology was rendered. A label refresh should be enough; AI chronology regeneration is not required unless the legal facts changed.";
    }
    if (advice.dependencyState === LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED) {
      return "Source metadata changed after this chronology was rendered. Review the current chronology before deciding whether to regenerate.";
    }
    return `${sentenceWithPeriod(advice.reason || "Newer source material exists")} Review the existing output document, then regenerate deliberately to include newer inputs.`;
  }
  if (advice.shouldConfirm) {
    return "An output document already exists. The app will ask before replacing it or starting a paid AI action.";
  }
  if (advice.state === "missing") {
    return "No output document exists yet; the next run will create one.";
  }
  if (advice.state === "failed") {
    return "The existing output metadata could not be read. Review the current file before regenerating.";
  }
  if (advice.state === "missing_upstream") {
    return "Required source material is missing. Complete the earlier step before creating this work product.";
  }
  return advice.reason || "Review the existing output document before regenerating.";
}

function sentenceWithPeriod(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function rerunHintMeta(stage, advice) {
  const meta = [];
  if (advice.lastRunAt) meta.push(`Last run ${formatDateTime(advice.lastRunAt)}`);
  const providerModel = [advice.provider, advice.model].filter(Boolean).join(" / ");
  if (providerModel) meta.push(providerModel);
  if (Number.isInteger(stage?.metrics?.rows)) {
    meta.push(`${stage.metrics.rows} row${stage.metrics.rows === 1 ? "" : "s"}`);
  }
  if (advice.newestInputPath) meta.push(`Newest input ${advice.newestInputPath}`);
  return meta;
}

function rerunStateLabel(state) {
  return ({
    current: "Up to date",
    stale: "Needs update",
    missing: "Not started",
    failed: "Needs attention",
    missing_upstream: "Waiting on earlier step",
  })[state] || "Status unknown";
}

function stageDisplayLabel(stage) {
  const bySlash = {
    "/matter-init": "Set up matter",
    "/extract": "Extract documents",
    "/describe_sources": "Label sources",
    "/context_preview": "Preview matter context",
    "/context_search": "Find in matter",
    "/create_listofdates": "Create list of dates",
    "/doctor": "Check matter",
    "/prepare_matter": "Prepare matter",
  };
  if (bySlash[stage?.slash]) return bySlash[stage.slash];
  return stage?.label || stage?.slash || "";
}

function rerunStateClass(state) {
  return ({
    current: "current",
    stale: "stale",
    missing: "missing",
    failed: "failed",
    missing_upstream: "missing-upstream",
  })[state] || "unknown";
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
