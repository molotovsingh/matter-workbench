import { getJson, postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import { renderRouterDecision, wireRouterGateButtons } from "./skill-router-panel.js";

const SLASH_COMMANDS = new Set([
  "/matter-init",
  "/extract",
  "/describe_sources",
  "/context_preview",
  "/context_search",
  "/create_listofdates",
  "/doctor",
]);

const SLASH_COMMAND_SUGGESTIONS = [
  {
    command: "/matter-init",
    description: "Initialize the matter folders and file register.",
  },
  {
    command: "/extract",
    description: "Extract text and OCR-ready records from registered files.",
  },
  {
    command: "/describe_sources",
    description: "Generate lawyer-readable source labels. Paid reruns ask first.",
  },
  {
    command: "/context_preview",
    description: "Preview the bounded evidence packet for future Q&A/search. No provider call.",
  },
  {
    command: "/context_search",
    description: "Search the bounded matter context locally. No provider call.",
  },
  {
    command: "/create_listofdates",
    description: "Generate the lawyer-facing chronology. Paid reruns ask first.",
  },
  {
    command: "/doctor",
    description: "Check and repair known matter workspace issues.",
  },
];

const COMMAND_ALIASES = new Map([
  ["extract", "/extract"],
  ["describe sources", "/describe_sources"],
  ["source labels", "/describe_sources"],
  ["context", "/context_preview"],
  ["show context", "/context_preview"],
  ["list of dates", "/create_listofdates"],
  ["chronology", "/create_listofdates"],
  ["doctor", "/doctor"],
]);

const LANE_COMMANDS = new Map([
  ["open inbox", "00_Inbox"],
  ["open library", "10_Library"],
  ["show library", "10_Library"],
  ["open workshop", "20_Workshop"],
  ["open drafts", "30_Drafts"],
  ["show drafts", "30_Drafts"],
  ["open dispatch", "40_Dispatch"],
]);

const STATUS_ALIASES = new Set(["show status", "status"]);

export function createAiCommandBox(ctx, options = {}) {
  const {
    aiCommandForm,
    aiCommandInput,
    aiCommandSubmit,
    aiCommandSuggestions,
    aiCommandCopyReport,
    aiCommandReportStatus,
    breadcrumbs,
    editorContent,
    statusBarRight,
    terminalOutput,
  } = ctx.elements;
  const skillDispatch = options.skillDispatch || {};
  const now = options.now || (() => new Date());
  const loadMatterStatus = options.loadMatterStatus || (() => getJson("/api/matter-status"));
  const writeClipboardText = options.writeClipboardText || writeClipboard;
  let latestReport = null;
  let activeSuggestionIndex = -1;

  function wire() {
    if (!aiCommandForm) return;
    aiCommandForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await handleCommand({
        userRequest: aiCommandInput.value.trim(),
      });
    });
    aiCommandInput?.addEventListener?.("input", () => renderSlashSuggestions());
    aiCommandInput?.addEventListener?.("focus", () => renderSlashSuggestions());
    aiCommandInput?.addEventListener?.("keydown", async (event) => {
      await handleSuggestionKeydown(event);
    });
    aiCommandInput?.addEventListener?.("blur", () => {
      setTimeout(hideSlashSuggestions, 120);
    });
    if (aiCommandCopyReport) {
      aiCommandCopyReport.addEventListener("click", copyLatestReport);
    }
  }

  async function handleCommand({ userRequest }) {
    hideSlashSuggestions();
    if (!userRequest) {
      renderCommandError("Enter a slash command or proposed skill request.");
      return;
    }

    const parsedCommand = parseDeterministicCommand(userRequest);
    if (parsedCommand) {
      await runDeterministicCommand(parsedCommand, userRequest);
      return;
    }

    await checkIntent({
      userRequest,
      overrideJustification: "",
    });
  }

  async function runDeterministicCommand(parsedCommand, userRequest) {
    startReport({
      typedInput: userRequest,
      matchedCommand: parsedCommand.command || parsedCommand.input || "status",
      status: "pending",
    });
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = parsedCommand.type === "search"
      ? "Searching..."
      : parsedCommand.type === "skill"
        ? "Running..."
        : "Opening...";
    const restoreStatus = captureStatusDuringCommand();
    try {
      if (parsedCommand.type === "status") {
        showMatterStatus(userRequest);
        updateReport({ status: "ran" });
        return;
      }
      if (parsedCommand.type === "lane") {
        const result = showWorkspaceLane(parsedCommand, userRequest);
        updateReport({ status: result?.ok ? "ran" : "failed" });
        return;
      }
      if (parsedCommand.type === "search") {
        await runContextSearch(parsedCommand, userRequest);
        if (latestReport?.status === "pending" || latestReport?.status === "warned") {
          updateReport({ status: "ran" });
        }
        return;
      }

      const runSkill = skillDispatch[parsedCommand.command];
      if (!runSkill) {
        renderCommandError(`No runner is wired for ${parsedCommand.command}.`);
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Command unavailable</strong><br />No runner is wired for <code>${escapeHtml(parsedCommand.command)}</code>.`,
          bar: "Command Unavailable",
          terminal: `[ai-command] no runner for ${parsedCommand.command}`,
        });
        updateReport({ status: "failed" });
        return;
      }

      ctx.setStatus({
        mood: "idle",
        card: `<strong>Command matched</strong><br /><code>${escapeHtml(userRequest)}</code> -> <code>${escapeHtml(parsedCommand.command)}</code>.`,
        bar: "Command Matched",
        terminal: `[ai-command] ${userRequest} -> ${parsedCommand.command}`,
      });
      await runSkill(parsedCommand.command);
      if (latestReport?.status === "pending" || latestReport?.status === "warned") {
        updateReport({ status: "ran" });
      }
    } catch (error) {
      updateReport({ status: "failed" });
      throw error;
    } finally {
      restoreStatus();
      updateReport({
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      });
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "Go";
    }
  }

  function showWorkspaceLane(parsedCommand, userRequest) {
    if (!ctx.openWorkspaceLane) {
      renderCommandError("Workspace lane navigation is unavailable.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Command unavailable</strong><br />Workspace lane navigation is not wired.",
        bar: "Command Unavailable",
        terminal: `[ai-command] lane navigation unavailable for ${parsedCommand.lanePath}`,
      });
      return { ok: false, reason: "unwired" };
    }

    ctx.setStatus({
      mood: "idle",
      card: `<strong>Command matched</strong><br /><code>${escapeHtml(userRequest)}</code> opens <code>${escapeHtml(parsedCommand.lanePath)}</code>.`,
      bar: "Command Matched",
      terminal: `[ai-command] ${userRequest} -> ${parsedCommand.lanePath}`,
    });
    return ctx.openWorkspaceLane(parsedCommand.lanePath);
  }

  async function runContextSearch(parsedCommand, userRequest) {
    const runSearch = skillDispatch[parsedCommand.command];
    if (!runSearch) {
      renderCommandError(`No runner is wired for ${parsedCommand.command}.`);
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Command unavailable</strong><br />No runner is wired for <code>${escapeHtml(parsedCommand.command)}</code>.`,
        bar: "Command Unavailable",
        terminal: `[ai-command] no runner for ${parsedCommand.command}`,
      });
      updateReport({ status: "failed" });
      return;
    }

    ctx.setStatus({
      mood: "idle",
      card: `<strong>Command matched</strong><br /><code>${escapeHtml(userRequest)}</code> searches the bounded matter context.`,
      bar: "Command Matched",
      terminal: `[ai-command] ${userRequest} -> ${parsedCommand.command}`,
    });
    await runSearch({
      command: parsedCommand.command,
      query: parsedCommand.query,
      typedInput: userRequest,
    });
  }

  function showMatterStatus(userRequest) {
    const activeMatter = ctx.getActiveMatter();
    if (!activeMatter.folderName) {
      renderCommandError("Pick a matter from the sidebar before showing status.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No matter loaded</strong><br />Pick a matter from the sidebar before showing status.",
        bar: "No Matter",
        terminal: "[ai-command] status requested without active matter",
      });
      return;
    }

    ctx.setStatus({
      mood: "idle",
      card: `<strong>Status</strong><br />Showing pipeline status for <code>${escapeHtml(activeMatter.folderName)}</code>.`,
      bar: "Matter Status",
      terminal: `[ai-command] ${userRequest} -> matter status`,
    });
    ctx.renderSkillOverview();
    if (typeof document !== "undefined") {
      setTimeout(() => {
        document.getElementById("matterPipelineStatus")?.scrollIntoView?.({ block: "start" });
      }, 0);
    }
  }

  async function checkIntent({ userRequest, overrideJustification }) {
    if (!userRequest) {
      renderCommandError("Enter a command or proposed skill request.");
      return;
    }

    startReport({
      typedInput: userRequest,
      matchedCommand: "router/check",
      status: "pending",
    });
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Checking...";
    breadcrumbs.textContent = "command";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Command</strong><br />Checking this proposed skill request against the registry.",
      bar: "Command Check",
      terminal: `[ai-command] checking intent: ${userRequest}`,
    });

    try {
      const decision = await postJson("/api/skills/check-intent", {
        userRequest,
        overrideJustification,
      });
      renderCommandDecision({ userRequest, overrideJustification, decision });
      updateReport({
        status: "checked",
        routerDecision: decision.decision || "",
        routerMatchedSkill: decision.matched_skill || "",
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Router decision</strong><br />${escapeHtml(decision.decision)}${decision.matched_skill ? ` for <code>${escapeHtml(decision.matched_skill)}</code>` : ""}.`,
        bar: "Router Ready",
        terminal: `[ai-command] ${decision.decision}${decision.matched_skill ? ` -> ${decision.matched_skill}` : ""}`,
      });
    } catch (error) {
      renderCommandError(error.message);
      updateReport({ status: "failed", error: error.message });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Command check failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Command Check Failed",
        terminal: `[ai-command] failed: ${error.message}`,
      });
    } finally {
      updateReport({
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      });
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "Go";
    }
  }

  function renderCommandDecision({ userRequest, overrideJustification, decision }) {
    editorContent.innerHTML = `
      <h1>Command</h1>
      <p><code>${escapeHtml(userRequest)}</code></p>
      <form class="new-matter-form ai-command-override-form" id="aiCommandOverrideForm" hidden>
        <label id="aiCommandOverrideLabel">
          <span>Override justification</span>
          <textarea id="aiCommandOverrideInput" spellcheck="true" placeholder="Explain the distinct purpose, input, output, workflow stage, legal setting, or audience.">${escapeHtml(overrideJustification || "")}</textarea>
        </label>
        <div class="form-actions">
          <button type="submit" id="aiCommandOverrideSubmit">Re-check with justification</button>
        </div>
        <div id="aiCommandOverrideError" class="form-error" hidden></div>
      </form>
      <div id="aiCommandResult" class="skill-router-result">
        ${renderRouterDecision(decision, { prefix: "aiCommand" })}
      </div>
    `;

    const overrideForm = document.getElementById("aiCommandOverrideForm");
    const overrideInput = document.getElementById("aiCommandOverrideInput");
    const overrideError = document.getElementById("aiCommandOverrideError");
    const resultBox = document.getElementById("aiCommandResult");

    wireRouterGateButtons({
      prefix: "aiCommand",
      decision,
      overrideLabel: overrideForm,
      overrideInput,
      resultBox,
      approveMessage: decision.matched_skill
        ? `Approved locally: this should become a modification request for ${decision.matched_skill}.`
        : "Approved locally: this should become a modification request.",
    });

    overrideForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const nextJustification = overrideInput.value.trim();
      if (!nextJustification) {
        overrideError.textContent = "Override justification is required.";
        overrideError.hidden = false;
        return;
      }
      overrideError.hidden = true;
      await checkIntent({ userRequest, overrideJustification: nextJustification });
    });
  }

  function renderCommandError(message) {
    breadcrumbs.textContent = "command";
    editorContent.innerHTML = `
      <h1>Command</h1>
      <p class="form-error">${escapeHtml(message)}</p>
    `;
  }

  function renderSlashSuggestions() {
    if (!aiCommandSuggestions || !aiCommandInput) return;
    const suggestions = listSlashCommandSuggestions(aiCommandInput.value);
    if (!suggestions.length) {
      hideSlashSuggestions();
      return;
    }
    activeSuggestionIndex = Math.min(Math.max(activeSuggestionIndex, 0), suggestions.length - 1);
    aiCommandSuggestions.hidden = false;
    aiCommandSuggestions.innerHTML = suggestions.map((suggestion, index) => `
      <button
        type="button"
        class="command-suggestion${index === activeSuggestionIndex ? " active" : ""}"
        data-command-suggestion="${escapeHtml(suggestion.command)}"
        role="option"
        aria-selected="${index === activeSuggestionIndex ? "true" : "false"}"
      >
        <strong>${escapeHtml(suggestion.command)}</strong>
        <span>${escapeHtml(suggestion.description)}</span>
      </button>
    `).join("");
    aiCommandSuggestions.querySelectorAll("[data-command-suggestion]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", async () => {
        await runSuggestedCommand(button.dataset.commandSuggestion);
      });
    });
  }

  async function handleSuggestionKeydown(event) {
    if (!aiCommandInput || !aiCommandSuggestions) return;
    const suggestions = listSlashCommandSuggestions(aiCommandInput.value);
    if (!suggestions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeSuggestionIndex = activeSuggestionIndex < 0
        ? 0
        : (activeSuggestionIndex + 1) % suggestions.length;
      renderSlashSuggestions();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeSuggestionIndex = activeSuggestionIndex < 0
        ? suggestions.length - 1
        : (activeSuggestionIndex - 1 + suggestions.length) % suggestions.length;
      renderSlashSuggestions();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideSlashSuggestions();
      return;
    }
    if (event.key === "Enter" && !aiCommandSuggestions.hidden && activeSuggestionIndex >= 0) {
      event.preventDefault();
      await runSuggestedCommand(suggestions[activeSuggestionIndex].command);
    }
  }

  async function runSuggestedCommand(command) {
    if (!command || !aiCommandInput) return;
    aiCommandInput.value = command;
    hideSlashSuggestions();
    await handleCommand({ userRequest: command });
  }

  function hideSlashSuggestions() {
    activeSuggestionIndex = -1;
    if (!aiCommandSuggestions) return;
    aiCommandSuggestions.hidden = true;
    aiCommandSuggestions.innerHTML = "";
  }

  function startReport({ typedInput, matchedCommand, status }) {
    const activeMatter = ctx.getActiveMatter?.() || {};
    latestReport = {
      timestamp: now().toISOString(),
      matterName: activeMatter.metadata?.matterName || activeMatter.folderName || "No active matter",
      matterFolder: activeMatter.folderName || "",
      typedInput,
      matchedCommand,
      status,
      routerDecision: "",
      routerMatchedSkill: "",
      providerModel: "",
      artifacts: [],
      statusBar: getStatusBarText(),
      terminalLines: getLatestTerminalLines(),
      error: "",
    };
    setReportStatus("Report tracking current command.");
    setCopyReportEnabled(true);
  }

  function updateReport(patch) {
    if (!latestReport) return;
    latestReport = { ...latestReport, ...patch };
    setCopyReportEnabled(true);
  }

  function captureStatusDuringCommand() {
    const originalSetStatus = ctx.setStatus;
    ctx.setStatus = (status = {}) => {
      originalSetStatus(status);
      captureStatusForReport(status);
    };
    return () => {
      ctx.setStatus = originalSetStatus;
    };
  }

  function captureStatusForReport(status = {}) {
    if (!latestReport) return;
    const bar = String(status.bar || "");
    const terminalLines = normalizeTerminalLines(status.terminal);
    const patch = {
      statusBar: bar || getStatusBarText(),
      terminalLines: getLatestTerminalLines(),
    };
    if (/rerun confirmation/i.test(bar)) patch.status = "warned";
    if (/cancelled/i.test(bar) || terminalLines.some((line) => /cancelled by user/i.test(line))) patch.status = "cancelled";
    if (/failed|unavailable/i.test(bar) || terminalLines.some((line) => /\bfailed\b/i.test(line))) patch.status = "failed";
    if (/complete|matter status/i.test(bar)) patch.status = "ran";
    updateReport(patch);
  }

  async function copyLatestReport() {
    if (!latestReport) {
      setReportStatus("Run or check a command first.", true);
      return;
    }
    setReportStatus("Copying report...");
    if (aiCommandCopyReport) aiCommandCopyReport.disabled = true;
    try {
      const report = await enrichReport(latestReport);
      await writeClipboardText(formatCommandReport(report));
      latestReport = report;
      setReportStatus("Report copied.");
    } catch (error) {
      setReportStatus(`Copy failed: ${error.message}`, true);
    } finally {
      setCopyReportEnabled(Boolean(latestReport));
    }
  }

  async function enrichReport(report) {
    if (!report?.matchedCommand || report.matchedCommand === "router/check" || report.matchedCommand === "status") {
      return {
        ...report,
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      };
    }
    try {
      const status = await loadMatterStatus();
      const stage = Array.isArray(status?.stages)
        ? status.stages.find((candidate) => candidate.slash === report.matchedCommand)
        : null;
      if (!stage) return report;
      const aiRun = stage.aiRun || {};
      const provider = aiRun.returnedProvider || aiRun.provider || stage.rerunAdvice?.provider || "";
      const model = aiRun.model || stage.rerunAdvice?.model || "";
      return {
        ...report,
        providerModel: [provider, model].filter(Boolean).join(" / "),
        artifacts: Array.isArray(stage.artifacts) ? stage.artifacts : [],
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      };
    } catch {
      return {
        ...report,
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      };
    }
  }

  function setCopyReportEnabled(enabled) {
    if (aiCommandCopyReport) aiCommandCopyReport.disabled = !enabled;
  }

  function setReportStatus(message, isError = false) {
    if (!aiCommandReportStatus) return;
    aiCommandReportStatus.textContent = message;
    aiCommandReportStatus.classList?.toggle?.("form-error", Boolean(isError));
  }

  function getStatusBarText() {
    return statusBarRight?.textContent?.trim?.() || "";
  }

  function getLatestTerminalLines() {
    const existing = terminalOutput?.textContent
      ? terminalOutput.textContent.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
    return existing.slice(-8);
  }

  return {
    checkIntent,
    handleCommand,
    copyLatestReport,
    wire,
  };
}

export function parseDeterministicCommand(input) {
  const normalized = normalizeCommandInput(input);
  if (!normalized) return null;
  const searchCommand = parseSearchCommand(normalized);
  if (searchCommand) return searchCommand;
  if (STATUS_ALIASES.has(normalized)) return { type: "status" };
  const lanePath = LANE_COMMANDS.get(normalized);
  if (lanePath) return { type: "lane", input: normalized, lanePath };
  if (SLASH_COMMANDS.has(normalized)) return { type: "skill", command: normalized };
  const aliasCommand = COMMAND_ALIASES.get(normalized);
  if (aliasCommand) return { type: "skill", command: aliasCommand };
  return null;
}

function parseSearchCommand(normalized) {
  if (normalized === "search" || normalized === "find" || normalized === "/context_search") {
    return { type: "search", command: "/context_search", query: "" };
  }
  for (const prefix of ["search ", "find ", "/context_search "]) {
    if (normalized.startsWith(prefix)) {
      return {
        type: "search",
        command: "/context_search",
        query: normalized.slice(prefix.length).trim(),
      };
    }
  }
  return null;
}

export function listSlashCommandSuggestions(input) {
  const raw = String(input || "");
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.startsWith("/")) return [];
  return SLASH_COMMAND_SUGGESTIONS.filter((suggestion) => suggestion.command.startsWith(trimmed));
}

function normalizeCommandInput(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeTerminalLines(terminal) {
  if (terminal === undefined || terminal === null) return [];
  const values = Array.isArray(terminal) ? terminal : [terminal];
  return values.map((line) => String(line)).filter(Boolean);
}

function formatCommandReport(report) {
  const lines = [
    "# Command Report",
    "",
    `- Matter: ${report.matterName || "Unknown"}`,
    `- Matter folder: ${report.matterFolder || "Unknown"}`,
    `- Timestamp: ${report.timestamp || ""}`,
    `- Typed input: \`${report.typedInput || ""}\``,
    `- Matched command: \`${report.matchedCommand || "none"}\``,
    `- Status: ${report.status || "unknown"}`,
  ];

  if (report.routerDecision) lines.push(`- Router/check result: ${report.routerDecision}${report.routerMatchedSkill ? ` -> ${report.routerMatchedSkill}` : ""}`);
  if (report.providerModel) lines.push(`- Provider/model: ${report.providerModel}`);
  if (report.error) lines.push(`- Error: ${report.error}`);
  if (Array.isArray(report.artifacts) && report.artifacts.length) {
    lines.push("- Artifact paths touched/preserved:");
    for (const artifact of report.artifacts.slice(0, 8)) {
      lines.push(`  - \`${artifact}\``);
    }
  }
  if (report.statusBar) lines.push(`- Visible status: ${report.statusBar}`);
  if (Array.isArray(report.terminalLines) && report.terminalLines.length) {
    lines.push("", "## Latest Terminal Lines", "", "```text", ...report.terminalLines, "```");
  }
  return lines.join("\n");
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
