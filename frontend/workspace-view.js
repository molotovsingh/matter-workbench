import { writeClipboardText } from "./clipboard.js";
import { escapeHtml, formatBytes } from "./dom-utils.js";
import {
  MATTER_WORKSPACE_GROUPS,
  MATTER_WORKSPACE_LANES,
  workspaceLaneLabel,
} from "../shared/workspace-lanes.mjs";

export function renderTreeNode(node, depth = 0, options = {}) {
  if (node.kind === "file") {
    const previewable = node.previewable ? "true" : "false";
    const previewKind = node.previewKind || "";
    const displayName = displayFileName(node);
    const canonicalName = displayName !== node.name ? ` <span class="tree-canonical-name">${escapeHtml(node.name)}</span>` : "";
    const meta = shouldShowFileSize(node) ? `<span class="tree-meta">${formatBytes(node.size)}</span>` : "";
    return `
      <li class="tree-node tree-file">
        <button
          class="tree-file-button"
          type="button"
          data-file-path="${escapeHtml(node.path)}"
          data-previewable="${previewable}"
          data-preview-kind="${escapeHtml(previewKind)}"
        >
          <span class="tree-name">${escapeHtml(displayName)}${canonicalName}</span>
          ${meta}
        </button>
      </li>
    `;
  }

  const children = node.children || [];
  const childItems = depth === 0
    ? renderMatterWorkspaceChildren(children, options)
    : renderDirectoryChildren(children, depth, options);
  const displayChildren = partitionChildrenForDisplay(children, options);
  const childCount = displayChildren.visibleCount ? `<span class="tree-meta">${displayChildren.visibleCount}</span>` : "";
  const truncated = node.truncated ? `<li class="tree-truncated">Directory output truncated</li>` : "";
  const open = depth < 2 || node.path === "00_Inbox/Intake 01 - Initial" ? " open" : "";
  const displayName = workspaceLaneLabel(node.path, node.name);
  const canonicalName = displayName !== node.name ? ` <span class="tree-canonical-name">${escapeHtml(node.name)}</span>` : "";
  const folderSuffix = depth === 0 || canonicalName ? "" : "/";
  const lane = MATTER_WORKSPACE_LANES.find((candidate) => candidate.path === node.path);
  const purpose = lane?.purpose ? `<span class="tree-purpose">${escapeHtml(lane.purpose)}</span>` : "";

  return `
    <li class="tree-node tree-directory">
      <details${open} data-directory-path="${escapeHtml(node.path || "")}">
        <summary>
          <span class="tree-name">${escapeHtml(displayName)}${folderSuffix}${canonicalName}${purpose}</span>
          ${childCount}
        </summary>
        <ul>${childItems}${truncated}</ul>
      </details>
    </li>
  `;
}

function renderMatterWorkspaceChildren(children = [], options = {}) {
  const byPath = new Map(children.map((child) => [child.path, child]));
  const groupedPaths = new Set(MATTER_WORKSPACE_GROUPS.flatMap((group) => group.lanes || []));
  const groupedItems = MATTER_WORKSPACE_GROUPS
    .map((group) => renderWorkspaceGroup(group, byPath, options))
    .filter(Boolean)
    .join("");
  const remaining = children.filter((child) => !groupedPaths.has(child.path));
  const { primary, technical } = partitionChildrenForDisplay(remaining, options);
  const remainingItems = [
    ...primary.map((child) => renderTreeNode(child, 1, options)),
    renderTechnicalGroup(technical, 0, options),
  ].filter(Boolean).join("");
  return `${groupedItems}${remainingItems}`;
}

function renderWorkspaceGroup(group, byPath, options = {}) {
  const lanes = (group.lanes || []).map((lanePath) => byPath.get(lanePath)).filter(Boolean);
  if (!lanes.length) return "";
  const childCount = lanes.reduce((total, lane) => {
    if (!Array.isArray(lane.children)) return total;
    return total + partitionChildrenForDisplay(lane.children, options).visibleCount;
  }, 0);
  return `
    <li class="tree-node tree-directory tree-lane-group">
      <details open data-workspace-group="${escapeHtml(group.id || "")}">
        <summary>
          <span class="tree-name">${escapeHtml(group.label || "Workspace Group")}<span class="tree-purpose">${escapeHtml(group.purpose || "")}</span></span>
          ${childCount ? `<span class="tree-meta">${childCount}</span>` : ""}
        </summary>
        <ul>${lanes.map((lane) => renderTreeNode(lane, 1, options)).join("")}</ul>
      </details>
    </li>
  `;
}

function renderDirectoryChildren(children = [], depth = 0, options = {}) {
  if (options.inTechnicalGroup) {
    return children.map((child) => renderTreeNode(child, depth + 1, options)).join("");
  }
  const { primary, technical } = partitionChildrenForDisplay(children, options);
  return [
    ...primary.map((child) => renderTreeNode(child, depth + 1, options)),
    renderTechnicalGroup(technical, depth, options),
  ].filter(Boolean).join("");
}

function renderTechnicalGroup(children = [], depth = 0, options = {}) {
  if (!children.length || !options.showTechnical) return "";
  return `
    <li class="tree-node tree-directory tree-technical-group">
      <details open>
        <summary>
          <span class="tree-name">Technical files<span class="tree-purpose">Logs, registers, extraction records, and machine-readable sidecars.</span></span>
          <span class="tree-meta">${children.length}</span>
        </summary>
        <p class="tree-technical-warning">Technical files are used by the app. Do not edit them unless you know what you are doing.</p>
        <ul>${children.map((child) => renderTreeNode(child, depth + 1, { ...options, inTechnicalGroup: true })).join("")}</ul>
      </details>
    </li>
  `;
}

function partitionChildrenForDisplay(children = [], options = {}) {
  if (options.inTechnicalGroup) {
    return { primary: children, technical: [], visibleCount: children.length };
  }
  const markdownBasenames = new Set(children
    .filter((child) => child.kind === "file" && extensionOf(child.name) === ".md")
    .map((child) => baseNameWithoutExtension(child.name)));
  const primary = [];
  const technical = [];
  for (const child of children) {
    if (isTechnicalTreeEntry(child, markdownBasenames)) technical.push(child);
    else primary.push(child);
  }
  return {
    primary,
    technical,
    visibleCount: primary.length + (options.showTechnical && technical.length ? 1 : 0),
  };
}

function isTechnicalTreeEntry(node, markdownBasenames = new Set()) {
  const name = String(node?.name || "");
  if (!name) return false;
  if (node.kind !== "file") {
    return name === "_extracted" || name === "By Type";
  }
  if (/^(Extraction Log|File Register|Intake Log)\.csv$/i.test(name)) return true;
  if (/^matter\.json$/i.test(name)) return true;
  const ext = extensionOf(name);
  const basename = baseNameWithoutExtension(name);
  if ((ext === ".json" || ext === ".csv") && markdownBasenames.has(basename)) return true;
  return false;
}

function displayFileName(node = {}) {
  const name = String(node.name || "");
  if (/^Source Index\.json$/i.test(name)) return "Source Index";
  const ext = extensionOf(name);
  if ([".md", ".json", ".csv"].includes(ext)) return baseNameWithoutExtension(name);
  return name;
}

function shouldShowFileSize(node = {}) {
  if (node.size === undefined) return false;
  const ext = extensionOf(node.name);
  return ![".md", ".json", ".csv", ".txt", ".log"].includes(ext);
}

function extensionOf(name = "") {
  const normalized = String(name || "");
  const index = normalized.lastIndexOf(".");
  return index <= 0 ? "" : normalized.slice(index).toLowerCase();
}

function baseNameWithoutExtension(name = "") {
  const normalized = String(name || "");
  const index = normalized.lastIndexOf(".");
  return index <= 0 ? normalized : normalized.slice(0, index);
}

export function createWorkspaceView(ctx) {
  const {
    breadcrumbs,
    editorContent,
    statusBarRight,
    toggleTechnicalFilesButton,
    workspaceTree,
  } = ctx.elements;
  let showTechnicalFiles = false;

  function updateTechnicalFilesToggle() {
    if (!toggleTechnicalFilesButton) return;
    toggleTechnicalFilesButton.textContent = showTechnicalFiles ? "Hide technical files" : "Show technical files";
    toggleTechnicalFilesButton.setAttribute("aria-pressed", showTechnicalFiles ? "true" : "false");
    toggleTechnicalFilesButton.classList.toggle("active", showTechnicalFiles);
  }

  function renderWorkspaceTree(activeMatter = ctx.getActiveMatter()) {
    updateTechnicalFilesToggle();
    if (activeMatter.tree) {
      workspaceTree.innerHTML = renderTreeNode(activeMatter.tree, 0, { showTechnical: showTechnicalFiles });
      return;
    }
    workspaceTree.innerHTML = '<li class="tree-node">Loading workspace...</li>';
  }

  function toggleTechnicalFiles() {
    showTechnicalFiles = !showTechnicalFiles;
    renderWorkspaceTree();
    return showTechnicalFiles;
  }

  async function openFilePreview(filePath, previewable, previewKind) {
    const activeMatter = ctx.getActiveMatter();
    const fileName = filePath.split("/").pop() || filePath;
    breadcrumbs.textContent = `${activeMatter.folderName} > ${filePath}`;

    if (previewable !== "true") {
      const rawUrl = `/api/file-raw?path=${encodeURIComponent(filePath)}`;
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Preview unavailable</strong><br />This file type isn't displayable in the browser yet.",
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
      ctx.setStatus({
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
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Previewing file</strong><br /><code>${escapeHtml(result.path)}</code>`,
        bar: "File Preview",
        terminal: `[explorer] opened ${result.path}`,
      });
      const listOfDatesActions = renderListOfDatesPreviewActions(result.path, escapeHtml);
      editorContent.innerHTML = `
        <h1>${escapeHtml(result.name)}</h1>
        <p><code>${escapeHtml(result.path)}</code></p>
        ${listOfDatesActions}
        <pre class="json-preview">${escapeHtml(result.content)}</pre>
      `;
      if (listOfDatesActions) wireListOfDatesPreviewActions(result.content);
    } catch (error) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Preview failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Preview Failed",
        terminal: `[explorer] preview failed for ${filePath}: ${error.message}`,
      });
    }
  }

  function openWorkspaceLane(lanePath) {
    const activeMatter = ctx.getActiveMatter();
    const lane = MATTER_WORKSPACE_LANES.find((candidate) => candidate.path === lanePath);
    const laneLabel = lane?.label || workspaceLaneLabel(lanePath, lanePath);

    if (!activeMatter.folderName) {
      breadcrumbs.textContent = "workbench";
      editorContent.innerHTML = `
        <h1>${escapeHtml(laneLabel)}</h1>
        <p class="form-error">Pick a matter first.</p>
      `;
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No matter loaded</strong><br />Pick a matter from the sidebar before opening a workspace lane.",
        bar: "No Matter",
        terminal: `[workspace] lane requested without active matter: ${lanePath}`,
      });
      return { ok: false, reason: "no_matter" };
    }

    const laneNode = findTreeNodeByPath(activeMatter.tree, lanePath);
    breadcrumbs.textContent = `${activeMatter.folderName} > ${lanePath}`;

    if (!laneNode) {
      editorContent.innerHTML = `
        <h1>${escapeHtml(laneLabel)}</h1>
        <p><code>${escapeHtml(lanePath)}</code></p>
        <p class="form-error">This lane folder is missing from the active matter.</p>
      `;
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Lane missing</strong><br /><code>${escapeHtml(lanePath)}</code> was not found in this matter.`,
        bar: "Lane Missing",
        terminal: `[workspace] missing lane ${lanePath}`,
      });
      return { ok: false, reason: "missing_lane" };
    }

    expandWorkspaceLane(workspaceTree, lanePath);
    editorContent.innerHTML = renderWorkspaceLaneView(lane, laneNode);
    ctx.setStatus({
      mood: "idle",
      card: `<strong>${escapeHtml(laneLabel)}</strong><br />Opened <code>${escapeHtml(lanePath)}</code> without running a skill.`,
      bar: "Lane Opened",
      terminal: `[workspace] opened ${lanePath}`,
    });
    return { ok: true, empty: !(laneNode.children || []).length };
  }

  return { openFilePreview, openWorkspaceLane, renderWorkspaceTree, toggleTechnicalFiles };
}

export function findTreeNodeByPath(node, relativePath) {
  if (!node) return null;
  const target = String(relativePath || "").replace(/\\/g, "/");
  const current = String(node.path || "").replace(/\\/g, "/");
  if (current === target) return node;
  for (const child of node.children || []) {
    const found = findTreeNodeByPath(child, target);
    if (found) return found;
  }
  return null;
}

export function renderWorkspaceLaneView(lane, laneNode) {
  const children = laneNode?.children || [];
  const label = lane?.label || workspaceLaneLabel(laneNode?.path, laneNode?.name || "Workspace Lane");
  const path = lane?.path || laneNode?.path || "";
  const purpose = lane?.purpose || "matter workspace files";
  const files = children.filter((child) => child.kind === "file").length;
  const folders = children.filter((child) => child.kind !== "file").length;
  const contents = children.length
    ? `
      <ul class="lane-preview-list">
        ${children.slice(0, 16).map((child) => `
          <li class="lane-preview-item">
            <span>${escapeHtml(child.kind === "file" ? "File" : "Folder")}</span>
            <strong>${escapeHtml(child.name || child.path || "Untitled")}</strong>
            ${child.size === undefined ? "" : `<code>${formatBytes(child.size)}</code>`}
          </li>
        `).join("")}
      </ul>
      ${children.length > 16 ? `<p class="muted">Showing 16 of ${children.length} entries.</p>` : ""}
    `
    : '<p class="muted">This lane is empty.</p>';

  return `
    <h1>${escapeHtml(label)}</h1>
    <p><code>${escapeHtml(path)}</code></p>
    <section class="lane-preview-card">
      <p>${escapeHtml(purpose)}</p>
      <div class="lane-preview-meta">
        <span>${files} files</span>
        <span>${folders} folders</span>
      </div>
      ${contents}
    </section>
  `;
}

function expandWorkspaceLane(workspaceTree, lanePath) {
  if (!workspaceTree?.querySelectorAll) return;
  const detailsElements = workspaceTree.querySelectorAll("[data-directory-path]");
  for (const details of detailsElements) {
    if (details.dataset?.directoryPath !== lanePath) continue;
    details.open = true;
    details.scrollIntoView?.({ block: "nearest" });
    return;
  }
}

export function renderListOfDatesPreviewActions(filePath, escape) {
  if (!isListOfDatesMarkdownPath(filePath)) return "";
  const fileName = filePath.split("/").pop() || "List of Dates.md";
  const rawUrl = `/api/file-raw?path=${encodeURIComponent(filePath)}`;
  return `
    <div class="artifact-actions" data-listofdates-preview-actions>
      <button
        type="button"
        class="run-skill-button"
        data-workspace-copy-markdown
      >
        Copy Markdown
      </button>
      <a
        class="run-skill-button secondary"
        href="${escape(rawUrl)}"
        download="${escape(fileName)}"
      >Download Markdown</a>
      <span class="artifact-action-status muted" data-workspace-copy-status></span>
    </div>
  `;
}

function isListOfDatesMarkdownPath(filePath) {
  return String(filePath || "").replace(/\\/g, "/").toLowerCase() === "10_library/list of dates.md";
}

function wireListOfDatesPreviewActions(markdown) {
  const copyButton = document.querySelector("[data-workspace-copy-markdown]");
  if (!copyButton) return;
  const status = document.querySelector("[data-workspace-copy-status]");

  copyButton.addEventListener("click", async () => {
    setArtifactActionStatus(status, "Copying Markdown...");
    copyButton.disabled = true;
    try {
      await writeClipboardText(markdown);
      setArtifactActionStatus(status, "Markdown copied.");
    } catch (error) {
      setArtifactActionStatus(status, `Copy failed: ${error.message}`, true);
    } finally {
      copyButton.disabled = false;
    }
  });
}

function setArtifactActionStatus(status, message, isError = false) {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("form-error", isError);
}
