import { escapeHtml } from "./dom-utils.js";
import {
  buildSkillCreationOverlapRequest,
  isBlockingSkillOverlapDecision,
  isSkillImprovementIdea,
  renderSkillCreationOverlapGateHtml,
} from "./skill-creation-overlap.js";
import { renderSkillReadyHtml } from "./skill-builder-result-rendering.js";
import { ensureSampleReview } from "./skill-sample-review.js";

export function createSkillIdeaCreationActions({
  aiCommandInput,
  aiCommandSession,
  aiCommandSubmit,
  breadcrumbs,
  checkSkillIntent,
  configurableSkillRuns,
  createSkillFromIdea,
  ctx,
  defaultPlaceholder,
  editorContent,
  getLatestTerminalLines,
  getSession,
  getStatusBarText,
  recordCommandInteraction,
  refreshConfigurableSlashSuggestions = () => {},
  renderSkillIdeaSession,
  setSession,
  updateReport,
} = {}) {
  async function createConfigurableSkillFromApprovedSample() {
    const session = getSession?.();
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
        matchedCommand: skill.slash || "skill_idea/interview",
        providerModel: [skill.modelPolicy?.provider, skill.modelPolicy?.model].filter(Boolean).join(" / "),
        artifacts: [skill.outputArtifact].filter(Boolean),
      });
      recordCommandInteraction({
        renderedState: "skill_builder/created",
        status: "skill_created",
        skillIdeaId: idea.id || "",
        providerRunInvoked: true,
      });
      setSession?.(null);
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
      const session = getSession?.();
      if (session) {
        session.skillCreationOverlapOverride = justification;
        session.skillCreationOverlapCleared = null;
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

  return {
    createConfigurableSkillFromApprovedSample,
  };
}
