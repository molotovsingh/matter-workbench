import { postJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import { confirmCurrentArtifactRerun } from "../rerun-guardrails.js";
import {
  renderSourceDescriptorsResultHtml,
  sourceDescriptorsSummary,
} from "../views/source-descriptors-result.js";

export function createDescribeSourcesSkill(ctx) {
  const { breadcrumbs, editorContent } = ctx.elements;

  function renderDescribeSourcesResult(result) {
    const { counts, warningsCount, needsReviewCount } = sourceDescriptorsSummary(result);
    const described = counts.descriptors || 0;

    ctx.setStatus({
      mood: warningsCount || needsReviewCount ? "idle" : "success",
      card: `<strong>source descriptors complete</strong><br />${described} source descriptors written${warningsCount ? `; ${warningsCount} warning(s).` : "."}`,
      bar: "Source Descriptors Complete",
      terminal: result.outputLines || [],
    });

    editorContent.innerHTML = renderSourceDescriptorsResultHtml(result, escapeHtml);
  }

  async function runDescribeSources(command) {
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No matter loaded</strong><br />Pick a matter from the sidebar before running /describe_sources.",
        bar: "No Matter",
        terminal: "[source-index] no active matter",
      });
      return;
    }

    if (!await confirmCurrentArtifactRerun({
      ctx,
      skill: "/describe_sources",
      escapeHtml,
      title: `Review source labels before regenerating — ${activeMatter.folderName}`,
      confirmLabel: "Regenerate source labels",
      cancelLabel: "Keep current source labels",
    })) {
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Run cancelled</strong><br />Existing Source Index artifact was left unchanged.",
        bar: "Source Descriptors Cancelled",
        terminal: "[source-index] rerun cancelled by user",
      });
      editorContent.innerHTML = `
        <h1>/describe_sources — ${escapeHtml(activeMatter.folderName)}</h1>
        <p>Run cancelled. Existing <code>10_Library/Source Index.json</code> was left unchanged.</p>
        <div class="form-actions">
          <button type="button" class="run-skill-button secondary" id="runDescribeSourcesBack">Back to overview</button>
        </div>
      `;
      const back = document.getElementById("runDescribeSourcesBack");
      if (back) back.addEventListener("click", ctx.goToExplorer);
      return;
    }

    ctx.setActivityActive("explorer");
    breadcrumbs.textContent = `${activeMatter.folderName} > /describe_sources`;
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Running /describe_sources</strong><br />Generating source labels from extraction records...",
      bar: "Source Descriptors Running",
      terminal: [
        `> workbench.run ${command}`,
        "[source-index] reading extraction records...",
        "[source-index] calling AI provider...",
      ],
    });
    editorContent.innerHTML = `<h1>/describe_sources — ${escapeHtml(activeMatter.folderName)}</h1><p>Generating source index...</p>`;

    try {
      const payload = await postJson("/api/describe-sources", { dryRun: false });
      renderDescribeSourcesResult(payload);
      await ctx.refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
    } catch (error) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Source descriptors failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Source Descriptors Failed",
        terminal: `[source-index] failed: ${error.message}`,
      });
      editorContent.innerHTML = `
        <h1>/describe_sources — ${escapeHtml(activeMatter.folderName)}</h1>
        <p class="form-error">Source descriptors failed: ${escapeHtml(error.message)}</p>
        <div class="form-actions">
          <button type="button" class="run-skill-button" id="runDescribeSourcesRetry">Try again</button>
          <button type="button" class="run-skill-button secondary" id="runDescribeSourcesBack">Back to overview</button>
        </div>
      `;
      const retry = document.getElementById("runDescribeSourcesRetry");
      if (retry) retry.addEventListener("click", () => runDescribeSources(command));
      const back = document.getElementById("runDescribeSourcesBack");
      if (back) back.addEventListener("click", ctx.goToExplorer);
    }
  }

  return { renderDescribeSourcesResult, runDescribeSources };
}
