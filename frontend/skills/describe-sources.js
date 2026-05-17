import { postJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import { lawyerActionCompleteLabel, lawyerActionLabel, lawyerActionRunningLabel } from "../lawyer-labels.js";
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
      card: `<strong>${lawyerActionCompleteLabel("/describe_sources")}</strong><br />${described} source label${described === 1 ? "" : "s"} written${warningsCount ? `; ${warningsCount} warning(s).` : "."}`,
      bar: "Source Labels Complete",
      terminal: result.outputLines || [],
    });

    editorContent.innerHTML = renderSourceDescriptorsResultHtml(result, escapeHtml);
  }

  async function runDescribeSources(command) {
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>No matter loaded</strong><br />Pick a matter from Home before running ${lawyerActionLabel("/describe_sources")}.`,
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
        card: "<strong>Run cancelled</strong><br />Existing source labels were left unchanged.",
        bar: "Source Labels Cancelled",
        terminal: "[source-index] rerun cancelled by user",
      });
      editorContent.innerHTML = `
        <h1>${lawyerActionLabel("/describe_sources")} — ${escapeHtml(activeMatter.folderName)}</h1>
        <p>Run cancelled. Existing source labels were left unchanged.</p>
        <div class="form-actions">
          <button type="button" class="run-skill-button secondary" id="runDescribeSourcesBack">Back to overview</button>
        </div>
      `;
      const back = document.getElementById("runDescribeSourcesBack");
      if (back) back.addEventListener("click", ctx.goToExplorer);
      return;
    }

    ctx.setActivityActive("explorer");
    breadcrumbs.textContent = `${activeMatter.folderName} > ${lawyerActionLabel("/describe_sources")}`;
    ctx.setStatus({
      mood: "idle",
      card: `<strong>${lawyerActionRunningLabel("/describe_sources")}</strong><br />Reading extracted documents and preparing source labels...`,
      bar: "Source Labels Running",
      terminal: [
        `> workbench.run ${command}`,
        "[source-index] reading extraction records...",
        "[source-index] calling AI provider...",
      ],
    });
    editorContent.innerHTML = `<h1>${lawyerActionLabel("/describe_sources")} — ${escapeHtml(activeMatter.folderName)}</h1><p>Preparing source labels...</p>`;

    try {
      const payload = await postJson("/api/describe-sources", { dryRun: false });
      renderDescribeSourcesResult(payload);
      await ctx.refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
    } catch (error) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Source labels failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Source Labels Failed",
        terminal: `[source-index] failed: ${error.message}`,
      });
      editorContent.innerHTML = `
        <h1>${lawyerActionLabel("/describe_sources")} — ${escapeHtml(activeMatter.folderName)}</h1>
        <p class="form-error">Source labels failed: ${escapeHtml(error.message)}</p>
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
