import { getJson, postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import {
  buildSkillIdeaInterview,
  buildSkillIdeaPayloadFromInterview,
  parseAdaptiveSkillIdeaInput,
} from "./skill-idea-interview.js";
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
const SKILLS_ALIASES = new Set(["open skills", "show skills", "skills"]);

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
  const saveSkillIdea = options.saveSkillIdea || ((body) => postJson("/api/skill-ideas", body));
  const writeClipboardText = options.writeClipboardText || writeClipboard;
  let latestReport = null;
  let activeSuggestionIndex = -1;
  let currentSkillIdeaInterview = null;

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
      renderCommandError("Enter a slash command or future skill idea.");
      return;
    }

    const parsedCommand = parseDeterministicCommand(userRequest);
    if (parsedCommand) {
      await runDeterministicCommand(parsedCommand, userRequest);
      return;
    }

    const skillIdea = parseSkillIdeaInput(userRequest) || parseAdaptiveSkillIdeaInput(userRequest);
    if (skillIdea) {
      showSkillIdeaInterview(skillIdea, userRequest);
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
      if (parsedCommand.type === "skills") {
        await showSkillsPage(userRequest);
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

  async function showSkillsPage(userRequest) {
    if (!ctx.renderSkills) {
      renderCommandError("Skills view is unavailable.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Command unavailable</strong><br />Skills view is not wired.",
        bar: "Command Unavailable",
        terminal: "[ai-command] skills view unavailable",
      });
      updateReport({ status: "failed" });
      return;
    }

    ctx.setStatus({
      mood: "idle",
      card: `<strong>Command matched</strong><br /><code>${escapeHtml(userRequest)}</code> opens the read-only Skills page.`,
      bar: "Command Matched",
      terminal: `[ai-command] ${userRequest} -> skills`,
    });
    await ctx.renderSkills();
  }

  async function checkIntent({ userRequest, overrideJustification }) {
    if (!userRequest) {
      renderCommandError("Enter a command or future skill idea.");
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
      card: "<strong>Command</strong><br />Checking this future skill idea against the current skill list.",
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

  function showSkillIdeaInterview(skillIdea, userRequest) {
    const interview = buildSkillIdeaInterview(skillIdea, userRequest);
    currentSkillIdeaInterview = interview;
    startReport({
      typedInput: userRequest,
      matchedCommand: "skill_idea/interview",
      status: "interview",
    });
    breadcrumbs.textContent = "command";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Skill idea interview</strong><br />Answer a few questions before saving. Nothing will run.",
      bar: "Skill Idea Interview",
      terminal: `[skill-ideas] interview opened: ${userRequest}`,
    });
    renderSkillIdeaInterview({ interview });
  }

  async function saveSkillIdeaInterview({ interview, form }) {
    const designBrief = readDesignBriefFromForm(form, interview.designBrief);
    const answers = readInterviewAnswersFromForm(form, interview.questions);
    const payloadBody = buildSkillIdeaPayloadFromInterview({
      interview,
      answers,
      designBrief,
    });
    const submit = form.querySelector?.("[data-skill-idea-save]");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Saving...";
    }
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Saving idea</strong><br />Saving a non-running design brief.",
      bar: "Saving Skill Idea",
      terminal: `[skill-ideas] saving interview: ${interview.originalText}`,
    });
    try {
      const payload = await saveSkillIdea(payloadBody);
      const idea = payload.idea || {};
      renderSavedSkillIdea({ idea, userRequest: interview.originalText });
      updateReport({
        status: "saved",
        skillIdeaId: idea.id || "",
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Saved as skill idea</strong><br />This proposal is not a runnable skill. Review it in Skills under Saved Ideas.`,
        bar: "Skill Idea Saved",
        terminal: `[skill-ideas] saved ${idea.id || "proposal"}`,
      });
    } catch (error) {
      renderCommandError(error.message);
      updateReport({ status: "failed", error: error.message });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill idea not saved</strong><br />${escapeHtml(error.message)}`,
        bar: "Skill Idea Failed",
        terminal: `[skill-ideas] failed: ${error.message}`,
      });
    } finally {
      updateReport({
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      });
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Save idea";
      }
    }
  }

  function renderSkillIdeaInterview({ interview }) {
    editorContent.innerHTML = `
      <h1>Command</h1>
      <section class="skill-router-result skill-idea-interview">
        <h2>Skill idea interview</h2>
        <p class="muted">Not runnable yet. This card saves a design brief only.</p>
        <div class="skill-idea-understood">
          <strong>What I understood</strong>
          <p>${escapeHtml(interview.understood)}</p>
          ${interview.targetSkill ? `<p class="muted">Likely related skill: <code>${escapeHtml(interview.targetSkill)}</code></p>` : ""}
        </div>
        <form class="skill-idea-interview-form" id="skillIdeaInterviewForm">
          <div class="skill-idea-question-list">
            ${interview.questions.map((question) => `
              <label>
                <span>Question</span>
                <strong>${escapeHtml(question.label)}</strong>
                <textarea data-interview-answer="${escapeHtml(question.id)}" placeholder="${escapeHtml(question.placeholder || "")}"></textarea>
              </label>
            `).join("")}
          </div>
          <details class="skill-idea-brief" id="skillIdeaInterviewBrief">
            <summary>Edit inferred design brief</summary>
            <p class="muted">These fields are saved into the same design brief shown in Skills.</p>
            ${renderDesignBriefFields(interview.designBrief)}
          </details>
          <div class="form-actions">
            <button type="submit" data-skill-idea-save>Save idea</button>
            <button type="button" class="secondary" data-skill-idea-edit>Edit</button>
            <button type="button" class="secondary" data-skill-idea-cancel>Cancel</button>
          </div>
        </form>
      </section>
    `;
    wireSkillIdeaInterviewForm(interview);
  }

  function wireSkillIdeaInterviewForm(interview) {
    if (typeof document === "undefined") return;
    const form = document.getElementById("skillIdeaInterviewForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveSkillIdeaInterview({ interview, form });
    });
    form.querySelector("[data-skill-idea-edit]")?.addEventListener("click", () => {
      const details = document.getElementById("skillIdeaInterviewBrief");
      if (details) details.open = true;
      details?.querySelector?.("input, textarea, select")?.focus?.();
    });
    form.querySelector("[data-skill-idea-cancel]")?.addEventListener("click", () => {
      currentSkillIdeaInterview = null;
      updateReport({ status: "cancelled" });
      editorContent.innerHTML = `
        <h1>Command</h1>
        <section class="skill-router-result">
          <h2>Skill idea cancelled</h2>
          <p>No idea was saved. Nothing ran.</p>
        </section>
      `;
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Skill idea cancelled</strong><br />No idea was saved and nothing ran.",
        bar: "Skill Idea Cancelled",
        terminal: "[skill-ideas] interview cancelled",
      });
    });
  }

  function renderDesignBriefFields(brief) {
    return `
      <div class="skill-idea-brief-form">
        <label>
          <span>Intended user</span>
          <input type="text" name="intendedUser" value="${escapeHtml(brief.intendedUser || "")}" />
        </label>
        <label>
          <span>Problem / job to be done</span>
          <textarea name="problem">${escapeHtml(brief.problem || "")}</textarea>
        </label>
        <label>
          <span>Expected inputs</span>
          <textarea name="expectedInputs">${escapeHtml(brief.expectedInputs || "")}</textarea>
        </label>
        <label>
          <span>Expected output artifact</span>
          <input type="text" name="expectedOutputArtifact" value="${escapeHtml(brief.expectedOutputArtifact || "")}" />
        </label>
        <div class="skill-idea-brief-grid">
          ${renderSelect({
            name: "targetLane",
            value: brief.targetLane || "",
            options: [
              ["", "Not chosen"],
              ["10_Library", "10_Library - Analysis Library"],
              ["20_Workshop", "20_Workshop - Strategy Workshop"],
              ["30_Drafts", "30_Drafts - Drafts"],
              ["40_Dispatch", "40_Dispatch - Dispatch"],
            ],
          })}
          ${renderSelect({
            name: "paidPosture",
            value: brief.paidPosture || "",
            options: [
              ["", "Not chosen"],
              ["free", "Free/local"],
              ["paid", "Paid/provider-backed"],
              ["unknown", "Unknown"],
            ],
          })}
          ${renderSelect({
            name: "riskLevel",
            value: brief.riskLevel || "",
            options: [
              ["", "Not assessed"],
              ["low", "Low"],
              ["medium", "Medium"],
              ["high", "High"],
            ],
          })}
        </div>
        <label>
          <span>Notes / acceptance criteria</span>
          <textarea name="notes">${escapeHtml(brief.notes || "")}</textarea>
        </label>
      </div>
    `;
  }

  function renderSelect({ name, value, options }) {
    return `
      <label>
        <span>${escapeHtml(labelForBriefField(name))}</span>
        <select name="${escapeHtml(name)}">
          ${options.map(([optionValue, optionLabel]) => `
            <option value="${escapeHtml(optionValue)}"${optionValue === value ? " selected" : ""}>${escapeHtml(optionLabel)}</option>
          `).join("")}
        </select>
      </label>
    `;
  }

  function labelForBriefField(name) {
    if (name === "targetLane") return "Target lane";
    if (name === "paidPosture") return "Paid/free posture";
    if (name === "riskLevel") return "Risk level";
    return name;
  }

  function readDesignBriefFromForm(form, fallback = {}) {
    return {
      intendedUser: readNamedFormValue(form, "intendedUser", fallback.intendedUser),
      problem: readNamedFormValue(form, "problem", fallback.problem),
      expectedInputs: readNamedFormValue(form, "expectedInputs", fallback.expectedInputs),
      expectedOutputArtifact: readNamedFormValue(form, "expectedOutputArtifact", fallback.expectedOutputArtifact),
      targetLane: readNamedFormValue(form, "targetLane", fallback.targetLane),
      paidPosture: readNamedFormValue(form, "paidPosture", fallback.paidPosture),
      riskLevel: readNamedFormValue(form, "riskLevel", fallback.riskLevel),
      notes: readNamedFormValue(form, "notes", fallback.notes),
    };
  }

  function readInterviewAnswersFromForm(form, questions = []) {
    const answers = {};
    for (const question of questions) {
      const field = form.querySelector?.(`[data-interview-answer="${question.id}"]`);
      answers[question.id] = String(field?.value || "").trim();
    }
    return answers;
  }

  function readNamedFormValue(form, name, fallback = "") {
    const field = form.querySelector?.(`[name="${name}"]`);
    return String(field?.value || fallback || "").trim();
  }

  function renderSavedSkillIdea({ idea, userRequest }) {
    breadcrumbs.textContent = "command";
    const matter = idea.matter || {};
    editorContent.innerHTML = `
      <h1>Command</h1>
      <section class="skill-router-result">
        <h2>Saved as skill idea</h2>
        <p><code>${escapeHtml(userRequest)}</code></p>
        <p>This is a proposal record only. It did not create a skill, run a provider, allocate a slash command, or change built-in skills.</p>
        <dl class="skill-card-meta">
          <div><dt>Status</dt><dd>${escapeHtml(idea.status || "incomplete")}</dd></div>
          <div><dt>Created</dt><dd>${escapeHtml(idea.createdAt || "")}</dd></div>
          <div><dt>Matter</dt><dd>${escapeHtml(matter.matterName || matter.folderName || "None")}</dd></div>
          <div><dt>Folder</dt><dd>${escapeHtml(matter.folderName || "None")}</dd></div>
        </dl>
        <p class="muted">Open Skills to review this under Saved Ideas.</p>
      </section>
    `;
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
  if (SKILLS_ALIASES.has(normalized)) return { type: "skills", input: normalized };
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
  if (report.skillIdeaId) lines.push(`- Saved skill idea: ${report.skillIdeaId}`);
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

export function parseSkillIdeaInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const normalized = normalizeCommandInput(raw);
  const patterns = [
    /^create a skill to (.+)$/,
    /^new skill (.+)$/,
    /^i need a skill that (.+)$/,
    /^can we make a skill for (.+)$/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]?.trim()) {
      return {
        type: "skill_idea",
        text: raw.replace(/\s+/g, " "),
        idea: match[1].trim(),
      };
    }
  }
  return null;
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
