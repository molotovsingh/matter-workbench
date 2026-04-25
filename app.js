const commandForm = document.getElementById("commandForm");
const commandInput = document.getElementById("commandInput");
const openFolderButton = document.getElementById("openFolder");
const switchMatterButton = document.getElementById("switchMatter");
const folderFallback = document.getElementById("folderFallback");
const statusCard = document.getElementById("statusCard");
const terminalOutput = document.getElementById("terminalOutput");
const editorContent = document.getElementById("editorContent");
const statusBarRight = document.getElementById("statusBarRight");
const matterName = document.getElementById("matterName");
const matterMetaPrimary = document.getElementById("matterMetaPrimary");
const matterMetaSecondary = document.getElementById("matterMetaSecondary");
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
const slashSkillButtons = document.querySelectorAll("[data-skill]");
const requiredMetadataFields = Array.from(metadataForm.querySelectorAll("[data-required='true']"));

const defaultEntries = [
  { name: "00_Inbox", kind: "directory" },
  { name: "10_Library", kind: "directory" },
  { name: "20_Workshop", kind: "directory" },
  { name: "30_Outbox", kind: "directory" },
  { name: "matter.json", kind: "file" },
];

let activeMatter = {
  name: "Naveen Vs Mohit",
  folderName: "case_naveen",
  inputLabel: "/Users/aks/case_naveen",
  metaPrimary: "Company Law / India",
  metaSecondary: "Phase 1 intake workbench only.",
  fileCount: 127,
  directoryCount: 8,
  entries: defaultEntries,
  tree: null,
  sourceMode: "default",
  metadata: {
    clientName: "Naveen Sharma",
    matterName: "Naveen Vs Mohit",
    oppositeParty: "Mohit",
    matterType: "Company Law",
    jurisdiction: "India",
    briefDescription: "Phase 1 intake workbench only.",
  },
};

function isServerBackedMatter() {
  return activeMatter.sourceMode === "server-workspace";
}

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
  const open = depth < 2 || node.path === "00_Inbox/Load_0001_Initial" ? " open" : "";

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
  `[phase-1] confirming matter root: ${activeMatter.inputLabel}`,
  `[phase-1] validating matter metadata: ${activeMatter.metadata.matterName}`,
  `[phase-1] scanned ${activeMatter.fileCount} files and ${activeMatter.directoryCount} folders`,
  "[phase-1] prototype mode: no files written",
  "[phase-1] would write matter.json",
  "[phase-1] would preserve source under 00_Inbox/Load_0001_Initial/raw_source_files/",
  "[phase-1] would arrange copies under 00_Inbox/Load_0001_Initial/arranged_files/",
  "[phase-1] would write Inbox_Loads.csv and Inbox_Normalization_Log.csv",
  "[phase-1] status: complete - intake ready for lawyer review",
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
    load_id: "Load_0001_Initial",
    intake: {
      scanned_files: activeMatter.fileCount,
      scanned_folders: activeMatter.directoryCount,
      preserve_originals_at: "00_Inbox/Load_0001_Initial/raw_source_files",
      arrange_working_copies_at: "00_Inbox/Load_0001_Initial/arranged_files",
      review_logs: [
        "00_Inbox/Load_0001_Initial/Inbox_Loads.csv",
        "00_Inbox/Load_0001_Initial/Inbox_Normalization_Log.csv",
      ],
    },
  };
}

function renderWorkspaceTree() {
  if (activeMatter.tree) {
    workspaceTree.innerHTML = renderTreeNode(activeMatter.tree);
    return;
  }

  const entries = activeMatter.entries.length
    ? activeMatter.entries
    : [{ name: "No visible files found", kind: "file", path: "" }];
  const entryItems = entries.map((entry) => {
    const label = entry.kind === "directory" ? `${entry.name}/` : entry.name;
    return `<li class="tree-node">${escapeHtml(label)}</li>`;
  }).join("");

  workspaceTree.innerHTML = `
    <li>
      <details open>
        <summary>${escapeHtml(activeMatter.folderName)}</summary>
        <ul>${entryItems}</ul>
      </details>
    </li>
  `;
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
        <dd>matter.json preview, raw_source_files, arranged_files, inbox logs</dd>
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

function renderMatterCard() {
  const metadata = activeMatter.metadata;
  matterName.textContent = metadata.matterName || activeMatter.folderName;
  matterMetaPrimary.textContent = [
    metadata.matterType || "Matter type missing",
    metadata.jurisdiction || "Jurisdiction missing",
  ].join(" / ");
  if (metadata.clientName && metadata.oppositeParty) {
    matterMetaSecondary.textContent = `${metadata.clientName} v. ${metadata.oppositeParty}`;
    return;
  }
  matterMetaSecondary.textContent = activeMatter.sourceMode === "browser-folder"
    ? "Browser preview only. Server writes disabled."
    : "Matter metadata required before /matter-init.";
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
  renderMatterCard();
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

async function readMatterJsonFromDirectoryHandle(handle) {
  try {
    const fileHandle = await handle.getFileHandle("matter.json");
    const file = await fileHandle.getFile();
    return metadataFromMatterJson(JSON.parse(await file.text()), handle.name);
  } catch {
    return null;
  }
}

async function readMatterJsonFromFallbackFiles(files, rootName) {
  const matterFile = files.find((file) => file.webkitRelativePath === `${rootName}/matter.json`);
  if (!matterFile) return null;

  try {
    return metadataFromMatterJson(JSON.parse(await matterFile.text()), rootName);
  } catch {
    return null;
  }
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
  renderMatterCard();
  breadcrumbs.textContent = `${activeMatter.folderName} > /matter-init`;
  commandInput.value = "/matter-init";
  if (!options.preserveStatus) {
    statusCard.className = "status-card idle";
    statusCard.innerHTML = activeMatter.sourceMode === "browser-folder"
      ? "Folder loaded for browser preview. Use a server-backed matter to run <code>/matter-init</code> writes."
      : "Folder loaded. Complete matter metadata, then run <code>/matter-init</code>";
    statusBarRight.innerHTML = "<span>Folder Loaded</span>";
    terminalOutput.textContent = [
      `[folder] loaded ${activeMatter.inputLabel}`,
      `[folder] visible scan: ${activeMatter.fileCount} files, ${activeMatter.directoryCount} folders`,
      activeMatter.sourceMode === "browser-folder"
        ? "[idle] Browser-selected folders are preview-only for this local server."
        : "[idle] Complete metadata, then type /matter-init and run the skill.",
    ].join("\n");
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
    entries: [],
    tree: workspace.tree,
    sourceMode: "server-workspace",
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
      statusCard.className = "status-card idle";
      statusCard.innerHTML = `<strong>Explorer refreshed</strong><br />${workspace.fileCount} files and ${workspace.directoryCount} folders loaded from disk.`;
      statusBarRight.innerHTML = "<span>Explorer Ready</span>";
      terminalOutput.textContent = [
        `[explorer] loaded ${workspace.inputLabel}`,
        `[explorer] indexed ${workspace.fileCount} files and ${workspace.directoryCount} folders`,
      ].join("\n");
    }
    return workspace;
  } catch (error) {
    statusCard.className = "status-card idle";
    statusCard.innerHTML = `<strong>Explorer unavailable</strong><br />${escapeHtml(error.message)}`;
    statusBarRight.innerHTML = "<span>Explorer Failed</span>";
    terminalOutput.textContent = `[explorer] failed: ${error.message}`;
    renderWorkspaceTree();
    return null;
  }
}

async function refreshBrowserMatter() {
  if (!activeMatter.directoryHandle) {
    statusCard.className = "status-card idle";
    statusCard.innerHTML = "<strong>Browser folder refresh unavailable</strong><br />Open Folder again to rescan this matter.";
    statusBarRight.innerHTML = "<span>Refresh Unavailable</span>";
    terminalOutput.textContent = "[explorer] browser fallback folders must be reopened to refresh";
    return;
  }

  try {
    const scan = await scanDirectoryHandle(activeMatter.directoryHandle);
    setActiveMatter({
      ...activeMatter,
      ...scan,
      tree: null,
    }, { preserveEditor: true });
    statusCard.className = "status-card idle";
    statusCard.innerHTML = `<strong>Browser folder refreshed</strong><br />${scan.fileCount} files and ${scan.directoryCount} folders visible to the browser.`;
    statusBarRight.innerHTML = "<span>Explorer Ready</span>";
    terminalOutput.textContent = [
      `[explorer] refreshed ${activeMatter.inputLabel}`,
      "[explorer] browser-selected folders remain preview-only for writes",
    ].join("\n");
  } catch (error) {
    statusCard.className = "status-card idle";
    statusCard.innerHTML = `<strong>Browser refresh failed</strong><br />${escapeHtml(error.message)}`;
    statusBarRight.innerHTML = "<span>Refresh Failed</span>";
    terminalOutput.textContent = `[explorer] browser refresh failed: ${error.message}`;
  }
}

function refreshActiveExplorer() {
  if (activeMatter.sourceMode === "browser-folder") {
    refreshBrowserMatter();
    return;
  }
  refreshWorkspace();
}

function showFolderOpeningState(mode) {
  statusCard.className = "status-card idle";
  statusCard.innerHTML = "<strong>Opening folder</strong><br />Choose a matter folder in the browser prompt.";
  statusBarRight.innerHTML = "<span>Opening Folder</span>";
  terminalOutput.textContent = [
    "[folder] open-folder requested",
    `[folder] access mode: ${mode}`,
    "[folder] waiting for folder selection...",
  ].join("\n");
}

async function scanDirectoryHandle(handle) {
  const entries = [];
  let fileCount = 0;
  let directoryCount = 0;

  for await (const [name, entry] of handle.entries()) {
    if (name.startsWith(".")) continue;
    if (entry.kind === "directory") directoryCount += 1;
    if (entry.kind === "file") fileCount += 1;
    entries.push({ name, kind: entry.kind });
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    entries: entries.slice(0, 18),
    fileCount,
    directoryCount,
  };
}

function scanFallbackFiles(files) {
  const topEntries = new Map();
  let rootName = "selected-folder";

  files.forEach((file) => {
    const parts = file.webkitRelativePath.split("/");
    rootName = parts[0] || rootName;
    const topName = parts[1] || file.name;
    const kind = parts.length > 2 ? "directory" : "file";
    if (topName && !topName.startsWith(".")) {
      topEntries.set(topName, { name: topName, kind });
    }
  });

  return {
    rootName,
    entries: Array.from(topEntries.values()).sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).slice(0, 18),
    fileCount: files.length,
    directoryCount: Array.from(topEntries.values()).filter((entry) => entry.kind === "directory").length,
  };
}

async function openFolder() {
  if ("showDirectoryPicker" in window) {
    showFolderOpeningState("File System Access API");
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      const scan = await scanDirectoryHandle(handle);
      const matterMetadata = await readMatterJsonFromDirectoryHandle(handle);
      setActiveMatter({
        name: handle.name,
        folderName: handle.name,
        inputLabel: `${handle.name} (browser-selected folder)`,
        metaPrimary: "Local folder selected",
        metaSecondary: "Ready for Phase 1 intake test.",
        sourceMode: "browser-folder",
        directoryHandle: handle,
        tree: null,
        metadata: matterMetadata || {
          clientName: "",
          matterName: handle.name,
          oppositeParty: "",
          matterType: "",
          jurisdiction: "",
          briefDescription: "",
        },
        ...scan,
      });
    } catch (error) {
      statusCard.className = "status-card idle";
      statusBarRight.innerHTML = "<span>Folder Not Loaded</span>";
      terminalOutput.textContent = [
        "[folder] open-folder cancelled or failed",
        `[folder] reason: ${error.name || "unknown"}`,
      ].join("\n");
      statusCard.innerHTML = error.name === "AbortError"
        ? "<strong>Folder selection cancelled</strong><br />Open Folder did not load a new matter."
        : "<strong>Folder load failed</strong><br />The browser did not grant folder access.";
    }
    return;
  }

  if (!("webkitdirectory" in folderFallback)) {
    statusCard.className = "status-card idle";
    statusCard.innerHTML = "<strong>Folder picker unsupported</strong><br />Use Chrome or Edge for this prototype.";
    statusBarRight.innerHTML = "<span>Folder Unsupported</span>";
    terminalOutput.textContent = "[folder] this browser does not expose directory selection to the page";
    return;
  }

  showFolderOpeningState("file input directory picker");
  folderFallback.value = "";
  folderFallback.click();
}

function renderMatterInitResult(result, modeLabel) {
  const matterJson = result.matterJson || buildMatterJson();
  const counts = result.counts || {
    scannedFiles: activeMatter.fileCount,
    uniqueFiles: activeMatter.fileCount,
    duplicateFiles: 0,
  };
  const paths = result.paths || {
    rawSourceDir: "00_Inbox/Load_0001_Initial/raw_source_files",
    arrangedDir: "00_Inbox/Load_0001_Initial/arranged_files",
    loadLogPath: "00_Inbox/Load_0001_Initial/Inbox_Loads.csv",
    normalizationLogPath: "00_Inbox/Load_0001_Initial/Inbox_Normalization_Log.csv",
  };

  statusCard.className = "status-card success";
  statusCard.innerHTML = `<strong>matter-init ${escapeHtml(modeLabel)} complete</strong><br />${counts.scannedFiles} files scanned, ${counts.duplicateFiles} exact duplicates identified.`;
  statusBarRight.innerHTML = "<span>Skill Complete</span>";
  terminalOutput.textContent = (result.outputLines || buildPreviewResultLines("/matter-init")).join("\n");
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
        <dt>Preserved</dt>
        <dd>Originals copied under <code>${escapeHtml(paths.rawSourceDir)}</code></dd>
      </div>
      <div>
        <dt>Arranged</dt>
        <dd>Working copies grouped under <code>${escapeHtml(paths.arrangedDir)}</code> by file type</dd>
      </div>
      <div>
        <dt>Reported</dt>
        <dd><code>${escapeHtml(paths.loadLogPath)}</code> and <code>${escapeHtml(paths.normalizationLogPath)}</code></dd>
      </div>
    </dl>
    <h2>matter.json</h2>
    <pre class="json-preview">${escapeHtml(JSON.stringify(matterJson, null, 2))}</pre>
  `;
}

async function openFilePreview(filePath, previewable) {
  if (previewable !== "true") {
    breadcrumbs.textContent = `${activeMatter.folderName} > ${filePath}`;
    statusCard.className = "status-card idle";
    statusCard.innerHTML = "<strong>Preview unavailable</strong><br />This file type is listed in the explorer but is not opened as text.";
    statusBarRight.innerHTML = "<span>File Selected</span>";
    terminalOutput.textContent = `[explorer] selected ${filePath}`;
    return;
  }

  statusBarRight.innerHTML = "<span>Opening File</span>";

  try {
    const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `file API returned ${response.status}`);

    breadcrumbs.textContent = `${activeMatter.folderName} > ${result.path}`;
    statusCard.className = "status-card idle";
    statusCard.innerHTML = `<strong>Previewing file</strong><br /><code>${escapeHtml(result.path)}</code>`;
    statusBarRight.innerHTML = "<span>File Preview</span>";
    terminalOutput.textContent = `[explorer] opened ${result.path}`;
    editorContent.innerHTML = `
      <h1>${escapeHtml(result.name)}</h1>
      <p><code>${escapeHtml(result.path)}</code></p>
      <pre class="json-preview">${escapeHtml(result.content)}</pre>
    `;
  } catch (error) {
    statusCard.className = "status-card idle";
    statusCard.innerHTML = `<strong>Preview failed</strong><br />${escapeHtml(error.message)}`;
    statusBarRight.innerHTML = "<span>Preview Failed</span>";
    terminalOutput.textContent = `[explorer] preview failed for ${filePath}: ${error.message}`;
  }
}

function renderBrowserMatterInitBlocked(command) {
  const matterJson = buildMatterJson();

  statusCard.className = "status-card idle";
  statusCard.innerHTML = "<strong>Server write blocked</strong><br />This folder was opened in the browser, but the local Node server is still bound to a different matter root.";
  statusBarRight.innerHTML = "<span>Preview Only</span>";
  terminalOutput.textContent = [
    `> workbench.run ${command}`,
    `[phase-1] blocked: ${activeMatter.folderName} is browser-selected only`,
    "[phase-1] no files written; server-backed matter root was not changed",
    "[phase-1] use Switch Matter for the configured server root, or restart with MATTER_ROOT=/path/to/matter",
  ].join("\n");
  editorContent.innerHTML = `
    <h1>/matter-init blocked</h1>
    <p>
      ${escapeHtml(activeMatter.folderName)} is loaded in browser preview mode. The local server cannot safely write
      into that selected folder, so it did not run intake against the old server root.
    </p>
    <dl class="skill-contract">
      <div>
        <dt>Loaded</dt>
        <dd><code>${escapeHtml(activeMatter.inputLabel)}</code></dd>
      </div>
      <div>
        <dt>Server Writes</dt>
        <dd>Disabled for browser-selected folders</dd>
      </div>
      <div>
        <dt>Next Step</dt>
        <dd>Restart the workbench with <code>MATTER_ROOT=/path/to/${escapeHtml(activeMatter.folderName)}</code>, then run <code>/matter-init</code>.</dd>
      </div>
    </dl>
    <h2>matter.json preview</h2>
    <pre class="json-preview">${escapeHtml(JSON.stringify(matterJson, null, 2))}</pre>
  `;
}

async function runMatterInit(command) {
  syncMetadataFromForm();
  const missingMetadata = validateMetadata();

  if (missingMetadata.length) {
    statusCard.className = "status-card idle";
    statusCard.innerHTML = `<strong>Metadata required</strong><br />Missing: ${escapeHtml(missingMetadata.join(", "))}`;
    statusBarRight.innerHTML = "<span>Metadata Missing</span>";
    terminalOutput.textContent = [
      `> workbench.run ${command}`,
      "[phase-1] blocked: required matter metadata is incomplete",
      `[phase-1] missing: ${missingMetadata.join(", ")}`,
    ].join("\n");
    return;
  }

  if (!isServerBackedMatter()) {
    renderBrowserMatterInitBlocked(command);
    return;
  }

  statusCard.className = "status-card idle";
  statusCard.innerHTML = "<strong>Running matter-init</strong><br />Hashing, preserving, arranging, and writing review logs.";
  statusBarRight.innerHTML = "<span>Running Skill</span>";
  terminalOutput.textContent = [
    `> workbench.run ${command}`,
    "[phase-1] running deterministic local intake...",
  ].join("\n");

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

function switchToKnownMatter() {
  refreshWorkspace();
}

function rejectUnknownSkill(command) {
  statusCard.className = "status-card idle";
  statusCard.innerHTML = `<strong>Unknown slash skill</strong><br /><code>${command || "(empty)"}</code> is not active in Phase 1.`;
  statusBarRight.innerHTML = "<span>Skill Not Found</span>";
  terminalOutput.textContent = [
    `> workbench.run ${command || "(empty)"}`,
    "[phase-1] rejected: only /matter-init is active in this prototype",
  ].join("\n");
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

openFolderButton.addEventListener("click", openFolder);
switchMatterButton.addEventListener("click", switchToKnownMatter);
refreshExplorerButton.addEventListener("click", refreshActiveExplorer);

workspaceTree.addEventListener("click", (event) => {
  const fileButton = event.target.closest("[data-file-path]");
  if (!fileButton) return;
  openFilePreview(fileButton.dataset.filePath, fileButton.dataset.previewable);
});

folderFallback.addEventListener("change", async () => {
  const files = Array.from(folderFallback.files);
  if (!files.length) {
    statusCard.className = "status-card idle";
    statusCard.innerHTML = "<strong>Folder selection cancelled</strong><br />Open Folder did not load a new matter.";
    statusBarRight.innerHTML = "<span>Folder Not Loaded</span>";
    terminalOutput.textContent = "[folder] no files returned from folder picker";
    return;
  }
  const scan = scanFallbackFiles(files);
  const matterMetadata = await readMatterJsonFromFallbackFiles(files, scan.rootName);
  setActiveMatter({
    name: scan.rootName,
    folderName: scan.rootName,
    inputLabel: `${scan.rootName} (browser-selected folder)`,
    metaPrimary: "Local folder selected",
    metaSecondary: "Ready for Phase 1 intake test.",
    sourceMode: "browser-folder",
    tree: null,
    metadata: matterMetadata || {
      clientName: "",
      matterName: scan.rootName,
      oppositeParty: "",
      matterType: "",
      jurisdiction: "",
      briefDescription: "",
    },
    entries: scan.entries,
    fileCount: scan.fileCount,
    directoryCount: scan.directoryCount,
  });
});

slashSkillButtons.forEach((button) => {
  button.addEventListener("click", () => {
    commandInput.value = button.dataset.skill;
    commandInput.focus();
    commandInput.select();
    statusCard.className = "status-card idle";
    statusCard.innerHTML = isServerBackedMatter()
      ? "Ready to run <code>/matter-init</code>"
      : "Browser preview mode. Server writes are disabled for <code>/matter-init</code>.";
    statusBarRight.innerHTML = isServerBackedMatter()
      ? "<span>Skill Ready</span>"
      : "<span>Preview Only</span>";
  });
});

metadataForm.addEventListener("input", () => {
  requiredMetadataFields.forEach((field) => {
    if (field.value.trim()) field.classList.remove("field-error");
  });
  syncMetadataFromForm();
  statusCard.className = "status-card idle";
  statusCard.innerHTML = isServerBackedMatter()
    ? "Metadata changed. Run <code>/matter-init</code> to refresh the preview."
    : "Metadata changed in browser preview mode. Server writes remain disabled.";
  statusBarRight.innerHTML = isServerBackedMatter()
    ? "<span>Skill Ready</span>"
    : "<span>Preview Only</span>";
  terminalOutput.textContent = isServerBackedMatter()
    ? "[idle] Metadata changed. Run /matter-init to refresh the intake preview."
    : "[idle] Metadata changed for browser preview only. No server write will run.";
});

setMetadataInputs(activeMatter.metadata);
renderMatterCard();
renderWorkspaceTree();
renderSkillOverview();
refreshWorkspace({ silent: true });
