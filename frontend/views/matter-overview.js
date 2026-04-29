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
      ? `<p class="form-error">Missing matter details: ${escapeHtml(missing.join(", "))}. Update the matter details on disk and refresh, or recreate the matter via <code>+ New Matter</code>.</p>`
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

      <div class="form-actions">
        <button type="button" class="run-skill-button" id="runMatterInitButton" ${missing.length ? "disabled" : ""}>Run /matter-init</button>
        <button type="button" class="run-skill-button secondary" id="runExtractButton">Run /extract</button>
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
    const runListOfDatesButton = document.getElementById("runListOfDatesButton");
    if (runListOfDatesButton) {
      runListOfDatesButton.addEventListener("click", () => skills.runCreateListOfDates("/create_listofdates"));
    }
    const runDoctorButton = document.getElementById("runDoctorButton");
    if (runDoctorButton) {
      runDoctorButton.addEventListener("click", () => skills.runDoctor("/doctor"));
    }
  }

  return { renderSkillOverview };
}
