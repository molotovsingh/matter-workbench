import assert from "node:assert/strict";
import test from "node:test";
import {
  wireActivityPageActions,
  wireSkillsPageActions,
} from "../frontend/skills-page-actions.js";

test("skills page actions run card commands through the command rail", () => {
  const commandButton = createButton({ skillCardCommand: "/create_listofdates" });
  const commands = [];
  const editorContent = createEditorContentDouble({
    "[data-skill-card-command]": [commandButton],
  });
  const ctx = {
    elements: {
      aiCommandInput: { value: "" },
    },
    runCommand: (command) => commands.push(command),
  };

  wireSkillsPageActions({ ctx, editorContent });
  commandButton.handlers.click();

  assert.equal(ctx.elements.aiCommandInput.value, "/create_listofdates");
  assert.deepEqual(commands, ["/create_listofdates"]);
});

test("activity page actions copy run reports and open output files", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const writes = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      clipboard: {
        writeText: async (text) => writes.push(text),
      },
    },
  });

  try {
    const copyButton = createButton({ configurableRunCopy: "run_1" });
    const openButton = createButton({ activityOpenOutput: "20_Workshop/Party and Officer Map.md" });
    const statuses = [];
    const opened = [];
    const editorContent = createEditorContentDouble({
      "[data-configurable-run-copy]": [copyButton],
      "[data-activity-open-output]": [openButton],
    });
    const ctx = {
      setStatus: (status) => statuses.push(status),
      openFilePreview: (...args) => opened.push(args),
    };

    wireActivityPageActions({
      configurableSkillRuns: {
        runs: [{
          id: "run_1",
          slash: "/party_officer_map_2",
          status: "succeeded",
          matter: { folderName: "Bharat Nagpal Vs Gionee India" },
          output: { path: "20_Workshop/Party and Officer Map.md" },
        }],
      },
      ctx,
      editorContent,
    });

    await copyButton.handlers.click();
    openButton.handlers.click();

    assert.equal(copyButton.disabled, false);
    assert.match(writes[0], /\/party_officer_map_2/);
    assert.equal(statuses.at(-1).bar, "Run Report Copied");
    assert.deepEqual(opened, [["20_Workshop/Party and Officer Map.md", "true", "markdown"]]);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

function createButton(dataset = {}) {
  return {
    dataset,
    disabled: false,
    handlers: {},
    addEventListener(event, handler) {
      this.handlers[event] = handler;
    },
  };
}

function createEditorContentDouble(selectorMap = {}) {
  return {
    querySelectorAll(selector) {
      return selectorMap[selector] || [];
    },
    querySelector(selector) {
      return selectorMap[selector]?.[0] || null;
    },
  };
}
