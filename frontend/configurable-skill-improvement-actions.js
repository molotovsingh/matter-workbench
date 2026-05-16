import {
  buildConfigurableSkillImprovementBrief,
  buildConfigurableSkillImprovementInterview,
} from "./configurable-skill-improvement.js";
import { renderConfigurableSkillImprovementPromptHtml } from "./configurable-skill-run-ui.js";
import { escapeHtml } from "./dom-utils.js";

export function createConfigurableSkillImprovementActions({
  aiCommandInput,
  aiCommandSession,
  aiCommandSubmit,
  ctx,
  defaultPlaceholder,
  getPendingRun,
  recordCommandInteraction,
  renderCommandError,
  renderCommandRailError,
  renderSkillIdeaSession,
  saveSkillIdea,
  setCurrentSkillIdeaInterview,
  setPendingRun,
  updateReport,
  wireConfigurableSkillActions,
}) {
  async function startConfigurableSkillImprovement(skill = {}, revisionText = "", { startReport } = {}) {
    startReport?.({
      typedInput: revisionText ? `improve ${skill.slash} ${revisionText}` : `improve ${skill.slash || ""}`,
      matchedCommand: "skill_revision/idea",
      status: "pending",
    });
    setPendingRun({
      phase: "improve",
      slash: skill.slash || "",
      title: skill.title || skill.slash || "Custom Skill",
      artifactPath: Array.isArray(skill.outputs) ? skill.outputs[0] || "" : skill.outputArtifact || "",
      skill,
    });
    if (revisionText) {
      await saveConfigurableSkillImprovement(revisionText);
      return;
    }
    renderConfigurableSkillImprovementPrompt();
  }

  function renderConfigurableSkillImprovementPrompt() {
    const pending = getPendingRun?.();
    if (!aiCommandSession || !pending) return;
    pending.phase = "improve";
    setPendingRun(pending);
    const slash = pending.slash || pending.skill?.slash || "";
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderConfigurableSkillImprovementPromptHtml(pending);
    aiCommandInput.placeholder = "Describe what should improve...";
    aiCommandSubmit.textContent = "Save idea";
    wireConfigurableSkillActions?.();
    ctx.setStatus({
      mood: "idle",
      card: `<strong>Improve skill</strong><br />Describe what should change for <code>${escapeHtml(slash)}</code>.`,
      bar: "Improve Skill",
      terminal: `[configurable-skill] improvement prompt for ${slash}`,
    });
  }

  async function saveConfigurableSkillImprovement(userRequest) {
    const pending = getPendingRun?.();
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
      const activeMatter = ctx.getActiveMatter?.() || {};
      const payload = await saveSkillIdea({
        text: `Improve ${slash}: ${changeText}`,
        designBrief: buildConfigurableSkillImprovementBrief({
          slash,
          title,
          artifactPath,
          changeText,
          activeMatter,
        }),
      });
      const idea = payload.idea || {};
      setPendingRun(null);
      aiCommandInput.placeholder = defaultPlaceholder;
      aiCommandSubmit.textContent = "→";
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
      setCurrentSkillIdeaInterview({
        interview: buildConfigurableSkillImprovementInterview({
          slash,
          title,
          artifactPath,
          changeText,
          activeMatter,
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
      });
      renderSkillIdeaSession();
      ctx.setStatus({
        mood: "idle",
        card: "<strong>Improvement idea saved</strong><br />Generate a revised sample before creating a new version. The active skill was not changed.",
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
      aiCommandSubmit.textContent = "→";
    }
  }

  return {
    renderConfigurableSkillImprovementPrompt,
    saveConfigurableSkillImprovement,
    startConfigurableSkillImprovement,
  };
}
