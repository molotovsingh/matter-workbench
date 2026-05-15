import assert from "node:assert/strict";
import test from "node:test";
import { setShellMatterMode } from "../frontend/shell-presentation.js";

test("shell presentation hides matter-only controls and uses landing command copy without a matter", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => ({ tagName, textContent: "" }),
  };
  try {
    const elements = fakeElements();

    setShellMatterMode(elements, false);

    assert.equal(elements.sidebarTitle.textContent, "Home");
    assert.equal(elements.mattersPicker.hidden, true);
    assert.equal(elements.matterActionsSection.hidden, true);
    assert.equal(elements.matterFilesSection.hidden, true);
    assert.equal(elements.addFilesButton.hidden, true);
    assert.equal(elements.toggleTechnicalFilesButton.hidden, true);
    assert.equal(elements.refreshExplorerButton.hidden, true);
    assert.equal(elements.aiCommandCopyText.textContent, "Ask a general question, create a skill, or pick a matter first.");
    assert.equal(elements.aiCommandInput.placeholder, "Ask a general question, create a skill, or pick a matter first");
    assert.deepEqual(elements.aiCommandExamples.children.map((child) => child.textContent), [
      "new skill",
      "find a matter",
      "prepare matter",
    ]);
    assert.deepEqual(elements.appShell.classList.calls, [
      ["home-mode", true],
      ["matter-mode", false],
    ]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("shell presentation restores matter controls and matter-specific command copy", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => ({ tagName, textContent: "" }),
  };
  try {
    const elements = fakeElements();

    setShellMatterMode(elements, true);

    assert.equal(elements.sidebarTitle.textContent, "Matter files");
    assert.equal(elements.mattersPicker.hidden, true);
    assert.equal(elements.matterActionsSection.hidden, false);
    assert.equal(elements.matterFilesSection.hidden, false);
    assert.equal(elements.addFilesButton.hidden, false);
    assert.equal(elements.toggleTechnicalFilesButton.hidden, false);
    assert.equal(elements.refreshExplorerButton.hidden, false);
    assert.equal(elements.aiCommandCopyText.textContent, "Ask about this matter, run a skill, or search documents.");
    assert.equal(elements.aiCommandInput.placeholder, "Ask about this matter, run a skill, or search documents");
    assert.deepEqual(elements.aiCommandExamples.children.map((child) => child.textContent), [
      "find payment receipts",
      "prepare matter",
      "new skill",
    ]);
    assert.deepEqual(elements.appShell.classList.calls, [
      ["home-mode", false],
      ["matter-mode", true],
    ]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

function fakeElements() {
  return {
    appShell: { classList: { calls: [], toggle(name, value) { this.calls.push([name, value]); } } },
    toggleTechnicalFilesButton: { hidden: false },
    refreshExplorerButton: { hidden: false },
    addFilesButton: { hidden: false },
    sidebarTitle: { textContent: "" },
    mattersPicker: { hidden: false },
    matterActionsSection: { hidden: false },
    matterFilesSection: { hidden: false },
    aiCommandCopyText: { textContent: "" },
    aiCommandInput: { placeholder: "" },
    aiCommandExamples: {
      children: [],
      replaceChildren(...children) {
        this.children = children;
      },
    },
  };
}
