import { escapeHtml } from "./dom-utils.js";
import {
  buildSkillIdeaInterview,
  buildSkillIdeaPayloadFromInterview,
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
  ensureSampleReview,
  markSampleReviewStale,
} from "./skill-sample-review.js";
import { createSkillIdeaSampleActions } from "./skill-idea-sample-actions.js";
import { renderSkillReadyHtml } from "./skill-builder-result-rendering.js";
import { formatSkillIdeaReviewPacket } from "./views/skills-page.js";

export function createSkillIdeaSessionController({
  aiCommandInput,
  aiCommandSession,
  aiCommandSubmit,
  approveSkillIdeaSample,
  breadcrumbs,
  checkSkillIntent,
  configurableSkillRuns,
  createSkillFromIdea,
  ctx,
  defaultPlaceholder,
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
  refreshConfigurableSlashSuggestions = () => {},
  renderCommandError,
  saveSkillIdea,
  startReport,
  updateReport,
  updateSkillIdeaDesignBrief,
  updateSkillIdeaStatus,
  writeClipboardText,
} = {}) {
  let currentSkillIdeaInterview = null;
  const sampleActions = createSkillIdeaSampleActions({
    aiCommandInput,
    aiCommandSubmit,
    approveSkillIdeaSample,
    breadcrumbs,
    createConfigurableSkillFromApprovedSample,
    ctx,
    editorContent,
    generateSkillIdeaSampleOutput,
    getLatestTerminalLines,
    getSession: () => currentSkillIdeaInterview,
    getStatusBarText,
    listSkillIdeaSamples,
    recordCommandInteraction,
    renderSkillIdeaSession,
    saveSkillIdeaInterviewSession,
    updateReport,
    writeClipboardText,
  });

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
    aiCommandSubmit.textContent = currentSkillIdeaInterview.ready ? "→" : "Answer";
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
      if (session.skillCreationOverlapGate && command.action === "unknown") {
        clearCommandInput();
        session.skillCreationOverlapOverride = userRequest;
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
          await sampleActions.generateSavedSkillIdeaSample({ feedback: command.feedback || "" });
          return;
        }
        if (command.action === "copy_sample") {
          clearCommandInput();
          await sampleActions.copySavedSkillIdeaSample();
          return;
        }
        if (command.action === "copy_sample_version") {
          clearCommandInput();
          await sampleActions.copySavedSkillIdeaSampleByVersion(command.version);
          return;
        }
        if (command.action === "approve_sample") {
          clearCommandInput();
          await sampleActions.approveSavedSkillIdeaSampleAndCreateSkill();
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
          await sampleActions.generateSavedSkillIdeaSample({ feedback: command.feedback || userRequest.trim() });
          return;
        }
      }
      if (command.action === "edit_answers") {
        beginSkillIdeaAnswerEditing(session, { editingSavedIdea: Boolean(session.savedIdea) });
        return;
      }
      if (command.action === "generate_sample") {
        clearCommandInput();
        await sampleActions.generateSavedSkillIdeaSample();
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
      aiCommandSubmit.textContent = "→";
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
      aiCommandSubmit.textContent = "→";
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
      aiCommandSubmit.textContent = "→";
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
      configurableSkillRuns.renderCreatedSkillCommandRail(skill);
      void refreshConfigurableSlashSuggestions({ force: true });
      aiCommandInput.value = "";
      aiCommandInput.placeholder = skill.slash
        ? `Type ${skill.slash} to run it, or another action`
        : defaultPlaceholder;
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
      aiCommandSubmit.textContent = "→";
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
      if (isBlockingSkillOverlapDecision(decision, { overrideJustification })) {
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
      aiCommandSubmit.textContent = "→";
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
    aiCommandInput.placeholder = defaultPlaceholder;
    aiCommandSubmit.textContent = "→";
    await deterministicCommands.showSkillsPage("open skills");
  }

  function startAnotherSkillIdea() {
    currentSkillIdeaInterview = null;
    aiCommandInput.value = "";
    aiCommandInput.placeholder = "create a skill to...";
    aiCommandSubmit.disabled = false;
    aiCommandSubmit.textContent = "→";
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
          await sampleActions.generateSavedSkillIdeaSample();
          return;
        }
        if (action === "regenerate-sample") {
          await sampleActions.generateSavedSkillIdeaSample({ feedback: "Regenerate the sample with the current design brief." });
          return;
        }
        if (action === "approve-sample") {
          await sampleActions.approveSavedSkillIdeaSampleAndCreateSkill();
          return;
        }
        if (action === "create-skill") {
          await createConfigurableSkillFromApprovedSample();
          return;
        }
        if (action === "run-created-skill") {
          const slash = currentSkillIdeaInterview?.createdSkill?.slash || currentSkillIdeaInterview?.sampleReview?.createdSkill?.slash || "";
          if (slash) await configurableSkillRuns.runConfigurableSkillCommand({ slash, title: currentSkillIdeaInterview?.createdSkill?.title || slash }, slash);
          return;
        }
        if (action === "copy-sample") {
          await sampleActions.copySavedSkillIdeaSample();
          return;
        }
        if (action === "copy-ledger-sample") {
          const sampleId = button.dataset.sampleId || "";
          await sampleActions.copyLedgerSampleById(sampleId);
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
    aiCommandInput.placeholder = defaultPlaceholder;
    aiCommandSubmit.disabled = false;
    aiCommandSubmit.textContent = "→";
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


  function clearCommandInput() {
    if (aiCommandInput) aiCommandInput.value = "";
  }

  function isActive() {
    return Boolean(currentSkillIdeaInterview);
  }

  function setSession(session) {
    currentSkillIdeaInterview = session;
  }

  return {
    cancelSkillIdeaInterview,
    clearSkillIdeaSession,
    handleSkillIdeaInterviewInput,
    isActive,
    renderSkillIdeaSession,
    setSession,
    showSkillIdeaInterview,
  };
}
