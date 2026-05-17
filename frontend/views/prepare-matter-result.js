import { lawyerActionLabel, lawyerActionPill, lawyerArtifactLabel } from "../lawyer-labels.js";

export function renderPrepareMatterHtml(plan, escapeHtml = defaultEscapeHtml) {
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  const matterName = plan?.matter?.name || "No matter selected";
  const nextStep = plan?.nextStep || {};
  const warnings = Array.isArray(plan?.warnings) ? plan.warnings : [];
  const canRun = stages.some((stage) => stage.action === "run" || stage.action === "confirm_paid_run");
  const nextStage = stages.find((stage) => stage.id === nextStep.stage);

  return `
    <h1>Prepare matter</h1>
    <p>
      A guided preparation plan for <strong>${escapeHtml(matterName)}</strong>.
      It checks saved work first, skips completed steps, and asks before paid source labeling.
    </p>
    <section class="matter-pipeline-card prepare-matter-card">
      <h2>Next safe step</h2>
      <p>${escapeHtml(nextStep.message || "Pick or create a matter before preparing it.")}</p>
      ${renderMetadata(plan?.metadata, escapeHtml)}
      ${warnings.length ? `
        <div class="prepare-warning-list">
          ${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}
        </div>
      ` : ""}
    </section>
    <section class="matter-pipeline-card prepare-matter-card">
      <h2>Preparation steps</h2>
      <div class="pipeline-stage-list">
        ${stages.length ? stages.map((stage) => renderPrepareStage(stage, escapeHtml)).join("") : "<p class=\"muted\">No active matter. Pick a matter from Home to begin.</p>"}
      </div>
      ${renderListOfDatesRecommendation(plan?.downstream?.listOfDates, escapeHtml)}
    </section>
    <div class="form-actions">
      ${canRun ? `<button type="button" class="run-skill-button" id="runPrepareMatterPlan">Run preparation</button>` : ""}
      ${nextStage && canRun ? `<button type="button" class="run-skill-button secondary" id="runPrepareMatterNext">Run next stage</button>` : ""}
      <button type="button" class="run-skill-button secondary" id="refreshPrepareMatterPlan">Refresh plan</button>
    </div>
  `;
}

export function renderPreparePaidConfirmationHtml(stage, escapeHtml = defaultEscapeHtml) {
  const advice = stage?.rerunAdvice || {};
  const providerModel = [advice.provider, advice.model].filter(Boolean).join(" / ");
  return `
    <h1>Confirm source labeling</h1>
    <div class="form-warning" role="alertdialog" aria-labelledby="preparePaidConfirmTitle">
      <h2 id="preparePaidConfirmTitle">Label sources may use a paid AI provider</h2>
      <p>
        Prepare Matter is ready to run <strong>${escapeHtml(lawyerActionLabel(stage, stage?.label || "Label sources"))}</strong>.
        This updates the matter's source labels for downstream List of Dates work.
      </p>
      <ul class="overlap-list">
        <li><strong>Step:</strong> ${escapeHtml(lawyerActionLabel(stage, stage?.label || "Label sources"))}</li>
        <li><strong>Saved record:</strong> ${escapeHtml(lawyerArtifactLabel(advice.artifactPath || "10_Library/Source Index.json"))}</li>
        <li><strong>Status:</strong> ${escapeHtml(stageStateLabel(stage || { state: advice.state || "missing" }))}</li>
        <li><strong>Provider / model:</strong> ${escapeHtml(providerModel || "Configured in Settings")}</li>
      </ul>
      <p>Cancel leaves existing artifacts unchanged.</p>
      <div class="warning-actions">
        <button type="button" id="preparePaidCancel">Keep current</button>
        <button type="button" class="secondary" id="preparePaidRun">Run ${escapeHtml(lawyerActionLabel(stage, "Label sources"))}</button>
      </div>
    </div>
  `;
}

function renderMetadata(metadata, escapeHtml) {
  const missing = Array.isArray(metadata?.missing) ? metadata.missing : [];
  if (!missing.length && metadata?.complete) {
    return '<p class="muted">Metadata is complete.</p>';
  }
  if (!missing.length) return "";
  return `<p class="form-error">Missing metadata: ${escapeHtml(missing.join(", "))}.</p>`;
}

function renderPrepareStage(stage, escapeHtml) {
  return `
    <div class="pipeline-stage ${stateClass(stage.state)}">
      <div class="pipeline-stage-main">
        <div>
          <strong>${escapeHtml(lawyerActionLabel(stage, stage.label || stage.slash || ""))}</strong>
          <span class="pipeline-stage-label">${escapeHtml(lawyerActionPill(stage))}</span>
        </div>
        <span class="pipeline-state ${stateClass(stage.state)}">${escapeHtml(stageStateLabel(stage))}</span>
      </div>
      <p class="muted">${escapeHtml(stage.reason || stage.description || "")}</p>
      ${renderArtifacts(stage.artifacts, escapeHtml)}
    </div>
  `;
}

function renderListOfDatesRecommendation(stage, escapeHtml) {
  if (!stage) return "";
  return `
    <div class="pipeline-stage ${stateClass(stage.state)}">
      <div class="pipeline-stage-main">
        <div>
          <strong>${escapeHtml(lawyerActionLabel(stage, stage.label || "Create list of dates"))}</strong>
          <span class="pipeline-stage-label">${escapeHtml(lawyerActionPill(stage.slash ? stage : "/create_listofdates"))}</span>
        </div>
        <span class="pipeline-state ${stateClass(stage.state)}">Recommended separately</span>
      </div>
      <p class="muted">${escapeHtml(stage.reason || "")}</p>
      ${renderArtifacts(stage.artifacts, escapeHtml)}
    </div>
  `;
}

function renderArtifacts(artifacts, escapeHtml) {
  if (!Array.isArray(artifacts) || !artifacts.length) return '<div class="pipeline-artifacts muted">No saved output found.</div>';
  return `
    <div class="pipeline-artifacts">
      ${artifacts.slice(0, 4).map((artifact) => `<span title="${escapeHtml(artifact)}">${escapeHtml(lawyerArtifactLabel(artifact))}</span>`).join("")}
      ${artifacts.length > 4 ? `<span class="muted">+${artifacts.length - 4} more</span>` : ""}
    </div>
  `;
}

function stageStateLabel(stage) {
  if (stage.action === "skip_current") return "Already done";
  if (stage.action === "confirm_paid_run") return "Needs approval";
  return ({
    ready_to_run: "Ready to run",
    blocked: "Blocked",
    missing: "Not started",
    stale: "Needs update",
    failed: "Needs attention",
    current: "Up to date",
  })[stage.state] || "Status unknown";
}

function stateClass(state) {
  return ({
    current: "present",
    ready_to_run: "stale",
    blocked: "not-run",
    missing: "not-run",
    stale: "stale",
    failed: "failed",
    not_selected: "not-run",
  })[state] || "not-run";
}

function defaultEscapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
