import { postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import { renderRouterDecision, wireRouterGateButtons } from "./skill-router-panel.js";

const SLASH_COMMANDS = new Set([
  "/matter-init",
  "/extract",
  "/describe_sources",
  "/create_listofdates",
  "/doctor",
]);

const COMMAND_ALIASES = new Map([
  ["extract", "/extract"],
  ["describe sources", "/describe_sources"],
  ["source labels", "/describe_sources"],
  ["list of dates", "/create_listofdates"],
  ["chronology", "/create_listofdates"],
  ["doctor", "/doctor"],
]);

const STATUS_ALIASES = new Set(["show status", "status"]);

export function createAiCommandBox(ctx, options = {}) {
  const {
    aiCommandForm,
    aiCommandInput,
    aiCommandSubmit,
    breadcrumbs,
    editorContent,
  } = ctx.elements;
  const skillDispatch = options.skillDispatch || {};

  function wire() {
    if (!aiCommandForm) return;
    aiCommandForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await handleCommand({
        userRequest: aiCommandInput.value.trim(),
      });
    });
  }

  async function handleCommand({ userRequest }) {
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
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = parsedCommand.type === "status" ? "Opening..." : "Running...";
    try {
      if (parsedCommand.type === "status") {
        showMatterStatus(userRequest);
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
        return;
      }

      ctx.setStatus({
        mood: "idle",
        card: `<strong>Command matched</strong><br /><code>${escapeHtml(userRequest)}</code> -> <code>${escapeHtml(parsedCommand.command)}</code>.`,
        bar: "Command Matched",
        terminal: `[ai-command] ${userRequest} -> ${parsedCommand.command}`,
      });
      await runSkill(parsedCommand.command);
    } finally {
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "Go";
    }
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
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Router decision</strong><br />${escapeHtml(decision.decision)}${decision.matched_skill ? ` for <code>${escapeHtml(decision.matched_skill)}</code>` : ""}.`,
        bar: "Router Ready",
        terminal: `[ai-command] ${decision.decision}${decision.matched_skill ? ` -> ${decision.matched_skill}` : ""}`,
      });
    } catch (error) {
      renderCommandError(error.message);
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Command check failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Command Check Failed",
        terminal: `[ai-command] failed: ${error.message}`,
      });
    } finally {
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

  return {
    checkIntent,
    handleCommand,
    wire,
  };
}

export function parseDeterministicCommand(input) {
  const normalized = normalizeCommandInput(input);
  if (!normalized) return null;
  if (STATUS_ALIASES.has(normalized)) return { type: "status" };
  if (SLASH_COMMANDS.has(normalized)) return { type: "skill", command: normalized };
  const aliasCommand = COMMAND_ALIASES.get(normalized);
  if (aliasCommand) return { type: "skill", command: aliasCommand };
  return null;
}

function normalizeCommandInput(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
