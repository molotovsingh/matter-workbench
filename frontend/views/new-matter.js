import { postFormData, postJson } from "../api-client.js";
import { escapeHtml, matterFromWorkspace } from "../dom-utils.js";
import {
  buildFileUploadFormData,
  collectFilesFromDataTransfer,
  collectFilesFromInput,
  hashCollectedFiles,
} from "../file-collection.js";
import { updateCollectedFileListElement } from "../file-list-view.js";
import { lawyerActionLabel } from "../lawyer-labels.js";

export function renderNewMatterForm(ctx) {
  const { breadcrumbs, editorContent } = ctx.elements;
  ctx.setActivityActive("explorer");
  breadcrumbs.textContent = "Home > New Matter";
  ctx.setStatus({
    mood: "idle",
    card: "<strong>New matter</strong><br />Fill in the basics, attach initial files or a folder, then click Create & Initialize.",
    bar: "New Matter",
    terminal: "[new-matter] form ready",
  });
  editorContent.innerHTML = `
    <section class="matter-intake-shell">
      <div class="matter-overview-hero matter-intake-hero">
        <div class="landing-kicker">New matter</div>
        <h1>New Matter</h1>
        <p>Fill in the basics and attach the first documents. More files can be added later.</p>
      </div>
      <form class="new-matter-form matter-intake-form" id="newMatterForm">
      <label class="matter-intake-field matter-intake-name">
        <span>Matter name *</span>
        <input type="text" id="nmName" required spellcheck="false" autocomplete="off" />
      </label>

      <section class="matter-intake-section" aria-labelledby="matterIntakeParties">
        <h2 id="matterIntakeParties">Parties</h2>
        <div class="matter-intake-grid">
          <label class="matter-intake-field">
            <span>Client name *</span>
            <input type="text" id="nmClient" required />
          </label>
          <label class="matter-intake-field">
            <span>Opposite party *</span>
            <input type="text" id="nmOpposite" required />
          </label>
        </div>
      </section>

      <section class="matter-intake-section" aria-labelledby="matterIntakeDetails">
        <h2 id="matterIntakeDetails">Matter details</h2>
        <div class="matter-intake-grid">
          <label class="matter-intake-field">
            <span>Matter type *</span>
            <input type="text" id="nmType" required />
          </label>
          <label class="matter-intake-field">
            <span>Jurisdiction *</span>
            <input type="text" id="nmJurisdiction" required />
          </label>
        </div>
        <label class="matter-intake-field">
          <span>Brief description</span>
          <textarea id="nmBrief"></textarea>
          <small>Include the dispute, key dates, forum, and what outcome the client wants.</small>
        </label>
      </section>

      <section class="matter-intake-section" aria-labelledby="matterIntakeFiles">
        <h2 id="matterIntakeFiles">Initial files</h2>
        <div class="drop-zone" id="nmDropZone">
        <div>Drag files or a folder here</div>
        <div class="drop-actions">
          <button type="button" id="nmPickFiles">Pick Files</button>
          <button type="button" id="nmPickFolder">Pick Folder</button>
        </div>
        <input type="file" id="nmFilesInput" multiple hidden />
        <input type="file" id="nmFolderInput" webkitdirectory multiple hidden />
        </div>
        <p class="matter-intake-hint">These files will be classified and indexed when the matter is prepared.</p>
      </section>
      <ul class="file-list" id="nmFileList" hidden></ul>
      <div id="nmOverlap" class="form-warning" hidden></div>
      <div class="form-actions">
        <button type="submit" id="nmSubmit">Create & Initialize</button>
        <button type="button" class="secondary" id="nmCancel">Cancel</button>
      </div>
      <div id="nmError" class="form-error" hidden></div>
      </form>
    </section>
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
    updateCollectedFileListElement(fileList, pendingFiles);
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
        const hashes = await hashCollectedFiles(pendingFiles);
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
        card: `<strong>Creating matter</strong><br />Uploading ${pendingFiles.length} file(s) and running ${lawyerActionLabel("/matter-init")}...`,
        bar: "Creating Matter",
        terminal: [
          `[new-matter] uploading ${pendingFiles.length} files`,
          `[new-matter] matter name: ${name}`,
        ],
      });

      const formData = buildFileUploadFormData(pendingFiles, {
        name,
        metadata: JSON.stringify(metadata),
      });
      const payload = await postFormData("/api/matters/new", formData);
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
        errorBox.innerHTML = `<strong>A matter named <code>${escapeHtml(name)}</code> already exists.</strong> Open it from Home search, or change the name above to create a new one.`;
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
          ? `<strong>Name in use</strong><br /><code>${escapeHtml(name)}</code> is already a matter. Pick it from Home or rename above.`
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
