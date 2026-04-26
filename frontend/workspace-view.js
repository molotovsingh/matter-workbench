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
      editorContent.innerHTML = `
        <h1>${escapeHtml(result.name)}</h1>
        <p><code>${escapeHtml(result.path)}</code></p>
        <pre class="json-preview">${escapeHtml(result.content)}</pre>
      `;
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
