import { postJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import { confirmCurrentArtifactRerun } from "../rerun-guardrails.js";
import { listOfDatesSummary, renderListOfDatesResultHtml } from "../views/listofdates-result.js";

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
    wireListOfDatesArtifactActions();
  }

  function wireListOfDatesArtifactActions() {
    const copyButton = editorContent.querySelector("[data-listofdates-copy-markdown]");
    if (!copyButton) return;
    const status = editorContent.querySelector("[data-listofdates-action-status]");

    copyButton.addEventListener("click", async () => {
      const filePath = copyButton.dataset.path;
      if (!filePath) return;
      setArtifactActionStatus(status, "Copying Markdown...");
      copyButton.disabled = true;
      try {
        const markdown = await readWorkspaceTextFile(filePath);
        await writeClipboardText(markdown);
        setArtifactActionStatus(status, "Markdown copied.");
      } catch (error) {
        setArtifactActionStatus(status, `Copy failed: ${error.message}`, true);
      } finally {
        copyButton.disabled = false;
      }
    });
  }

  async function runCreateListOfDates(command) {
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No matter loaded</strong><br />Pick a matter from Home before running /create_listofdates.",
        bar: "No Matter",
        terminal: "[listofdates] no active matter",
      });
      return;
    }

    if (!await confirmCurrentArtifactRerun({
      ctx,
      skill: "/create_listofdates",
      escapeHtml,
      title: `Review List of Dates before regenerating — ${activeMatter.folderName}`,
      confirmLabel: "Regenerate List of Dates",
      cancelLabel: "Keep current List of Dates",
    })) {
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Run cancelled</strong><br />Existing List of Dates artifacts were left unchanged.",
        bar: "List of Dates Cancelled",
        terminal: "[listofdates] rerun cancelled by user",
      });
      editorContent.innerHTML = `
        <h1>/create_listofdates — ${escapeHtml(activeMatter.folderName)}</h1>
        <p>Run cancelled. Existing <code>10_Library/List of Dates.md</code> and <code>10_Library/List of Dates.json</code> were left unchanged.</p>
        <div class="form-actions">
          <button type="button" class="run-skill-button secondary" id="runListOfDatesBack">Back to overview</button>
        </div>
      `;
      const back = document.getElementById("runListOfDatesBack");
      if (back) back.addEventListener("click", ctx.goToExplorer);
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

async function readWorkspaceTextFile(filePath) {
  const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `file API returned ${response.status}`);
  if (typeof result.content !== "string") throw new Error("file preview did not include text content");
  return result.content;
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
  try {
    if (!document.execCommand("copy")) throw new Error("clipboard copy was rejected");
  } finally {
    document.body.removeChild(scratch);
  }
}

function setArtifactActionStatus(statusElement, message, isError = false) {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.classList.toggle("form-error", isError);
  statusElement.classList.toggle("muted", !isError);
}
