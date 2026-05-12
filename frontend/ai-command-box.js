import { getJson, postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import {
  buildSkillIdeaInterview,
  buildSkillIdeaPayloadFromInterview,
  parseAdaptiveSkillIdeaInput,
} from "./skill-idea-interview.js";
import { renderRouterDecision, wireRouterGateButtons } from "./skill-router-panel.js";
import { formatSkillIdeaReviewPacket } from "./views/skills-page.js";

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
  const saveSkillIdea = options.saveSkillIdea || ((body) => postJson("/api/skill-ideas", body));
  const updateSkillIdeaDesignBrief = options.updateSkillIdeaDesignBrief || ((id, designBrief) => postJson(`/api/skill-ideas/${encodeURIComponent(id)}/design-brief`, { designBrief }));
  const updateSkillIdeaStatus = options.updateSkillIdeaStatus || ((id, status) => postJson(`/api/skill-ideas/${encodeURIComponent(id)}/status`, { status }));
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
    if (currentSkillIdeaInterview) {
      await handleSkillIdeaInterviewInput(userRequest);
      return;
    }
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
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Router decision</strong><br />${escapeHtml(decision.decision)}${decision.matched_skill ? ` for <code>${escapeHtml(decision.matched_skill)}</code>` : ""}.`,
        bar: "Router Ready",
        terminal: `[ai-command] ${decision.decision}${decision.matched_skill ? ` -> ${decision.matched_skill}` : ""}`,
      });
    } catch (error) {
      renderCommandRailError(error.message);
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
    currentSkillIdeaInterview = {
      interview,
      answers: {},
      questionIndex: 0,
      ready: false,
    };
    startReport({
      typedInput: userRequest,
      matchedCommand: "skill_idea/interview",
      status: "interview",
    });
    aiCommandInput.value = "";
    aiCommandInput.placeholder = "Answer the current question";
    aiCommandSubmit.textContent = "Answer";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Skill idea interview</strong><br />Answer one question at a time in the Command rail. Nothing will run.",
      bar: "Skill Idea Interview",
      terminal: `[skill-ideas] interview opened: ${userRequest}`,
    });
    renderSkillIdeaSession();
  }

  async function handleSkillIdeaInterviewInput(userRequest) {
    const session = currentSkillIdeaInterview;
    if (!session) return;
    const normalized = normalizeCommandInput(userRequest);
    if (normalized === "cancel") {
      cancelSkillIdeaInterview();
      return;
    }
    if (!userRequest) {
      renderSkillIdeaSession("Answer the current question, or choose Cancel.");
      return;
    }
    if (session.ready) {
      if (normalized === "save idea") {
        await saveSkillIdeaInterviewSession();
        return;
      }
      if (normalized === "save updates") {
        await saveSkillIdeaInterviewSession();
        return;
      }
      if (session.savedIdea) {
        if (normalized === "copy review packet") {
          await copySavedSkillIdeaReviewPacket();
          return;
        }
        if (normalized === "mark ready for review" || normalized === "mark ready") {
          await markSavedSkillIdeaReady();
          return;
        }
        if (normalized === "open in skills" || normalized === "open skills") {
          await openSavedSkillIdeaInSkills();
          return;
        }
        if (normalized === "start another idea") {
          startAnotherSkillIdea();
          return;
        }
      }
      if (normalized === "edit answers" || normalized === "edit") {
        session.editingSavedIdea = Boolean(session.savedIdea);
        session.ready = false;
        session.questionIndex = 0;
        aiCommandInput.value = session.answers[session.interview.questions[0]?.id] || "";
        aiCommandSubmit.textContent = "Answer";
        renderSkillIdeaSession();
        return;
      }
      renderSkillIdeaSession(session.savedIdea
        ? "Use Copy Review Packet, Mark ready for review, Edit answers, Open in Skills, Start another idea, or Cancel."
        : "Use Save idea, Edit answers, or Cancel.");
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
    aiCommandInput.value = "";
    if (session.questionIndex >= session.interview.questions.length) {
      session.ready = true;
      aiCommandInput.placeholder = "Type Save idea, Edit answers, or Cancel";
      aiCommandSubmit.textContent = "Go";
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Ready to save</strong><br />Review the interview summary, then save or cancel.",
        bar: "Skill Idea Ready",
        terminal: "[skill-ideas] interview ready to save",
      });
    } else {
      aiCommandInput.placeholder = "Answer the current question";
      aiCommandSubmit.textContent = "Answer";
      const nextIndex = session.questionIndex + 1;
      const total = session.interview.questions.length;
      ctx.setStatus({
        mood: "idle",
        card: `<strong>Skill idea interview</strong><br />Question ${nextIndex} of ${total}.`,
        bar: `Question ${nextIndex} of ${total}`,
        terminal: `[skill-ideas] question ${nextIndex} of ${total}`,
      });
    }
    renderSkillIdeaSession();
  }

  async function saveSkillIdeaInterviewSession() {
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
      const payload = existingIdea?.id
        ? await updateSkillIdeaDesignBrief(existingIdea.id, payloadBody.designBrief)
        : await saveSkillIdea(payloadBody);
      const idea = payload.idea || {};
      session.savedIdea = idea;
      session.editingSavedIdea = false;
      session.ready = true;
      updateReport({
        status: existingIdea?.id ? "updated" : "saved",
        skillIdeaId: idea.id || "",
      });
      ctx.setStatus({
        mood: "idle",
        card: `<strong>${existingIdea?.id ? "Skill idea updated" : "Saved as skill idea"}</strong><br />Continue here: copy a review packet, mark ready, edit answers, or open Skills.`,
        bar: existingIdea?.id ? "Skill Idea Updated" : "Skill Idea Saved",
        terminal: `[skill-ideas] ${existingIdea?.id ? "updated" : "saved"} ${idea.id || "proposal"}`,
      });
      aiCommandInput.value = "";
      aiCommandInput.placeholder = "Copy Review Packet, Mark ready, Edit answers, Open in Skills, or Start another idea";
      aiCommandSubmit.textContent = "Go";
      renderSkillIdeaSession();
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
      aiCommandSubmit.disabled = false;
      aiCommandSubmit.textContent = "Go";
    }
  }

  function renderSkillIdeaSession(errorMessage = "") {
    if (!aiCommandSession || !currentSkillIdeaInterview) return;
    const { interview, answers, questionIndex, ready, savedIdea, editingSavedIdea } = currentSkillIdeaInterview;
    aiCommandSession.hidden = false;
    if (ready && savedIdea && !editingSavedIdea) {
      aiCommandSession.innerHTML = renderSavedSkillIdeaSession({ idea: savedIdea, interview, answers, errorMessage });
      wireSkillIdeaSessionActions();
      return;
    }
    if (ready) {
      const isUpdate = Boolean(savedIdea);
      aiCommandSession.innerHTML = `
        <section class="command-interview" aria-live="polite">
          <h3>${isUpdate ? "Ready to save updates" : "Ready to save this skill idea"}</h3>
          <p class="muted">Not runnable yet. ${isUpdate ? "Saving updates the design brief only." : "Saving creates a design brief only."}</p>
          ${renderSkillIdeaUnderstood(interview)}
          ${renderAnsweredQuestions(interview, answers)}
          ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ""}
          <div class="command-interview-actions">
            <button type="button" data-skill-interview-action="save">${isUpdate ? "Save updates" : "Save idea"}</button>
            <button type="button" class="secondary" data-skill-interview-action="edit">Edit answers</button>
            <button type="button" class="secondary" data-skill-interview-action="cancel">Cancel</button>
          </div>
        </section>
      `;
      wireSkillIdeaSessionActions();
      return;
    }
    const total = interview.questions.length;
    const question = interview.questions[questionIndex] || {};
    aiCommandSession.innerHTML = `
      <section class="command-interview" aria-live="polite">
        <h3>Skill idea interview</h3>
        <p class="muted">Temporary browser-memory session. Refreshing may lose it.</p>
        ${renderSkillIdeaUnderstood(interview)}
        <div class="command-interview-question">
          <strong>Question ${questionIndex + 1} of ${total}</strong>
          <p>${escapeHtml(question.label || "")}</p>
          ${question.placeholder ? `<p class="muted">${escapeHtml(question.placeholder)}</p>` : ""}
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
          ${interview.targetSkill ? `<p class="muted">Likely related skill: <code>${escapeHtml(interview.targetSkill)}</code></p>` : ""}
        </div>
    `;
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

  function renderSavedSkillIdeaSession({ idea, interview, answers, errorMessage = "" }) {
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
        <p class="muted">Not runnable yet. No prompt, code, provider call, activation, or matter artifact has been generated.</p>
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
        ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ""}
        <div class="command-interview-actions">
          <button type="button" data-skill-interview-action="copy-packet">Copy Review Packet</button>
          <button type="button" class="secondary" data-skill-interview-action="mark-ready"${checklistReady && status !== "ready_for_review" ? "" : " disabled"}>Mark ready for review</button>
          <button type="button" class="secondary" data-skill-interview-action="edit">Edit answers</button>
          <button type="button" class="secondary" data-skill-interview-action="open-skills">Open in Skills</button>
          <button type="button" class="secondary" data-skill-interview-action="start-another">Start another idea</button>
        </div>
      </section>
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

  async function copySavedSkillIdeaReviewPacket() {
    const session = currentSkillIdeaInterview;
    const idea = session?.savedIdea;
    if (!idea) return;
    try {
      const registry = await loadSkillRegistry().catch(() => ({}));
      await writeClipboardText(formatSkillIdeaReviewPacket(idea, registry));
      updateReport({ status: "copied", skillIdeaId: idea.id || "" });
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Review packet copied</strong><br />No provider call, prompt generation, or matter artifact write occurred.",
        bar: "Skill Idea Packet Copied",
        terminal: `[skill-ideas] copied review packet for ${idea.id || "proposal"}`,
      });
      renderSkillIdeaSession();
    } catch (error) {
      renderSkillIdeaSession(`Copy failed: ${error.message}`);
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
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Marked ready for review</strong><br />Still not runnable. No provider call or matter artifact was created.",
        bar: "Skill Idea Ready",
        terminal: `[skill-ideas] marked ready ${session.savedIdea.id || idea.id}`,
      });
      renderSkillIdeaSession();
    } catch (error) {
      renderSkillIdeaSession(`Mark ready failed: ${error.message}`);
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
    aiCommandInput.placeholder = "/extract, find payment, open skills, chronology, or status";
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
    aiCommandInput.placeholder = "/extract, find payment, open skills, chronology, or status";
    aiCommandSubmit.disabled = false;
    aiCommandSubmit.textContent = "Go";
    clearSkillIdeaSession();
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
    if (currentSkillIdeaInterview) {
      hideSlashSuggestions();
      return;
    }
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
    if (currentSkillIdeaInterview) return;
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
    /^create a new skil{1,2} (?:for|to) (.+)$/,
    /^create a skil{1,2} (?:for|to) (.+)$/,
    /^make a new skil{1,2} (?:for|that) (.+)$/,
    /^make a skil{1,2} (?:for|that) (.+)$/,
    /^new skil{1,2} (.+)$/,
    /^i need a skil{1,2} that (.+)$/,
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
