import { postJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import { extractSummary, renderExtractResultHtml } from "../views/extract-result.js";

export function createExtractSkill(ctx) {
  const { breadcrumbs, editorContent } = ctx.elements;

  function renderExtractResult(result) {
    const { counts, totalSkipped } = extractSummary(result);

    ctx.setStatus({
      mood: counts.failed ? "idle" : "success",
      card: `<strong>extract complete</strong><br />${counts.extracted || 0} extracted, ${counts.cached || 0} cached, ${totalSkipped} skipped.`,
      bar: counts.failed ? "Extract Finished With Failures" : "Extract Complete",
      terminal: result.outputLines || [],
    });

    editorContent.innerHTML = renderExtractResultHtml(result, escapeHtml);
  }

  async function runExtract(command) {
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No matter loaded</strong><br />Pick a matter from the sidebar before running /extract.",
        bar: "No Matter",
        terminal: "[extract] no active matter",
      });
      return;
    }

    ctx.setActivityActive("explorer");
    breadcrumbs.textContent = `${activeMatter.folderName} > /extract`;
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Running /extract</strong><br />Generating extraction records...",
      bar: "Extract Running",
      terminal: [
        `> workbench.run ${command}`,
        "[extract] running deterministic local extraction...",
      ],
    });
    editorContent.innerHTML = `<h1>/extract — ${escapeHtml(activeMatter.folderName)}</h1><p>Extracting...</p>`;

    try {
      const payload = await postJson("/api/extract", { dryRun: false });
      renderExtractResult(payload);
      await ctx.refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
    } catch (error) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Extract failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Extract Failed",
        terminal: `[extract] failed: ${error.message}`,
      });
      editorContent.innerHTML = `
        <h1>/extract — ${escapeHtml(activeMatter.folderName)}</h1>
        <p class="form-error">Extraction failed: ${escapeHtml(error.message)}</p>
        <div class="form-actions">
          <button type="button" class="run-skill-button" id="runExtractRetry">Try again</button>
          <button type="button" class="run-skill-button secondary" id="runExtractBack">Back to overview</button>
        </div>
      `;
      const retry = document.getElementById("runExtractRetry");
      if (retry) retry.addEventListener("click", () => runExtract(command));
      const back = document.getElementById("runExtractBack");
      if (back) back.addEventListener("click", ctx.goToExplorer);
    }
  }

  return { renderExtractResult, runExtract };
}
