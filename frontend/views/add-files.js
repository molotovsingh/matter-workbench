import { postJson } from "../api-client.js";
import { escapeHtml, formatBytes, matterFromWorkspace } from "../dom-utils.js";
import { collectFilesFromDataTransfer, collectFilesFromInput, hashFile } from "../file-collection.js";

export function renderAddFilesForm(ctx) {
  const { breadcrumbs, editorContent } = ctx.elements;
  const activeMatter = ctx.getActiveMatter();
  ctx.setActivityActive("explorer");
  if (!activeMatter.folderName) {
    ctx.setStatus({
      mood: "idle",
      card: "<strong>No matter loaded</strong><br />Pick a matter from the sidebar before adding files.",
      bar: "No Matter",
    });
    return;
  }
  breadcrumbs.textContent = `${activeMatter.folderName} > add files`;
  ctx.setStatus({
    mood: "idle",
    card: `<strong>Add files to <code>${escapeHtml(activeMatter.folderName)}</code></strong><br />Files will go into a new Intake batch with today's date.`,
    bar: "Add Files",
    terminal: "[add-files] form ready",
  });
  const today = new Date().toISOString().slice(0, 10);
  editorContent.innerHTML = `
    <h1>Add files to ${escapeHtml(activeMatter.folderName)}</h1>
    <p>Each batch becomes its own <code>Intake NN</code> folder so you can answer "when did this arrive". Files already in this matter are noted as duplicates and not re-copied.</p>
    <form class="new-matter-form" id="addFilesForm">
      <label>
        <span>Label (optional)</span>
        <input type="text" id="afLabel" placeholder="e.g., client email, opposite party production" maxlength="80" autocomplete="off" />
        <small style="color:#9aa0a6;font-size:11px;">The intake folder will be: <code>Intake NN - ${today}<span id="afLabelPreview"></span></code></small>
      </label>
      <div class="drop-zone" id="afDropZone">
        <div>Drag files or a folder here</div>
        <div class="drop-actions">
          <button type="button" id="afPickFiles">Pick Files</button>
          <button type="button" id="afPickFolder">Pick Folder</button>
        </div>
        <input type="file" id="afFilesInput" multiple hidden />
        <input type="file" id="afFolderInput" webkitdirectory multiple hidden />
      </div>
      <ul class="file-list" id="afFileList" hidden></ul>
      <div id="afInfo" class="form-info" hidden></div>
      <div id="afOverlap" class="form-warning" hidden></div>
      <div class="form-actions">
        <button type="submit" id="afSubmit">Add to matter</button>
        <button type="button" class="secondary" id="afCancel">Cancel</button>
      </div>
      <div id="afError" class="form-error" hidden></div>
    </form>
  `;

  let pendingFiles = [];
  let bypassOverlapCheck = false;
  const dropZone = document.getElementById("afDropZone");
  const filesInput = document.getElementById("afFilesInput");
  const folderInput = document.getElementById("afFolderInput");
  const fileList = document.getElementById("afFileList");
  const errorBox = document.getElementById("afError");
  const infoBox = document.getElementById("afInfo");
  const overlapBox = document.getElementById("afOverlap");
  const labelInput = document.getElementById("afLabel");
  const labelPreview = document.getElementById("afLabelPreview");
  const submitButton = document.getElementById("afSubmit");

  labelInput.addEventListener("input", () => {
    const v = labelInput.value.trim();
    labelPreview.textContent = v ? ` ${v}` : "";
  });

  const resetOverlapState = () => {
    bypassOverlapCheck = false;
    overlapBox.hidden = true;
    overlapBox.innerHTML = "";
    infoBox.hidden = true;
    infoBox.innerHTML = "";
  };

  const updateFileList = () => {
    if (!pendingFiles.length) {
      fileList.hidden = true;
      fileList.innerHTML = "";
      return;
    }
    fileList.hidden = false;
    const totalBytes = pendingFiles.reduce((sum, item) => sum + item.file.size, 0);
    const summary = `<li class="file-list-summary">${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} ready — ${formatBytes(totalBytes)}</li>`;
    const rows = pendingFiles.map((item) => `<li class="file-list-entry">${escapeHtml(item.relativePath)}</li>`).join("");
    fileList.innerHTML = summary + rows;
  };

  function renderThisMatterInfo(warning) {
    infoBox.innerHTML = `
      <strong>Some files are already in this matter.</strong>
      ${warning.overlapCount} of ${warning.totalIncoming} file${warning.totalIncoming === 1 ? "" : "s"} match existing files in <code>${escapeHtml(activeMatter.folderName)}</code> (${warning.overlapPercent}%).
      They'll be recorded as duplicates of the prior FILE id and not re-copied.
      <div class="info-actions">
        <button type="button" id="afInfoContinue">Continue</button>
      </div>
    `;
    infoBox.hidden = false;
    document.getElementById("afInfoContinue").addEventListener("click", () => {
      bypassOverlapCheck = true;
      infoBox.hidden = true;
      infoBox.innerHTML = "";
      submitButton.focus();
    });
  }

  function renderOtherMatterWarnings(others) {
    const top = others[0];
    const list = others.map((w) => (
      `<li><strong>${escapeHtml(w.matterName)}</strong>: ${w.overlapCount} of ${w.totalIncoming} file${w.totalIncoming === 1 ? "" : "s"} match (${w.overlapPercent}%)</li>`
    )).join("");
    overlapBox.innerHTML = `
      <strong>Some files appear in other matter${others.length > 1 ? "s" : ""}.</strong>
      Are these meant to live in <code>${escapeHtml(activeMatter.folderName)}</code> too?
      <ul class="overlap-list">${list}</ul>
      <div class="warning-actions">
        <button type="button" id="afOpenOther">Open ${escapeHtml(top.matterName)}</button>
        <button type="button" id="afContinueAnyway" class="secondary">Continue adding here</button>
      </div>
    `;
    overlapBox.hidden = false;
    document.getElementById("afOpenOther").addEventListener("click", () => ctx.switchToMatter(top.matterName));
    document.getElementById("afContinueAnyway").addEventListener("click", () => {
      bypassOverlapCheck = true;
      overlapBox.hidden = true;
      overlapBox.innerHTML = "";
      submitButton.focus();
    });
  }

  document.getElementById("afPickFiles").addEventListener("click", () => filesInput.click());
  document.getElementById("afPickFolder").addEventListener("click", () => folderInput.click());
  filesInput.addEventListener("change", () => {
    pendingFiles = pendingFiles.concat(collectFilesFromInput(filesInput));
    filesInput.value = "";
    updateFileList();
    resetOverlapState();
  });
  folderInput.addEventListener("change", () => {
    pendingFiles = pendingFiles.concat(collectFilesFromInput(folderInput));
    folderInput.value = "";
    updateFileList();
    resetOverlapState();
  });
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
    const collected = await collectFilesFromDataTransfer(event.dataTransfer);
    pendingFiles = pendingFiles.concat(collected);
    updateFileList();
    resetOverlapState();
  });

  document.getElementById("afCancel").addEventListener("click", () => {
    ctx.renderSkillOverview();
    ctx.setStatus({
      mood: "idle",
      card: `Back on <code>${escapeHtml(activeMatter.folderName)}</code>.`,
      bar: "Skill Ready",
      terminal: `[matter] returned to ${activeMatter.folderName}`,
    });
  });

  document.getElementById("addFilesForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    if (!pendingFiles.length) {
      errorBox.textContent = "Attach at least one file or a folder.";
      errorBox.hidden = false;
      return;
    }
    const label = labelInput.value.trim();

    submitButton.disabled = true;
    submitButton.textContent = "Adding...";

    try {
      if (!bypassOverlapCheck) {
        submitButton.textContent = "Checking for duplicates...";
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Checking</strong><br />Hashing ${pendingFiles.length} file(s)...`,
          bar: "Checking",
          terminal: `[add-files] hashing ${pendingFiles.length} files`,
        });
        const hashes = [];
        for (const item of pendingFiles) hashes.push(await hashFile(item.file));
        const checkPayload = await postJson("/api/matters/check-overlap", { hashes, proposedName: activeMatter.folderName });
        const warnings = checkPayload.warnings || [];
        const thisMatter = warnings.find((w) => w.matterName === activeMatter.folderName);
        const others = warnings.filter((w) => w.matterName !== activeMatter.folderName);
        if (thisMatter) renderThisMatterInfo(thisMatter);
        if (others.length) renderOtherMatterWarnings(others);
        if (thisMatter || others.length) {
          submitButton.disabled = false;
          submitButton.textContent = "Add to matter";
          return;
        }
      }

      submitButton.textContent = "Adding...";
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Adding files</strong><br />Uploading ${pendingFiles.length} file(s) and running intake...`,
        bar: "Adding",
        terminal: [
          `[add-files] uploading ${pendingFiles.length} files`,
          label ? `[add-files] label: ${label}` : "[add-files] no label",
        ],
      });
      const formData = new FormData();
      formData.append("label", label);
      formData.append("paths", JSON.stringify(pendingFiles.map((item) => item.relativePath)));
      pendingFiles.forEach((item) => formData.append("files", item.file, item.file.name));
      const response = await fetch("/api/matters/add-files", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) {
        const err = new Error(payload.error || `add-files returned ${response.status}`);
        err.statusCode = response.status;
        throw err;
      }
      ctx.setActiveMatter(matterFromWorkspace(payload));
      const a = payload.intakeAdded;
      ctx.setStatus({
        mood: "success",
        card: `<strong>${escapeHtml(a.intakeId)} added</strong><br /><code>${escapeHtml(a.intakeDirName)}</code>: ${a.unique} new, ${a.duplicatesOfPrior} already in matter, ${a.duplicatesInBatch} in-batch dup.`,
        bar: "Intake Added",
        terminal: [
          `[add-files] created ${a.intakeId} (${a.intakeDirName})`,
          `[add-files] scanned ${a.scanned} files`,
          `[add-files] unique: ${a.unique}, dup-of-prior: ${a.duplicatesOfPrior}, dup-in-batch: ${a.duplicatesInBatch}`,
        ],
      });
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Add failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Add Failed",
        terminal: `[add-files] failed: ${error.message}`,
      });
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Add to matter";
    }
  });
}
