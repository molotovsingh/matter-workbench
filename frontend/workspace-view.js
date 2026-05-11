import { escapeHtml, formatBytes } from "./dom-utils.js";

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

export function createWorkspaceView(ctx) {
  const { breadcrumbs, editorContent, statusBarRight, workspaceTree } = ctx.elements;

  function renderWorkspaceTree(activeMatter = ctx.getActiveMatter()) {
    if (activeMatter.tree) {
      workspaceTree.innerHTML = renderTreeNode(activeMatter.tree);
      return;
    }
    workspaceTree.innerHTML = '<li class="tree-node">Loading workspace...</li>';
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

  return { openFilePreview, renderWorkspaceTree };
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

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for embedded browser contexts that expose Clipboard API but deny write permission.
    }
  }

  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  scratch.style.position = "fixed";
  scratch.style.top = "-9999px";
  document.body.appendChild(scratch);
  scratch.select();
  document.execCommand("copy");
  scratch.remove();
}

function setArtifactActionStatus(status, message, isError = false) {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("form-error", isError);
}
