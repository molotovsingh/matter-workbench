const LANDING_COMMAND_COPY = "Ask a general question, create a skill, or pick a matter first.";
const MATTER_COMMAND_COPY = "Ask about this matter, run a skill, or search documents.";
const LANDING_COMMAND_PLACEHOLDER = "Ask a general question, create a skill, or pick a matter first";
const MATTER_COMMAND_PLACEHOLDER = "Ask about this matter, run a skill, or search documents";
const LANDING_COMMAND_EXAMPLES = ["new skill", "find a matter", "prepare matter"];
const MATTER_COMMAND_EXAMPLES = ["find payment receipts", "prepare matter", "new skill"];

export function setShellMatterMode(elements = {}, hasMatter = false) {
  const matterSelected = Boolean(hasMatter);
  elements.appShell?.classList?.toggle("home-mode", !matterSelected);
  elements.appShell?.classList?.toggle("matter-mode", matterSelected);
  if (elements.sidebarTitle) elements.sidebarTitle.textContent = matterSelected ? "Matter files" : "Home";
  if (elements.mattersPicker) elements.mattersPicker.hidden = true;
  if (elements.matterActionsSection) elements.matterActionsSection.hidden = !matterSelected;
  if (elements.matterFilesSection) elements.matterFilesSection.hidden = !matterSelected;
  if (elements.addFilesButton) elements.addFilesButton.hidden = !matterSelected;
  if (elements.toggleTechnicalFilesButton) elements.toggleTechnicalFilesButton.hidden = !matterSelected;
  if (elements.refreshExplorerButton) elements.refreshExplorerButton.hidden = !matterSelected;
  if (elements.aiCommandCopyText) {
    elements.aiCommandCopyText.textContent = matterSelected ? MATTER_COMMAND_COPY : LANDING_COMMAND_COPY;
  }
  if (elements.aiCommandInput) {
    const placeholder = matterSelected ? MATTER_COMMAND_PLACEHOLDER : LANDING_COMMAND_PLACEHOLDER;
    elements.aiCommandInput.placeholder = placeholder;
    elements.aiCommandInput.setAttribute?.("placeholder", placeholder);
  }
  renderCommandExamples(
    elements.aiCommandExamples,
    matterSelected ? MATTER_COMMAND_EXAMPLES : LANDING_COMMAND_EXAMPLES,
  );
}

function renderCommandExamples(container, examples) {
  if (!container) return;
  container.replaceChildren(...examples.map((example) => {
    const code = document.createElement("code");
    code.textContent = example;
    return code;
  }));
}
