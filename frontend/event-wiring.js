import { renderAddFilesForm } from "./views/add-files.js";
import { renderNewMatterForm } from "./views/new-matter.js";
import { createBuiltinSkillDispatch } from "./skill-dispatch.js";

export function wireAppEvents(ctx, skills) {
  const { elements } = ctx;
  const skillDispatch = createBuiltinSkillDispatch(skills);

  elements.refreshExplorerButton.addEventListener("click", () => ctx.refreshWorkspace());
  elements.toggleTechnicalFilesButton?.addEventListener("click", () => ctx.toggleTechnicalFiles?.());

  elements.workspaceTree.addEventListener("click", (event) => {
    const fileButton = event.target.closest("[data-file-path]");
    if (!fileButton) return;
    ctx.openFilePreview(
      fileButton.dataset.filePath,
      fileButton.dataset.previewable,
      fileButton.dataset.previewKind || "",
    );
  });

  elements.mattersList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-matter-name]");
    if (!button) return;
    const name = button.dataset.matterName;
    const mattersState = ctx.getMattersState();
    if (!name || name === mattersState.active) return;
    ctx.switchToMatter(name);
  });

  elements.mattersSearchInput?.addEventListener("input", (event) => {
    ctx.setMatterSearchQuery?.(event.target.value);
  });

  elements.newMatterButton.addEventListener("click", () => renderNewMatterForm(ctx));
  elements.addFilesButton.addEventListener("click", () => renderAddFilesForm(ctx));
  elements.activitySettings.addEventListener("click", ctx.renderSettings);
  elements.activitySkills?.addEventListener("click", ctx.renderSkills);
  elements.activityActivity?.addEventListener("click", ctx.renderActivity);
  elements.activityExplorer.addEventListener("click", ctx.goToExplorer);

  elements.slashSkillButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!ctx.getActiveMatter().folderName) {
        const skill = button.dataset.skill;
        if (skill === "/prepare_matter") {
          elements.slashSkillButtons.forEach((other) => other.classList.toggle("active", other === button));
          skills.runPrepareMatter(skill);
          return;
        }
        ctx.setStatus({
          bar: "No matter selected",
          terminal: "[skills] no matter loaded; pick one from the sidebar",
        });
        return;
      }
      elements.slashSkillButtons.forEach((other) => other.classList.toggle("active", other === button));
      const skill = button.dataset.skill;
      const runSkill = skillDispatch[skill];
      if (!runSkill) {
        ctx.setStatus({
          bar: "Unknown Skill",
          terminal: `[skills] no runner is wired for ${skill || "unknown skill"}`,
        });
        return;
      }
      runSkill(skill);
    });
  });
}
