import { renderCreatedSkillCommandRailHtml } from "./skill-builder-result-rendering.js";

export function createCreatedSkillCommandRailActions({
  aiCommandInput,
  aiCommandSession,
  aiCommandSubmit,
  ctx,
  deterministicCommands,
  editorContent,
  recordCommandInteraction,
  runConfigurableSkillCommand,
  setCurrentSkillIdeaInterview,
}) {
  let lastCreatedConfigurableSkill = null;

  function renderCreatedSkillCommandRail(skill = {}) {
    lastCreatedConfigurableSkill = skill;
    if (!aiCommandSession) return;
    aiCommandSession.hidden = false;
    aiCommandSession.innerHTML = renderCreatedSkillCommandRailHtml(skill);
    wireCreatedSkillActions();
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

  function startAnotherSkillIdea() {
    setCurrentSkillIdeaInterview(null);
    if (aiCommandInput) {
      aiCommandInput.value = "";
      aiCommandInput.placeholder = "create a skill to...";
    }
    aiCommandSubmit.disabled = false;
    aiCommandSubmit.textContent = "→";
    if (aiCommandSession) {
      aiCommandSession.hidden = true;
      aiCommandSession.innerHTML = "";
    }
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

  return {
    renderCreatedSkillCommandRail,
  };
}
