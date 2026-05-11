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
        <button type="button" class="run-skill-button" id="runMatterInitButton" ${missing.length ? "disabled" : ""}>Run /matter-init</button>
        <button type="button" class="run-skill-button secondary" id="runExtractButton">Run /extract</button>
        <button type="button" class="run-skill-button secondary" id="runDescribeSourcesButton">Run /describe_sources</button>
        <button type="button" class="run-skill-button secondary" id="runListOfDatesButton">Run /create_listofdates</button>
        <button type="button" class="run-skill-button secondary" id="runDoctorButton">Run /doctor</button>
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
