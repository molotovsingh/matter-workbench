import { getJson, postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import {
  buildSkillIdeaInterview,
  buildSkillIdeaPayloadFromInterview,
  planSkillIdeaInterview,
  parseAdaptiveSkillIdeaInput,
} from "./skill-idea-interview.js";
import { renderRouterDecision, wireRouterGateButtons } from "./skill-router-panel.js";
import { formatSkillIdeaReviewPacket } from "./views/skills-page.js";

const DEFAULT_COMMAND_PLACEHOLDER = "find payment, open library, create list of dates";

const SLASH_COMMANDS = new Set([
  "/matter-init",
  "/prepare_matter",
  "/extract",
  "/describe_sources",
  "/context_preview",
  "/context_search",
  "/create_listofdates",
  "/doctor",
]);

const PROVIDER_BACKED_COMMANDS = new Set([
  "/describe_sources",
  "/create_listofdates",
]);

const SLASH_COMMAND_SUGGESTIONS = [
  {
    command: "/matter-init",
    description: "Set up the matter folders and file register.",
  },
  {
    command: "/prepare_matter",
    description: "Show a guarded preparation plan and skip stages that are already current.",
  },
  {
    command: "/extract",
    description: "Extract text and OCR-ready records from registered files.",
  },
  {
    command: "/describe_sources",
    description: "Label sources with lawyer-readable names. Paid AI actions ask first.",
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
    description: "Create the lawyer-facing list of dates. Paid AI actions ask first.",
  },
  {
    command: "/doctor",
    description: "Check known matter workspace issues.",
  },
];

const COMMAND_ALIASES = new Map([
  ["prepare matter", "/prepare_matter"],
  ["prepare this matter", "/prepare_matter"],
  ["matter prep", "/prepare_matter"],
  ["setup matter", "/prepare_matter"],
  ["extract", "/extract"],
  ["describe sources", "/describe_sources"],
  ["source labels", "/describe_sources"],
  ["context", "/context_preview"],
  ["show context", "/context_preview"],
  ["list of dates", "/create_listofdates"],
  ["create list of dates", "/create_listofdates"],
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
const NEW_SKILL_MODE_ALIASES = new Set([
  "new skill",
  "create skill",
  "create a skill",
  "make skill",
  "make a skill",
  "design skill",
  "design a skill",
]);

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
  const createSkillFromIdea = options.createSkillFromIdea || ((ideaId) => postJson(`/api/skill-ideas/${encodeURIComponent(ideaId)}/create-skill`, {}));
  const runConfigurableSkill = options.runConfigurableSkill || ((body) => postJson("/api/configurable-skills/run", body));
  const planSkillIdeaInterviewProvider = options.planSkillIdeaInterviewProvider || planSkillIdeaInterviewViaApi;
  const writeClipboardText = options.writeClipboardText || writeClipboard;
  const planSkillIdeaInterviewFn = options.planSkillIdeaInterview || planSkillIdeaInterview;
  let latestReport = null;
  let activeSuggestionIndex = -1;
  let currentSkillIdeaInterview = null;
  let pendingSkillIdeaMode = null;
  let pendingConfigurableRun = null;
  let configurableSlashSuggestions = [];
  let configurableSlashSuggestionsLoaded = false;
  let configurableSlashSuggestionsLoading = false;
  let lastCreatedConfigurableSkill = null;

  function wire() {
    if (!aiCommandForm) return;
    aiCommandForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const userRequest = aiCommandInput.value.trim();
      if (userRequest) clearCommandInput();
      await handleCommand({ userRequest });
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
    if (currentSkillIdeaInterview) {
      await handleSkillIdeaInterviewInput(userRequest);
      return;
    }
    if (pendingSkillIdeaMode) {
      await handlePendingSkillIdeaModeInput(userRequest);
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
      openNewSkillMode(userRequest);
      return;
    }

    const parsedCommand = parseDeterministicCommand(userRequest);
    if (parsedCommand) {
      await runDeterministicCommand(parsedCommand, userRequest);
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
      recordCommandInteraction({
        renderedState: `command/${parsedCommand.type}`,
        providerRunInvoked: parsedCommand.type === "skill" && PROVIDER_BACKED_COMMANDS.has(parsedCommand.command),
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

  async function findConfigurableSkillCommand(userRequest) {
    const normalized = normalizeCommandInput(userRequest);
    if (!normalized.startsWith("/")) return null;
    const registry = await loadSkillRegistry().catch(() => null);
    const skills = Array.isArray(registry?.skills) ? registry.skills : [];
    return skills.find((skill) => (
      skill?.configurable
      && skill.status === "active"
      && normalizeCommandInput(skill.slash) === normalized
    )) || null;
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
          slash,
          title: skill?.title || result.skill?.title || slash,
          artifactPath: result.artifactPath || "",
        };
        renderConfigurableSkillOverwritePrompt(result);
        updateReport({
          status: "warned",
          artifacts: result.artifactPath ? [result.artifactPath] : [],
        });
        recordCommandInteraction({
          renderedState: "configurable_skill/overwrite",
          status: "warned",
          providerRunInvoked: false,
        });
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Overwrite confirmation</strong><br /><code>${escapeHtml(result.artifactPath || "artifact")}</code> already exists.`,
          bar: "Overwrite Confirmation",
          terminal: `[configurable-skill] overwrite required for ${slash}`,
        });
        return;
      }
      renderConfigurableSkillRunResult(result);
      updateReport({
        status: "ran",
        providerModel: [result.aiRun?.provider, result.aiRun?.model].filter(Boolean).join(" / "),
        artifacts: [result.outputPaths?.markdown, result.outputPaths?.json].filter(Boolean),
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
    const normalized = normalizeCommandInput(userRequest);
    if (normalized === "cancel" || normalized === "keep current") {
      pendingConfigurableRun = null;
      renderCommandRailError("Kept the existing artifact. Nothing was overwritten.");
      updateReport({ status: "cancelled" });
      recordCommandInteraction({
        renderedState: "configurable_skill/overwrite",
        status: "cancelled",
        providerRunInvoked: false,
      });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Kept current artifact</strong><br />Nothing was overwritten.",
        bar: "Run Cancelled",
        terminal: "[configurable-skill] overwrite cancelled",
      });
      return true;
    }
    if (normalized === "overwrite" || normalized === "overwrite artifact" || normalized === "run again") {
      const pending = pendingConfigurableRun;
      await runConfigurableSkillCommand(pending, userRequest, { overwrite: true });
      return true;
    }
    return false;
  }

  function renderConfigurableSkillOverwritePrompt(result = {}) {
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = `
      <section class="command-interview" aria-live="polite">
        <h3>Artifact already exists</h3>
        <p class="muted">This skill writes a matter artifact. Choose whether to keep the current file or overwrite it.</p>
        <dl class="skill-card-meta">
          <div><dt>Skill</dt><dd><code>${escapeHtml(result.skill?.slash || pendingConfigurableRun?.slash || "")}</code></dd></div>
          <div><dt>Artifact</dt><dd><code>${escapeHtml(result.artifactPath || "")}</code></dd></div>
        </dl>
        <div class="command-interview-actions">
          <button type="button" data-configurable-skill-action="overwrite">Overwrite artifact</button>
          <button type="button" class="secondary" data-configurable-skill-action="cancel">Keep current</button>
        </div>
      </section>
    `;
    wireConfigurableSkillActions();
  }

  function renderConfigurableSkillRunResult(result = {}) {
    const skill = result.skill || {};
    breadcrumbs.textContent = skill.slash || "custom skill";
    editorContent.innerHTML = `
      <h1>${escapeHtml(skill.title || "Custom Skill Result")}</h1>
      <p class="muted">Generated by <code>${escapeHtml(skill.slash || "")}</code>. Review before relying on it.</p>
      <section class="skill-router-result">
        <dl class="skill-card-meta">
          <div><dt>Provider</dt><dd>${escapeHtml([result.aiRun?.provider, result.aiRun?.model].filter(Boolean).join(" / ") || "configured provider")}</dd></div>
          <div><dt>Output</dt><dd><code>${escapeHtml(result.outputPaths?.markdown || result.outputPath || "")}</code></dd></div>
          <div><dt>Metadata</dt><dd><code>${escapeHtml(result.outputPaths?.json || "")}</code></dd></div>
        </dl>
        <pre class="skill-sample-markdown">${escapeHtml(result.markdown || "")}</pre>
      </section>
    `;
    if (aiCommandSession) {
      aiCommandSession.hidden = false;
      aiCommandSession.innerHTML = `
        <section class="command-interview" aria-live="polite">
          <h3>Skill complete</h3>
          <p>Wrote <code>${escapeHtml(result.outputPaths?.markdown || result.outputPath || "")}</code>.</p>
          <p class="muted">The result is also shown in the main pane for review.</p>
        </section>
      `;
    }
  }

  function wireConfigurableSkillActions() {
    aiCommandSession?.querySelectorAll?.("[data-configurable-skill-action]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.configurableSkillAction;
        if (action === "overwrite") {
          const pending = pendingConfigurableRun;
          await runConfigurableSkillCommand(pending, "overwrite artifact", { overwrite: true });
          return;
        }
        if (action === "cancel") {
          await handlePendingConfigurableRunInput("keep current");
        }
      });
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
          await showSkillsPage("open skills");
          return;
        }
        if (action === "start-another") {
          startAnotherSkillIdea();
        }
      });
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
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Command</strong><br />Checking this future skill idea against the current skill list.",
      bar: "Command Check",
      terminal: `[ai-command] checking intent: ${userRequest}`,
    });

    try {
      const decision = await checkSkillIntent({
        userRequest,
        overrideJustification,
      });
      renderCommandRailDecision({ userRequest, overrideJustification, decision });
      updateReport({
        status: "checked",
        routerDecision: decision.decision || "",
        routerMatchedSkill: decision.matched_skill || "",
      });
      recordCommandInteraction({
        renderedState: "router/check",
        status: "router_checked",
        routerDecision: decision,
        providerRunInvoked: true,
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Router decision</strong><br />${escapeHtml(decision.decision)}${decision.matched_skill ? ` for <code>${escapeHtml(decision.matched_skill)}</code>` : ""}.`,
        bar: "Router Ready",
        terminal: `[ai-command] ${decision.decision}${decision.matched_skill ? ` -> ${decision.matched_skill}` : ""}`,
      });
    } catch (error) {
      renderCommandRailError(error.message);
      updateReport({ status: "failed", error: error.message });
      recordCommandInteraction({
        renderedState: "router/check",
        status: "failed",
        providerRunInvoked: true,
        error: error.message,
      });
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
    const normalized = normalizeCommandInput(userRequest);
    if (normalized === "cancel") {
      clearCommandInput();
      cancelSkillIdeaInterview();
      return;
    }
    if (!userRequest) {
      renderSkillIdeaSession("Answer the current question, or choose Cancel.");
      return;
    }
    if (session.ready) {
      if (normalized === "save idea" || normalized === "save updates") {
        clearCommandInput();
        await saveSkillIdeaInterviewSession();
        return;
      }
      if (session.savedIdea) {
        if (normalized === "generate sample" || normalized === "use this matter for sample" || normalized === "regenerate sample") {
          clearCommandInput();
          await generateSavedSkillIdeaSample({ feedback: normalized === "regenerate sample" ? "Regenerate the sample with the current design brief." : "" });
          return;
        }
        if (normalized === "copy sample") {
          clearCommandInput();
          await copySavedSkillIdeaSample();
          return;
        }
        if (/^copy sample v\d+$/i.test(normalized)) {
          clearCommandInput();
          await copySavedSkillIdeaSampleByVersion(Number(normalized.match(/\d+$/)?.[0] || 0));
          return;
        }
        if (normalized === "looks right" || normalized === "approve sample" || normalized === "sample approved") {
          clearCommandInput();
          await approveSavedSkillIdeaSample();
          return;
        }
        if (normalized === "create skill") {
          clearCommandInput();
          await createConfigurableSkillFromApprovedSample();
          return;
        }
        if (normalized === "copy review packet") {
          clearCommandInput();
          await copySavedSkillIdeaReviewPacket();
          return;
        }
        if (normalized === "mark ready for review" || normalized === "mark ready") {
          clearCommandInput();
          await markSavedSkillIdeaReady();
          return;
        }
        if (normalized === "open in skills" || normalized === "open skills") {
          clearCommandInput();
          await openSavedSkillIdeaInSkills();
          return;
        }
        if (normalized === "start another idea") {
          clearCommandInput();
          startAnotherSkillIdea();
          return;
        }
        if (session.sampleReview?.activeSample && !session.sampleReview.approved) {
          clearCommandInput();
          await generateSavedSkillIdeaSample({ feedback: userRequest.trim() });
          return;
        }
      }
      if (normalized === "edit answers" || normalized === "edit") {
        if (!Array.isArray(session.interview.questions) || session.interview.questions.length === 0) {
          renderSkillIdeaSession("No follow-up questions were asked. Edit the skill idea by starting again, or generate a sample from a matter.");
          return;
        }
        session.editingSavedIdea = Boolean(session.savedIdea);
        session.ready = false;
        session.questionIndex = 0;
        aiCommandInput.value = session.answers[session.interview.questions[0]?.id] || "";
        aiCommandSubmit.textContent = "Answer";
        renderSkillIdeaSession();
        return;
      }
      if (normalized === "generate sample" || normalized === "generate sample from this matter" || normalized === "use this matter for sample") {
        clearCommandInput();
        await generateSavedSkillIdeaSample();
        return;
      }
      if (normalized === "save idea") {
        clearCommandInput();
        await saveSkillIdeaInterviewSession();
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
      aiCommandSession.innerHTML = renderSavedSkillIdeaSession({ idea: savedIdea, interview, answers, sampleReview, createdSkill, errorMessage });
      wireSkillIdeaSessionActions();
      return;
    }
    if (ready) {
      const activeMatter = ctx.getActiveMatter?.() || {};
      const hasMatter = Boolean(activeMatter?.folderName);
      const primaryLabel = hasMatter ? "Generate sample from this matter" : "Pick matter to test this skill";
      aiCommandSession.innerHTML = `
        <section class="command-interview" aria-live="polite">
          <h3>Ready to generate a sample output</h3>
          <p class="muted">Not runnable yet. The next step is to test this idea against a matter. ${hasMatter ? "The idea will be saved before sample generation." : "Pick a matter to test this skill."}</p>
          ${renderSkillIdeaUnderstood(interview)}
          ${Array.isArray(interview.questions) && interview.questions.length === 0 ? '<p class="muted">No follow-up questions were needed because the initial request already contains a detailed skill specification.</p>' : ""}
          ${renderAnsweredQuestions(interview, answers)}
          ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ""}
          <div class="command-interview-actions">
            <button type="button" data-skill-interview-action="generate-sample"${hasMatter ? "" : " disabled"}>${escapeHtml(primaryLabel)}</button>
            <button type="button" class="secondary" data-skill-interview-action="edit">Edit answers</button>
            <button type="button" class="secondary" data-skill-interview-action="cancel">Cancel</button>
          </div>
        </section>
      `;
      wireSkillIdeaSessionActions();
      return;
    }
    const question = interview.questions[questionIndex] || {};
    aiCommandSession.innerHTML = `
      <section class="command-interview" aria-live="polite">
        <h3>Skill idea interview</h3>
        <p class="muted">Temporary browser-memory session. Refreshing may lose it.</p>
        ${renderSkillIdeaUnderstood(interview)}
        <div class="command-interview-question">
          <strong>Question ${questionIndex + 1}</strong>
          <p>${escapeHtml(question.label || "")}</p>
          ${question.help ? `<p>${escapeHtml(question.help)}</p>` : ""}
          ${renderQuestionExamples(question)}
        </div>
        ${renderAnsweredQuestions(interview, answers)}
        ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ""}
        <div class="command-interview-actions">
          <button type="button" class="secondary" data-skill-interview-action="cancel">Cancel</button>
        </div>
      </section>
    `;
    wireSkillIdeaSessionActions();
  }

  function renderSkillIdeaUnderstood(interview) {
    return `
        <div class="skill-idea-understood">
          <strong>What I understood</strong>
          <p>${escapeHtml(interview.understood)}</p>
          ${renderInterviewPlannerInfo(interview)}
          ${renderDefaultAssumptions(interview)}
          ${interview.targetSkill ? `<p class="muted">Likely related skill: <code>${escapeHtml(interview.targetSkill)}</code></p>` : ""}
        </div>
    `;
  }

  function renderInterviewPlannerInfo(interview) {
    const plannerInfo = describeInterviewPlanner(interview);
    const plannerLabel = plannerInfo.model || plannerInfo.source;
    const reason = plannerInfo.fallbackReason
      ? `<br /><span>Fallback reason: ${escapeHtml(plannerInfo.fallbackReason)}</span>`
      : "";
    return `<p class="muted">Planner: ${escapeHtml(plannerLabel)}${reason}</p>`;
  }

  function renderDefaultAssumptions(interview) {
    const assumptions = Array.isArray(interview.defaultAssumptions) ? interview.defaultAssumptions : [];
    if (!assumptions.length) return "";
    return `
      <ul class="command-interview-answers">
        ${assumptions.map((assumption) => `<li><span>Default</span><strong>${escapeHtml(assumption)}</strong></li>`).join("")}
      </ul>
    `;
  }

  function renderQuestionExamples(question) {
    const examples = Array.isArray(question.examples) ? question.examples.filter(Boolean) : [];
    if (examples.length) {
      return `<p class="muted">Examples: ${escapeHtml(examples.join(", "))}.</p>`;
    }
    return question.placeholder ? `<p class="muted">${escapeHtml(question.placeholder)}</p>` : "";
  }

  function renderAnsweredQuestions(interview, answers) {
    const answered = interview.questions
      .filter((question) => answers[question.id])
      .map((question) => `
        <li>
          <span>${escapeHtml(question.label)}</span>
          <strong>${escapeHtml(answers[question.id])}</strong>
        </li>
      `).join("");
    if (!answered) return "";
    return `
      <ul class="command-interview-answers">
        ${answered}
      </ul>
    `;
  }

  function renderSavedSkillIdeaSession({ idea, interview, answers, sampleReview = {}, createdSkill = null, errorMessage = "" }) {
    const brief = idea.designBrief || {};
    const readiness = idea.readiness || {};
    const status = String(idea.status || "incomplete");
    const checklistReady = Boolean(readiness.ready);
    const statusText = status === "ready_for_review"
      ? "Ready for review"
      : checklistReady
        ? "Incomplete - ready to mark for review"
        : "Incomplete";
    const checklistText = checklistReady
      ? "Complete"
      : `Incomplete ${Number(readiness.passedCount || 0)}/${Number(readiness.totalCount || 0)}`;
    return `
      <section class="command-interview" aria-live="polite">
        <h3>Saved skill idea</h3>
        <p class="muted">Not runnable yet. No prompt, code, slash command, activation, or matter artifact has been generated.</p>
        ${renderSkillIdeaUnderstood(interview)}
        <dl class="skill-card-meta">
          <div><dt>Status</dt><dd>${escapeHtml(statusText)}</dd></div>
          <div><dt>Checklist</dt><dd>${escapeHtml(checklistText)}</dd></div>
          <div><dt>Output</dt><dd>${escapeHtml(brief.expectedOutputArtifact || "Not specified")}</dd></div>
          <div><dt>Lane</dt><dd>${escapeHtml(brief.targetLane || "Not specified")}</dd></div>
          <div><dt>Risk</dt><dd>${escapeHtml(brief.riskLevel || "Not assessed")}</dd></div>
        </dl>
        <details class="skill-idea-brief" open>
          <summary>Design brief <span class="muted">Not runnable yet</span></summary>
          <dl class="skill-card-meta">
            <div><dt>User</dt><dd>${escapeHtml(brief.intendedUser || "Not specified")}</dd></div>
            <div><dt>Problem</dt><dd>${escapeHtml(brief.problem || "Not specified")}</dd></div>
            <div><dt>Inputs</dt><dd>${escapeHtml(brief.expectedInputs || "Not specified")}</dd></div>
            <div><dt>Paid/free</dt><dd>${escapeHtml(brief.paidPosture || "Not specified")}</dd></div>
          </dl>
          ${brief.notes ? `<p class="muted">${escapeHtml(brief.notes)}</p>` : ""}
        </details>
        ${renderAnsweredQuestions(interview, answers)}
        ${renderSavedSkillIdeaChecklist(readiness)}
        ${renderSavedSkillIdeaSampleReview({ idea, sampleReview, createdSkill })}
        ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ""}
        <div class="command-interview-actions">
          ${renderSampleReviewButtons(sampleReview, createdSkill)}
          <button type="button" data-skill-interview-action="copy-packet">Copy Review Packet</button>
          <button type="button" class="secondary" data-skill-interview-action="mark-ready"${checklistReady && status !== "ready_for_review" ? "" : " disabled"}>Mark ready for review</button>
          <button type="button" class="secondary" data-skill-interview-action="edit">Edit answers</button>
          <button type="button" class="secondary" data-skill-interview-action="open-skills">Open in Skills</button>
          <button type="button" class="secondary" data-skill-interview-action="start-another">Start another idea</button>
        </div>
      </section>
    `;
  }

  function renderSavedSkillIdeaSampleReview({ idea, sampleReview = {}, createdSkill = null }) {
    const activeMatter = ctx.getActiveMatter?.() || {};
    const activeSample = sampleReview.activeSample || null;
    const sampleMatter = getSampleMatter(activeSample);
    const matterName = activeSample
      ? sampleMatter.matterName || sampleMatter.folderName || ""
      : activeMatter?.metadata?.matterName || activeMatter?.folderName || "";
    const matterFolder = activeSample
      ? sampleMatter.folderName || ""
      : activeMatter?.folderName || "";
    const sampleVersion = activeSample ? getSampleVersion(activeSample, Array.isArray(sampleReview.samples) ? sampleReview.samples.length : 1) : 0;
    const approved = Boolean(sampleReview.approved);
    const stale = Boolean(sampleReview.stale);
    const readySkill = createdSkill || sampleReview.createdSkill || null;
    const sampleStatus = stale
      ? sampleReview.staleReason || "Design brief changed after this sample was generated. Regenerate the sample before approving it."
      : readySkill?.slash
        ? `Skill Ready. Use ${readySkill.slash}.`
      : approved
      ? "Sample approved. You can create the runnable skill from this approved sample."
      : activeSample
        ? `Sample v${sampleVersion || 1} ready for review. Type feedback to regenerate, or choose Looks right.`
        : matterFolder
          ? "Generate an AI sample output from the selected test matter."
          : "Pick a matter to generate a sample output.";
    return `
      <div class="skill-idea-sample-review">
        <h4>Sample output review</h4>
        <p class="muted">${escapeHtml(sampleStatus)}</p>
        ${readySkill?.slash ? `<p><strong>Skill Ready</strong>: type <code>${escapeHtml(readySkill.slash)}</code> to run it.</p>` : ""}
        <dl class="skill-card-meta">
          <div><dt>Test matter</dt><dd>${escapeHtml(matterName || "No matter selected")}</dd></div>
          <div><dt>Matter folder</dt><dd>${escapeHtml(matterFolder || "Pick a matter first")}</dd></div>
          <div><dt>Sample</dt><dd>${activeSample ? escapeHtml(`v${sampleVersion || 1}`) : "Not generated"}</dd></div>
        </dl>
        ${getSampleAiRun(activeSample).provider || getSampleAiRun(activeSample).model ? `
          <p class="muted">Sample provider: ${escapeHtml(formatSampleProvider(activeSample))}</p>
        ` : ""}
        <p class="muted">Sample generation may call the configured AI provider. A skill becomes runnable only after you approve the sample and choose Create skill.</p>
        ${renderSampleLedger(sampleReview)}
      </div>
    `;
  }

  function renderSampleReviewButtons(sampleReview = {}, createdSkill = null) {
    const activeMatter = ctx.getActiveMatter?.() || {};
    const hasMatter = Boolean(activeMatter?.folderName);
    const activeSample = sampleReview.activeSample || null;
    const approved = Boolean(sampleReview.approved);
    const stale = Boolean(sampleReview.stale) || isSampleStale(activeSample);
    const readySkill = createdSkill || sampleReview.createdSkill || null;
    const generateLabel = activeSample ? "Regenerate sample" : "Generate sample from this matter";
    const generateAction = activeSample ? "regenerate-sample" : "generate-sample";
    if (readySkill?.slash) {
      return `
        <button type="button" data-skill-interview-action="run-created-skill">Run now</button>
        <button type="button" class="secondary" data-skill-interview-action="copy-sample"${activeSample ? "" : " disabled"}>Copy Sample</button>
      `;
    }
    return `
      <button type="button" data-skill-interview-action="${generateAction}"${hasMatter && !approved ? "" : " disabled"}>${escapeHtml(generateLabel)}</button>
      <button type="button" class="secondary" data-skill-interview-action="approve-sample"${activeSample && !approved && !stale ? "" : " disabled"}>Looks right</button>
      <button type="button" data-skill-interview-action="create-skill"${activeSample && approved && !stale ? "" : " disabled"}>Create skill</button>
      <button type="button" class="secondary" data-skill-interview-action="copy-sample"${activeSample ? "" : " disabled"}>Copy Sample</button>
    `;
  }

  function renderSavedSkillIdeaChecklist(readiness = {}) {
    const items = Array.isArray(readiness.items) ? readiness.items : [];
    if (!items.length) return "";
    return `
      <div class="skill-idea-readiness">
        <div class="skill-idea-readiness-header">
          <strong>Readiness checklist</strong>
          <span class="pipeline-state ${readiness.ready ? "present" : "pending"}">${readiness.ready ? "Complete" : "Incomplete"}</span>
        </div>
        <ul>
          ${items.map((item) => `
            <li class="${item.passed ? "passed" : "missing"}">
              <span>${item.passed ? "OK" : "Missing"}</span>
              ${escapeHtml(item.label || item.key || "Readiness item")}
            </li>
          `).join("")}
        </ul>
      </div>
    `;
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
        card: "<strong>Sample output ready</strong><br />Review it, type feedback to regenerate, or choose Looks right.",
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

  async function approveSavedSkillIdeaSample() {
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
        card: "<strong>Sample approved</strong><br />You can now create the runnable skill from this approved sample.",
        bar: "Sample Approved",
        terminal: "[skill-ideas] sample approved",
      });
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
      const payload = await createSkillFromIdea(idea.id);
      const skill = payload.skill || {};
      lastCreatedConfigurableSkill = skill;
      session.createdSkill = skill;
      sampleReview.createdSkill = skill;
      session.sampleReview = sampleReview;
      updateReport({
        status: "skill_created",
        skillIdeaId: idea.id || "",
        matchedCommand: skill.slash || latestReport?.matchedCommand || "skill_idea/interview",
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
      void refreshConfigurableSlashSuggestions({ force: true });
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

  function renderSkillReady(skill = {}) {
    breadcrumbs.textContent = "skill ready";
    editorContent.innerHTML = `
      <h1>Skill Ready</h1>
      <section class="skill-router-result">
        <h2>${escapeHtml(skill.title || "Custom Skill")}</h2>
        <p>You can use this skill by typing <code>${escapeHtml(skill.slash || "")}</code>.</p>
        <dl class="skill-card-meta">
          <div><dt>Status</dt><dd>${escapeHtml(skill.status || "active")}</dd></div>
          <div><dt>Output</dt><dd><code>${escapeHtml(skill.outputArtifact || "")}</code></dd></div>
          <div><dt>Lane</dt><dd><code>${escapeHtml(skill.targetLane || "")}</code></dd></div>
          <div><dt>Version</dt><dd>${escapeHtml(String(skill.version || 1))}</dd></div>
        </dl>
        <p class="muted">Running the skill writes only its configured matter artifact after explicit command execution.</p>
      </section>
    `;
  }

  function renderCreatedSkillCommandRail(skill = {}) {
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = `
      <section class="command-interview" aria-live="polite">
        <h3>Skill Ready</h3>
        <p>You can use <code>${escapeHtml(skill.slash || "")}</code> on any selected matter.</p>
        <p class="muted">Switch matters first if you want to run it somewhere else.</p>
        <dl class="skill-card-meta">
          <div><dt>Skill</dt><dd>${escapeHtml(skill.title || "Custom Skill")}</dd></div>
          <div><dt>Output</dt><dd><code>${escapeHtml(skill.outputArtifact || "")}</code></dd></div>
        </dl>
        <div class="command-interview-actions">
          <button type="button" data-created-skill-action="run">Run now</button>
          <button type="button" class="secondary" data-created-skill-action="open-skills">Open Skills</button>
          <button type="button" class="secondary" data-created-skill-action="start-another">Start another idea</button>
        </div>
      </section>
    `;
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
    const sampleState = getSampleState(sample);
    const sampleApproved = approved || sampleState === "approved_current";
    const sampleStale = sampleState === "stale" || sampleState === "approved_stale";
    const statusText = sampleState === "approved_stale"
      ? "Approved earlier, now stale. Regenerate before creating a skill."
      : sampleApproved
        ? "Sample approved. Ready to create skill."
        : sampleStale
          ? "Stale after design brief changes. Regenerate before approval."
          : "Awaiting review";
    breadcrumbs.textContent = "sample output";
    editorContent.innerHTML = `
      <h1>Sample Output</h1>
      <p class="muted">Review sample only. This did not create a runnable skill, prompt, code, slash command, or matter artifact.</p>
      <section class="skill-router-result">
        <h2>Sample v${Number(version || getSampleVersion(sample, 1))}${sampleApproved ? " - approved" : ""}</h2>
        <dl class="skill-card-meta">
          <div><dt>Provider</dt><dd>${escapeHtml(formatSampleProvider(sample))}</dd></div>
          <div><dt>Matter</dt><dd>${escapeHtml(getSampleMatter(sample).matterName || getSampleMatter(sample).folderName || "Selected matter")}</dd></div>
          <div><dt>Status</dt><dd>${escapeHtml(statusText)}</dd></div>
        </dl>
        <pre class="skill-sample-markdown">${escapeHtml(getSampleMarkdown(sample))}</pre>
        ${renderSampleLedger(sampleReview, { central: true })}
      </section>
    `;
  }

  function formatSkillSampleCopy(sample, { version, approved } = {}) {
    const state = getSampleState(sample);
    const statusText = state === "approved_stale"
      ? "Approved earlier, now stale. Regenerate before creating a skill."
      : approved
        ? "Sample approved. Ready to create skill."
        : state === "stale"
          ? "Stale after design brief changes. Regenerate before approval."
          : "Awaiting review";
    const lines = [
      "# Skill Sample Output",
      "",
      `- Sample: v${Number(version || getSampleVersion(sample, 1))}`,
      `- Status: ${statusText}`,
      `- Ledger state: ${formatSampleStateLabel(state)}`,
      `- Matter: ${getSampleMatter(sample).matterName || getSampleMatter(sample).folderName || "Selected matter"}`,
      `- Provider/model: ${formatSampleProvider(sample)}`,
      `- Feedback: ${getSampleFeedback(sample) || "None"}`,
      "",
      approved && state !== "approved_stale"
        ? "This sample is approved, but it is not a runnable skill until Create skill succeeds."
        : "This is not a runnable skill. No prompt, code, slash command, provider runtime, or activation has been generated.",
      "",
      "## Sample",
      "",
      getSampleMarkdown(sample),
    ];
    return lines.join("\n");
  }

  function renderSampleLedger(sampleReview = {}, { central = false } = {}) {
    const samples = getLedgerSamples(sampleReview);
    if (!samples.length) return "";
    const activeId = getSampleId(sampleReview.activeSample);
    const ordered = [...samples].sort((a, b) => getSampleVersion(b, 0) - getSampleVersion(a, 0));
    return `
      <section class="skill-sample-ledger" aria-label="Sample ledger">
        <div class="skill-sample-ledger-header">
          <strong>Sample Ledger</strong>
          <span class="muted">${escapeHtml(String(samples.length))} version${samples.length === 1 ? "" : "s"}</span>
        </div>
        <ul>
          ${ordered.map((sample) => {
            const sampleId = getSampleId(sample);
            const version = getSampleVersion(sample, 1);
            const state = getSampleState(sample);
            const matter = getSampleMatter(sample);
            const createdAt = getSampleCreatedAt(sample);
            const feedback = getSampleFeedback(sample);
            const isActive = activeId && sampleId === activeId;
            return `
              <li class="skill-sample-ledger-item ${isActive ? "active" : ""}">
                <div class="skill-sample-ledger-title">
                  <strong>Sample v${escapeHtml(String(version))}${isActive ? " · active" : ""}</strong>
                  <span class="sample-state ${escapeHtml(state)}">${escapeHtml(formatSampleStateLabel(state))}</span>
                </div>
                <dl class="skill-card-meta compact">
                  <div><dt>Matter</dt><dd>${escapeHtml(matter.matterName || matter.folderName || "Unknown")}</dd></div>
                  <div><dt>Provider</dt><dd>${escapeHtml(formatSampleProvider(sample))}</dd></div>
                  <div><dt>Created</dt><dd>${escapeHtml(createdAt || "Unknown")}</dd></div>
                  <div><dt>Feedback</dt><dd>${escapeHtml(feedback || "None")}</dd></div>
                </dl>
                ${central ? "" : `
                  <div class="command-interview-actions compact">
                    <button type="button" class="secondary" data-skill-interview-action="copy-ledger-sample" data-sample-id="${escapeHtml(sampleId)}">Copy Sample</button>
                  </div>
                `}
              </li>
            `;
          }).join("")}
        </ul>
        ${ordered.some((sample) => getSampleState(sample) === "approved_stale")
          ? '<p class="muted">An approved stale sample is kept for review history, but it cannot create a skill. Regenerate and approve a current sample.</p>'
          : ""}
      </section>
    `;
  }

  function getLedgerSamples(sampleReview = {}) {
    const byId = new Map();
    const samples = Array.isArray(sampleReview.samples) ? sampleReview.samples.map(normalizeUiSample) : [];
    const ledger = Array.isArray(sampleReview.ledger) ? sampleReview.ledger.map(normalizeUiSample) : [];
    for (const sample of samples) {
      byId.set(getSampleId(sample) || `version:${getSampleVersion(sample, byId.size + 1)}`, sample);
    }
    for (const sample of ledger) {
      byId.set(getSampleId(sample) || `version:${getSampleVersion(sample, byId.size + 1)}`, sample);
    }
    return [...byId.values()].sort((a, b) => getSampleVersion(a, 0) - getSampleVersion(b, 0));
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

  function applyActiveSampleState(sampleReview, sample) {
    const active = normalizeUiSample(sample);
    sampleReview.activeSample = active;
    const state = getSampleState(active);
    sampleReview.approved = state === "approved_current";
    sampleReview.stale = state === "stale" || state === "approved_stale";
    sampleReview.staleReason = state === "approved_stale"
      ? "This sample was approved earlier, but the design brief changed. Regenerate and approve a current sample before creating a skill."
      : state === "stale"
        ? "Design brief changed after this sample was generated. Regenerate the sample before approving it."
        : "";
    return sampleReview;
  }

  function normalizeUiSample(sample = {}) {
    const stored = sample.storedSample || sample.sample || {};
    const merged = { ...sample, ...stored };
    const aiRun = normalizeSampleAiRun(merged.aiRun || merged.ai_run || sample.ai_run || stored.aiRun);
    const matter = getSampleMatter(merged);
    const markdown = merged.sample_markdown || merged.sampleMarkdown || sample.sample_markdown || stored.sampleMarkdown || "";
    const id = String(merged.sample_id || merged.sampleId || merged.id || "").trim();
    return {
      ...merged,
      id,
      sample_id: id,
      version: Number.isInteger(merged.version) && merged.version > 0 ? merged.version : Number(merged.version || 0) || 1,
      generated_at: String(merged.generated_at || merged.createdAt || merged.created_at || "").trim(),
      createdAt: String(merged.createdAt || merged.generated_at || merged.created_at || "").trim(),
      approved: Boolean(merged.approved),
      approved_at: String(merged.approved_at || merged.approvedAt || "").trim(),
      approvedAt: String(merged.approvedAt || merged.approved_at || "").trim(),
      state: String(merged.state || "").trim(),
      current: typeof merged.current === "boolean" ? merged.current : undefined,
      matter: {
        matter_name: matter.matterName,
        folder_name: matter.folderName,
      },
      sample_markdown: markdown,
      sampleMarkdown: markdown,
      feedback: String(merged.feedback || ""),
      ai_run: aiRun,
      aiRun,
    };
  }

  function getSampleId(sample = {}) {
    return String(sample?.sample_id || sample?.sampleId || sample?.id || "").trim();
  }

  function getSampleVersion(sample = {}, fallback = 1) {
    const version = Number(sample?.version || 0);
    return Number.isFinite(version) && version > 0 ? version : Number(fallback || 1);
  }

  function getSampleMarkdown(sample = {}) {
    return String(sample?.sample_markdown || sample?.sampleMarkdown || "").trim();
  }

  function getSampleMatter(sample = {}) {
    const matter = sample?.matter || {};
    return {
      matterName: String(matter.matter_name || matter.matterName || "").trim(),
      folderName: String(matter.folder_name || matter.folderName || "").trim(),
    };
  }

  function getSampleAiRun(sample = {}) {
    return normalizeSampleAiRun(sample?.ai_run || sample?.aiRun || {});
  }

  function normalizeSampleAiRun(aiRun = {}) {
    return {
      provider: String(aiRun.provider || "").trim(),
      model: String(aiRun.model || "").trim(),
      task: String(aiRun.task || "").trim(),
    };
  }

  function formatSampleProvider(sample = {}) {
    const aiRun = getSampleAiRun(sample);
    return [aiRun.provider, aiRun.model].filter(Boolean).join(" / ") || "configured provider";
  }

  function getSampleFeedback(sample = {}) {
    return String(sample?.feedback || "").trim();
  }

  function getSampleCreatedAt(sample = {}) {
    return String(sample?.createdAt || sample?.created_at || sample?.generated_at || "").trim();
  }

  function getSampleState(sample = {}) {
    const state = String(sample?.state || "").trim();
    if (["current", "stale", "approved_current", "approved_stale"].includes(state)) return state;
    if (sample?.approved && sample?.current === false) return "approved_stale";
    if (sample?.approved) return "approved_current";
    if (sample?.current === false) return "stale";
    return "current";
  }

  function isSampleStale(sample = {}) {
    const state = getSampleState(sample);
    return state === "stale" || state === "approved_stale";
  }

  function formatSampleStateLabel(state) {
    if (state === "approved_current") return "Approved current";
    if (state === "approved_stale") return "Approved stale";
    if (state === "stale") return "Stale";
    return "Current";
  }

  function findSampleByVersion(sampleReview = {}, version) {
    const targetVersion = Number(version || 0);
    return getLedgerSamples(sampleReview).find((sample) => getSampleVersion(sample, 0) === targetVersion) || null;
  }

  function ensureSampleReview(session) {
    if (!session.sampleReview) {
      session.sampleReview = {
        samples: [],
        ledger: [],
        activeSample: null,
        approved: false,
        stale: false,
        staleReason: "",
      };
    }
    if (!Array.isArray(session.sampleReview.samples)) session.sampleReview.samples = [];
    if (!Array.isArray(session.sampleReview.ledger)) session.sampleReview.ledger = session.sampleReview.samples;
    if (typeof session.sampleReview.stale !== "boolean") session.sampleReview.stale = false;
    if (typeof session.sampleReview.staleReason !== "string") session.sampleReview.staleReason = "";
    return session.sampleReview;
  }

  function markSampleReviewStale(session, reason) {
    const sampleReview = ensureSampleReview(session);
    if (!sampleReview.activeSample) return sampleReview;
    sampleReview.approved = false;
    sampleReview.stale = true;
    sampleReview.staleReason = reason || "Design brief changed after this sample was generated. Regenerate the sample before approving it.";
    sampleReview.activeSample = {
      ...sampleReview.activeSample,
      state: sampleReview.activeSample.approved ? "approved_stale" : "stale",
      current: false,
    };
    sampleReview.ledger = getLedgerSamples(sampleReview).map((sample) => getSampleId(sample) === getSampleId(sampleReview.activeSample)
      ? sampleReview.activeSample
      : sample);
    session.sampleReview = sampleReview;
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
    await showSkillsPage("open skills");
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
          await approveSavedSkillIdeaSample();
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

  async function handlePendingSkillIdeaModeInput(userRequest) {
    const normalized = normalizeCommandInput(userRequest);
    if (normalized === "cancel") {
      cancelNewSkillMode();
      return;
    }
    if (!userRequest) {
      renderNewSkillMode("Describe the skill you want, or choose Cancel.");
      return;
    }
    if (parseDeterministicCommand(userRequest)) {
      renderNewSkillMode("Describe the skill you want, or type Cancel before running another command.");
      return;
    }

    const text = String(userRequest || "").trim();
    pendingSkillIdeaMode = null;
    await showSkillIdeaInterview({
      type: "skill_idea",
      mode: "new_skill",
      text,
      idea: text,
    }, text, { useModelPlanner: true });
  }

  function openNewSkillMode(userRequest) {
    const activeMatter = ctx.getActiveMatter?.() || {};
    pendingSkillIdeaMode = {
      mode: "awaiting_skill_idea",
      startedAt: now().toISOString(),
      activeMatterName: activeMatter?.metadata?.matterName || activeMatter?.folderName || "",
      activeMatterFolder: activeMatter?.folderName || "",
    };
    startReport({
      typedInput: userRequest,
      matchedCommand: "skill_idea/new",
      status: "awaiting_skill_idea",
    });
    recordCommandInteraction({
      renderedState: "skill_idea/new",
      status: "awaiting_skill_idea",
      providerRunInvoked: false,
    });
    aiCommandInput.value = "";
    aiCommandInput.placeholder = "Describe the skill you want...";
    aiCommandSubmit.textContent = "Go";
    renderNewSkillMode();
    ctx.setStatus({
      mood: "idle",
      card: "<strong>New skill idea</strong><br />Describe the skill you want in your own words. Nothing will run.",
      bar: "New Skill Idea",
      terminal: "[skill-ideas] awaiting freeform idea",
    });
  }

  function renderNewSkillMode(errorMessage = "") {
    if (!aiCommandSession || !pendingSkillIdeaMode) return;
    const matterName = pendingSkillIdeaMode.activeMatterName || "No active matter";
    const matterFolder = pendingSkillIdeaMode.activeMatterFolder || "Planning mode";
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = `
      <section class="command-interview" aria-live="polite">
        <h3>New skill idea</h3>
        <p>Describe the skill you want in your own words. You do not need to use special phrasing.</p>
        <p class="muted">This will only create a non-runnable idea for review. It will not generate code, prompts, or run a provider-backed skill.</p>
        <dl class="skill-card-meta">
          <div><dt>Matter</dt><dd>${escapeHtml(matterName)}</dd></div>
          <div><dt>Matter folder</dt><dd>${escapeHtml(matterFolder)}</dd></div>
        </dl>
        ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ""}
        <div class="command-interview-actions">
          <button type="button" class="secondary" data-new-skill-mode-action="cancel">Cancel</button>
        </div>
      </section>
    `;
    wireNewSkillModeActions();
  }

  function wireNewSkillModeActions() {
    aiCommandSession?.querySelectorAll?.("[data-new-skill-mode-action]")?.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.newSkillModeAction === "cancel") cancelNewSkillMode();
      });
    });
  }

  function cancelNewSkillMode() {
    pendingSkillIdeaMode = null;
    aiCommandInput.value = "";
    aiCommandInput.placeholder = DEFAULT_COMMAND_PLACEHOLDER;
    aiCommandSubmit.disabled = false;
    aiCommandSubmit.textContent = "Go";
    if (aiCommandSession) {
      aiCommandSession.hidden = false;
      aiCommandSession.innerHTML = `
        <section class="command-interview" aria-live="polite">
          <h3>New skill idea cancelled</h3>
          <p class="muted">No idea was saved. Nothing ran.</p>
        </section>
      `;
    }
    updateReport({ status: "cancelled" });
    recordCommandInteraction({
      renderedState: "skill_idea/new",
      status: "cancelled",
      providerRunInvoked: false,
    });
    ctx.setStatus({
      mood: "idle",
      card: "<strong>New skill idea cancelled</strong><br />No idea was saved and nothing ran.",
      bar: "New Skill Cancelled",
      terminal: "[skill-ideas] new skill mode cancelled",
    });
  }

  function renderCommandRailDecision({ userRequest, overrideJustification, decision }) {
    if (!aiCommandSession) {
      renderCommandDecision({ userRequest, overrideJustification, decision });
      return;
    }
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderInlineRouterDecision({ userRequest, overrideJustification, decision });
    wireCommandRailDecisionActions({ userRequest, decision });
  }

  function renderInlineRouterDecision({ userRequest, overrideJustification, decision }) {
    const matchedSkill = decision.matched_skill || "none";
    const confidence = Number.isFinite(decision.confidence)
      ? `${Math.round(decision.confidence * 100)}%`
      : "n/a";
    const gateActions = decision.user_gate_required ? `
      <button type="button" class="secondary" data-command-router-action="approve">Approve modification</button>
      <button type="button" class="secondary" data-command-router-action="justify">Justify new skill</button>
    ` : "";
    return `
      <section class="command-interview command-router-result" aria-live="polite">
        <h3>Router/check result</h3>
        <p class="muted">This response stays in the Command rail. Nothing ran.</p>
        <p><code>${escapeHtml(userRequest)}</code></p>
        <dl class="skill-card-meta">
          <div><dt>Decision</dt><dd>${escapeHtml(decision.decision || "")}</dd></div>
          <div><dt>Recommended action</dt><dd>${escapeHtml(decision.recommended_action || "")}</dd></div>
          <div><dt>Matched skill</dt><dd><code>${escapeHtml(matchedSkill)}</code></dd></div>
          <div><dt>Confidence</dt><dd>${escapeHtml(confidence)}</dd></div>
          <div><dt>Reason</dt><dd>${escapeHtml(decision.reason || "")}</dd></div>
          <div><dt>Next action</dt><dd>${escapeHtml(decision.suggested_next_action || "")}</dd></div>
        </dl>
        <form class="ai-command-override-form" data-command-router-override hidden>
          <label>
            <span>Override justification</span>
            <textarea data-command-router-override-input spellcheck="true" placeholder="Explain the distinct purpose, input, output, workflow stage, legal setting, or audience.">${escapeHtml(overrideJustification || "")}</textarea>
          </label>
          <div class="command-interview-actions">
            <button type="submit">Re-check</button>
          </div>
          <div class="form-error" data-command-router-override-error hidden></div>
        </form>
        <div class="command-interview-actions">
          ${gateActions}
          <button type="button" class="secondary" data-command-router-action="open-full">Open full result</button>
        </div>
        <div class="form-note" data-command-router-message></div>
      </section>
    `;
  }

  function wireCommandRailDecisionActions({ userRequest, decision }) {
    if (!aiCommandSession?.querySelectorAll) return;
    const message = aiCommandSession.querySelector?.("[data-command-router-message]");
    const overrideForm = aiCommandSession.querySelector?.("[data-command-router-override]");
    const overrideInput = aiCommandSession.querySelector?.("[data-command-router-override-input]");
    const overrideError = aiCommandSession.querySelector?.("[data-command-router-override-error]");
    aiCommandSession.querySelectorAll("[data-command-router-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.commandRouterAction;
        if (action === "approve") {
          if (message) {
            message.textContent = decision.matched_skill
              ? `Approved locally: this should become a modification request for ${decision.matched_skill}.`
              : "Approved locally: this should become a modification request.";
          }
          return;
        }
        if (action === "justify") {
          if (overrideForm) overrideForm.hidden = false;
          overrideInput?.focus?.();
          if (message) message.textContent = "Add an override justification, then re-check.";
          return;
        }
        if (action === "open-full") {
          renderCommandDecision({ userRequest, overrideJustification: overrideInput?.value?.trim?.() || "", decision });
        }
      });
    });
    overrideForm?.addEventListener?.("submit", async (event) => {
      event.preventDefault();
      const nextJustification = overrideInput?.value?.trim?.() || "";
      if (!nextJustification) {
        if (overrideError) {
          overrideError.textContent = "Override justification is required.";
          overrideError.hidden = false;
        }
        return;
      }
      if (overrideError) overrideError.hidden = true;
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

  function renderSlashSuggestions() {
    if (!aiCommandSuggestions || !aiCommandInput) return;
    if (currentSkillIdeaInterview || pendingSkillIdeaMode) {
      hideSlashSuggestions();
      return;
    }
    if (String(aiCommandInput.value || "").trim().startsWith("/") && !configurableSlashSuggestionsLoaded && !configurableSlashSuggestionsLoading) {
      void refreshConfigurableSlashSuggestions().then(() => renderSlashSuggestions());
    }
    const suggestions = listSlashCommandSuggestions(aiCommandInput.value, configurableSlashSuggestions);
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
    if (currentSkillIdeaInterview || pendingSkillIdeaMode) return;
    const suggestions = listSlashCommandSuggestions(aiCommandInput.value, configurableSlashSuggestions);
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

  async function refreshConfigurableSlashSuggestions({ force = false } = {}) {
    if (configurableSlashSuggestionsLoading) return;
    if (configurableSlashSuggestionsLoaded && !force) return;
    configurableSlashSuggestionsLoading = true;
    try {
      const registry = await loadSkillRegistry();
      const skills = Array.isArray(registry?.skills) ? registry.skills : [];
      configurableSlashSuggestions = skills
        .filter((skill) => skill?.configurable && skill.status === "active" && skill.slash)
        .map((skill) => ({
          command: skill.slash,
          description: skill.purpose || skill.title || "Run custom skill.",
        }));
      configurableSlashSuggestionsLoaded = true;
    } catch {
      configurableSlashSuggestions = [];
      configurableSlashSuggestionsLoaded = true;
    } finally {
      configurableSlashSuggestionsLoading = false;
    }
  }

  function hideSlashSuggestions() {
    activeSuggestionIndex = -1;
    if (!aiCommandSuggestions) return;
    aiCommandSuggestions.hidden = true;
    aiCommandSuggestions.innerHTML = "";
  }

  function clearCommandInput() {
    if (aiCommandInput) aiCommandInput.value = "";
  }

  function startReport({
    typedInput,
    matchedCommand,
    status,
    plannerSource = "",
    plannerModel = "",
    plannerFallbackReason = "",
  }) {
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
      sampleId: "",
      providerModel: "",
      artifacts: [],
      statusBar: getStatusBarText(),
      terminalLines: getLatestTerminalLines(),
      error: "",
      plannerSource,
      plannerModel,
      plannerFallbackReason,
    };
    setReportStatus("Report tracking current command.");
    setCopyReportEnabled(true);
  }

  function updateReport(patch) {
    if (!latestReport) return;
    latestReport = { ...latestReport, ...patch };
    setCopyReportEnabled(true);
  }

  function recordCommandInteraction(patch = {}) {
    if (!latestReport) return;
    const report = { ...latestReport, ...patch };
    const body = {
      timestamp: report.timestamp,
      typed_input: report.typedInput,
      matched_command: report.matchedCommand,
      rendered_state: report.renderedState || patch.renderedState || "",
      status: report.status,
      skill_idea_id: report.skillIdeaId || "",
      sample_id: report.sampleId || "",
      router_decision: patch.routerDecision || (
        report.routerDecision
          ? {
              decision: report.routerDecision,
              matched_skill: report.routerMatchedSkill,
            }
          : null
      ),
      provider_run_invoked: Boolean(patch.providerRunInvoked),
      planner_source: report.plannerSource || patch.plannerSource || "",
      planner_model: report.plannerModel || patch.plannerModel || "",
      planner_fallback_reason: report.plannerFallbackReason || patch.plannerFallbackReason || "",
      errors: report.error ? [report.error] : [],
      status_bar: report.statusBar || getStatusBarText(),
      terminal_lines: report.terminalLines || getLatestTerminalLines(),
    };
    try {
      Promise.resolve(logCommandInteraction(body)).catch(() => {});
    } catch {
      // Local beta diagnostics must never block Command rail behavior.
    }
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
    if (aiCommandCopyReport) {
      aiCommandCopyReport.disabled = !enabled;
      aiCommandCopyReport.hidden = !enabled;
    }
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

export function parseNewSkillModeCommand(input) {
  const normalized = normalizeCommandInput(input);
  if (!normalized) return null;
  if (!NEW_SKILL_MODE_ALIASES.has(normalized)) return null;
  return { type: "new_skill_mode", input: normalized };
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

export function listSlashCommandSuggestions(input, extraSuggestions = []) {
  const raw = String(input || "");
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.startsWith("/")) return [];
  const combined = [...SLASH_COMMAND_SUGGESTIONS, ...extraSuggestions]
    .filter((suggestion) => suggestion?.command)
    .filter((suggestion, index, list) => list.findIndex((candidate) => candidate.command === suggestion.command) === index);
  return combined.filter((suggestion) => suggestion.command.startsWith(trimmed));
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

function describeInterviewPlanner(interview) {
  const planner = interview?.planner || null;
  if (planner?.used) {
    return {
      source: "model",
      model: [planner.provider, planner.model].filter(Boolean).join(" / "),
      fallbackReason: "",
    };
  }
  if (planner) {
    return {
      source: "deterministic fallback",
      model: "",
      fallbackReason: String(planner.reason || "").trim(),
    };
  }
  return {
    source: "deterministic",
    model: "",
    fallbackReason: "",
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
  if (report.sampleId) lines.push(`- Sample output: ${report.sampleId}`);
  if (report.plannerSource) lines.push(`- Planner: ${report.plannerModel || report.plannerSource}`);
  if (report.plannerFallbackReason) lines.push(`- Planner fallback reason: ${report.plannerFallbackReason}`);
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
    /^create (?:a )?new skil{1,2} (?:for|to|that) (.+)$/,
    /^create (?:a )?skil{1,2} (?:for|to|that) (.+)$/,
    /^make (?:a )?new skil{1,2} (?:for|to|that) (.+)$/,
    /^make (?:a )?skil{1,2} (?:for|to|that) (.+)$/,
    /^new skil{1,2} (.+)$/,
    /^i need a skil{1,2} that (.+)$/,
    /^i want a (?:new )?skil{1,2} (?:for|to|that) (.+)$/,
    /^can we make a skil{1,2} for (.+)$/,
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
