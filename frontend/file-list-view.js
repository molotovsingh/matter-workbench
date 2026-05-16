import { escapeHtml, formatBytes } from "./dom-utils.js";

export function renderCollectedFileListHtml(collectedFiles = []) {
  if (!collectedFiles.length) return "";
  const totalBytes = collectedFiles.reduce((sum, item) => sum + item.file.size, 0);
  const summary = `<li class="file-list-summary">${collectedFiles.length} file${collectedFiles.length === 1 ? "" : "s"} ready — ${formatBytes(totalBytes)}</li>`;
  const rows = collectedFiles
    .map((item) => `<li class="file-list-entry">${escapeHtml(item.relativePath)}</li>`)
    .join("");
  return summary + rows;
}

export function updateCollectedFileListElement(element, collectedFiles = []) {
  if (!element) return;
  if (!collectedFiles.length) {
    element.hidden = true;
    element.innerHTML = "";
    return;
  }
  element.hidden = false;
  element.innerHTML = renderCollectedFileListHtml(collectedFiles);
}
