import { getJson, postJson } from "./api-client.js";
import { writeClipboardText as defaultWriteClipboardText } from "./clipboard.js";
import {
  parseDeterministicCommand,
  parseNewSkillModeCommand,
  parseSkillIdeaInput,
} from "./command-parsing.js";
import { createCommandReportController } from "./command-report-controller.js";
import { createCommandRouterCheckController } from "./command-router-check-controller.js";
import { createCommandSuggestionController } from "./command-suggestions.js";
import { createConfigurableSkillRunController } from "./configurable-skill-run-controller.js";
import { createDeterministicCommandController } from "./deterministic-command-controller.js";
import { createNewSkillModeController } from "./new-skill-mode-controller.js";
import { escapeHtml } from "./dom-utils.js";
import { createSkillIdeaSessionController } from "./skill-idea-session-controller.js";
import {
  planSkillIdeaInterview,
  parseAdaptiveSkillIdeaInput,
} from "./skill-idea-interview.js";

export {
  listSlashCommandSuggestions,
  parseDeterministicCommand,
  parseNewSkillModeCommand,
  parseSkillIdeaInput,
} from "./command-parsing.js";

const DEFAULT_COMMAND_PLACEHOLDER = "Ask about this matter, run a skill, or search documents";

export function createAiCommandBox(ctx, options = {}) {
  const {
    aiCommandForm,
    aiCommandInput,
    aiCommandSubmit,
    aiCommandSuggestions,
    aiCommandSession,
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
  const loadSkillRegistry = options.loadSkillRegistry || (() => getJson("/api/skills"));
  const checkSkillIntent = options.checkSkillIntent || ((body) => postJson("/api/skills/check-intent", body));
  const logCommandInteraction = options.logCommandInteraction || ((body) => postJson("/api/command-interactions", body));
  const saveSkillIdea = options.saveSkillIdea || ((body) => postJson("/api/skill-ideas", body));
  const updateSkillIdeaDesignBrief = options.updateSkillIdeaDesignBrief || ((id, designBrief) => postJson(`/api/skill-ideas/${encodeURIComponent(id)}/design-brief`, { designBrief }));
  const updateSkillIdeaStatus = options.updateSkillIdeaStatus || ((id, status) => postJson(`/api/skill-ideas/${encodeURIComponent(id)}/status`, { status }));
  const generateSkillIdeaSampleOutput = options.generateSkillIdeaSampleOutput || ((body) => postJson("/api/skill-ideas/sample-output", body));
  const listSkillIdeaSamples = options.listSkillIdeaSamples || ((ideaId) => getJson(`/api/skill-ideas/${encodeURIComponent(ideaId)}/samples`));
  const approveSkillIdeaSample = options.approveSkillIdeaSample || ((ideaId, sampleId) => postJson(`/api/skill-ideas/${encodeURIComponent(ideaId)}/samples/${encodeURIComponent(sampleId)}/approve`, {}));
  const createSkillFromIdea = options.createSkillFromIdea || ((ideaId, body = {}) => postJson(`/api/skill-ideas/${encodeURIComponent(ideaId)}/create-skill`, body));
  const runConfigurableSkill = options.runConfigurableSkill || ((body) => postJson("/api/configurable-skills/run", body));
  const cancelConfigurableSkillRun = options.cancelConfigurableSkillRun || ((body) => postJson("/api/configurable-skills/runs/cancelled", body));
  const planSkillIdeaInterviewProvider = options.planSkillIdeaInterviewProvider || planSkillIdeaInterviewViaApi;
  const writeClipboardText = options.writeClipboardText || defaultWriteClipboardText;
  const planSkillIdeaInterviewFn = options.planSkillIdeaInterview || planSkillIdeaInterview;
  let skillIdeaSessions = null;
  let commandSuggestions = null;
  const commandReport = createCommandReportController({
    ctx,
    now,
    loadMatterStatus,
    logCommandInteraction,
    writeClipboardText,
    copyReportButton: aiCommandCopyReport,
    reportStatusElement: aiCommandReportStatus,
    statusBarRight,
    terminalOutput,
  });
  const {
    copyLatestReport,
    getLatestTerminalLines,
    getStatusBarText,
    recordCommandInteraction,
    setCopyReportEnabled,
    setReportStatus,
    startReport,
    updateReport,
  } = commandReport;
  const newSkillModeController = createNewSkillModeController({
    aiCommandInput,
    aiCommandSession,
    aiCommandSubmit,
    ctx,
    defaultPlaceholder: DEFAULT_COMMAND_PLACEHOLDER,
    now,
    recordCommandInteraction,
    startReport,
    updateReport,
    showSkillIdeaInterview: (...args) => skillIdeaSessions?.showSkillIdeaInterview?.(...args),
  });
  const commandRouterCheck = createCommandRouterCheckController({
    aiCommandSession,
    aiCommandSubmit,
    breadcrumbs,
    checkSkillIntent,
    ctx,
    editorContent,
    getLatestTerminalLines,
    getStatusBarText,
    recordCommandInteraction,
    renderCommandError,
    renderCommandRailError,
    startReport,
    updateReport,
  });
  const { checkIntent } = commandRouterCheck;
  const deterministicCommands = createDeterministicCommandController({
    aiCommandSubmit,
    commandReport,
    ctx,
    getLatestTerminalLines,
    getStatusBarText,
    recordCommandInteraction,
    renderCommandError,
    skillDispatch,
    updateReport,
  });
  const configurableSkillRuns = createConfigurableSkillRunController({
    aiCommandInput,
    aiCommandSession,
    aiCommandSubmit,
    breadcrumbs,
    cancelConfigurableSkillRun,
    commandReport,
    copyLatestReport,
    ctx,
    defaultPlaceholder: DEFAULT_COMMAND_PLACEHOLDER,
    deterministicCommands,
    editorContent,
    getLatestTerminalLines,
    getStatusBarText,
    loadSkillRegistry,
    recordCommandInteraction,
    renderCommandError,
    renderCommandRailError,
    renderSkillIdeaSession: (...args) => skillIdeaSessions?.renderSkillIdeaSession?.(...args),
    runConfigurableSkill,
    saveSkillIdea,
    setCurrentSkillIdeaInterview: (session) => skillIdeaSessions?.setSession?.(session),
    setReportStatus,
    updateReport,
    writeClipboardText,
  });
  skillIdeaSessions = createSkillIdeaSessionController({
    aiCommandInput,
    aiCommandSession,
    aiCommandSubmit,
    approveSkillIdeaSample,
    breadcrumbs,
    checkSkillIntent,
    configurableSkillRuns,
    createSkillFromIdea,
    ctx,
    defaultPlaceholder: DEFAULT_COMMAND_PLACEHOLDER,
    deterministicCommands,
    editorContent,
    generateSkillIdeaSampleOutput,
    getLatestTerminalLines,
    getStatusBarText,
    listSkillIdeaSamples,
    loadSkillRegistry,
    planSkillIdeaInterviewFn,
    planSkillIdeaInterviewProvider,
    recordCommandInteraction,
    refreshConfigurableSlashSuggestions: (...args) => commandSuggestions?.refreshConfigurableSlashSuggestions?.(...args),
    renderCommandError,
    saveSkillIdea,
    startReport,
    updateReport,
    updateSkillIdeaDesignBrief,
    updateSkillIdeaStatus,
    writeClipboardText,
  });
  commandSuggestions = createCommandSuggestionController({
    input: aiCommandInput,
    suggestionsElement: aiCommandSuggestions,
    loadSkillRegistry,
    isSuppressed: () => Boolean(skillIdeaSessions?.isActive?.() || newSkillModeController.isActive()),
    runCommand: async (command) => {
      await handleCommand({ userRequest: command });
    },
  });

  function wire() {
    if (!aiCommandForm) return;
    aiCommandForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const userRequest = aiCommandInput.value.trim();
      if (userRequest) clearCommandInput();
      await handleCommand({ userRequest });
    });
    aiCommandInput?.addEventListener?.("input", () => commandSuggestions.render());
    aiCommandInput?.addEventListener?.("focus", () => commandSuggestions.render());
    aiCommandInput?.addEventListener?.("keydown", async (event) => {
      await commandSuggestions.handleKeydown(event);
    });
    aiCommandInput?.addEventListener?.("blur", () => {
      setTimeout(commandSuggestions.hide, 120);
    });
    if (aiCommandCopyReport) {
      aiCommandCopyReport.addEventListener("click", commandReport.copyLatestReport);
    }
  }

  async function handleCommand({ userRequest }) {
    commandSuggestions.hide();
    if (skillIdeaSessions.isActive()) {
      await skillIdeaSessions.handleSkillIdeaInterviewInput(userRequest);
      return;
    }
    if (newSkillModeController.isActive()) {
      await newSkillModeController.handleInput(userRequest);
      return;
    }
    if (!userRequest) {
      renderCommandError("Enter a slash command or future skill idea.");
      return;
    }

    if (configurableSkillRuns.hasPendingRun()) {
      const handledPendingRun = await configurableSkillRuns.handlePendingConfigurableRunInput(userRequest);
      if (handledPendingRun) return;
    }

    const newSkillMode = parseNewSkillModeCommand(userRequest);
    if (newSkillMode) {
      newSkillModeController.open(userRequest);
      return;
    }

    const parsedCommand = parseDeterministicCommand(userRequest);
    if (parsedCommand) {
      await deterministicCommands.runDeterministicCommand(parsedCommand, userRequest);
      return;
    }

    const configurableSkillRevision = await configurableSkillRuns.findConfigurableSkillRevisionCommand(userRequest);
    if (configurableSkillRevision) {
      await configurableSkillRuns.startConfigurableSkillImprovement(configurableSkillRevision.skill, configurableSkillRevision.revisionText);
      return;
    }

    const configurableSkill = await configurableSkillRuns.findConfigurableSkillCommand(userRequest);
    if (configurableSkill) {
      await configurableSkillRuns.runConfigurableSkillCommand(configurableSkill, userRequest);
      return;
    }

    const skillIdea = parseSkillIdeaInput(userRequest) || parseAdaptiveSkillIdeaInput(userRequest);
    if (skillIdea) {
      await skillIdeaSessions.showSkillIdeaInterview(skillIdea, userRequest);
      return;
    }

    await checkIntent({
      userRequest,
      overrideJustification: "",
    });
  }

  function renderCommandError(message) {
    breadcrumbs.textContent = "command";
    editorContent.innerHTML = `
      <h1>Command</h1>
      <p class="form-error">${escapeHtml(message)}</p>
    `;
  }

  function renderCommandRailError(message) {
    if (!aiCommandSession) {
      renderCommandError(message);
      return;
    }
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = `
      <section class="command-interview" aria-live="polite">
        <h3>Command check failed</h3>
        <p class="form-error">${escapeHtml(message)}</p>
      </section>
    `;
  }

  function clearCommandInput() {
    if (aiCommandInput) aiCommandInput.value = "";
  }

  function resetForMatterChange() {
    if (skillIdeaSessions.isActive() || newSkillModeController.isActive()) return;
    configurableSkillRuns.clearPendingForMatterChange();
    aiCommandInput.placeholder = DEFAULT_COMMAND_PLACEHOLDER;
    aiCommandSubmit.disabled = false;
    aiCommandSubmit.textContent = "Go";
    commandReport.clear();
    commandSuggestions.hide();
    if (aiCommandSession) {
      aiCommandSession.hidden = true;
      aiCommandSession.innerHTML = "";
    }
  }

  return {
    checkIntent,
    handleCommand,
    copyLatestReport,
    resetForMatterChange,
    wire,
  };
}

async function planSkillIdeaInterviewViaApi(body = {}) {
  const response = await postJson("/api/skill-ideas/plan-interview", body);
  if (!response?.plan) {
    return response?.planner ? { __plannerMeta: response.planner } : null;
  }
  return {
    ...response.plan,
    __plannerMeta: response.planner || null,
  };
}
