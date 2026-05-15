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
import {
  buildConfigurableSkillImprovementBrief,
  buildConfigurableSkillImprovementInterview,
} from "./configurable-skill-improvement.js";
import { createDeterministicCommandController } from "./deterministic-command-controller.js";
import { createNewSkillModeController } from "./new-skill-mode-controller.js";
import {
  findActiveConfigurableSkillBySlash,
  parseConfigurableSkillRevisionCommand,
} from "./configurable-skill-commands.js";
import { classifyConfigurableSkillRunInput } from "./configurable-skill-run-commands.js";
import {
  buildConfigurableRunPending,
  getConfigurableRunArtifactPath,
  renderConfigurableSkillCancelledRail,
  renderConfigurableSkillExistingOutputSheetHtml,
  renderConfigurableSkillImprovementPromptHtml,
  renderConfigurableSkillOverwritePromptHtml,
  renderConfigurableSkillRunOutput,
  renderConfigurableSkillRunRail,
} from "./configurable-skill-run-ui.js";
import { formatConfigurableSkillDisplayName } from "./configurable-skill-version-labels.js";
import { escapeHtml } from "./dom-utils.js";
import {
  buildSkillIdeaInterview,
  buildSkillIdeaPayloadFromInterview,
  planSkillIdeaInterview,
  parseAdaptiveSkillIdeaInput,
} from "./skill-idea-interview.js";
import { classifySkillIdeaSessionInput } from "./skill-idea-session-commands.js";
import {
  describeInterviewPlanner,
  renderActiveSkillIdeaQuestionHtml,
  renderReadySkillIdeaSessionHtml,
  renderSavedSkillIdeaSessionHtml,
} from "./skill-idea-session-rendering.js";
import {
  buildSkillCreationOverlapRequest,
  isBlockingSkillOverlapDecision,
  isSkillImprovementIdea,
  parseSkillCreationOverlapJustification,
  renderSkillCreationOverlapGateHtml,
} from "./skill-creation-overlap.js";
import {
  applyActiveSampleState,
  ensureSampleReview,
  findSampleByVersion,
  formatSampleProvider,
  formatSkillSampleCopy,
  getLedgerSamples,
  getSampleId,
  getSampleMarkdown,
  getSampleState,
  getSampleVersion,
  markSampleReviewStale,
  normalizeUiSample,
} from "./skill-sample-review.js";
import {
  renderCreatedSkillCommandRailHtml,
  renderSkillReadyHtml,
  renderSkillSampleOutputHtml,
} from "./skill-builder-result-rendering.js";
import {
  formatConfigurableSkillRunReport,
  formatSkillIdeaReviewPacket,
} from "./views/skills-page.js";

export {
  listSlashCommandSuggestions,
  parseDeterministicCommand,
  parseNewSkillModeCommand,
  parseSkillIdeaInput,
} from "./command-parsing.js";

const DEFAULT_COMMAND_PLACEHOLDER = "find payment, open library, create list of dates";

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
  let currentSkillIdeaInterview = null;
  let pendingConfigurableRun = null;
  let lastCreatedConfigurableSkill = null;
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
    showSkillIdeaInterview,
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
  const commandSuggestions = createCommandSuggestionController({
    input: aiCommandInput,
    suggestionsElement: aiCommandSuggestions,
    loadSkillRegistry,
    isSuppressed: () => Boolean(currentSkillIdeaInterview || newSkillModeController.isActive()),
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
    if (currentSkillIdeaInterview) {
      await handleSkillIdeaInterviewInput(userRequest);
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

    if (pendingConfigurableRun) {
      const handledPendingRun = await handlePendingConfigurableRunInput(userRequest);
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

    const configurableSkillRevision = await findConfigurableSkillRevisionCommand(userRequest);
    if (configurableSkillRevision) {
      await startConfigurableSkillImprovement(configurableSkillRevision.skill, configurableSkillRevision.revisionText);
      return;
    }

    const configurableSkill = await findConfigurableSkillCommand(userRequest);
    if (configurableSkill) {
      await runConfigurableSkillCommand(configurableSkill, userRequest);
      return;
    }

    const skillIdea = parseSkillIdeaInput(userRequest) || parseAdaptiveSkillIdeaInput(userRequest);
    if (skillIdea) {
      await showSkillIdeaInterview(skillIdea, userRequest);
      return;
    }

    await checkIntent({
      userRequest,
      overrideJustification: "",
    });
  }

  async function findConfigurableSkillCommand(userRequest) {
    const registry = await loadSkillRegistry().catch(() => null);
    const skills = Array.isArray(registry?.skills) ? registry.skills : [];
    return findActiveConfigurableSkillBySlash(skills, userRequest);
  }

  async function findConfigurableSkillRevisionCommand(userRequest) {
    const parsed = parseConfigurableSkillRevisionCommand(userRequest);
    if (!parsed) return null;
    const registry = await loadSkillRegistry().catch(() => null);
    const skills = Array.isArray(registry?.skills) ? registry.skills : [];
    const skill = findActiveConfigurableSkillBySlash(skills, parsed.targetSlash);
    return skill ? { skill, revisionText: parsed.revisionText } : null;
  }

  async function startConfigurableSkillImprovement(skill = {}, revisionText = "") {
    startReport({
      typedInput: revisionText ? `improve ${skill.slash} ${revisionText}` : `improve ${skill.slash || ""}`,
      matchedCommand: "skill_revision/idea",
      status: "pending",
    });
    pendingConfigurableRun = {
      phase: "improve",
      slash: skill.slash || "",
      title: skill.title || skill.slash || "Custom Skill",
      artifactPath: Array.isArray(skill.outputs) ? skill.outputs[0] || "" : skill.outputArtifact || "",
      skill,
    };
    if (revisionText) {
      await saveConfigurableSkillImprovement(revisionText);
      return;
    }
    renderConfigurableSkillImprovementPrompt();
  }

  async function runConfigurableSkillCommand(skill, userRequest, { overwrite = false } = {}) {
    const slash = skill?.slash || pendingConfigurableRun?.slash || "";
    if (!slash) {
      renderCommandError("No configurable skill selected.");
      return;
    }
    if (!overwrite) {
      startReport({
        typedInput: userRequest,
        matchedCommand: slash,
        status: "pending",
      });
    }
    pendingConfigurableRun = null;
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Running...";
    ctx.setStatus({
      mood: "thinking",
      card: `<strong>Running skill</strong><br /><code>${escapeHtml(slash)}</code> is using the selected matter context.`,
      bar: "Running Skill",
      terminal: `[configurable-skill] running ${slash}`,
    });
    try {
      const result = await runConfigurableSkill({ slash, overwrite });
      if (result.state === "requires_overwrite") {
        pendingConfigurableRun = {
          phase: "action_sheet",
          slash,
          title: skill?.title || result.skill?.title || slash,
          artifactPath: result.artifactPath || "",
          skill: result.skill || skill || {},
        };
        renderConfigurableSkillExistingOutputSheet(result);
        updateReport({
          status: "warned",
          artifacts: result.artifactPath ? [result.artifactPath] : [],
        });
        recordCommandInteraction({
          renderedState: "configurable_skill/output_replace",
          status: "warned",
          providerRunInvoked: false,
        });
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Output document already exists</strong><br /><code>${escapeHtml(result.artifactPath || "output document")}</code> already exists. This does not replace or edit the skill version.`,
          bar: "Output Exists",
          terminal: `[configurable-skill] output replacement required for ${slash}`,
        });
        return;
      }
      renderConfigurableSkillRunResult(result);
      const skillName = formatConfigurableSkillDisplayName(result.skill || skill || result.runRecord || {}, slash || "Custom Skill");
      updateReport({
        status: "ran",
        skillName,
        providerModel: [result.aiRun?.provider, result.aiRun?.model].filter(Boolean).join(" / "),
        artifacts: [result.outputPaths?.markdown, result.outputPaths?.json].filter(Boolean),
        runId: result.runId || result.runRecord?.id || "",
        runRecord: result.runRecord || null,
        overwrite: result.runRecord?.overwrite || (overwrite ? "approved" : "not_needed"),
      });
      recordCommandInteraction({
        renderedState: "configurable_skill/run",
        status: "ran",
        providerRunInvoked: true,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill complete</strong><br />Wrote <code>${escapeHtml(result.outputPaths?.markdown || result.outputPath || "configured artifact")}</code>.`,
        bar: "Skill Complete",
        terminal: `[configurable-skill] wrote ${result.outputPaths?.markdown || result.outputPath || slash}`,
      });
    } catch (error) {
      renderCommandRailError(error.message);
      updateReport({ status: "failed", error: error.message });
      recordCommandInteraction({
        renderedState: "configurable_skill/run",
        status: "failed",
        providerRunInvoked: overwrite,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Skill Failed",
        terminal: `[configurable-skill] failed: ${error.message}`,
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

  async function handlePendingConfigurableRunInput(userRequest) {
    const pendingPhase = pendingConfigurableRun?.phase || "overwrite";
    const action = classifyConfigurableSkillRunInput(userRequest, { phase: pendingPhase });
    if (action === "cancel_improvement") {
      clearPendingConfigurableRun("Skill improvement cancelled", "No improvement idea was saved.");
      return true;
    }
    if (action === "save_improvement") {
      await saveConfigurableSkillImprovement(userRequest);
      return true;
    }
    if (action === "open_output") {
      openPendingConfigurableOutput();
      return true;
    }
    if (action === "accept_run") {
      markConfigurableSkillRunAccepted();
      return true;
    }
    if (action === "improve_skill") {
      renderConfigurableSkillImprovementPrompt();
      return true;
    }
    if (action === "show_overwrite_prompt") {
      renderConfigurableSkillOverwritePrompt(pendingConfigurableRun);
      return true;
    }
    if (action === "clear_action_sheet") {
      clearPendingConfigurableRun("No action taken", "Kept the existing output document. Nothing ran and the skill was not changed.");
      return true;
    }
    if (action === "cancel_overwrite") {
      const pending = pendingConfigurableRun;
      pendingConfigurableRun = null;
      let cancelled = null;
      try {
        cancelled = await cancelConfigurableSkillRun({
          slash: pending?.slash || "",
          artifactPath: pending?.artifactPath || "",
        });
      } catch {
        cancelled = null;
      }
      renderConfigurableSkillCancelledResult(cancelled || {
        skill: pending?.skill || { slash: pending?.slash, title: pending?.title },
        artifactPath: pending?.artifactPath || "",
      });
      updateReport({
        status: "cancelled",
        skillName: formatConfigurableSkillDisplayName(cancelled?.skill || pending?.skill || cancelled?.runRecord || {}, pending?.slash || "Custom Skill"),
        artifacts: pending?.artifactPath ? [pending.artifactPath] : [],
        runId: cancelled?.runId || cancelled?.runRecord?.id || "",
        runRecord: cancelled?.runRecord || null,
        overwrite: "cancelled",
      });
      recordCommandInteraction({
        renderedState: "configurable_skill/output_replace",
        status: "cancelled",
        providerRunInvoked: false,
      });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Kept existing output document</strong><br />Nothing ran and the skill was not changed.",
        bar: "Run Cancelled",
        terminal: "[configurable-skill] output replacement cancelled",
      });
      return true;
    }
    if (action === "replace_output") {
      const pending = pendingConfigurableRun;
      await runConfigurableSkillCommand(pending, userRequest, { overwrite: true });
      return true;
    }
    return false;
  }

  function renderConfigurableSkillExistingOutputSheet(result = {}) {
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderConfigurableSkillExistingOutputSheetHtml(result, pendingConfigurableRun || {});
    aiCommandInput.placeholder = "Open output, Run again, Improve this skill, or Cancel";
    wireConfigurableSkillActions();
  }

  function renderConfigurableSkillOverwritePrompt(result = {}) {
    if (!aiCommandSession) return;
    if (pendingConfigurableRun) pendingConfigurableRun.phase = "overwrite";
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderConfigurableSkillOverwritePromptHtml(result, pendingConfigurableRun || {});
    aiCommandInput.placeholder = "Replace output document or Keep existing output document";
    wireConfigurableSkillActions();
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Output document exists</strong><br /><code>${escapeHtml(result.artifactPath || pendingConfigurableRun?.artifactPath || "output document")}</code> already exists. This does not replace or edit the skill version.`,
      bar: "Replace Output?",
      terminal: `[configurable-skill] output replacement confirmation for ${pendingConfigurableRun?.slash || ""}`,
    });
  }

  function renderConfigurableSkillImprovementPrompt() {
    if (!aiCommandSession || !pendingConfigurableRun) return;
    pendingConfigurableRun.phase = "improve";
    const slash = pendingConfigurableRun.slash || pendingConfigurableRun.skill?.slash || "";
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderConfigurableSkillImprovementPromptHtml(pendingConfigurableRun);
    aiCommandInput.placeholder = "Describe what should improve...";
    aiCommandSubmit.textContent = "Save idea";
    wireConfigurableSkillActions();
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Improve skill</strong><br />Describe what should change for <code>${escapeHtml(slash)}</code>.`,
      bar: "Improve Skill",
      terminal: `[configurable-skill] improvement prompt for ${slash}`,
    });
  }

  function clearPendingConfigurableRun(title, message) {
    pendingConfigurableRun = null;
    aiCommandInput.placeholder = DEFAULT_COMMAND_PLACEHOLDER;
    aiCommandSubmit.textContent = "Go";
    if (aiCommandSession) {
      aiCommandSession.hidden = false;
      aiCommandSession.innerHTML = `
        <section class="command-interview" aria-live="polite">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
        </section>
      `;
    }
    updateReport({ status: "cancelled" });
    recordCommandInteraction({
      renderedState: "configurable_skill/action_sheet",
      status: "cancelled",
      providerRunInvoked: false,
    });
    ctx.setStatus({
      mood: "idle",
      card: `<strong>${escapeHtml(title)}</strong><br />${escapeHtml(message)}`,
      bar: title,
      terminal: "[configurable-skill] no action taken",
    });
  }

  function openPendingConfigurableOutput() {
    const pending = pendingConfigurableRun;
    const artifactPath = pending?.artifactPath || "";
    if (!artifactPath || !ctx.openFilePreview) {
      renderCommandRailError("Output preview is unavailable.");
      return;
    }
    ctx.openFilePreview(artifactPath, "true", artifactPath.endsWith(".md") ? "markdown" : "");
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Opened output</strong><br /><code>${escapeHtml(artifactPath)}</code>.`,
      bar: "Output Opened",
      terminal: `[configurable-skill] opened ${artifactPath}`,
    });
  }

  async function saveConfigurableSkillImprovement(userRequest) {
    const pending = pendingConfigurableRun;
    const changeText = String(userRequest || "").trim();
    if (!changeText) {
      renderConfigurableSkillImprovementPrompt();
      renderCommandError("Describe what should improve.");
      return;
    }
    const slash = pending?.slash || pending?.skill?.slash || "";
    const title = pending?.title || pending?.skill?.title || slash || "Custom Skill";
    const artifactPath = pending?.artifactPath || pending?.skill?.outputArtifact || "";
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Saving...";
    try {
      const payload = await saveSkillIdea({
        text: `Improve ${slash}: ${changeText}`,
        designBrief: buildConfigurableSkillImprovementBrief({
          slash,
          title,
          artifactPath,
          changeText,
          activeMatter: ctx.getActiveMatter?.() || {},
        }),
      });
      const idea = payload.idea || {};
      pendingConfigurableRun = null;
      aiCommandInput.placeholder = DEFAULT_COMMAND_PLACEHOLDER;
      aiCommandSubmit.textContent = "Go";
      updateReport({
        status: "saved",
        skillIdeaId: idea.id || "",
        matchedCommand: "skill_revision/idea",
      });
      recordCommandInteraction({
        renderedState: "configurable_skill/improvement_idea",
        status: "saved_idea",
        skillIdeaId: idea.id || "",
        providerRunInvoked: false,
      });
      currentSkillIdeaInterview = {
        interview: buildConfigurableSkillImprovementInterview({
          slash,
          title,
          artifactPath,
          changeText,
          activeMatter: ctx.getActiveMatter?.() || {},
        }),
        answers: {},
        questionIndex: 0,
        ready: true,
        savedIdea: idea,
        editingSavedIdea: false,
        sampleReview: {
          samples: [],
          ledger: [],
          activeSample: null,
          approved: false,
          stale: false,
          staleReason: "",
        },
      };
      renderSkillIdeaSession();
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Improvement idea saved</strong><br />Generate a revised sample before creating a new version. The active skill was not changed.`,
        bar: "Ready for Revised Sample",
        terminal: `[configurable-skill] saved improvement idea for ${slash}`,
      });
    } catch (error) {
      renderCommandRailError(error.message);
      updateReport({ status: "failed", error: error.message });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Improvement not saved</strong><br />${escapeHtml(error.message)}`,
        bar: "Improvement Failed",
        terminal: `[configurable-skill] improvement failed: ${error.message}`,
      });
    } finally {
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "Go";
    }
  }

  function renderConfigurableSkillRunResult(result = {}) {
    currentSkillIdeaInterview = null;
    aiCommandInput.placeholder = DEFAULT_COMMAND_PLACEHOLDER;
    aiCommandSubmit.textContent = "Go";
    const skill = result.skill || {};
    pendingConfigurableRun = buildConfigurableRunPending(result);
    breadcrumbs.textContent = skill.slash || "custom skill";
    editorContent.innerHTML = renderConfigurableSkillRunOutput(result);
    if (aiCommandSession) {
      aiCommandSession.hidden = false;
      aiCommandSession.innerHTML = renderConfigurableSkillRunRail(result);
      wireConfigurableSkillActions();
      wireConfigurableRunReportActions();
    }
  }

  function renderConfigurableSkillCancelledResult(result = {}) {
    aiCommandInput.placeholder = DEFAULT_COMMAND_PLACEHOLDER;
    aiCommandSubmit.textContent = "Go";
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderConfigurableSkillCancelledRail(result);
    wireConfigurableRunReportActions();
  }

  function wireConfigurableRunReportActions() {
    aiCommandSession?.querySelectorAll?.("[data-configurable-run-action='copy-report']")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const runRecord = commandReport.getReport()?.runRecord;
        if (!runRecord) {
          await copyLatestReport();
          return;
        }
        button.disabled = true;
        try {
          await writeClipboardText(formatConfigurableSkillRunReport(runRecord));
          setReportStatus("Run report copied.");
        } catch (error) {
          setReportStatus(`Copy failed: ${error.message}`, true);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function wireConfigurableSkillActions() {
    aiCommandSession?.querySelectorAll?.("[data-configurable-skill-action]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.configurableSkillAction;
        if (action === "overwrite") {
          const pending = pendingConfigurableRun;
          await runConfigurableSkillCommand(pending, "replace output document", { overwrite: true });
          return;
        }
        if (action === "run-again") {
          renderConfigurableSkillOverwritePrompt(pendingConfigurableRun || {});
          return;
        }
        if (action === "looks-good") {
          markConfigurableSkillRunAccepted();
          return;
        }
        if (action === "open-output") {
          openPendingConfigurableOutput();
          return;
        }
        if (action === "improve") {
          renderConfigurableSkillImprovementPrompt();
          return;
        }
        if (action === "open-skills") {
          await deterministicCommands.showSkillsPage("open skills");
          return;
        }
        if (action === "cancel") {
          await handlePendingConfigurableRunInput(pendingConfigurableRun?.phase === "overwrite" ? "keep current" : "cancel");
        }
      });
    });
  }

  function markConfigurableSkillRunAccepted() {
    const slash = pendingConfigurableRun?.slash || pendingConfigurableRun?.skill?.slash || "";
    const artifactPath = getConfigurableRunArtifactPath(pendingConfigurableRun?.result || {}) || pendingConfigurableRun?.artifactPath || "";
    const acceptance = aiCommandSession?.querySelector?.("[data-configurable-run-acceptance]");
    if (acceptance) {
      acceptance.textContent = "Marked as good for this run. The active skill was not changed.";
    } else if (aiCommandSession?.innerHTML) {
      aiCommandSession.innerHTML = aiCommandSession.innerHTML.replace(
        "The result is also shown in the main pane for review.",
        "Marked as good for this run. The active skill was not changed.",
      );
    }
    updateReport({
      status: "accepted",
      artifacts: artifactPath ? [artifactPath] : commandReport.getReport()?.artifacts || [],
    });
    recordCommandInteraction({
      renderedState: "configurable_skill/run_review",
      status: "accepted",
      providerRunInvoked: false,
    });
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Run accepted</strong><br />Marked <code>${escapeHtml(slash || "this skill")}</code> output as good for this run.`,
      bar: "Run Accepted",
      terminal: `[configurable-skill] run accepted ${slash}`.trim(),
    });
  }

  function wireCreatedSkillActions() {
    aiCommandSession?.querySelectorAll?.("[data-created-skill-action]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.createdSkillAction;
        if (action === "run") {
          const skill = lastCreatedConfigurableSkill;
          if (skill?.slash) await runConfigurableSkillCommand(skill, skill.slash);
          return;
        }
        if (action === "open-skills") {
          await deterministicCommands.showSkillsPage("open skills");
          return;
        }
        if (action === "start-another") {
          startAnotherSkillIdea();
        }
      });
    });
  }

  async function showSkillIdeaInterview(skillIdea, userRequest, { useModelPlanner = false } = {}) {
    let interview = null;
    let plannerFallbackMessage = "";
    try {
      const plannerOptions = {
        activeMatter: ctx.getActiveMatter?.() || null,
      };
      if (useModelPlanner) {
        plannerOptions.plannerProvider = async ({ skillIdea: plannerSkillIdea, userRequest: plannerUserRequest, designBrief }) => (
          planSkillIdeaInterviewProvider({
            skillIdea: plannerSkillIdea,
            userRequest: plannerUserRequest,
            designBrief,
          })
        );
      }
      interview = await planSkillIdeaInterviewFn(skillIdea, userRequest, plannerOptions);
    } catch (error) {
      plannerFallbackMessage = error.message || "planner unavailable";
      interview = buildSkillIdeaInterview(skillIdea, userRequest);
    }
    currentSkillIdeaInterview = {
      interview,
      answers: {},
      questionIndex: 0,
      ready: !Array.isArray(interview?.questions) || interview.questions.length === 0,
    };
    const plannerInfo = describeInterviewPlanner(interview);
    startReport({
      typedInput: userRequest,
      matchedCommand: "skill_idea/interview",
      status: "interview",
      plannerSource: plannerInfo.source,
      plannerModel: plannerInfo.model,
      plannerFallbackReason: plannerInfo.fallbackReason,
    });
    recordCommandInteraction({
      renderedState: "skill_idea/interview",
      status: "opened_interview",
      providerRunInvoked: Boolean(interview?.planner?.used),
      plannerSource: plannerInfo.source,
      plannerModel: plannerInfo.model,
      plannerFallbackReason: plannerInfo.fallbackReason,
    });
    aiCommandInput.value = "";
    aiCommandInput.placeholder = currentSkillIdeaInterview.ready
      ? "Generate sample, Edit answers, or Cancel"
      : "Answer the current question";
    aiCommandSubmit.textContent = currentSkillIdeaInterview.ready ? "Go" : "Answer";
    const plannerTerminal = plannerInfo.source === "model"
      ? `[skill-ideas] model-planned interview opened: ${userRequest}`
      : plannerInfo.source === "deterministic fallback"
        ? [
          `[skill-ideas] planner fallback: ${plannerInfo.fallbackReason || plannerFallbackMessage || "deterministic fallback"}`,
          `[skill-ideas] interview opened: ${userRequest}`,
        ]
        : `[skill-ideas] interview opened: ${userRequest}`;
    ctx.setStatus(currentSkillIdeaInterview.ready
      ? {
          mood: "idle",
          card: "<strong>Ready for sample</strong><br />The initial request is detailed enough to test with a sample output.",
          bar: "Ready for Sample",
          terminal: Array.isArray(plannerTerminal) ? [...plannerTerminal, "[skill-ideas] detailed idea ready for sample"] : [plannerTerminal, "[skill-ideas] detailed idea ready for sample"],
        }
      : {
          mood: "idle",
          card: "<strong>Skill idea interview</strong><br />Answer one question at a time in the Command rail. Nothing will run.",
          bar: "Skill Idea Interview",
          terminal: plannerTerminal,
        });
    renderSkillIdeaSession();
  }

  async function handleSkillIdeaInterviewInput(userRequest) {
    const session = currentSkillIdeaInterview;
    if (!session) return;
    const command = classifySkillIdeaSessionInput(userRequest, {
      ready: Boolean(session.ready),
      hasSavedIdea: Boolean(session.savedIdea),
      hasActiveSample: Boolean(session.sampleReview?.activeSample),
      sampleApproved: Boolean(session.sampleReview?.approved),
    });
    if (command.action === "cancel") {
      clearCommandInput();
      cancelSkillIdeaInterview();
      return;
    }
    if (command.action === "blank") {
      renderSkillIdeaSession("Answer the current question, or choose Cancel.");
      return;
    }
    if (session.ready) {
      const justification = parseSkillCreationOverlapJustification(userRequest);
      if (justification) {
        clearCommandInput();
        session.skillCreationOverlapOverride = justification;
        session.skillCreationOverlapCleared = null;
        await createConfigurableSkillFromApprovedSample();
        return;
      }
      if (command.action === "save") {
        clearCommandInput();
        await saveSkillIdeaInterviewSession();
        return;
      }
      if (session.savedIdea) {
        if (command.action === "generate_sample") {
          clearCommandInput();
          await generateSavedSkillIdeaSample({ feedback: command.feedback || "" });
          return;
        }
        if (command.action === "copy_sample") {
          clearCommandInput();
          await copySavedSkillIdeaSample();
          return;
        }
        if (command.action === "copy_sample_version") {
          clearCommandInput();
          await copySavedSkillIdeaSampleByVersion(command.version);
          return;
        }
        if (command.action === "approve_sample") {
          clearCommandInput();
          await approveSavedSkillIdeaSampleAndCreateSkill();
          return;
        }
        if (command.action === "create_skill") {
          clearCommandInput();
          await createConfigurableSkillFromApprovedSample();
          return;
        }
        if (command.action === "copy_review_packet") {
          clearCommandInput();
          await copySavedSkillIdeaReviewPacket();
          return;
        }
        if (command.action === "mark_ready") {
          clearCommandInput();
          await markSavedSkillIdeaReady();
          return;
        }
        if (command.action === "open_skills") {
          clearCommandInput();
          await openSavedSkillIdeaInSkills();
          return;
        }
        if (command.action === "start_another") {
          clearCommandInput();
          startAnotherSkillIdea();
          return;
        }
        if (command.action === "edit_answers") {
          beginSkillIdeaAnswerEditing(session, { editingSavedIdea: true });
          return;
        }
        if (command.action === "sample_feedback") {
          clearCommandInput();
          await generateSavedSkillIdeaSample({ feedback: command.feedback || userRequest.trim() });
          return;
        }
      }
      if (command.action === "edit_answers") {
        beginSkillIdeaAnswerEditing(session, { editingSavedIdea: Boolean(session.savedIdea) });
        return;
      }
      if (command.action === "generate_sample") {
        clearCommandInput();
        await generateSavedSkillIdeaSample();
        return;
      }
      renderSkillIdeaSession(session.savedIdea
        ? "Use Generate sample, Copy Review Packet, Mark ready for review, Edit answers, Open in Skills, Start another idea, or Cancel."
        : "Use Generate sample, Edit answers, or Cancel.");
      return;
    }

    const question = session.interview.questions[session.questionIndex];
    if (!question) {
      session.ready = true;
      renderSkillIdeaSession();
      return;
    }
    session.answers[question.id] = userRequest.trim();
    session.questionIndex += 1;
    recordCommandInteraction({
      typedInput: userRequest.trim(),
      renderedState: "skill_idea/question",
      status: "question_answered",
      providerRunInvoked: false,
    });
    clearCommandInput();
    if (session.questionIndex >= session.interview.questions.length) {
      session.ready = true;
      aiCommandInput.placeholder = "Generate sample, Edit answers, or Cancel";
      aiCommandSubmit.textContent = "Go";
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Ready for sample</strong><br />Generate a sample output from a test matter before approving this skill idea.",
        bar: "Ready for Sample",
        terminal: "[skill-ideas] interview ready for sample",
      });
    } else {
      aiCommandInput.placeholder = "Answer the current question";
      aiCommandSubmit.textContent = "Answer";
      const nextIndex = session.questionIndex + 1;
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill idea interview</strong><br />Question ${nextIndex}.`,
        bar: `Question ${nextIndex}`,
        terminal: `[skill-ideas] question ${nextIndex}`,
      });
    }
    renderSkillIdeaSession();
  }

  function beginSkillIdeaAnswerEditing(session, { editingSavedIdea = false } = {}) {
    if (!Array.isArray(session.interview.questions) || session.interview.questions.length === 0) {
      renderSkillIdeaSession("No follow-up questions were asked. Edit the skill idea by starting again, or generate a sample from a matter.");
      return false;
    }
    session.editingSavedIdea = editingSavedIdea;
    session.ready = false;
    session.questionIndex = 0;
    aiCommandInput.value = session.answers[session.interview.questions[0]?.id] || "";
    aiCommandSubmit.textContent = "Answer";
    renderSkillIdeaSession();
    return true;
  }

  async function saveSkillIdeaInterviewSession({ silent = false } = {}) {
    const session = currentSkillIdeaInterview;
    if (!session) return;
    const { interview, answers } = session;
    const payloadBody = buildSkillIdeaPayloadFromInterview({
      interview,
      answers,
      designBrief: interview.designBrief,
    });
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Saving...";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Saving idea</strong><br />Saving a non-running design brief.",
      bar: "Saving Skill Idea",
      terminal: `[skill-ideas] saving interview: ${interview.originalText}`,
    });
    try {
      const existingIdea = session.savedIdea;
      const editedExistingIdea = Boolean(existingIdea?.id && session.editingSavedIdea);
      const payload = existingIdea?.id
        ? await updateSkillIdeaDesignBrief(existingIdea.id, payloadBody.designBrief)
        : await saveSkillIdea(payloadBody);
      const idea = payload.idea || {};
      session.savedIdea = idea;
      session.editingSavedIdea = false;
      session.ready = true;
      const sampleReview = ensureSampleReview(session);
      if (editedExistingIdea && sampleReview.activeSample) {
        markSampleReviewStale(session, "Design brief changed after this sample was generated. Regenerate the sample before approving it.");
        sampleReview.createdSkill = null;
        session.createdSkill = null;
      }
      updateReport({
        status: existingIdea?.id ? "updated" : "saved",
        skillIdeaId: idea.id || "",
      });
      recordCommandInteraction({
        renderedState: "skill_idea/saved",
        status: existingIdea?.id ? "updated_idea" : "saved_idea",
        skillIdeaId: idea.id || "",
        providerRunInvoked: false,
      });
      if (!silent) {
        ctx.setStatus({
          mood: "idle",
          card: `<strong>${existingIdea?.id ? "Skill idea updated" : "Saved as skill idea"}</strong><br />Continue here: generate a sample output, copy a review packet, mark ready, edit answers, or open Skills.`,
          bar: existingIdea?.id ? "Skill Idea Updated" : "Skill Idea Saved",
          terminal: `[skill-ideas] ${existingIdea?.id ? "updated" : "saved"} ${idea.id || "proposal"}`,
        });
      }
      aiCommandInput.value = "";
      aiCommandInput.placeholder = "Generate sample, Copy Review Packet, Mark ready, or Edit answers";
      aiCommandSubmit.textContent = "Go";
      if (!silent) renderSkillIdeaSession();
      return idea;
    } catch (error) {
      renderCommandError(error.message);
      updateReport({ status: "failed", error: error.message });
      recordCommandInteraction({
        renderedState: "skill_idea/save",
        status: "failed",
        providerRunInvoked: false,
        error: error.message,
      });
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
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "Go";
    }
    return null;
  }

  function renderSkillIdeaSession(errorMessage = "") {
    if (!aiCommandSession || !currentSkillIdeaInterview) return;
    const { interview, answers, questionIndex, ready, savedIdea, editingSavedIdea, sampleReview, createdSkill } = currentSkillIdeaInterview;
    aiCommandSession.hidden = false;
    if (ready && savedIdea && !editingSavedIdea) {
      aiCommandSession.innerHTML = renderSavedSkillIdeaSessionHtml({
        idea: savedIdea,
        interview,
        answers,
        sampleReview,
        createdSkill,
        activeMatter: ctx.getActiveMatter?.() || {},
        errorMessage,
      });
      wireSkillIdeaSessionActions();
      return;
    }
    if (ready) {
      const activeMatter = ctx.getActiveMatter?.() || {};
      aiCommandSession.innerHTML = renderReadySkillIdeaSessionHtml({ interview, answers, activeMatter, errorMessage });
      wireSkillIdeaSessionActions();
      return;
    }
    aiCommandSession.innerHTML = renderActiveSkillIdeaQuestionHtml({ interview, answers, questionIndex, errorMessage });
    wireSkillIdeaSessionActions();
  }

  async function generateSavedSkillIdeaSample({ feedback = "" } = {}) {
    const session = currentSkillIdeaInterview;
    const activeMatter = ctx.getActiveMatter?.() || {};
    if (!activeMatter?.folderName) {
      renderSkillIdeaSession("Pick a test matter before generating sample output.");
      ctx.setStatus({
        mood: "idle",
        card: "<strong>No test matter selected</strong><br />Pick a matter, then generate a sample output.",
        bar: "No Test Matter",
        terminal: "[skill-ideas] sample requested without active matter",
      });
      return;
    }
    let idea = session?.savedIdea;
    if (!idea) {
      idea = await saveSkillIdeaInterviewSession({ silent: true });
      if (!idea) return;
    }

    const sampleReview = ensureSampleReview(session);
    const previousSample = getSampleMarkdown(sampleReview.activeSample);
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Generating...";
    ctx.setStatus({
      mood: "thinking",
      card: "<strong>Generating sample output</strong><br />Using the selected matter context. This will not create a runnable skill.",
      bar: "Generating Sample",
      terminal: `[skill-ideas] generating sample output for ${idea.id || "proposal"}`,
    });
    try {
      const sample = normalizeUiSample(await generateSkillIdeaSampleOutput({
        idea,
        feedback,
        previousSample,
      }));
      if (!sample.version || sample.version === 1 && sampleReview.samples.length > 0) {
        sample.version = sampleReview.samples.length + 1;
      }
      sampleReview.samples.push(sample);
      sampleReview.activeSample = sample;
      sampleReview.approved = false;
      sampleReview.stale = false;
      sampleReview.staleReason = "";
      session.sampleReview = sampleReview;
      await refreshSkillIdeaSampleLedger({ selectSampleId: getSampleId(sample) });
      updateReport({
        status: feedback ? "sample_feedback" : "sample_generated",
        skillIdeaId: idea.id || "",
        providerModel: formatSampleProvider(sample),
        sampleId: getSampleId(sample),
      });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: feedback ? "sample_feedback" : "sample_generated",
        skillIdeaId: idea.id || "",
        providerRunInvoked: true,
      });
      renderSkillSampleOutput(sampleReview.activeSample || sample, {
        version: getSampleVersion(sampleReview.activeSample || sample, sampleReview.samples.length),
        approved: false,
      });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Sample output ready</strong><br />Review it, type feedback to regenerate, or choose Looks right to create the skill.",
        bar: "Sample Output Ready",
        terminal: `[skill-ideas] sample v${sampleReview.samples.length} generated`,
      });
      aiCommandInput.value = "";
      aiCommandInput.placeholder = "Type feedback, Looks right, Copy Sample, or Regenerate sample";
      renderSkillIdeaSession();
    } catch (error) {
      updateReport({ status: "failed", error: error.message, skillIdeaId: idea.id || "" });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "failed",
        skillIdeaId: idea.id || "",
        providerRunInvoked: true,
        error: error.message,
      });
      renderSkillIdeaSession(`Sample generation failed: ${error.message}`);
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Sample generation failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Sample Failed",
        terminal: `[skill-ideas] sample failed: ${error.message}`,
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

  async function approveSavedSkillIdeaSampleAndCreateSkill() {
    const session = currentSkillIdeaInterview;
    const idea = session?.savedIdea;
    if (!idea) return;
    const sampleReview = ensureSampleReview(session);
    if (!sampleReview.activeSample) {
      renderSkillIdeaSession("Generate a sample output before approving it.");
      return;
    }
    const sampleId = getSampleId(sampleReview.activeSample);
    if (!sampleId) {
      renderSkillIdeaSession("The current sample is not persisted. Regenerate the sample before approving it.");
      return;
    }
    if (sampleReview.stale) {
      renderSkillIdeaSession("Regenerate the sample after the design brief changes before approving it.");
      return;
    }
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Approving...";
    try {
      const payload = await approveSkillIdeaSample(idea.id, sampleId);
      const approvedSample = payload.sample || {};
      sampleReview.activeSample = normalizeUiSample({
        ...sampleReview.activeSample,
        approved: true,
        approved_at: approvedSample.approvedAt || approvedSample.approved_at || "",
        state: "approved_current",
      });
      sampleReview.approved = true;
      sampleReview.stale = false;
      sampleReview.staleReason = "";
      session.sampleReview = sampleReview;
      await refreshSkillIdeaSampleLedger({ selectSampleId: sampleId });
      updateReport({
        status: "sample_approved",
        skillIdeaId: idea.id || "",
        sampleId,
      });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "sample_approved",
        skillIdeaId: idea.id || "",
        sampleId,
        providerRunInvoked: false,
      });
      renderSkillSampleOutput(sampleReview.activeSample, {
        version: getSampleVersion(sampleReview.activeSample, sampleReview.samples.length),
        approved: true,
      });
      renderSkillIdeaSession();
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Sample approved</strong><br />Creating and validating the runnable skill.",
        bar: "Sample Approved",
        terminal: "[skill-ideas] sample approved",
      });
      await createConfigurableSkillFromApprovedSample();
    } catch (error) {
      renderSkillIdeaSession(`Sample approval failed: ${error.message}`);
      updateReport({ status: "failed", error: error.message });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "failed",
        skillIdeaId: idea.id || "",
        sampleId,
        providerRunInvoked: false,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Sample approval failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Sample Approval Failed",
        terminal: `[skill-ideas] sample approval failed: ${error.message}`,
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

  async function createConfigurableSkillFromApprovedSample() {
    const session = currentSkillIdeaInterview;
    const idea = session?.savedIdea;
    const sampleReview = ensureSampleReview(session);
    if (!idea?.id) {
      renderSkillIdeaSession("Save the idea and approve a sample before creating the skill.");
      return;
    }
    if (!sampleReview.approved || sampleReview.stale) {
      renderSkillIdeaSession("Approve a current sample before creating the skill.");
      return;
    }
    const overlapCleared = await ensureSkillCreationOverlapCleared({ session, idea });
    if (!overlapCleared) return;
    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Creating...";
    ctx.setStatus({
      mood: "thinking",
      card: "<strong>Creating skill...</strong><br />Testing against the approved sample, then activating only if validation passes.",
      bar: "Creating Skill",
      terminal: [
        "[skill-builder] creating skill",
        "[skill-builder] testing against approved sample",
        "[skill-builder] activating if validation passes",
      ],
    });
    try {
      const overlapOverrideJustification = session.skillCreationOverlapOverride || "";
      const payload = await createSkillFromIdea(idea.id, { overlapOverrideJustification });
      const skill = payload.skill || {};
      lastCreatedConfigurableSkill = skill;
      session.createdSkill = skill;
      sampleReview.createdSkill = skill;
      session.sampleReview = sampleReview;
      updateReport({
        status: "skill_created",
        skillIdeaId: idea.id || "",
        matchedCommand: skill.slash || commandReport.getReport()?.matchedCommand || "skill_idea/interview",
        providerModel: [skill.modelPolicy?.provider, skill.modelPolicy?.model].filter(Boolean).join(" / "),
        artifacts: [skill.outputArtifact].filter(Boolean),
      });
      recordCommandInteraction({
        renderedState: "skill_builder/created",
        status: "skill_created",
        skillIdeaId: idea.id || "",
        providerRunInvoked: true,
      });
      currentSkillIdeaInterview = null;
      renderSkillReady(skill);
      renderCreatedSkillCommandRail(skill);
      void commandSuggestions.refreshConfigurableSlashSuggestions({ force: true });
      aiCommandInput.value = "";
      aiCommandInput.placeholder = skill.slash
        ? `Type ${skill.slash} to run it, or another action`
        : DEFAULT_COMMAND_PLACEHOLDER;
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill Ready</strong><br />You can use <code>${escapeHtml(skill.slash || "")}</code>.`,
        bar: "Skill Ready",
        terminal: `[skill-builder] activated ${skill.slash || "custom skill"}`,
      });
    } catch (error) {
      renderSkillIdeaSession(`Skill creation failed: ${error.message}`);
      updateReport({ status: "failed", error: error.message });
      recordCommandInteraction({
        renderedState: "skill_builder/create",
        status: "failed",
        skillIdeaId: idea.id || "",
        providerRunInvoked: true,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill creation failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Skill Creation Failed",
        terminal: `[skill-builder] failed: ${error.message}`,
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

  async function ensureSkillCreationOverlapCleared({ session, idea }) {
    if (isSkillImprovementIdea({ session, idea })) return true;
    const userRequest = buildSkillCreationOverlapRequest({ session, idea });
    const overrideJustification = session.skillCreationOverlapOverride || "";
    const cleared = session.skillCreationOverlapCleared || {};
    if (
      cleared.ideaId === idea?.id
      && cleared.userRequest === userRequest
      && cleared.overrideJustification === overrideJustification
    ) {
      return true;
    }

    aiCommandSubmit.disabled = true;
    aiCommandSubmit.textContent = "Checking...";
    ctx.setStatus({
      mood: "thinking",
      card: "<strong>Checking existing skills...</strong><br />Making sure this does not duplicate an existing skill before activation.",
      bar: "Checking Skills",
      terminal: "[skill-builder] checking overlap before skill creation",
    });
    try {
      const decision = await checkSkillIntent({ userRequest, overrideJustification });
      updateReport({
        status: "overlap_checked",
        routerDecision: decision.decision || "",
        routerMatchedSkill: decision.matched_skill || "",
      });
      recordCommandInteraction({
        renderedState: "skill_builder/overlap_check",
        status: "overlap_checked",
        skillIdeaId: idea?.id || "",
        routerDecision: decision,
        providerRunInvoked: true,
      });
      if (isBlockingSkillOverlapDecision(decision)) {
        session.skillCreationOverlapGate = {
          decision,
          userRequest,
          overrideJustification,
        };
        renderSkillCreationOverlapGate({ decision, userRequest, overrideJustification });
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Existing skill may already cover this</strong><br />Review <code>${escapeHtml(decision.matched_skill || "the matched skill")}</code> before creating another skill.`,
          bar: "Review Existing Skill",
          terminal: `[skill-builder] overlap gate ${decision.matched_skill || ""}`.trim(),
        });
        return false;
      }
      session.skillCreationOverlapCleared = {
        ideaId: idea?.id || "",
        userRequest,
        overrideJustification,
        decision,
      };
      return true;
    } catch (error) {
      renderSkillIdeaSession(`Existing-skill check failed: ${error.message}`);
      updateReport({ status: "failed", error: error.message });
      recordCommandInteraction({
        renderedState: "skill_builder/overlap_check",
        status: "failed",
        skillIdeaId: idea?.id || "",
        providerRunInvoked: true,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Existing-skill check failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Skill Check Failed",
        terminal: `[skill-builder] overlap check failed: ${error.message}`,
      });
      return false;
    } finally {
      updateReport({
        statusBar: getStatusBarText(),
        terminalLines: getLatestTerminalLines(),
      });
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "Go";
    }
  }

  function renderSkillCreationOverlapGate({ decision = {}, userRequest = "", overrideJustification = "", errorMessage = "" } = {}) {
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderSkillCreationOverlapGateHtml({
      decision,
      userRequest,
      overrideJustification,
      errorMessage,
    });
    wireSkillCreationOverlapGateActions({ decision, userRequest });
  }

  function wireSkillCreationOverlapGateActions({ decision = {}, userRequest = "" } = {}) {
    const form = aiCommandSession?.querySelector?.("[data-skill-overlap-form]");
    const input = aiCommandSession?.querySelector?.("[data-skill-overlap-justification]");
    const errorBox = aiCommandSession?.querySelector?.("[data-skill-overlap-error]");
    form?.addEventListener?.("submit", async (event) => {
      event.preventDefault();
      const justification = input?.value?.trim?.() || "";
      if (!justification) {
        if (errorBox) {
          errorBox.textContent = "Explain why this is a separate new skill before continuing.";
          errorBox.hidden = false;
        }
        return;
      }
      if (currentSkillIdeaInterview) {
        currentSkillIdeaInterview.skillCreationOverlapOverride = justification;
        currentSkillIdeaInterview.skillCreationOverlapCleared = null;
      }
      await createConfigurableSkillFromApprovedSample();
    });
    aiCommandSession?.querySelectorAll?.("[data-skill-overlap-action]")?.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.skillOverlapAction === "cancel") {
          renderSkillIdeaSession(
            decision.matched_skill
              ? `Skill creation paused. Use ${decision.matched_skill} or justify why this should be a separate new skill.`
              : "Skill creation paused. Use the existing skill or justify why this should be a separate new skill.",
          );
          ctx.setStatus({
            mood: "idle",
            card: "<strong>Skill creation paused</strong><br />No skill was created.",
            bar: "Skill Creation Paused",
            terminal: `[skill-builder] creation paused after overlap check ${userRequest}`.trim(),
          });
        }
      });
    });
  }

  function renderSkillReady(skill = {}) {
    breadcrumbs.textContent = "skill ready";
    editorContent.innerHTML = renderSkillReadyHtml(skill);
  }

  function renderCreatedSkillCommandRail(skill = {}) {
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderCreatedSkillCommandRailHtml(skill);
    wireCreatedSkillActions();
  }

  async function copySavedSkillIdeaSample() {
    const session = currentSkillIdeaInterview;
    const idea = session?.savedIdea;
    const sample = session?.sampleReview?.activeSample;
    if (!idea || !sample) return;
    await copySkillIdeaSample(sample, {
      version: getSampleVersion(sample, session.sampleReview.samples.length),
      approved: session.sampleReview.approved,
    });
  }

  async function copySavedSkillIdeaSampleByVersion(version) {
    const session = currentSkillIdeaInterview;
    const idea = session?.savedIdea;
    const sampleReview = ensureSampleReview(session || {});
    const sample = findSampleByVersion(sampleReview, version);
    if (!idea || !sample) {
      renderSkillIdeaSession(`Sample v${Number(version || 0) || "?"} is not available in the ledger.`);
      return;
    }
    await copySkillIdeaSample(sample, {
      version: getSampleVersion(sample, version),
      approved: getSampleState(sample) === "approved_current",
    });
  }

  async function copySkillIdeaSample(sample, { version, approved } = {}) {
    const session = currentSkillIdeaInterview;
    const idea = session?.savedIdea;
    if (!idea || !sample) return;
    try {
      await writeClipboardText(formatSkillSampleCopy(sample, {
        version,
        approved,
      }));
      updateReport({
        status: "copied_sample",
        skillIdeaId: idea.id || "",
        sampleId: getSampleId(sample),
      });
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "copied_sample",
        skillIdeaId: idea.id || "",
        providerRunInvoked: false,
      });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Sample copied</strong><br />This is a review sample only; no skill was created.",
        bar: "Sample Copied",
        terminal: `[skill-ideas] copied sample ${getSampleId(sample)}`,
      });
      renderSkillIdeaSession();
    } catch (error) {
      renderSkillIdeaSession(`Sample copy failed: ${error.message}`);
      recordCommandInteraction({
        renderedState: "skill_idea/sample_output",
        status: "failed",
        skillIdeaId: idea.id || "",
        providerRunInvoked: false,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Sample copy failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Sample Copy Failed",
        terminal: `[skill-ideas] sample copy failed: ${error.message}`,
      });
    }
  }

  function renderSkillSampleOutput(sample, { version, approved } = {}) {
    const sampleReview = currentSkillIdeaInterview?.sampleReview || {};
    breadcrumbs.textContent = "sample output";
    editorContent.innerHTML = renderSkillSampleOutputHtml(sample, { version, approved, sampleReview });
  }

  async function refreshSkillIdeaSampleLedger({ selectSampleId = "" } = {}) {
    const session = currentSkillIdeaInterview;
    const idea = session?.savedIdea;
    if (!idea?.id) return ensureSampleReview(session || {});
    const sampleReview = ensureSampleReview(session);
    const preferredId = selectSampleId || getSampleId(sampleReview.activeSample);
    try {
      const payload = await listSkillIdeaSamples(idea.id);
      const ledger = Array.isArray(payload.samples) ? payload.samples.map(normalizeUiSample) : [];
      sampleReview.ledger = ledger;
      sampleReview.samples = ledger;
      if (ledger.length) {
        const selected = ledger.find((sample) => getSampleId(sample) === preferredId) || ledger.at(-1);
        applyActiveSampleState(sampleReview, selected);
      }
      session.sampleReview = sampleReview;
    } catch {
      const ledger = getLedgerSamples(sampleReview);
      sampleReview.ledger = ledger;
      if (sampleReview.activeSample) {
        applyActiveSampleState(sampleReview, sampleReview.activeSample);
      }
      session.sampleReview = sampleReview;
    }
    return sampleReview;
  }

  async function copySavedSkillIdeaReviewPacket() {
    const session = currentSkillIdeaInterview;
    const idea = session?.savedIdea;
    if (!idea) return;
    try {
      const registry = await loadSkillRegistry().catch(() => ({}));
      await writeClipboardText(formatSkillIdeaReviewPacket(idea, registry));
      updateReport({ status: "copied", skillIdeaId: idea.id || "" });
      recordCommandInteraction({
        renderedState: "skill_idea/review_packet",
        status: "copied_review_packet",
        skillIdeaId: idea.id || "",
        providerRunInvoked: false,
      });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Review packet copied</strong><br />No provider call, prompt generation, or matter artifact write occurred.",
        bar: "Skill Idea Packet Copied",
        terminal: `[skill-ideas] copied review packet for ${idea.id || "proposal"}`,
      });
      renderSkillIdeaSession();
    } catch (error) {
      renderSkillIdeaSession(`Copy failed: ${error.message}`);
      recordCommandInteraction({
        renderedState: "skill_idea/review_packet",
        status: "failed",
        skillIdeaId: idea.id || "",
        providerRunInvoked: false,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Review packet copy failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Skill Idea Copy Failed",
        terminal: `[skill-ideas] copy failed: ${error.message}`,
      });
    }
  }

  async function markSavedSkillIdeaReady() {
    const session = currentSkillIdeaInterview;
    const idea = session?.savedIdea;
    if (!idea?.id) return;
    if (!idea.readiness?.ready) {
      renderSkillIdeaSession("Complete every readiness item before marking ready.");
      return;
    }
    try {
      const payload = await updateSkillIdeaStatus(idea.id, "ready_for_review");
      session.savedIdea = payload.idea || { ...idea, status: "ready_for_review" };
      updateReport({ status: "ready_for_review", skillIdeaId: session.savedIdea.id || "" });
      recordCommandInteraction({
        renderedState: "skill_idea/ready",
        status: "ready_for_review",
        skillIdeaId: session.savedIdea.id || "",
        providerRunInvoked: false,
      });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Marked ready for review</strong><br />Still not runnable. No provider call or matter artifact was created.",
        bar: "Ready for Review",
        terminal: `[skill-ideas] marked ready ${session.savedIdea.id || idea.id}`,
      });
      renderSkillIdeaSession();
    } catch (error) {
      renderSkillIdeaSession(`Mark ready failed: ${error.message}`);
      recordCommandInteraction({
        renderedState: "skill_idea/ready",
        status: "failed",
        skillIdeaId: idea.id || "",
        providerRunInvoked: false,
        error: error.message,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill idea update failed</strong><br />${escapeHtml(error.message)}`,
        bar: "Skill Idea Failed",
        terminal: `[skill-ideas] mark ready failed: ${error.message}`,
      });
    }
  }

  async function openSavedSkillIdeaInSkills() {
    currentSkillIdeaInterview = null;
    clearSkillIdeaSession();
    aiCommandInput.value = "";
    aiCommandInput.placeholder = DEFAULT_COMMAND_PLACEHOLDER;
    aiCommandSubmit.textContent = "Go";
    await deterministicCommands.showSkillsPage("open skills");
  }

  function startAnotherSkillIdea() {
    currentSkillIdeaInterview = null;
    aiCommandInput.value = "";
    aiCommandInput.placeholder = "create a skill to...";
    aiCommandSubmit.disabled = false;
    aiCommandSubmit.textContent = "Go";
    clearSkillIdeaSession();
    editorContent.innerHTML = `
      <h1>Command</h1>
      <section class="skill-router-result">
        <h2>Start another idea</h2>
        <p>Type the next skill idea in the Command rail. Nothing will run until it becomes a validated skill in a later workflow.</p>
      </section>
    `;
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Ready for another idea</strong><br />Type a new skill idea in the Command rail.",
      bar: "Skill Idea",
      terminal: "[skill-ideas] ready for another idea",
    });
    recordCommandInteraction({
      renderedState: "skill_idea/start_another",
      status: "started_another_idea",
      providerRunInvoked: false,
    });
  }

  function wireSkillIdeaSessionActions() {
    aiCommandSession?.querySelectorAll?.("[data-skill-interview-action]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.skillInterviewAction;
        if (action === "save") {
          await saveSkillIdeaInterviewSession();
          return;
        }
        if (action === "edit") {
          await handleSkillIdeaInterviewInput("edit answers");
          return;
        }
        if (action === "copy-packet") {
          await copySavedSkillIdeaReviewPacket();
          return;
        }
        if (action === "generate-sample") {
          await generateSavedSkillIdeaSample();
          return;
        }
        if (action === "regenerate-sample") {
          await generateSavedSkillIdeaSample({ feedback: "Regenerate the sample with the current design brief." });
          return;
        }
        if (action === "approve-sample") {
          await approveSavedSkillIdeaSampleAndCreateSkill();
          return;
        }
        if (action === "create-skill") {
          await createConfigurableSkillFromApprovedSample();
          return;
        }
        if (action === "run-created-skill") {
          const slash = currentSkillIdeaInterview?.createdSkill?.slash || currentSkillIdeaInterview?.sampleReview?.createdSkill?.slash || "";
          if (slash) await runConfigurableSkillCommand({ slash, title: currentSkillIdeaInterview?.createdSkill?.title || slash }, slash);
          return;
        }
        if (action === "copy-sample") {
          await copySavedSkillIdeaSample();
          return;
        }
        if (action === "copy-ledger-sample") {
          const sampleId = button.dataset.sampleId || "";
          const sampleReview = currentSkillIdeaInterview?.sampleReview || {};
          const sample = getLedgerSamples(sampleReview).find((candidate) => getSampleId(candidate) === sampleId);
          if (sample) {
            await copySkillIdeaSample(sample, {
              version: getSampleVersion(sample, 1),
              approved: getSampleState(sample) === "approved_current",
            });
          }
          return;
        }
        if (action === "mark-ready") {
          await markSavedSkillIdeaReady();
          return;
        }
        if (action === "open-skills") {
          await openSavedSkillIdeaInSkills();
          return;
        }
        if (action === "start-another") {
          startAnotherSkillIdea();
          return;
        }
        if (action === "cancel") {
          cancelSkillIdeaInterview();
        }
      });
    });
  }

  function cancelSkillIdeaInterview() {
    currentSkillIdeaInterview = null;
    aiCommandInput.value = "";
    aiCommandInput.placeholder = DEFAULT_COMMAND_PLACEHOLDER;
    aiCommandSubmit.disabled = false;
    aiCommandSubmit.textContent = "Go";
    clearSkillIdeaSession();
    updateReport({ status: "cancelled" });
    recordCommandInteraction({
      renderedState: "skill_idea/interview",
      status: "cancelled",
      providerRunInvoked: false,
    });
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
  }

  function clearSkillIdeaSession() {
    if (aiCommandSession) {
      aiCommandSession.hidden = true;
      aiCommandSession.innerHTML = "";
    }
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
    if (currentSkillIdeaInterview || newSkillModeController.isActive()) return;
    pendingConfigurableRun = null;
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
