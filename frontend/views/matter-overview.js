import { getJson } from "../api-client.js";
import { escapeHtml, validateMetadata } from "../dom-utils.js";
import { lawyerActionLabel, lawyerActionPill, lawyerArtifactLabel } from "../lawyer-labels.js";
import { LIST_OF_DATES_DEPENDENCY_STATES } from "../../shared/listofdates-dependency-states.mjs";
import {
  renderMatterAttentionLoading,
  renderMatterAttentionStatus,
  renderMatterAttentionUnavailable,
} from "./matter-attention-card.js";

export function createMatterOverview(ctx, skills) {
  const { editorContent } = ctx.elements;

  function renderSkillOverview() {
    ctx.setActivityActive("explorer");
    const activeMatter = ctx.getActiveMatter();
    const meta = activeMatter.metadata || {};
    const fmt = (value, fallback) => escapeHtml(value && value.trim() ? value : fallback);
    const missing = validateMetadata(meta);
    const missingNote = missing.length
      ? `<p class="form-error">Missing metadata: ${escapeHtml(missing.join(", "))}. Update the matter details file (<code>matter.json</code>) and refresh, or recreate the matter via <code>Add new matter</code>.</p>`
      : "";

    editorContent.innerHTML = `
      <section class="matter-overview-hero">
        <h1>${fmt(meta.matterName, activeMatter.folderName || "Matter")}</h1>
        <p>${activeMatter.fileCount} files and ${activeMatter.directoryCount} folders loaded from the matter folder.</p>
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
        ${renderMatterActionButton("runPrepareMatterButton", "/prepare_matter")}
        ${renderMatterActionButton("runMatterInitButton", "/matter-init", { disabled: Boolean(missing.length) })}
        ${renderMatterActionButton("runExtractButton", "/extract", { secondary: true })}
        ${renderMatterActionButton("runDescribeSourcesButton", "/describe_sources", { secondary: true })}
        ${renderMatterActionButton("runListOfDatesButton", "/create_listofdates", { secondary: true })}
        ${renderMatterActionButton("runDoctorButton", "/doctor", { secondary: true })}
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

export function renderMatterPipelineStatus(status, escape) {
  const stages = Array.isArray(status?.stages) ? status.stages : [];
  const rows = stages.length
    ? stages.map((stage) => `
      <div class="pipeline-stage ${stage.present ? "present" : "not-run"}">
        <div class="pipeline-stage-main">
          <div>
            <strong>${escape(stageDisplayLabel(stage))}</strong>
            ${stage.slash ? `<span class="pipeline-stage-label">${escape(lawyerActionPill(stage, { paidProviderCall: stage.paidProviderCall }))}</span>` : ""}
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
      ${artifacts.slice(0, 4).map((artifact) => `<span title="${escape(artifact)}">${escape(lawyerArtifactLabel(artifact))}</span>`).join("")}
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
    <details class="pipeline-ai-run">
      <summary>Run receipt</summary>
      <div>
        ${provider ? `<span>${escape(provider)}</span>` : ""}
        ${model ? `<code>${escape(model)}</code>` : ""}
      </div>
    </details>
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
  if (providerModel) meta.push("Run receipt available");
  if (Number.isInteger(stage?.metrics?.rows)) {
    meta.push(`${stage.metrics.rows} row${stage.metrics.rows === 1 ? "" : "s"}`);
  }
  if (advice.newestInputPath) meta.push(`Newest input ${lawyerArtifactLabel(advice.newestInputPath)}`);
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
  if (stage?.slash) return lawyerActionLabel(stage, stage.label || stage.slash);
  return stage?.label || stage?.slash || "";
}

function renderMatterActionButton(id, command, { secondary = false, disabled = false } = {}) {
  const classes = ["run-skill-button"];
  if (secondary) classes.push("secondary");
  return `<button type="button" class="${classes.join(" ")}" id="${id}"${disabled ? " disabled" : ""}>${lawyerActionLabel(command)} <span>${lawyerActionPill(command)}</span></button>`;
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
