import { getJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import {
  formatContextReport,
  renderContextPreviewResultHtml,
} from "../views/context-preview-result.js";

export function createContextPreviewSkill(ctx, options = {}) {
  const { breadcrumbs, editorContent } = ctx.elements;
  const writeClipboardText = options.writeClipboardText || writeClipboard;

  async function runContextPreview(command = "/context_preview") {
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No matter loaded</strong><br />Pick a matter from Home before showing context.",
        bar: "No Matter",
        terminal: "[context] no active matter",
      });
      return;
    }

    ctx.setActivityActive("explorer");
    breadcrumbs.textContent = `${activeMatter.folderName} > ${command}`;
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Reading context</strong><br />Building a safe preview of the matter evidence boundary...",
      bar: "Context Preview Running",
      terminal: [
        `> workbench.run ${command}`,
        "[context] reading matter artifacts...",
        "[context] provider calls disabled for preview",
      ],
    });
    editorContent.innerHTML = `<h1>Context Preview</h1><p>Reading matter context...</p>`;

    try {
      const payload = await getJson("/api/matter-context");
      renderContextPreviewResult(payload);
    } catch (error) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Context preview failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Context Preview Failed",
        terminal: `[context] failed: ${error.message}`,
      });
      editorContent.innerHTML = `
        <h1>Context Preview</h1>
        <p class="form-error">Context preview failed: ${escapeHtml(error.message)}</p>
      `;
    }
  }

  function renderContextPreviewResult(result) {
    const counts = result.counts || {};
    ctx.setStatus({
      mood: "success",
      card: `<strong>Context preview ready</strong><br />${counts.sources || 0} source(s), ${counts.evidence_blocks_included || 0} included block(s), ${counts.evidence_blocks_omitted || 0} omitted by bounds.`,
      bar: "Context Preview Ready",
      terminal: [
        `[context] sources: ${counts.sources || 0}`,
        `[context] evidence blocks: ${counts.evidence_blocks_included || 0} included, ${counts.evidence_blocks_omitted || 0} omitted`,
        `[context] provider calls: none`,
      ],
    });

    editorContent.innerHTML = renderContextPreviewResultHtml(result, escapeHtml);
    const copyButton = document.getElementById("copyContextReportButton");
    if (copyButton) {
      copyButton.addEventListener("click", async () => {
        copyButton.disabled = true;
        try {
          await writeClipboardText(formatContextReport(result));
          ctx.setStatus({
            mood: "success",
            card: "<strong>Context report copied</strong><br />The report includes counts, source labels, citations, warnings, and library summaries only.",
            bar: "Context Report Copied",
            terminal: "[context] report copied",
          });
        } catch (error) {
          ctx.setStatus({
            mood: "idle",
            card: `<strong>Copy failed</strong><br />${escapeHtml(error.message)}`,
            bar: "Copy Failed",
            terminal: `[context] copy failed: ${error.message}`,
          });
        } finally {
          copyButton.disabled = false;
        }
      });
    }
  }

  return { renderContextPreviewResult, runContextPreview };
}

async function writeClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") throw new Error("clipboard is unavailable");
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
