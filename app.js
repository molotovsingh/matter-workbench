const commandForm = document.getElementById("commandForm");
const commandInput = document.getElementById("commandInput");
const statusCard = document.getElementById("statusCard");
const terminalOutput = document.getElementById("terminalOutput");
const editorContent = document.getElementById("editorContent");
const statusBarRight = document.getElementById("statusBarRight");
const metadataForm = document.getElementById("metadataForm");
const clientNameInput = document.getElementById("clientNameInput");
const matterNameInput = document.getElementById("matterNameInput");
const oppositePartyInput = document.getElementById("oppositePartyInput");
const matterTypeInput = document.getElementById("matterTypeInput");
const jurisdictionInput = document.getElementById("jurisdictionInput");
const briefDescriptionInput = document.getElementById("briefDescriptionInput");
const workspaceTree = document.getElementById("workspaceTree");
const refreshExplorerButton = document.getElementById("refreshExplorer");
const breadcrumbs = document.getElementById("breadcrumbs");
const mattersPicker = document.getElementById("mattersPicker");
const mattersList = document.getElementById("mattersList");
const newMatterButton = document.getElementById("newMatterButton");
const slashSkillButtons = document.querySelectorAll("[data-skill]");
const requiredMetadataFields = Array.from(metadataForm.querySelectorAll("[data-required='true']"));

let mattersState = { enabled: false, mattersHome: null, active: null, matters: [] };

let activeMatter = {
  folderName: "",
  inputLabel: "",
  fileCount: 0,
  directoryCount: 0,
  tree: null,
  metadata: {
    clientName: "",
    matterName: "",
    oppositeParty: "",
    matterType: "",
    jurisdiction: "",
    briefDescription: "",
  },
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus({ mood, card, bar, terminal }) {
  if (mood !== undefined) statusCard.className = `status-card ${mood}`;
  if (card !== undefined) statusCard.innerHTML = card;
  if (bar !== undefined) statusBarRight.innerHTML = `<span>${bar}</span>`;
  if (terminal !== undefined) {
    terminalOutput.textContent = Array.isArray(terminal) ? terminal.join("\n") : terminal;
  }
}

function renderTreeNode(node, depth = 0) {
  if (node.kind === "file") {
    const previewable = node.previewable ? "true" : "false";
    const meta = node.size === undefined ? "" : `<span class="tree-meta">${formatBytes(node.size)}</span>`;
    return `
      <li class="tree-node tree-file">
        <button
          class="tree-file-button"
          type="button"
          data-file-path="${escapeHtml(node.path)}"
          data-previewable="${previewable}"
        >
          <span class="tree-name">${escapeHtml(node.name)}</span>
          ${meta}
        </button>
      </li>
    `;
  }

  const children = node.children || [];
  const childItems = children.map((child) => renderTreeNode(child, depth + 1)).join("");
  const childCount = children.length ? `<span class="tree-meta">${children.length}</span>` : "";
  const truncated = node.truncated ? `<li class="tree-truncated">Directory output truncated</li>` : "";
  const open = depth < 2 || node.path === "00_Inbox/Intake 01 - Initial" ? " open" : "";

  return `
    <li class="tree-node tree-directory">
      <details${open}>
        <summary>
          <span class="tree-name">${escapeHtml(node.name)}${depth === 0 ? "" : "/"}</span>
          ${childCount}
        </summary>
        <ul>${childItems}${truncated}</ul>
      </details>
    </li>
  `;
}

const buildPreviewResultLines = (command) => [
  `> workbench.run ${command}`,
  `[intake] confirming matter root: ${activeMatter.inputLabel}`,
  `[intake] validating matter metadata: ${activeMatter.metadata.matterName}`,
  `[intake] scanned ${activeMatter.fileCount} files and ${activeMatter.directoryCount} folders`,
  "[intake] prototype mode: no files written",
  "[intake] would write matter.json",
  "[intake] would preserve originals under 00_Inbox/Intake 01 - Initial/Originals/",
  "[intake] would arrange copies under 00_Inbox/Intake 01 - Initial/By Type/",
  "[intake] would write Intake Log.csv and File Register.csv",
  "[intake] status: complete - intake ready for lawyer review",
];

function buildMatterJson() {
  const metadata = activeMatter.metadata;

  return {
    matter_id: activeMatter.folderName,
    matter_name: metadata.matterName,
    client_name: metadata.clientName,
    opposite_party: metadata.oppositeParty,
    matter_type: metadata.matterType,
    jurisdiction: metadata.jurisdiction,
    brief_description: metadata.briefDescription,
    source_root: activeMatter.inputLabel,
    phase: "phase_1_intake",
    intake_id: "INTAKE-01",
    intake: {
      scanned_files: activeMatter.fileCount,
      scanned_folders: activeMatter.directoryCount,
      preserve_originals_at: "00_Inbox/Intake 01 - Initial/Originals",
      arrange_working_copies_at: "00_Inbox/Intake 01 - Initial/By Type",
      review_logs: [
        "00_Inbox/Intake 01 - Initial/Intake Log.csv",
        "00_Inbox/Intake 01 - Initial/File Register.csv",
      ],
    },
  };
}

function renderWorkspaceTree() {
  if (activeMatter.tree) {
    workspaceTree.innerHTML = renderTreeNode(activeMatter.tree);
    return;
  }
  workspaceTree.innerHTML = '<li class="tree-node">Loading workspace...</li>';
}

function renderSkillOverview() {
  editorContent.innerHTML = `
    <h1>/matter-init</h1>
    <p>
      Intake slash skill for turning the open matter folder into a preserved,
      normalized, review-ready workspace.
    </p>
    <dl class="skill-contract">
      <div>
        <dt>Input</dt>
        <dd><code>${escapeHtml(activeMatter.inputLabel)}</code></dd>
      </div>
      <div>
        <dt>Loaded</dt>
        <dd>${activeMatter.fileCount} files and ${activeMatter.directoryCount} folders visible to the browser</dd>
      </div>
      <div>
        <dt>Metadata</dt>
        <dd>${escapeHtml(activeMatter.metadata.clientName || "Client not set")} v. ${escapeHtml(activeMatter.metadata.oppositeParty || "Opposite party not set")}</dd>
      </div>
      <div>
        <dt>Output</dt>
        <dd>matter.json preview, Originals, By Type, intake logs</dd>
      </div>
      <div>
        <dt>Guardrail</dt>
        <dd>original source remains untouched; ambiguity goes to lawyer review</dd>
      </div>
    </dl>
  `;
}

function collectMetadata() {
  return {
    clientName: clientNameInput.value.trim(),
    matterName: matterNameInput.value.trim(),
    oppositeParty: oppositePartyInput.value.trim(),
    matterType: matterTypeInput.value.trim(),
    jurisdiction: jurisdictionInput.value.trim(),
    briefDescription: briefDescriptionInput.value.trim(),
  };
}

function setMetadataInputs(metadata) {
  clientNameInput.value = metadata.clientName || "";
  matterNameInput.value = metadata.matterName || "";
  oppositePartyInput.value = metadata.oppositeParty || "";
  matterTypeInput.value = metadata.matterType || "";
  jurisdictionInput.value = metadata.jurisdiction || "";
  briefDescriptionInput.value = metadata.briefDescription || "";
}

function syncMetadataFromForm() {
  activeMatter.metadata = collectMetadata();
  renderSkillOverview();
  renderWorkspaceTree();
}

function metadataFromMatterJson(rawMatter, fallbackName = "") {
  return {
    clientName: rawMatter.client_name || "",
    matterName: rawMatter.matter_name || fallbackName,
    oppositeParty: rawMatter.opposite_party || "",
    matterType: rawMatter.matter_type || "",
    jurisdiction: rawMatter.jurisdiction || "",
    briefDescription: rawMatter.brief_description || "",
  };
}

function validateMetadata() {
  const missing = [];

  requiredMetadataFields.forEach((field) => {
    field.classList.remove("field-error");
    if (!field.value.trim()) {
      field.classList.add("field-error");
      missing.push(field.previousElementSibling.textContent);
    }
  });

  return missing;
}

function setActiveMatter(nextMatter, options = {}) {
  activeMatter = { ...activeMatter, ...nextMatter };
  if (nextMatter.metadata) {
    setMetadataInputs(activeMatter.metadata);
  }
  breadcrumbs.textContent = `${activeMatter.folderName} > /matter-init`;
  commandInput.value = "/matter-init";
  if (!options.preserveStatus) {
    setStatus({
      mood: "idle",
      card: "Folder loaded. Complete matter metadata, then run <code>/matter-init</code>",
      bar: "Folder Loaded",
      terminal: [
        `[folder] loaded ${activeMatter.inputLabel}`,
        `[folder] visible scan: ${activeMatter.fileCount} files, ${activeMatter.directoryCount} folders`,
        "[idle] Complete metadata, then type /matter-init and run the skill.",
      ],
    });
  }
  renderWorkspaceTree();
  if (!options.preserveEditor) renderSkillOverview();
}

function matterFromWorkspace(workspace) {
  return {
    name: workspace.metadata.matterName || workspace.folderName,
    folderName: workspace.folderName,
    inputLabel: workspace.inputLabel,
    fileCount: workspace.fileCount,
    directoryCount: workspace.directoryCount,
    tree: workspace.tree,
    metadata: workspace.metadata,
  };
}

async function refreshWorkspace(options = {}) {
  if (!options.silent) {
    statusBarRight.innerHTML = "<span>Refreshing Explorer</span>";
  }

  try {
    const response = await fetch("/api/workspace");
    if (!response.ok) throw new Error(`workspace API returned ${response.status}`);
    const workspace = await response.json();
    setActiveMatter(matterFromWorkspace(workspace), {
      preserveStatus: options.preserveStatus,
      preserveEditor: options.preserveEditor,
    });
    if (!options.preserveStatus) {
      setStatus({
        mood: "idle",
        card: `<strong>Explorer refreshed</strong><br />${workspace.fileCount} files and ${workspace.directoryCount} folders loaded from disk.`,
        bar: "Explorer Ready",
        terminal: [
          `[explorer] loaded ${workspace.inputLabel}`,
          `[explorer] indexed ${workspace.fileCount} files and ${workspace.directoryCount} folders`,
        ],
      });
    }
    return workspace;
  } catch (error) {
    setStatus({
      mood: "idle",
      card: `<strong>Explorer unavailable</strong><br />${escapeHtml(error.message)}`,
      bar: "Explorer Failed",
      terminal: `[explorer] failed: ${error.message}`,
    });
    renderWorkspaceTree();
    return null;
  }
}

function renderMattersList() {
  if (!mattersState.enabled) {
    mattersPicker.hidden = true;
    mattersList.innerHTML = "";
    return;
  }
  mattersPicker.hidden = false;
  if (!mattersState.matters.length) {
    mattersList.innerHTML = '<li class="matters-empty">No matters yet. Click + New Matter to add your first.</li>';
    return;
  }
  mattersList.innerHTML = mattersState.matters.map((matter) => {
    const activeClass = matter.name === mattersState.active ? " active" : "";
    return `<li><button type="button" class="matters-entry${activeClass}" data-matter-name="${escapeHtml(matter.name)}">${escapeHtml(matter.name)}</button></li>`;
  }).join("");
}

async function loadMattersList() {
  try {
    const response = await fetch("/api/matters");
    if (!response.ok) throw new Error(`matters API returned ${response.status}`);
    mattersState = await response.json();
  } catch {
    mattersState = { enabled: false, mattersHome: null, active: null, matters: [] };
  }
  renderMattersList();
}

async function switchToMatter(name) {
  setStatus({
    mood: "idle",
    card: `<strong>Switching matter</strong><br />Loading <code>${escapeHtml(name)}</code>...`,
    bar: "Switching Matter",
    terminal: `[matters] switching to ${name}`,
  });
  try {
    const response = await fetch("/api/switch-matter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `switch-matter returned ${response.status}`);
    mattersState = { ...mattersState, active: name };
    renderMattersList();
    setActiveMatter(matterFromWorkspace(payload));
  } catch (error) {
    setStatus({
      mood: "idle",
      card: `<strong>Switch failed</strong><br />${escapeHtml(error.message)}`,
      bar: "Switch Failed",
      terminal: `[matters] switch failed: ${error.message}`,
    });
  }
}

function renderFirstRun(defaultPath) {
  breadcrumbs.textContent = "first run";
  setStatus({
    mood: "idle",
    card: "<strong>First run</strong><br />Pick where your matters should live.",
    bar: "First Run",
    terminal: "[first-run] awaiting matters home selection",
  });
  editorContent.innerHTML = `
    <h1>Where should your matters live?</h1>
    <p>
      This is the parent folder where each new matter becomes a subfolder.
      You can change it later by editing <code>config.json</code>.
    </p>
    <form class="first-run-form" id="firstRunForm">
      <label>
        <span>Matters home (absolute path)</span>
        <input type="text" id="firstRunInput" value="${escapeHtml(defaultPath || "")}" spellcheck="false" autocomplete="off" />
      </label>
      <div class="form-actions">
        <button type="submit">Continue</button>
      </div>
      <div id="firstRunError" class="form-error" hidden></div>
    </form>
  `;
  const form = document.getElementById("firstRunForm");
  const input = document.getElementById("firstRunInput");
  const errorBox = document.getElementById("firstRunError");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const value = input.value.trim();
    if (!value) {
      errorBox.textContent = "Please enter a path.";
      errorBox.hidden = false;
      return;
    }
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mattersHome: value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `config API returned ${response.status}`);
      await bootstrap();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  });
  input.focus();
  input.select();
}

function renderBlankLanding() {
  activeMatter = {
    folderName: "",
    inputLabel: "",
    fileCount: 0,
    directoryCount: 0,
    tree: null,
    metadata: {
      clientName: "",
      matterName: "",
      oppositeParty: "",
      matterType: "",
      jurisdiction: "",
      briefDescription: "",
    },
  };
  setMetadataInputs(activeMatter.metadata);
  workspaceTree.innerHTML = '<li class="tree-node">Pick a matter from the sidebar.</li>';
  breadcrumbs.textContent = "workbench > pick a matter";
  const hasMatters = mattersState.matters.length > 0;
  editorContent.innerHTML = `
    <h1>Welcome</h1>
    <p>
      ${hasMatters
        ? `You have <strong>${mattersState.matters.length}</strong> matter${mattersState.matters.length === 1 ? "" : "s"} available. Pick one from the sidebar to open it, or click <code>+ New Matter</code> to add a new one.`
        : "No matters yet. Click <code>+ New Matter</code> in the sidebar to create your first."}
    </p>
    <p>Matters home: <code>${escapeHtml(mattersState.mattersHome || "")}</code></p>
  `;
  setStatus({
    mood: "idle",
    card: hasMatters
      ? "<strong>Ready</strong><br />Pick a matter or create a new one."
      : "<strong>Ready</strong><br />Create your first matter to begin.",
    bar: "No Matter",
    terminal: [
      "[landing] no active matter",
      `[landing] ${mattersState.matters.length} matter(s) available`,
    ],
  });
}

function collectFilesFromDataTransfer(dataTransfer) {
  const entries = [];
  const items = dataTransfer.items;
  if (!items) return Promise.resolve([]);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind === "file") {
      const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
  }
  return Promise.all(entries.map((entry) => walkFileSystemEntry(entry, ""))).then((results) => results.flat());
}

function walkFileSystemEntry(entry, prefix) {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file((file) => {
        const relativePath = prefix ? `${prefix}/${file.name}` : file.name;
        resolve([{ file, relativePath }]);
      }, reject);
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const collected = [];
      const readBatch = () => {
        reader.readEntries(async (batch) => {
          if (!batch.length) {
            const nested = await Promise.all(collected.map((child) => walkFileSystemEntry(child, prefix ? `${prefix}/${entry.name}` : entry.name)));
            resolve(nested.flat());
            return;
          }
          collected.push(...batch);
          readBatch();
        }, reject);
      };
      readBatch();
      return;
    }
    resolve([]);
  });
}

async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function collectFilesFromInput(input) {
  const result = [];
  const files = Array.from(input.files || []);
  for (const file of files) {
    const raw = file.webkitRelativePath || file.name;
    const parts = raw.split("/");
    const relativePath = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
    result.push({ file, relativePath });
  }
  return result;
}

function renderNewMatterForm() {
  breadcrumbs.textContent = "workbench > new matter";
  setStatus({
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
    document.getElementById("nmOpenExisting").addEventListener("click", () => switchToMatter(top.matterName));
    document.getElementById("nmContinueAnyway").addEventListener("click", () => {
      bypassOverlapCheck = true;
      overlapBox.hidden = true;
      overlapBox.innerHTML = "";
      document.getElementById("nmSubmit").focus();
    });
    setStatus({
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
    if (activeMatter.folderName) {
      renderSkillOverview();
      setStatus({
        mood: "idle",
        card: `Back on <code>${escapeHtml(activeMatter.folderName)}</code>.`,
        bar: "Skill Ready",
        terminal: `[matter] returned to ${activeMatter.folderName}`,
      });
      return;
    }
    if (mattersState.matters.length === 1) {
      switchToMatter(mattersState.matters[0].name);
      return;
    }
    renderBlankLanding();
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
        setStatus({
          mood: "idle",
          card: `<strong>Checking for duplicates</strong><br />Hashing ${pendingFiles.length} file(s) to compare with existing matters...`,
          bar: "Checking",
          terminal: `[new-matter] hashing ${pendingFiles.length} files for duplicate check`,
        });
        const hashes = [];
        for (const item of pendingFiles) {
          hashes.push(await hashFile(item.file));
        }
        const checkResponse = await fetch("/api/matters/check-overlap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hashes, proposedName: name }),
        });
        const checkPayload = await checkResponse.json();
        if (!checkResponse.ok) {
          throw new Error(checkPayload.error || `check-overlap returned ${checkResponse.status}`);
        }
        if (checkPayload.warnings && checkPayload.warnings.length) {
          renderOverlapWarnings(checkPayload.warnings);
          submitButton.disabled = false;
          submitButton.textContent = "Create & Initialize";
          return;
        }
      }

      submitButton.textContent = "Creating...";
      setStatus({
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
      await loadMattersList();
      setActiveMatter(matterFromWorkspace(payload));
      setStatus({
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
      setStatus({
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

function renderMatterInitResult(result, modeLabel) {
  const matterJson = result.matterJson || buildMatterJson();
  const counts = result.counts || {
    scannedFiles: activeMatter.fileCount,
    uniqueFiles: activeMatter.fileCount,
    duplicateFiles: 0,
  };
  const paths = result.paths || {
    sourceDir: "00_Inbox/Intake 01 - Initial/Source Files",
    originalsDir: "00_Inbox/Intake 01 - Initial/Originals",
    byTypeDir: "00_Inbox/Intake 01 - Initial/By Type",
    intakeLogPath: "00_Inbox/Intake 01 - Initial/Intake Log.csv",
    fileRegisterPath: "00_Inbox/Intake 01 - Initial/File Register.csv",
  };

  setStatus({
    mood: "success",
    card: `<strong>matter-init ${escapeHtml(modeLabel)} complete</strong><br />${counts.scannedFiles} files scanned, ${counts.duplicateFiles} exact duplicates identified.`,
    bar: "Skill Complete",
    terminal: result.outputLines || buildPreviewResultLines("/matter-init"),
  });
  editorContent.innerHTML = `
    <h1>/matter-init result</h1>
    <p>
      The intake slash skill completed the deterministic copy-only pass for
      ${escapeHtml(activeMatter.metadata.matterName)} while keeping source material untouched.
    </p>
    <dl class="skill-contract">
      <div>
        <dt>Matter</dt>
        <dd>${escapeHtml(activeMatter.metadata.clientName)} v. ${escapeHtml(activeMatter.metadata.oppositeParty)}</dd>
      </div>
      <div>
        <dt>Scanned</dt>
        <dd>${counts.scannedFiles} files, ${counts.uniqueFiles} unique, ${counts.duplicateFiles} exact duplicates</dd>
      </div>
      <div>
        <dt>Staged</dt>
        <dd>${counts.looseRootFilesStaged || 0} loose root files copied into <code>${escapeHtml(paths.sourceDir)}</code></dd>
      </div>
      <div>
        <dt>Preserved</dt>
        <dd>Originals copied under <code>${escapeHtml(paths.originalsDir)}</code></dd>
      </div>
      <div>
        <dt>Arranged</dt>
        <dd>Working copies grouped under <code>${escapeHtml(paths.byTypeDir)}</code> by file type</dd>
      </div>
      <div>
        <dt>Reported</dt>
        <dd><code>${escapeHtml(paths.intakeLogPath)}</code> and <code>${escapeHtml(paths.fileRegisterPath)}</code></dd>
      </div>
    </dl>
    <h2>matter.json</h2>
    <pre class="json-preview">${escapeHtml(JSON.stringify(matterJson, null, 2))}</pre>
  `;
}

async function openFilePreview(filePath, previewable) {
  if (previewable !== "true") {
    breadcrumbs.textContent = `${activeMatter.folderName} > ${filePath}`;
    setStatus({
      mood: "idle",
      card: "<strong>Preview unavailable</strong><br />This file type is listed in the explorer but is not opened as text.",
      bar: "File Selected",
      terminal: `[explorer] selected ${filePath}`,
    });
    return;
  }

  statusBarRight.innerHTML = "<span>Opening File</span>";

  try {
    const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `file API returned ${response.status}`);

    breadcrumbs.textContent = `${activeMatter.folderName} > ${result.path}`;
    setStatus({
      mood: "idle",
      card: `<strong>Previewing file</strong><br /><code>${escapeHtml(result.path)}</code>`,
      bar: "File Preview",
      terminal: `[explorer] opened ${result.path}`,
    });
    editorContent.innerHTML = `
      <h1>${escapeHtml(result.name)}</h1>
      <p><code>${escapeHtml(result.path)}</code></p>
      <pre class="json-preview">${escapeHtml(result.content)}</pre>
    `;
  } catch (error) {
    setStatus({
      mood: "idle",
      card: `<strong>Preview failed</strong><br />${escapeHtml(error.message)}`,
      bar: "Preview Failed",
      terminal: `[explorer] preview failed for ${filePath}: ${error.message}`,
    });
  }
}

async function runMatterInit(command) {
  syncMetadataFromForm();
  const missingMetadata = validateMetadata();

  if (missingMetadata.length) {
    setStatus({
      mood: "idle",
      card: `<strong>Metadata required</strong><br />Missing: ${escapeHtml(missingMetadata.join(", "))}`,
      bar: "Metadata Missing",
      terminal: [
        `> workbench.run ${command}`,
        "[phase-1] blocked: required matter metadata is incomplete",
        `[phase-1] missing: ${missingMetadata.join(", ")}`,
      ],
    });
    return;
  }

  setStatus({
    mood: "idle",
    card: "<strong>Running matter-init</strong><br />Hashing, preserving, arranging, and writing review logs.",
    bar: "Running Skill",
    terminal: [
      `> workbench.run ${command}`,
      "[phase-1] running deterministic local intake...",
    ],
  });

  try {
    const response = await fetch("/api/matter-init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metadata: activeMatter.metadata }),
    });

    if (!response.ok) throw new Error(`matter-init API returned ${response.status}`);

    const result = await response.json();
    activeMatter.fileCount = result.counts.scannedFiles;
    renderMatterInitResult(result, "write");
    await refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
  } catch (error) {
    renderMatterInitResult({
      matterJson: buildMatterJson(),
      outputLines: [
        ...buildPreviewResultLines(command),
        `[phase-1] local write API unavailable: ${error.message}`,
      ],
    }, "preview");
  }
}

function rejectUnknownSkill(command) {
  setStatus({
    mood: "idle",
    card: `<strong>Unknown slash skill</strong><br /><code>${command || "(empty)"}</code> is not active in Phase 1.`,
    bar: "Skill Not Found",
    terminal: [
      `> workbench.run ${command || "(empty)"}`,
      "[phase-1] rejected: only /matter-init is active in this prototype",
    ],
  });
}

commandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();

  if (command === "/matter-init") {
    runMatterInit(command);
    return;
  }

  rejectUnknownSkill(command);
});

refreshExplorerButton.addEventListener("click", () => refreshWorkspace());

workspaceTree.addEventListener("click", (event) => {
  const fileButton = event.target.closest("[data-file-path]");
  if (!fileButton) return;
  openFilePreview(fileButton.dataset.filePath, fileButton.dataset.previewable);
});

mattersList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-matter-name]");
  if (!button) return;
  const name = button.dataset.matterName;
  if (!name || name === mattersState.active) return;
  switchToMatter(name);
});

newMatterButton.addEventListener("click", renderNewMatterForm);

slashSkillButtons.forEach((button) => {
  button.addEventListener("click", () => {
    commandInput.value = button.dataset.skill;
    commandInput.focus();
    commandInput.select();
    setStatus({
      mood: "idle",
      card: "Ready to run <code>/matter-init</code>",
      bar: "Skill Ready",
    });
  });
});

metadataForm.addEventListener("input", () => {
  requiredMetadataFields.forEach((field) => {
    if (field.value.trim()) field.classList.remove("field-error");
  });
  syncMetadataFromForm();
  setStatus({
    mood: "idle",
    card: "Metadata changed. Run <code>/matter-init</code> to refresh the preview.",
    bar: "Skill Ready",
    terminal: "[idle] Metadata changed. Run /matter-init to refresh the intake preview.",
  });
});

setMetadataInputs(activeMatter.metadata);
renderWorkspaceTree();

async function bootstrap() {
  let config;
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`config API returned ${response.status}`);
    config = await response.json();
  } catch (error) {
    setStatus({
      mood: "idle",
      card: `<strong>Server unreachable</strong><br />${escapeHtml(error.message)}`,
      bar: "Server Failed",
      terminal: `[bootstrap] ${error.message}`,
    });
    return;
  }
  if (!config.mattersHome) {
    renderFirstRun(config.defaultMattersHome);
    return;
  }
  await loadMattersList();
  if (config.hasActiveMatter) {
    await refreshWorkspace({ silent: true });
    return;
  }
  if (mattersState.matters.length === 1) {
    await switchToMatter(mattersState.matters[0].name);
    return;
  }
  renderBlankLanding();
}

bootstrap();
