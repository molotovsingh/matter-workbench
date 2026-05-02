import { postJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import {
  listOfDatesRawFileUrl,
  listOfDatesSummary,
  renderListOfDatesResultHtml,
} from "../views/listofdates-result.js";

export function createListOfDatesSkill(ctx) {
  const { breadcrumbs, editorContent } = ctx.elements;

  function renderListOfDatesResult(result) {
    const { counts } = listOfDatesSummary(result);
    const accepted = counts.acceptedEntries ?? counts.entries ?? 0;
    const rendered = counts.entries ?? accepted;
    const clustered = counts.clusteredEntries ?? 0;

    ctx.setStatus({
      mood: "success",
      card: `<strong>list of dates complete</strong><br />${rendered} chronology rows from ${accepted} accepted events${clustered ? `; ${clustered} clustered.` : "."}`,
      bar: "List of Dates Complete",
      terminal: result.outputLines || [],
    });

    editorContent.innerHTML = renderListOfDatesResultHtml(result, escapeHtml);
    wireListOfDatesOutputActions();
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

function wireListOfDatesOutputActions() {
  const copyButton = document.getElementById("copyListOfDatesMarkdown");
  if (!copyButton) return;
  const status = document.getElementById("listOfDatesCopyStatus");
  copyButton.addEventListener("click", async () => {
    const markdownPath = copyButton.dataset.path || "";
    if (!markdownPath) return;
    copyButton.disabled = true;
    setCopyStatus(status, "Copying...");
    try {
      const response = await fetch(listOfDatesRawFileUrl(markdownPath));
      if (!response.ok) throw new Error(`Markdown file returned ${response.status}`);
      await copyTextToClipboard(await response.text());
      setCopyStatus(status, "Copied Markdown.");
    } catch (error) {
      setCopyStatus(status, `Copy failed: ${error.message}`);
    } finally {
      copyButton.disabled = false;
    }
  });
}

function setCopyStatus(status, message) {
  if (status) status.textContent = message;
}

async function copyTextToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}
