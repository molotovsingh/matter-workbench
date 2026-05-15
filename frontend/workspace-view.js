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
    const activeClass = normalizedPath(node.path) === normalizedPath(options.activeFilePath) ? " active" : "";
    const activeAria = activeClass ? ' aria-current="true"' : "";
    return `
      <li class="tree-node tree-file">
        <button
          class="tree-file-button${activeClass}"
          type="button"
          data-file-path="${escapeHtml(node.path)}"
          data-previewable="${previewable}"
          data-preview-kind="${escapeHtml(previewKind)}"
          ${activeAria}
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
  let activeFilePath = "";

  function updateTechnicalFilesToggle() {
    if (!toggleTechnicalFilesButton) return;
    toggleTechnicalFilesButton.textContent = showTechnicalFiles ? "Hide technical files" : "Show technical files";
    toggleTechnicalFilesButton.setAttribute("aria-pressed", showTechnicalFiles ? "true" : "false");
    toggleTechnicalFilesButton.classList.toggle("active", showTechnicalFiles);
  }

  function renderWorkspaceTree(activeMatter = ctx.getActiveMatter()) {
    updateTechnicalFilesToggle();
    if (activeMatter.tree) {
      workspaceTree.innerHTML = renderTreeNode(activeMatter.tree, 0, {
        activeFilePath,
        showTechnical: showTechnicalFiles,
      });
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
    activeFilePath = filePath;
    renderWorkspaceTree(activeMatter);
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
      editorContent.innerHTML = isListOfDatesMarkdownPath(result.path)
        ? renderListOfDatesMarkdownPreview(result, escapeHtml)
        : `
          <h1>${escapeHtml(result.name)}</h1>
          <p><code>${escapeHtml(result.path)}</code></p>
          <pre class="json-preview">${escapeHtml(result.content)}</pre>
        `;
      if (isListOfDatesMarkdownPath(result.path)) wireListOfDatesPreviewActions(result.content);
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
        card: "<strong>No matter loaded</strong><br />Pick a matter from Home before opening a workspace lane.",
        bar: "No Matter",
        terminal: `[workspace] lane requested without active matter: ${lanePath}`,
      });
      return { ok: false, reason: "no_matter" };
    }

    const laneNode = findTreeNodeByPath(activeMatter.tree, lanePath);
    breadcrumbs.textContent = `${activeMatter.folderName} > ${lanePath}`;
    activeFilePath = "";
    renderWorkspaceTree(activeMatter);

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
    <div class="artifact-actions document-actions" data-listofdates-preview-actions>
      <button
        type="button"
        class="run-skill-button secondary"
        data-workspace-copy-markdown
      >
        Copy Markdown
      </button>
      <a
        class="run-skill-button secondary"
        href="${escape(rawUrl)}"
        download="${escape(fileName)}"
      >Download</a>
      <span class="artifact-action-status muted" data-workspace-copy-status></span>
    </div>
  `;
}

export function renderListOfDatesMarkdownPreview(result, escape) {
  const content = String(result?.content || "");
  const parsed = parseListOfDatesMarkdown(content);
  const filePath = result?.path || "10_Library/List of Dates.md";
  const fileName = result?.name || filePath.split("/").pop() || "List of Dates.md";
  const actions = renderListOfDatesPreviewActions(filePath, escape);

  if (!parsed.entries.length) {
    return `
      <section class="document-preview">
        ${renderDocumentHeader({ fileName, filePath, parsed, actions, escape })}
        <pre class="json-preview">${escape(content)}</pre>
      </section>
    `;
  }

  return `
    <section class="document-preview listofdates-preview">
      ${renderDocumentHeader({ fileName, filePath, parsed, actions, escape })}
      <section class="chronology-table" aria-label="List of Dates chronology">
        <div class="chronology-header">
          <span>Date</span>
          <span>Event</span>
          <span>Relevance</span>
          <span>Source</span>
        </div>
        ${parsed.entries.map((entry) => renderChronologyEntry(entry, escape)).join("")}
      </section>
      <div class="chronology-summary">
        <span>${parsed.entries.length} ${parsed.entries.length === 1 ? "entry" : "entries"}</span>
        <span>${parsed.sourceCount} ${parsed.sourceCount === 1 ? "source" : "sources"} cited</span>
        <span>${escape(parsed.dateRange || "No date range")}</span>
      </div>
    </section>
  `;
}

export function parseListOfDatesMarkdown(markdown = "") {
  const text = String(markdown || "");
  const lines = text.split(/\r?\n/);
  const title = (lines.find((line) => /^#\s+/.test(line)) || "# List of Dates").replace(/^#\s+/, "").trim();
  const matter = extractMetadataLine(lines, "Matter");
  const generated = lines.find((line) => /^Generated by\s+/i.test(line))?.trim() || "";
  const headerIndex = lines.findIndex((line) => /\|\s*Date\s*\|\s*Event\s*\|\s*Legal Relevance\s*\|\s*Source\s*\|/i.test(line));
  if (headerIndex === -1) {
    return { title, matter, generated, entries: [], sourceCount: 0, dateRange: "" };
  }

  const entries = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith("|")) break;
    const cells = splitMarkdownTableRow(line);
    if (cells.length < 4) continue;
    entries.push({
      date: normalizeMarkdownCell(cells[0]),
      event: normalizeMarkdownCell(cells[1]),
      relevance: normalizeMarkdownCell(cells[2]),
      source: normalizeSourceCell(cells[3]),
    });
  }

  const sourceCount = countUniqueSources(entries);
  const dates = entries.map((entry) => entry.date).filter(Boolean);
  const dateRange = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "";
  return { title, matter, generated, entries, sourceCount, dateRange };
}

function renderDocumentHeader({ fileName, filePath, parsed, actions, escape }) {
  const title = parsed.title || stripExtension(fileName);
  const matterLine = parsed.matter ? `Matter: ${parsed.matter}` : "";
  const generatedLine = parsed.generated ? parsed.generated : "";
  const detailParts = [matterLine, generatedLine].filter(Boolean);
  return `
    <header class="document-preview-header">
      <div>
        <h1>${escape(title)}</h1>
        <p class="document-path"><code>${escape(filePath)}</code></p>
        ${detailParts.length ? `<p class="document-note">${detailParts.map(escape).join(" · ")}</p>` : ""}
      </div>
      ${actions}
    </header>
  `;
}

function renderChronologyEntry(entry, escape) {
  const relevanceClass = relevanceTone(entry.relevance);
  const important = relevanceClass === "attention" ? " important" : "";
  return `
    <article class="chronology-row${important}">
      <time datetime="${escape(entry.date)}">${escape(entry.date)}</time>
      <p>${escape(entry.event)}</p>
      <span class="chronology-relevance ${relevanceClass}">${escape(entry.relevance)}</span>
      <div class="chronology-source">${renderSourceFragments(entry.source, escape)}</div>
    </article>
  `;
}

function renderSourceFragments(source = "", escape) {
  const fragments = splitSourceFragments(source);
  if (!fragments.length) return '<span class="muted">No source</span>';
  return fragments.map((fragment) => `<span>${escape(fragment)}</span>`).join("");
}

function relevanceTone(relevance = "") {
  const normalized = String(relevance || "").toLowerCase();
  if (/(key incident|financial damage|denied boarding|refused|compelled|damage|dispute)/.test(normalized)) return "attention";
  if (/(official|confirmation|confirmed|consulate)/.test(normalized)) return "official";
  if (/(payment|flight|record|invoice|ledger|immigration)/.test(normalized)) return "record";
  return "neutral";
}

function extractMetadataLine(lines, label) {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, "i");
  const line = lines.find((candidate) => pattern.test(candidate));
  return line ? line.match(pattern)[1].trim() : "";
}

function splitMarkdownTableRow(line = "") {
  const trimmed = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeMarkdownCell(value = "") {
  return String(value || "")
    .replace(/\\\|/g, "|")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSourceCell(value = "") {
  return String(value || "")
    .replace(/\\\|/g, "|")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\n+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function countUniqueSources(entries = []) {
  const sources = new Set();
  for (const entry of entries) {
    for (const source of splitSourceFragments(entry.source)) {
      const fileIds = source.match(/FILE-\d+/gi) || [];
      if (fileIds.length) {
        fileIds.forEach((fileId) => sources.add(fileId.toUpperCase()));
      } else {
        sources.add(source);
      }
    }
  }
  return sources.size;
}

function splitSourceFragments(source = "") {
  const normalized = String(source || "").replace(/<br\s*\/?>/gi, "\n");
  const firstPass = normalized.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const fragments = firstPass.length ? firstPass : [normalized.trim()].filter(Boolean);
  return fragments.flatMap((fragment) => {
    if (/^S\d+(,\s*S\d+)*$/i.test(fragment)) return fragment.split(/\s*,\s*/);
    return [fragment];
  }).filter(Boolean);
}

function stripExtension(name = "") {
  return String(name || "").replace(/\.[^.]+$/, "");
}

function isListOfDatesMarkdownPath(filePath) {
  return normalizedPath(filePath) === "10_library/list of dates.md";
}

function normalizedPath(filePath = "") {
  return String(filePath || "").replace(/\\/g, "/").toLowerCase();
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
