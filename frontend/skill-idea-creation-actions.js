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
      aiCommandInput.placeholder = "Ask, run a skill, or describe another action";
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Skill Ready</strong><br />Use Run now or open it from Skills.",
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
          card: `<strong>This may already be covered</strong><br />Choose whether to use, improve, park, or create a separate skill.`,
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
    const message = aiCommandSession?.querySelector?.("[data-skill-overlap-message]");
    const matchedSkill = decision.matched_skill || "";
    const matchedTitle = decision.matched_skill_card?.title || decision.matched_skill_card?.display?.action || matchedSkill || "the existing skill";
    form?.addEventListener?.("submit", async (event) => {
      event.preventDefault();
      const justification = input?.value?.trim?.() || "";
      if (!justification) {
        if (errorBox) {
          errorBox.textContent = "Explain what makes this a separate custom skill before continuing.";
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
        const action = button.dataset.skillOverlapAction;
        if (action === "create-separate") {
          if (form) form.hidden = false;
          if (message) {
            message.textContent = "Add the reason only if this needs its own output, audience, workflow stage, or legal setting.";
          }
          input?.focus?.();
          return;
        }
        if (action === "hide-separate") {
          if (form) form.hidden = true;
          if (message) message.textContent = "";
          return;
        }
        if (action === "use-existing") {
          setSession?.(null);
          if (matchedSkill && aiCommandInput) {
            aiCommandInput.value = matchedSkill;
            aiCommandInput.placeholder = `Press Enter to run ${matchedSkill}, or edit the command`;
            aiCommandInput.focus?.();
          }
          if (aiCommandSession) {
            aiCommandSession.hidden = false;
            aiCommandSession.innerHTML = `
              <section class="command-interview" aria-live="polite">
                <h3>Use existing skill</h3>
                <p class="muted">Your idea and sample stay saved in Skills. Press Enter to run the existing skill, or edit the command first.</p>
              </section>
            `;
          }
          ctx.setStatus({
            mood: "idle",
            card: `<strong>Use existing skill</strong><br /><code>${escapeHtml(matchedSkill || matchedTitle)}</code> is ready in the command box.`,
            bar: "Use Existing Skill",
            terminal: `[skill-builder] using existing skill ${matchedSkill}`.trim(),
          });
          return;
        }
        if (action === "improve-existing") {
          setSession?.(null);
          const isConfigurableMatch = Boolean(decision.matched_skill_card?.configurable);
          const improvementPrompt = isConfigurableMatch && matchedSkill.startsWith("/")
            ? `Improve ${matchedSkill} to `
            : `Improve ${matchedTitle} to `;
          if (aiCommandInput) {
            aiCommandInput.value = improvementPrompt;
            aiCommandInput.placeholder = `Describe what should improve in ${matchedTitle}`;
            aiCommandInput.focus?.();
          }
          if (aiCommandSession) {
            aiCommandSession.hidden = false;
            aiCommandSession.innerHTML = `
              <section class="command-interview" aria-live="polite">
                <h3>Improve existing skill</h3>
                <p class="muted">Your original idea and sample stay saved in Skills. Finish the sentence in the command box to capture the improvement request.</p>
              </section>
            `;
          }
          ctx.setStatus({
            mood: "idle",
            card: `<strong>Improve existing skill</strong><br />Describe what should change for <code>${escapeHtml(matchedSkill || matchedTitle)}</code>.`,
            bar: "Improve Existing Skill",
            terminal: `[skill-builder] improvement path ${matchedSkill}`.trim(),
          });
          return;
        }
        if (action === "park") {
          renderSkillIdeaSession(
            decision.matched_skill
              ? `Skill creation parked. Your idea and sample are saved. You can use ${decision.matched_skill}, improve it, or return later from Skills.`
              : "Skill creation parked. Your idea and sample are saved. You can return later from Skills.",
          );
          ctx.setStatus({
            mood: "idle",
            card: "<strong>Skill idea parked</strong><br />No runnable skill was created.",
            bar: "Skill Idea Parked",
            terminal: `[skill-builder] idea parked after overlap check ${userRequest}`.trim(),
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
