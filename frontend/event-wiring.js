import { renderAddFilesForm } from "./views/add-files.js";
import { renderNewMatterForm } from "./views/new-matter.js";

export function wireAppEvents(ctx, skills, skillDispatch = {}) {
  const { elements } = ctx;

  elements.refreshExplorerButton.addEventListener("click", () => ctx.refreshWorkspace());

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

  elements.newMatterButton.addEventListener("click", () => renderNewMatterForm(ctx));
  elements.addFilesButton.addEventListener("click", () => renderAddFilesForm(ctx));
  elements.activitySettings.addEventListener("click", ctx.renderSettings);
  elements.activityExplorer.addEventListener("click", ctx.goToExplorer);

  elements.slashSkillButtons.forEach((button) => {
    button.addEventListener("click", () => {
      elements.slashSkillButtons.forEach((other) => other.classList.toggle("active", other === button));
      if (!ctx.getActiveMatter().folderName) {
        ctx.setStatus({
          bar: "No Matter",
          terminal: "[skills] no matter loaded; pick one from the sidebar",
        });
        return;
      }
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
