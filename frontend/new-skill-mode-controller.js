import { normalizeCommandInput, parseDeterministicCommand } from "./command-parsing.js";
import { escapeHtml } from "./dom-utils.js";

export function createNewSkillModeController({
  aiCommandInput,
  aiCommandSession,
  aiCommandSubmit,
  ctx,
  defaultPlaceholder,
  now,
  recordCommandInteraction,
  startReport,
  updateReport,
  showSkillIdeaInterview,
}) {
  let pendingSkillIdeaMode = null;

  function isActive() {
    return Boolean(pendingSkillIdeaMode);
  }

  async function handleInput(userRequest) {
    const normalized = normalizeCommandInput(userRequest);
    if (normalized === "cancel") {
      cancel();
      return;
    }
    if (!userRequest) {
      render("Describe the skill you want, or choose Cancel.");
      return;
    }
    if (parseDeterministicCommand(userRequest)) {
      render("Describe the skill you want, or type Cancel before running another command.");
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

  function open(userRequest) {
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
    render();
    ctx.setStatus({
      mood: "idle",
      card: "<strong>New skill idea</strong><br />Describe the skill you want in your own words. Nothing will run.",
      bar: "New Skill Idea",
      terminal: "[skill-ideas] awaiting freeform idea",
    });
  }

  function render(errorMessage = "") {
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
    wireActions();
  }

  function wireActions() {
    aiCommandSession?.querySelectorAll?.("[data-new-skill-mode-action]")?.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.newSkillModeAction === "cancel") cancel();
      });
    });
  }

  function cancel() {
    pendingSkillIdeaMode = null;
    aiCommandInput.value = "";
    aiCommandInput.placeholder = defaultPlaceholder;
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

  return {
    cancel,
    handleInput,
    isActive,
    open,
  };
}
