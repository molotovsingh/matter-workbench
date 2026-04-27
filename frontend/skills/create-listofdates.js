import { postJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import { listOfDatesSummary, renderListOfDatesResultHtml } from "../views/listofdates-result.js";

export function createListOfDatesSkill(ctx) {
  const { breadcrumbs, editorContent } = ctx.elements;

  function renderListOfDatesResult(result) {
    const { counts } = listOfDatesSummary(result);

    ctx.setStatus({
      mood: "success",
      card: `<strong>list of dates complete</strong><br />${counts.entries || 0} accepted from ${counts.candidateEntries || 0} AI candidate events.`,
      bar: "List of Dates Complete",
      terminal: result.outputLines || [],
    });

    editorContent.innerHTML = renderListOfDatesResultHtml(result, escapeHtml);
  }

  async function runCreateListOfDates(command) {
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No matter loaded</strong><br />Pick a matter from the sidebar before running /create_listofdates.",
        bar: "No Matter",
        terminal: "[listofdates] no active matter",
      });
      return;
    }

    ctx.setActivityActive("explorer");
    breadcrumbs.textContent = `${activeMatter.folderName} > /create_listofdates`;
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Running /create_listofdates</strong><br />Generating AI chronology from extraction records...",
      bar: "List of Dates Running",
      terminal: [
        `> workbench.run ${command}`,
        "[listofdates] reading extraction records...",
        "[listofdates] calling AI provider...",
      ],
    });
    editorContent.innerHTML = `<h1>/create_listofdates — ${escapeHtml(activeMatter.folderName)}</h1><p>Generating list of dates...</p>`;

    try {
      const payload = await postJson("/api/create-listofdates", { dryRun: false });
      renderListOfDatesResult(payload);
      await ctx.refreshWorkspace({ silent: true, preserveStatus: true, preserveEditor: true });
    } catch (error) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>List of dates failed</strong><br />${escapeHtml(error.message)}`,
        bar: "List of Dates Failed",
        terminal: `[listofdates] failed: ${error.message}`,
      });
      editorContent.innerHTML = `
        <h1>/create_listofdates — ${escapeHtml(activeMatter.folderName)}</h1>
        <p class="form-error">List of dates failed: ${escapeHtml(error.message)}</p>
        <div class="form-actions">
          <button type="button" class="run-skill-button" id="runListOfDatesRetry">Try again</button>
          <button type="button" class="run-skill-button secondary" id="runListOfDatesBack">Back to overview</button>
        </div>
      `;
      const retry = document.getElementById("runListOfDatesRetry");
      if (retry) retry.addEventListener("click", () => runCreateListOfDates(command));
      const back = document.getElementById("runListOfDatesBack");
      if (back) back.addEventListener("click", ctx.goToExplorer);
    }
  }

  return { renderListOfDatesResult, runCreateListOfDates };
}
