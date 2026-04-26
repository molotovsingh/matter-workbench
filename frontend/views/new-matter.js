import { postJson } from "../api-client.js";
import { escapeHtml, formatBytes, matterFromWorkspace } from "../dom-utils.js";
import { collectFilesFromDataTransfer, collectFilesFromInput, hashFile } from "../file-collection.js";

export function renderNewMatterForm(ctx) {
  const { breadcrumbs, editorContent } = ctx.elements;
  ctx.setActivityActive("explorer");
  breadcrumbs.textContent = "workbench > new matter";
  ctx.setStatus({
    mood: "idle",
    card: "<strong>New matter</strong><br />Fill the form, attach files or a folder, then click Create & Initialize.",
    bar: "New Matter",
    terminal: "[new-matter] form ready",
  });
  editorContent.innerHTML = `
    <h1>New matter</h1>
    <form class="new-matter-form" id="newMatterForm">
      <label>
        <span>Matter name *</span>
        <input type="text" id="nmName" required spellcheck="false" autocomplete="off" />
      </label>
      <label>
        <span>Client name *</span>
        <input type="text" id="nmClient" required />
      </label>
      <label>
        <span>Opposite party *</span>
        <input type="text" id="nmOpposite" required />
      </label>
      <label>
        <span>Matter type *</span>
        <input type="text" id="nmType" required />
      </label>
      <label>
        <span>Jurisdiction *</span>
        <input type="text" id="nmJurisdiction" required />
      </label>
      <label>
        <span>Brief description</span>
        <textarea id="nmBrief"></textarea>
      </label>
      <div class="drop-zone" id="nmDropZone">
        <div>Drag files or a folder here</div>
        <div class="drop-actions">
          <button type="button" id="nmPickFiles">Pick Files</button>
          <button type="button" id="nmPickFolder">Pick Folder</button>
        </div>
        <input type="file" id="nmFilesInput" multiple hidden />
        <input type="file" id="nmFolderInput" webkitdirectory multiple hidden />
      </div>
      <ul class="file-list" id="nmFileList" hidden></ul>
      <div id="nmOverlap" class="form-warning" hidden></div>
      <div class="form-actions">
        <button type="submit" id="nmSubmit">Create & Initialize</button>
        <button type="button" class="secondary" id="nmCancel">Cancel</button>
      </div>
      <div id="nmError" class="form-error" hidden></div>
    </form>
  `;

  let pendingFiles = [];
  let bypassOverlapCheck = false;
  const dropZone = document.getElementById("nmDropZone");
  const filesInput = document.getElementById("nmFilesInput");
  const folderInput = document.getElementById("nmFolderInput");
  const fileList = document.getElementById("nmFileList");
  const errorBox = document.getElementById("nmError");
  const submitButton = document.getElementById("nmSubmit");
  const overlapBox = document.getElementById("nmOverlap");

  const resetOverlapState = () => {
    bypassOverlapCheck = false;
    overlapBox.hidden = true;
    overlapBox.innerHTML = "";
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

  function renderOverlapWarnings(warnings) {
    const top = warnings[0];
    const list = warnings.map((w) => (
      `<li><strong>${escapeHtml(w.matterName)}</strong>: ${w.overlapCount} of ${w.totalIncoming} file${w.totalIncoming === 1 ? "" : "s"} match (${w.overlapPercent}%)</li>`
    )).join("");
    overlapBox.innerHTML = `
      <strong>Possible duplicate matter.</strong>
      Your selected files overlap with existing matter${warnings.length > 1 ? "s" : ""}:
      <ul class="overlap-list">${list}</ul>
      <div class="warning-actions">
        <button type="button" id="nmOpenExisting">Open ${escapeHtml(top.matterName)}</button>
        <button type="button" id="nmContinueAnyway" class="secondary">Continue creating new matter</button>
      </div>
    `;
    overlapBox.hidden = false;
    document.getElementById("nmOpenExisting").addEventListener("click", () => ctx.switchToMatter(top.matterName));
    document.getElementById("nmContinueAnyway").addEventListener("click", () => {
      bypassOverlapCheck = true;
      overlapBox.hidden = true;
      overlapBox.innerHTML = "";
      document.getElementById("nmSubmit").focus();
    });
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Possible duplicate</strong><br />Files match existing matter <code>${escapeHtml(top.matterName)}</code> (${top.overlapPercent}%).`,
      bar: "Possible Duplicate",
      terminal: warnings.map((w) => `[duplicate-check] ${w.matterName}: ${w.overlapCount}/${w.totalIncoming} match (${w.overlapPercent}%)`),
    });
  }

  document.getElementById("nmPickFiles").addEventListener("click", () => filesInput.click());
  document.getElementById("nmPickFolder").addEventListener("click", () => folderInput.click());
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

  document.getElementById("nmCancel").addEventListener("click", () => {
    const activeMatter = ctx.getActiveMatter();
    const mattersState = ctx.getMattersState();
    if (activeMatter.folderName) {
      ctx.renderSkillOverview();
      ctx.setStatus({
        mood: "idle",
        card: `Back on <code>${escapeHtml(activeMatter.folderName)}</code>.`,
        bar: "Skill Ready",
        terminal: `[matter] returned to ${activeMatter.folderName}`,
      });
      return;
    }
    if (mattersState.matters.length === 1) {
      ctx.switchToMatter(mattersState.matters[0].name);
      return;
    }
    ctx.renderBlankLanding();
  });

  document.getElementById("newMatterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const name = document.getElementById("nmName").value.trim();
    const metadata = {
      clientName: document.getElementById("nmClient").value.trim(),
      matterName: name,
      oppositeParty: document.getElementById("nmOpposite").value.trim(),
      matterType: document.getElementById("nmType").value.trim(),
      jurisdiction: document.getElementById("nmJurisdiction").value.trim(),
      briefDescription: document.getElementById("nmBrief").value.trim(),
    };
    if (!name) {
      errorBox.textContent = "Matter name is required.";
      errorBox.hidden = false;
      return;
    }
    if (!pendingFiles.length) {
      errorBox.textContent = "Attach at least one file or a folder.";
      errorBox.hidden = false;
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Creating...";

    try {
      if (!bypassOverlapCheck) {
        submitButton.textContent = "Checking for duplicates...";
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Checking for duplicates</strong><br />Hashing ${pendingFiles.length} file(s) to compare with existing matters...`,
          bar: "Checking",
          terminal: `[new-matter] hashing ${pendingFiles.length} files for duplicate check`,
        });
        const hashes = [];
        for (const item of pendingFiles) hashes.push(await hashFile(item.file));
        const checkPayload = await postJson("/api/matters/check-overlap", { hashes, proposedName: name });
        if (checkPayload.warnings && checkPayload.warnings.length) {
          renderOverlapWarnings(checkPayload.warnings);
          submitButton.disabled = false;
          submitButton.textContent = "Create & Initialize";
          return;
        }
      }

      submitButton.textContent = "Creating...";
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Creating matter</strong><br />Uploading ${pendingFiles.length} file(s) and running /matter-init...`,
        bar: "Creating Matter",
        terminal: [
          `[new-matter] uploading ${pendingFiles.length} files`,
          `[new-matter] matter name: ${name}`,
        ],
      });

      const formData = new FormData();
      formData.append("name", name);
      formData.append("metadata", JSON.stringify(metadata));
      formData.append("paths", JSON.stringify(pendingFiles.map((item) => item.relativePath)));
      pendingFiles.forEach((item) => formData.append("files", item.file, item.file.name));
      const response = await fetch("/api/matters/new", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.error || `matters/new returned ${response.status}`);
        error.statusCode = response.status;
        throw error;
      }
      await ctx.loadMattersList();
      ctx.setActiveMatter(matterFromWorkspace(payload));
      ctx.setStatus({
        mood: "success",
        card: `<strong>Matter created</strong><br /><code>${escapeHtml(name)}</code> is ready.`,
        bar: "Matter Created",
        terminal: [
          `[new-matter] created ${name}`,
          `[new-matter] scanned ${payload.fileCount} files, ${payload.directoryCount} folders`,
        ],
      });
    } catch (error) {
      const isDuplicate = error.statusCode === 409 && /already exists/i.test(error.message);
      if (isDuplicate) {
        errorBox.innerHTML = `<strong>A matter named <code>${escapeHtml(name)}</code> already exists.</strong> Open it from the Matters list in the sidebar, or change the name above to create a new one.`;
      } else {
        errorBox.textContent = error.message;
      }
      errorBox.hidden = false;
      const nameInput = document.getElementById("nmName");
      nameInput.focus();
      nameInput.select();
      ctx.setStatus({
        mood: "idle",
        card: isDuplicate
          ? `<strong>Name in use</strong><br /><code>${escapeHtml(name)}</code> is already a matter. Pick it from the sidebar or rename above.`
          : `<strong>Create failed</strong><br />${escapeHtml(error.message)}`,
        bar: isDuplicate ? "Name In Use" : "Create Failed",
        terminal: `[new-matter] ${isDuplicate ? "name in use" : "failed"}: ${error.message}`,
      });
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Create & Initialize";
    }
  });
}
