import { getJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import {
  formatContextSearchReport,
  renderContextSearchResultHtml,
} from "../views/context-search-result.js";

export function createContextSearchSkill(ctx, options = {}) {
  const { breadcrumbs, editorContent } = ctx.elements;
  const writeClipboardText = options.writeClipboardText || writeClipboard;

  async function runContextSearch(commandOrOptions = "/context_search") {
    const options = typeof commandOrOptions === "object" && commandOrOptions !== null
      ? commandOrOptions
      : { command: String(commandOrOptions || "/context_search"), query: "" };
    const command = options.command || "/context_search";
    const query = String(options.query || "").trim();
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No matter loaded</strong><br />Pick a matter from Home before searching context.",
        bar: "No Matter",
        terminal: "[context-search] no active matter",
      });
      return;
    }
    if (!query) {
      renderSearchPrompt(command);
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Search query required</strong><br />Use <code>search &lt;term&gt;</code> or <code>find &lt;term&gt;</code>.",
        bar: "Search Query Required",
        terminal: "[context-search] query required",
      });
      return;
    }

    ctx.setActivityActive("explorer");
    breadcrumbs.textContent = `${activeMatter.folderName} > ${command}`;
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Searching context</strong><br />Looking for <code>${escapeHtml(query)}</code> in the bounded matter context packet...`,
      bar: "Context Search Running",
      terminal: [
        `> workbench.run ${command}`,
        `[context-search] query: ${query}`,
        "[context-search] provider calls disabled for local search",
      ],
    });
    editorContent.innerHTML = `<h1>Context Search</h1><p>Searching matter context...</p>`;

    try {
      const payload = await getJson(`/api/matter-context/search?q=${encodeURIComponent(query)}`);
      renderContextSearchResult(payload);
    } catch (error) {
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Context search failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Context Search Failed",
        terminal: `[context-search] failed: ${error.message}`,
      });
      editorContent.innerHTML = `
        <h1>Context Search</h1>
        <p class="form-error">Context search failed: ${escapeHtml(error.message)}</p>
      `;
    }
  }

  function renderSearchPrompt(command) {
    ctx.setActivityActive("explorer");
    breadcrumbs.textContent = `command > ${command}`;
    editorContent.innerHTML = `
      <h1>Context Search</h1>
      <p>Type <code>search &lt;term&gt;</code> or <code>find &lt;term&gt;</code> in the Command panel. Search is local, read-only, and uses the bounded matter context packet.</p>
    `;
  }

  function renderContextSearchResult(result) {
    const counts = result.counts || {};
    ctx.setStatus({
      mood: "success",
      card: `<strong>Context search ready</strong><br />${counts.matches || 0} match(es) across ${counts.sources || 0} source(s).`,
      bar: "Context Search Ready",
      terminal: [
        `[context-search] matches: ${counts.matches || 0}`,
        `[context-search] sources: ${counts.sources || 0}`,
        `[context-search] provider calls: none`,
      ],
    });

    editorContent.innerHTML = renderContextSearchResultHtml(result, escapeHtml);
    const copyButton = document.getElementById("copyContextSearchReportButton");
    if (copyButton) {
      copyButton.addEventListener("click", async () => {
        copyButton.disabled = true;
        try {
          await writeClipboardText(formatContextSearchReport(result));
          ctx.setStatus({
            mood: "success",
            card: "<strong>Search report copied</strong><br />The report includes query, counts, source labels, citations, and bounded snippets.",
            bar: "Search Report Copied",
            terminal: "[context-search] report copied",
          });
        } catch (error) {
          ctx.setStatus({
            mood: "idle",
            card: `<strong>Copy failed</strong><br />${escapeHtml(error.message)}`,
            bar: "Copy Failed",
            terminal: `[context-search] copy failed: ${error.message}`,
          });
        } finally {
          copyButton.disabled = false;
        }
      });
    }
  }

  return { renderContextSearchResult, runContextSearch };
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
