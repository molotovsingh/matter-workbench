const terminalOutput = document.getElementById("terminalOutput");
const editorContent = document.getElementById("editorContent");
const statusBarRight = document.getElementById("statusBarRight");
const workspaceTree = document.getElementById("workspaceTree");
const refreshExplorerButton = document.getElementById("refreshExplorer");
const addFilesButton = document.getElementById("addFilesButton");
const breadcrumbs = document.getElementById("breadcrumbs");
const mattersPicker = document.getElementById("mattersPicker");
const mattersList = document.getElementById("mattersList");
const newMatterButton = document.getElementById("newMatterButton");
const activityExplorer = document.getElementById("activityExplorer");
const activitySettings = document.getElementById("activitySettings");

function setActivityActive(which) {
  activityExplorer.classList.toggle("active", which !== "settings");
  activitySettings.classList.toggle("active", which === "settings");
}
const slashSkillButtons = document.querySelectorAll("[data-skill]");
const REQUIRED_METADATA = [
  { key: "clientName", label: "Client name" },
  { key: "matterName", label: "Matter name" },
  { key: "oppositeParty", label: "Opposite party" },
  { key: "matterType", label: "Matter type" },
  { key: "jurisdiction", label: "Jurisdiction" },
];
const TERMINAL_LINE_CAP = 500;

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

function setStatus({ bar, terminal } = {}) {
  if (bar !== undefined) statusBarRight.innerHTML = `<span>${bar}</span>`;
  if (terminal !== undefined) appendTerminal(terminal);
}

function appendTerminal(lines) {
  const incoming = Array.isArray(lines) ? lines : [lines];
  if (!incoming.length) return;
  const stamp = new Date().toLocaleTimeString([], { hour12: false });
  const stamped = incoming.map((line) => `${stamp} ${line}`);
  const existing = terminalOutput.textContent ? terminalOutput.textContent.split("\n") : [];
  const combined = existing.concat(stamped);
  const trimmed = combined.length > TERMINAL_LINE_CAP
    ? combined.slice(combined.length - TERMINAL_LINE_CAP)
    : combined;
  terminalOutput.textContent = trimmed.join("\n");
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function renderTreeNode(node, depth = 0) {
  if (node.kind === "file") {
    const previewable = node.previewable ? "true" : "false";
    const previewKind = node.previewKind || "";
    const meta = node.size === undefined ? "" : `<span class="tree-meta">${formatBytes(node.size)}</span>`;
    return `
      <li class="tree-node tree-file">
        <button
          class="tree-file-button"
          type="button"
          data-file-path="${escapeHtml(node.path)}"
          data-previewable="${previewable}"
          data-preview-kind="${escapeHtml(previewKind)}"
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
  setActivityActive("explorer");
  const meta = activeMatter.metadata || {};
  const fmt = (value, fallback) => escapeHtml(value && value.trim() ? value : fallback);
  const missing = validateMetadata();
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

    <div class="form-actions">
      <button type="button" class="run-skill-button" id="runMatterInitButton" ${missing.length ? "disabled" : ""}>Run /matter-init</button>
      <button type="button" class="run-skill-button secondary" id="runDoctorButton">Run /doctor</button>
    </div>
  `;

  const runInitButton = document.getElementById("runMatterInitButton");
  if (runInitButton) {
    runInitButton.addEventListener("click", () => runMatterInit("/matter-init"));
  }
  const runDoctorButton = document.getElementById("runDoctorButton");
  if (runDoctorButton) {
    runDoctorButton.addEventListener("click", () => runDoctor("/doctor"));
  }
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
  const meta = activeMatter.metadata || {};
  return REQUIRED_METADATA
    .filter(({ key }) => !(meta[key] && meta[key].trim()))
    .map(({ label }) => label);
}

function setActiveMatter(nextMatter, options = {}) {
  activeMatter = { ...activeMatter, ...nextMatter };
  if (addFilesButton) addFilesButton.hidden = !activeMatter.folderName;
  breadcrumbs.textContent = activeMatter.folderName
    ? `${activeMatter.folderName} > overview`
    : "workbench";
  if (!options.preserveStatus) {
    setStatus({
      bar: "Matter Loaded",
      terminal: [
        `[folder] loaded ${activeMatter.inputLabel}`,
        `[folder] visible scan: ${activeMatter.fileCount} files, ${activeMatter.directoryCount} folders`,
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

function renderSettings() {
  setActivityActive("settings");
  breadcrumbs.textContent = "settings";
  setStatus({
    mood: "idle",
    card: "<strong>Settings</strong>",
    bar: "Settings",
    terminal: "[settings] viewing",
  });
  const currentHome = mattersState.mattersHome || "";
  editorContent.innerHTML = `
    <h1>Settings</h1>
    <h2>Matters home</h2>
    <p>The folder where your matters live. Each subfolder under this path is one matter.</p>
    <form class="new-matter-form" id="settingsForm">
      <label>
        <span>Path</span>
        <input type="text" id="settingsMattersHome" value="${escapeHtml(currentHome)}" spellcheck="false" autocomplete="off" />
      </label>
      <p style="color:#9aa0a6;font-size:12px;">Changing this reloads the matters list. Existing matters at the old location are untouched on disk; they just stop appearing in the sidebar until you point back at that folder.</p>
      <div class="form-actions">
        <button type="submit" id="settingsSubmit">Save</button>
        <button type="button" class="secondary" id="settingsCancel">Cancel</button>
      </div>
      <div id="settingsError" class="form-error" hidden></div>
    </form>
  `;
  const form = document.getElementById("settingsForm");
  const input = document.getElementById("settingsMattersHome");
  const errorBox = document.getElementById("settingsError");
  const submit = document.getElementById("settingsSubmit");
  document.getElementById("settingsCancel").addEventListener("click", goToExplorer);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const value = input.value.trim();
    if (!value) {
      errorBox.textContent = "Path is required.";
      errorBox.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = "Saving...";
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mattersHome: value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `config returned ${response.status}`);
      await bootstrap();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      submit.disabled = false;
      submit.textContent = "Save";
    }
  });
}

function goToExplorer() {
  setActivityActive("explorer");
  if (activeMatter.folderName) {
    renderSkillOverview();
  } else {
    renderBlankLanding();
  }
}

function renderFirstRun(defaultPath) {
  setActivityActive("explorer");
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
  setActivityActive("explorer");
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
  if (addFilesButton) addFilesButton.hidden = true;
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
  setActivityActive("explorer");
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

function renderAddFilesForm() {
  setActivityActive("explorer");
  if (!activeMatter.folderName) {
    setStatus({
      mood: "idle",
      card: "<strong>No matter loaded</strong><br />Pick a matter from the sidebar before adding files.",
      bar: "No Matter",
    });
    return;
  }
  breadcrumbs.textContent = `${activeMatter.folderName} > add files`;
  setStatus({
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
    document.getElementById("afOpenOther").addEventListener("click", () => switchToMatter(top.matterName));
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
    renderSkillOverview();
    setStatus({
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
        setStatus({
          mood: "idle",
          card: `<strong>Checking</strong><br />Hashing ${pendingFiles.length} file(s)...`,
          bar: "Checking",
          terminal: `[add-files] hashing ${pendingFiles.length} files`,
        });
        const hashes = [];
        for (const item of pendingFiles) {
          hashes.push(await hashFile(item.file));
        }
        const checkResponse = await fetch("/api/matters/check-overlap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hashes, proposedName: activeMatter.folderName }),
        });
        const checkPayload = await checkResponse.json();
        if (!checkResponse.ok) throw new Error(checkPayload.error || `check-overlap returned ${checkResponse.status}`);
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
      setStatus({
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
      setActiveMatter(matterFromWorkspace(payload));
      const a = payload.intakeAdded;
      setStatus({
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
      setStatus({
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

async function openFilePreview(filePath, previewable, previewKind) {
  const fileName = filePath.split("/").pop() || filePath;
  breadcrumbs.textContent = `${activeMatter.folderName} > ${filePath}`;

  if (previewable !== "true") {
    const rawUrl = `/api/file-raw?path=${encodeURIComponent(filePath)}`;
    setStatus({
      mood: "idle",
      card: `<strong>Preview unavailable</strong><br />This file type isn't displayable in the browser yet.`,
      bar: "File Selected",
      terminal: `[explorer] selected ${filePath}`,
    });
    editorContent.innerHTML = `
      <h1>${escapeHtml(fileName)}</h1>
      <p><code>${escapeHtml(filePath)}</code></p>
      <p>This file type isn't previewable in the browser. You can download it to open in a native app:</p>
      <p><a class="file-download-link" href="${rawUrl}" download="${escapeHtml(fileName)}">Download ${escapeHtml(fileName)}</a></p>
    `;
    return;
  }

  statusBarRight.innerHTML = "<span>Opening File</span>";

  if (previewKind === "pdf" || previewKind === "image") {
    const rawUrl = `/api/file-raw?path=${encodeURIComponent(filePath)}`;
    setStatus({
      mood: "idle",
      card: `<strong>Previewing file</strong><br /><code>${escapeHtml(filePath)}</code>`,
      bar: "File Preview",
      terminal: `[explorer] opened ${filePath}`,
    });
    const body = previewKind === "pdf"
      ? `<iframe class="file-pdf-frame" src="${rawUrl}" title="${escapeHtml(fileName)}"></iframe>`
      : `<img class="file-image" src="${rawUrl}" alt="${escapeHtml(fileName)}" />`;
    editorContent.innerHTML = `
      <h1>${escapeHtml(fileName)}</h1>
      <p><code>${escapeHtml(filePath)}</code> &nbsp; <a class="file-download-link" href="${rawUrl}" download="${escapeHtml(fileName)}">Download</a></p>
      ${body}
    `;
    return;
  }

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
  const missingMetadata = validateMetadata();

  if (missingMetadata.length) {
    setStatus({
      bar: "Metadata Missing",
      terminal: [
        `> workbench.run ${command}`,
        "[matter-init] blocked: required matter metadata is incomplete",
        `[matter-init] missing: ${missingMetadata.join(", ")}`,
      ],
    });
    editorContent.innerHTML = `
      <h1>${escapeHtml(activeMatter.metadata.matterName || activeMatter.folderName || "Matter")}</h1>
      <div class="run-failure-card">
        <strong>matter-init can't run yet</strong>
        Missing required metadata: ${escapeHtml(missingMetadata.join(", "))}.<br />
        Edit <code>matter.json</code> on disk and click Refresh, or recreate this matter via <code>+ New Matter</code>.
      </div>
    `;
    return;
  }

  setStatus({
    bar: "Running Skill",
    terminal: [
      `> workbench.run ${command}`,
      "[matter-init] running deterministic local intake...",
    ],
  });

  try {
    const response = await fetch("/api/matter-init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metadata: activeMatter.metadata }),
    });

    if (!response.ok) {
      let detail = `${response.status}`;
      try {
        const payload = await response.json();
        if (payload && payload.error) detail = `${response.status}: ${payload.error}`;
      } catch {
        /* response had no JSON body */
      }
      throw new Error(`matter-init API returned ${detail}`);
    }

    const result = await response.json();
    activeMatter.fileCount = result.counts.scannedFiles;
    renderMatterInitResult(result, "write");
    await refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
  } catch (error) {
    setStatus({
      bar: "Run Failed",
      terminal: [
        `[matter-init] aborted: ${error.message}`,
        "[matter-init] no files were written",
      ],
    });
    editorContent.innerHTML = `
      <h1>${escapeHtml(activeMatter.metadata.matterName || activeMatter.folderName || "Matter")}</h1>
      <div class="run-failure-card">
        <strong>matter-init failed</strong>
        ${escapeHtml(error.message)}<br />
        No files were written. Check that the local server is running, then try again.
      </div>
      <div class="form-actions">
        <button type="button" class="run-skill-button" id="runMatterInitRetry">Try again</button>
        <button type="button" class="run-skill-button secondary" id="runMatterInitBack">Back to overview</button>
      </div>
    `;
    const retry = document.getElementById("runMatterInitRetry");
    if (retry) retry.addEventListener("click", () => runMatterInit(command));
    const back = document.getElementById("runMatterInitBack");
    if (back) back.addEventListener("click", goToExplorer);
  }
}

async function runDoctor(command) {
  if (!activeMatter.folderName) {
    setStatus({
      mood: "idle",
      card: "<strong>No matter loaded</strong><br />Pick a matter from the sidebar before running /doctor.",
      bar: "No Matter",
      terminal: "[doctor] no active matter",
    });
    return;
  }
  setActivityActive("explorer");
  breadcrumbs.textContent = `${activeMatter.folderName} > /doctor`;
  setStatus({
    mood: "idle",
    card: "<strong>Running /doctor</strong><br />Scanning matter for issues...",
    bar: "Doctor Scanning",
    terminal: `[doctor] scanning ${activeMatter.folderName}`,
  });
  editorContent.innerHTML = `<h1>/doctor — ${escapeHtml(activeMatter.folderName)}</h1><p>Scanning...</p>`;
  try {
    const response = await fetch("/api/doctor/scan", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `doctor/scan returned ${response.status}`);
    renderDoctorScan(payload.issues || []);
  } catch (error) {
    setStatus({
      mood: "idle",
      card: `<strong>Doctor scan failed</strong><br />${escapeHtml(error.message)}`,
      bar: "Doctor Failed",
      terminal: `[doctor] scan failed: ${error.message}`,
    });
    editorContent.innerHTML = `<h1>/doctor — ${escapeHtml(activeMatter.folderName)}</h1><p class="form-error">Scan failed: ${escapeHtml(error.message)}</p>`;
  }
}

function renderDoctorScan(issues) {
  if (!issues.length) {
    setStatus({
      mood: "success",
      card: "<strong>All clear</strong><br />No issues detected.",
      bar: "Doctor Clean",
      terminal: "[doctor] no issues found",
    });
    editorContent.innerHTML = `
      <h1>/doctor — ${escapeHtml(activeMatter.folderName)}</h1>
      <p>No issues detected. The matter's structure matches the current schema.</p>
    `;
    return;
  }
  setStatus({
    mood: "idle",
    card: `<strong>${issues.length} issue${issues.length === 1 ? "" : "s"} found</strong><br />Review and choose which to fix.`,
    bar: "Doctor Issues",
    terminal: [`[doctor] ${issues.length} issue(s) found`, ...issues.map((i) => `[doctor] - ${i.id} (${i.severity}): ${i.title}`)],
  });
  const cards = issues.map((issue) => `
    <div class="doctor-issue" data-issue-id="${escapeHtml(issue.id)}">
      <label class="doctor-issue-toggle">
        <input type="checkbox" class="doctor-issue-checkbox" data-issue-id="${escapeHtml(issue.id)}" ${issue.autoFixable ? "checked" : "disabled"} />
        <span class="doctor-issue-title">
          <span class="doctor-issue-badge doctor-severity-${escapeHtml(issue.severity)}">${escapeHtml(issue.severity)}</span>
          ${escapeHtml(issue.title)}
        </span>
      </label>
      <div class="doctor-issue-body">
        <p>${escapeHtml(issue.description)}</p>
        ${issue.autoFixable
          ? `<p class="doctor-fix-description"><strong>Auto-fix:</strong> ${escapeHtml(issue.fixDescription || "")}</p>`
          : `<p class="doctor-fix-description"><em>No automatic fix; manual cleanup required.</em></p>`}
      </div>
    </div>
  `).join("");
  editorContent.innerHTML = `
    <h1>/doctor — ${escapeHtml(activeMatter.folderName)}</h1>
    <p>${issues.length} issue${issues.length === 1 ? "" : "s"} found. Backups go to <code>.doctor-backups/&lt;timestamp&gt;/</code> before any fix runs.</p>
    <div class="doctor-issues">${cards}</div>
    <div class="form-actions">
      <button type="button" id="doctorFixSelected">Fix selected</button>
      <button type="button" class="secondary" id="doctorFixAll">Fix all auto-fixable</button>
      <button type="button" class="secondary" id="doctorCancel">Cancel</button>
    </div>
    <div id="doctorError" class="form-error" hidden></div>
  `;
  document.getElementById("doctorCancel").addEventListener("click", goToExplorer);
  document.getElementById("doctorFixSelected").addEventListener("click", () => {
    const selected = Array.from(document.querySelectorAll(".doctor-issue-checkbox"))
      .filter((cb) => cb.checked && !cb.disabled)
      .map((cb) => cb.dataset.issueId);
    applyDoctorFixes(selected);
  });
  document.getElementById("doctorFixAll").addEventListener("click", () => {
    const all = issues.filter((i) => i.autoFixable).map((i) => i.id);
    applyDoctorFixes(all);
  });
}

async function applyDoctorFixes(fixIds) {
  const errorBox = document.getElementById("doctorError");
  if (errorBox) errorBox.hidden = true;
  if (!fixIds.length) {
    if (errorBox) {
      errorBox.textContent = "Select at least one issue to fix.";
      errorBox.hidden = false;
    }
    return;
  }
  setStatus({
    mood: "idle",
    card: `<strong>Applying ${fixIds.length} fix${fixIds.length === 1 ? "" : "es"}</strong><br />Backing up and migrating...`,
    bar: "Doctor Fixing",
    terminal: `[doctor] applying ${fixIds.length} fix(es): ${fixIds.join(", ")}`,
  });
  try {
    const response = await fetch("/api/doctor/fix", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixIds }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `doctor/fix returned ${response.status}`);
    await refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
    renderDoctorResult(payload);
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
    setStatus({
      mood: "idle",
      card: `<strong>Doctor fix failed</strong><br />${escapeHtml(error.message)}`,
      bar: "Doctor Failed",
      terminal: `[doctor] fix failed: ${error.message}`,
    });
  }
}

function renderDoctorResult(payload) {
  const applied = payload.applied || [];
  const failed = payload.failed || [];
  const remaining = payload.remaining || [];
  const appliedCount = applied.length;
  const allLogs = applied.flatMap((a) => a.log || []);
  const backupDirs = applied.map((a) => a.backupDir).filter(Boolean);
  setStatus({
    mood: failed.length ? "idle" : "success",
    card: failed.length
      ? `<strong>Partial fix</strong><br />${appliedCount} applied, ${failed.length} failed.`
      : `<strong>Doctor done</strong><br />${appliedCount} fix${appliedCount === 1 ? "" : "es"} applied.`,
    bar: failed.length ? "Doctor Partial" : "Doctor Done",
    terminal: [
      `[doctor] applied ${appliedCount} fix(es)`,
      ...allLogs.map((l) => `[doctor]   ${l}`),
      ...failed.map((f) => `[doctor] FAILED ${f.id}: ${f.error}`),
      `[doctor] remaining issues: ${remaining.length}`,
    ],
  });
  const appliedHtml = applied.map((a) => `
    <div class="doctor-issue">
      <strong>${escapeHtml(a.id)}</strong>
      <ul>${(a.log || []).map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
      ${a.backupDir ? `<p class="doctor-fix-description">Backup: <code>${escapeHtml(a.backupDir)}</code></p>` : ""}
    </div>
  `).join("");
  const failedHtml = failed.map((f) => `
    <div class="doctor-issue">
      <span class="doctor-issue-badge doctor-severity-error">failed</span>
      <strong>${escapeHtml(f.id)}</strong>: ${escapeHtml(f.error)}
    </div>
  `).join("");
  const remainingHtml = remaining.length
    ? `<h2>Remaining issues</h2><div class="doctor-issues">${remaining.map((i) => `<div class="doctor-issue"><span class="doctor-issue-badge doctor-severity-${escapeHtml(i.severity)}">${escapeHtml(i.severity)}</span> <strong>${escapeHtml(i.title)}</strong><p>${escapeHtml(i.description)}</p></div>`).join("")}</div>`
    : "";
  editorContent.innerHTML = `
    <h1>/doctor result — ${escapeHtml(activeMatter.folderName)}</h1>
    ${appliedCount ? `<h2>Applied</h2><div class="doctor-issues">${appliedHtml}</div>` : ""}
    ${failed.length ? `<h2>Failed</h2><div class="doctor-issues">${failedHtml}</div>` : ""}
    ${remainingHtml}
    <div class="form-actions">
      <button type="button" id="doctorReturn">Back to matter</button>
      ${remaining.length ? `<button type="button" class="secondary" id="doctorRescan">Re-scan</button>` : ""}
    </div>
  `;
  document.getElementById("doctorReturn").addEventListener("click", goToExplorer);
  const rescan = document.getElementById("doctorRescan");
  if (rescan) rescan.addEventListener("click", () => runDoctor("/doctor"));
}

refreshExplorerButton.addEventListener("click", () => refreshWorkspace());

workspaceTree.addEventListener("click", (event) => {
  const fileButton = event.target.closest("[data-file-path]");
  if (!fileButton) return;
  openFilePreview(
    fileButton.dataset.filePath,
    fileButton.dataset.previewable,
    fileButton.dataset.previewKind || "",
  );
});

mattersList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-matter-name]");
  if (!button) return;
  const name = button.dataset.matterName;
  if (!name || name === mattersState.active) return;
  switchToMatter(name);
});

newMatterButton.addEventListener("click", renderNewMatterForm);
addFilesButton.addEventListener("click", renderAddFilesForm);
activitySettings.addEventListener("click", renderSettings);
activityExplorer.addEventListener("click", goToExplorer);

slashSkillButtons.forEach((button) => {
  button.addEventListener("click", () => {
    slashSkillButtons.forEach((other) => other.classList.toggle("active", other === button));
    if (!activeMatter.folderName) {
      setStatus({
        bar: "No Matter",
        terminal: "[skills] no matter loaded; pick one from the sidebar",
      });
      return;
    }
    const skill = button.dataset.skill;
    if (skill === "/matter-init") runMatterInit(skill);
    else if (skill === "/doctor") runDoctor(skill);
  });
});

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
