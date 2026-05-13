import { getJson } from "../api-client.js";
import { escapeHtml, validateMetadata } from "../dom-utils.js";

export function createMatterOverview(ctx, skills) {
  const { editorContent } = ctx.elements;

  function renderSkillOverview() {
    ctx.setActivityActive("explorer");
    const activeMatter = ctx.getActiveMatter();
    const meta = activeMatter.metadata || {};
    const fmt = (value, fallback) => escapeHtml(value && value.trim() ? value : fallback);
    const missing = validateMetadata(meta);
    const missingNote = missing.length
      ? `<p class="form-error">Missing metadata: ${escapeHtml(missing.join(", "))}. Edit <code>matter.json</code> on disk and refresh, or recreate the matter via <code>+ New Matter</code>.</p>`
      : "";

    editorContent.innerHTML = `
      <h1>${fmt(meta.matterName, activeMatter.folderName || "Matter")}</h1>
      <p>${activeMatter.fileCount} files and ${activeMatter.directoryCount} folders loaded from <code>${escapeHtml(activeMatter.inputLabel)}</code>.</p>

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

      <div class="form-actions">
        <button type="button" class="run-skill-button" id="runMatterInitButton" ${missing.length ? "disabled" : ""}>Set up matter <span>/matter-init</span></button>
        <button type="button" class="run-skill-button secondary" id="runExtractButton">Extract documents <span>/extract</span></button>
        <button type="button" class="run-skill-button secondary" id="runDescribeSourcesButton">Label sources <span>/describe_sources</span></button>
        <button type="button" class="run-skill-button secondary" id="runListOfDatesButton">Create list of dates <span>/create_listofdates</span></button>
        <button type="button" class="run-skill-button secondary" id="runDoctorButton">Check matter <span>/doctor</span></button>
      </div>
    `;

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
}

export function renderMatterPipelineStatusLoading() {
  return `
    <h2>Matter Pipeline</h2>
    <p class="muted">Checking existing matter artifacts...</p>
  `;
}

export function renderMatterPipelineStatusUnavailable(message) {
  return `
    <h2>Matter Pipeline</h2>
    <p class="muted">Pipeline status unavailable: ${escapeHtml(message || "Unknown error")}</p>
  `;
}

export function renderMatterPipelineStatus(status, escape) {
  const stages = Array.isArray(status?.stages) ? status.stages : [];
  const rows = stages.length
    ? stages.map((stage) => `
      <div class="pipeline-stage ${stage.present ? "present" : "not-run"}">
        <div class="pipeline-stage-main">
          <div>
            <strong>${escape(stage.slash || stage.label || "")}</strong>
            <span class="pipeline-stage-label">${escape(stage.label || "")}</span>
          </div>
          <span class="pipeline-state ${stage.present ? "present" : "not-run"}">${stage.present ? "Present" : "Not run"}</span>
        </div>
        ${renderStageArtifacts(stage.artifacts, escape)}
        ${renderStageAiRun(stage.aiRun, escape)}
        ${renderStageRerunHint(stage, escape)}
      </div>
    `).join("")
    : '<p class="muted">No pipeline status available.</p>';

  return `
    <h2>Matter Pipeline</h2>
    <p class="muted">Derived from files in the active matter folder. Missing artifacts are shown as not run.</p>
    <div class="pipeline-stage-list">${rows}</div>
  `;
}

function renderStageArtifacts(artifacts, escape) {
  if (!Array.isArray(artifacts) || !artifacts.length) return '<div class="pipeline-artifacts muted">No artifact found.</div>';
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
  if (advice.shouldConfirm) {
    return "Clicking Run will show a confirmation before starting a paid provider call.";
  }
  if (advice.state === "stale") {
    return `${advice.reason || "Newer upstream inputs were found."} Rerun recommended; no confirmation will be shown.`;
  }
  if (advice.state === "missing") {
    return "No current artifact exists, so the next run will not ask for overwrite confirmation.";
  }
  if (advice.state === "failed") {
    return "The existing artifact could not be read, so rerun is allowed without confirmation.";
  }
  if (advice.state === "missing_upstream") {
    return "Upstream inputs are missing, so rerun is allowed without overwrite confirmation.";
  }
  return advice.reason || "Rerun confirmation is not required.";
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
    current: "Current",
    stale: "Stale",
    missing: "Not run",
    failed: "Needs rerun",
    missing_upstream: "Missing inputs",
  })[state] || "Status unknown";
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
