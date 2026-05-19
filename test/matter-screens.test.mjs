import assert from "node:assert/strict";
import test from "node:test";
import { createMatterScreens } from "../frontend/matter-screens.js";

test("legacy sidebar matter picker remains hidden after matter list render", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    const state = {
      enabled: true,
      active: "Mehta vs Skyline",
      matters: [
        { name: "Ayesha Vs Japan Airlines" },
        { name: "Dummy 20260429T1324 02 - Devi v Patel" },
        { name: "Mehta vs Skyline" },
      ],
    };
    const elements = {
      mattersPicker: { hidden: true },
      mattersList: { innerHTML: "" },
      mattersSearchInput: { value: "" },
      mattersSearchMeta: { textContent: "" },
    };
    const screens = createMatterScreens({
      elements,
      getMattersState: () => state,
    });

    screens.renderMattersList();

    assert.equal(elements.mattersPicker.hidden, true);
    assert.equal(elements.mattersSearchMeta.textContent, "");
    assert.equal(elements.mattersList.innerHTML, "");

    screens.setMatterSearchQuery("airlines");

    assert.equal(elements.mattersSearchInput.value, "airlines");
    assert.equal(elements.mattersSearchMeta.textContent, "1 of 3 matters");
    assert.match(elements.mattersList.innerHTML, /Ayesha Vs Japan Airlines/);
    assert.doesNotMatch(elements.mattersList.innerHTML, /Mehta vs Skyline/);

    screens.setMatterSearchQuery("no such matter");

    assert.equal(elements.mattersSearchMeta.textContent, "0 of 3 matters");
    assert.match(elements.mattersList.innerHTML, /No matters match "no such matter"\./);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("legacy sidebar matter picker stays hidden even when no matter is selected", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    const state = {
      enabled: true,
      active: "",
      matters: [
        { name: "Ayesha Vs Japan Airlines" },
        { name: "Mehta vs Skyline" },
      ],
    };
    const elements = {
      mattersPicker: { hidden: true },
      mattersList: { innerHTML: "" },
      mattersSearchInput: { value: "" },
      mattersSearchMeta: { textContent: "" },
    };
    const screens = createMatterScreens({
      elements,
      getMattersState: () => state,
    });

    screens.renderMattersList();

    assert.equal(elements.mattersPicker.hidden, true);
    assert.equal(elements.mattersSearchMeta.textContent, "");
    assert.equal(elements.mattersList.innerHTML, "");

    screens.setMatterSearchQuery("mehta");

    assert.equal(elements.mattersSearchInput.value, "mehta");
    assert.equal(elements.mattersSearchMeta.textContent, "1 of 2 matters");
    assert.doesNotMatch(elements.mattersList.innerHTML, /Ayesha Vs Japan Airlines/);
    assert.match(elements.mattersList.innerHTML, /Mehta vs Skyline/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("blank landing offers explicit continue action for last matter without selecting it", () => {
  const previousDocument = globalThis.document;
  const nodes = createHomeDocumentNodes();
  globalThis.document = {
    activeElement: null,
    getElementById: (id) => nodes[id] || null,
  };
  try {
    const calls = [];
    const state = {
      enabled: true,
      active: null,
      resumeMatterName: "Ayesha Vs Japan Airlines",
      mattersHome: "/tmp/matters",
      matters: [
        { name: "Ayesha Vs Japan Airlines" },
        { name: "Mehta vs Skyline" },
      ],
    };
    const elements = {
      activityExplorer: { classList: { toggle: (...args) => calls.push(["explorer-toggle", args]) } },
      activitySkills: { classList: { toggle: () => {} } },
      activityActivity: { classList: { toggle: () => {} } },
      activitySettings: { classList: { toggle: () => {} } },
      addFilesButton: { hidden: false },
      matterActionsSection: { hidden: false },
      matterFilesSection: { hidden: false },
      mattersPicker: { hidden: false },
      sidebarTitle: { textContent: "" },
      toggleTechnicalFilesButton: { hidden: false },
      refreshExplorerButton: { hidden: false },
      breadcrumbs: { textContent: "" },
      editorContent: { innerHTML: "", scrollTop: 42 },
      titleText: { textContent: "" },
      bottomMeta: { textContent: "" },
      aiCommandCopyText: { textContent: "" },
      aiCommandInput: { placeholder: "" },
      workspaceTree: { innerHTML: "" },
    };
    const screens = createMatterScreens({
      elements,
      getMattersState: () => state,
      clearActiveMatter: () => calls.push(["clear-active"]),
      setStatus: (status) => calls.push(["status", status]),
      switchToMatter: (name) => calls.push(["switch", name]),
      runCommand: (command) => calls.push(["command", command]),
    });

    screens.renderBlankLanding();

    assert.equal(elements.titleText.textContent, "No matter selected");
    assert.equal(elements.bottomMeta.textContent, "No matter selected");
    assert.equal(elements.breadcrumbs.textContent, "Home");
    assert.equal(elements.sidebarTitle.textContent, "Home");
    assert.equal(elements.mattersPicker.hidden, true);
    assert.equal(elements.matterActionsSection.hidden, true);
    assert.equal(elements.matterFilesSection.hidden, true);
    assert.equal(elements.addFilesButton.hidden, true);
    assert.equal(elements.toggleTechnicalFilesButton.hidden, true);
    assert.equal(elements.refreshExplorerButton.hidden, true);
    assert.equal(elements.aiCommandCopyText.textContent, "Ask a general question, create a skill, or pick a matter first.");
    assert.equal(elements.aiCommandInput.placeholder, "Ask a general question, create a skill, or pick a matter first");
    assert.equal(elements.editorContent.scrollTop, 0);
    assert.match(elements.editorContent.innerHTML, /Good (morning|afternoon|evening)\./);
    assert.match(elements.editorContent.innerHTML, /Available matters/);
    assert.match(elements.editorContent.innerHTML, /Quick actions/);
    assert.match(elements.editorContent.innerHTML, /Add new matter/);
    assert.match(elements.editorContent.innerHTML, /New skill/);
    assert.match(elements.editorContent.innerHTML, /Prepare matter/);
    assert.match(elements.editorContent.innerHTML, /Continue where you left off/);
    assert.match(elements.editorContent.innerHTML, /Ayesha Vs Japan Airlines/);
    assert.match(elements.editorContent.innerHTML, /Choose a matter to begin/);
    assert.doesNotMatch(elements.editorContent.innerHTML, /Recent matters/);
    assert.ok(!calls.some((call) => call[0] === "switch"));

    nodes.homeFindMatterAction.handlers.click();
    assert.equal(nodes.homeMatterSearchPanel.hidden, false);
    assert.equal(nodes.homeMatterSearchInput.focused, true);
    assert.equal(nodes.homeMatterSearchMeta.textContent, "Type to search 2 matters.");
    assert.equal(nodes.homeMattersList.innerHTML, "");

    nodes.homeMatterSearchInput.handlers.input({ target: { value: "mehta" } });
    assert.equal(nodes.homeMatterSearchMeta.textContent, "1 of 2 matters");
    assert.match(nodes.homeMattersList.innerHTML, /Mehta vs Skyline/);
    assert.doesNotMatch(nodes.homeMattersList.innerHTML, /Ayesha Vs Japan Airlines/);

    nodes.homeMattersList.handlers.click({
      target: {
        closest: () => ({ dataset: { homeMatterName: "Mehta vs Skyline" } }),
      },
    });
    assert.deepEqual(calls.at(-1), ["switch", "Mehta vs Skyline"]);

    nodes.continueLastMatterButton.handlers.click();
    assert.deepEqual(calls.at(-1), ["switch", "Ayesha Vs Japan Airlines"]);

    nodes.homeViewAllMattersButton.handlers.click();
    assert.equal(nodes.homeMatterSearchPanel.hidden, false);

    nodes.homeNewSkillAction.handlers.click();
    assert.deepEqual(calls.at(-1), ["command", "new skill"]);

    nodes.homePrepareMatterAction.handlers.click();
    assert.deepEqual(calls.at(-1), ["command", "prepare matter"]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("home button clears the active matter and renders landing", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    activeElement: null,
    getElementById: () => null,
  };
  try {
    const calls = [];
    const elements = {
      activityExplorer: { classList: { toggle: () => {} } },
      activitySkills: { classList: { toggle: () => {} } },
      activityActivity: { classList: { toggle: () => {} } },
      activitySettings: { classList: { toggle: () => {} } },
      addFilesButton: { hidden: false },
      matterActionsSection: { hidden: false },
      matterFilesSection: { hidden: false },
      mattersPicker: { hidden: false },
      sidebarTitle: { textContent: "" },
      toggleTechnicalFilesButton: { hidden: false },
      refreshExplorerButton: { hidden: false },
      breadcrumbs: { textContent: "" },
      editorContent: { innerHTML: "", scrollTop: 42 },
      titleText: { textContent: "" },
      bottomMeta: { textContent: "" },
      aiCommandCopyText: { textContent: "" },
      aiCommandInput: { placeholder: "" },
      workspaceTree: { innerHTML: "" },
    };
    const screens = createMatterScreens({
      elements,
      getActiveMatter: () => ({ folderName: "Ayesha Vs Japan Airlines" }),
      getMattersState: () => ({
        enabled: true,
        active: "Ayesha Vs Japan Airlines",
        matters: [{ name: "Ayesha Vs Japan Airlines" }],
      }),
      clearActiveMatterOnServer: () => calls.push(["clear-server"]),
      clearActiveMatter: () => calls.push(["clear-active"]),
      setResumeMatterName: (name) => calls.push(["resume", name]),
      setStatus: (status) => calls.push(["status", status]),
    });

    await screens.goToExplorer();

    assert.deepEqual(calls[0], ["resume", "Ayesha Vs Japan Airlines"]);
    assert.deepEqual(calls[1], ["clear-server"]);
    assert.ok(calls.some((call) => call[0] === "clear-active"));
    assert.equal(elements.breadcrumbs.textContent, "Home");
    assert.equal(elements.sidebarTitle.textContent, "Home");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("settings page leads with readiness and collapses routing tables", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const nodes = createSettingsDocumentNodes();
  globalThis.document = {
    activeElement: null,
    getElementById: (id) => nodes[id] || null,
  };
  globalThis.fetch = async (url) => {
    if (url === "/api/ai-settings") {
      return jsonResponse({
        provider: "OpenAI",
        apiKeyConfigured: true,
        envPath: "/tmp/matter-workbench/.env",
        model: "gpt-5.4-mini",
        maxOutputTokens: 3000,
        aiTasks: [
          {
            label: "Skill router",
            surface: "AI command routing",
            provider: "openai-direct",
            model: "gpt-5.4-mini",
            maxOutputTokens: 1200,
            fallback: "fail_closed",
            ready: true,
          },
        ],
      });
    }
    if (url === "/api/skills") {
      return jsonResponse({
        skills: [
          {
            slash: "/prepare_matter",
            category: "Prepare",
            mode: "deterministic",
            purpose: "Show a disk-derived preparation plan.",
          },
        ],
      });
    }
    return jsonResponse({ error: `Unexpected URL ${url}` }, { ok: false, status: 404 });
  };

  try {
    const elements = {
      activityExplorer: { classList: { toggle: () => {} } },
      activitySkills: { classList: { toggle: () => {} } },
      activityActivity: { classList: { toggle: () => {} } },
      activitySettings: { classList: { toggle: () => {} } },
      breadcrumbs: { textContent: "" },
      editorContent: { innerHTML: "" },
    };
    const screens = createMatterScreens({
      elements,
      getMattersState: () => ({ mattersHome: "/tmp/matters" }),
      setStatus: () => {},
      goToExplorer: () => {},
    });

    await screens.renderSettings();

    assert.equal(elements.breadcrumbs.textContent, "settings");
    assert.match(elements.editorContent.innerHTML, /All systems ready/);
    assert.match(elements.editorContent.innerHTML, /Matters Home/);
    assert.match(elements.editorContent.innerHTML, /AI Configuration/);
    assert.match(elements.editorContent.innerHTML, /Save AI settings/);
    assert.match(elements.editorContent.innerHTML, /Test connection/);
    assert.match(elements.editorContent.innerHTML, /<summary>[\s\S]*Advanced AI Routing/);
    assert.match(elements.editorContent.innerHTML, /<summary>[\s\S]*Skill Registry/);
    assert.match(elements.editorContent.innerHTML, /1 skills/);
    assert.ok(nodes.settingsForm.handlers.submit);
    assert.ok(nodes.aiSettingsForm.handlers.submit);
    assert.ok(nodes.skillRouterForm.handlers.submit);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

function createHomeDocumentNodes() {
  const node = (extra = {}) => ({
    hidden: false,
    innerHTML: "",
    textContent: "",
    value: "",
    focused: false,
    handlers: {},
    addEventListener(event, handler) {
      this.handlers[event] = handler;
    },
    focus() {
      this.focused = true;
    },
    ...extra,
  });
  return {
    continueLastMatterButton: node(),
    homeSearchMatterButton: node(),
    homeAddMatterButton: node(),
    homeViewAllMattersButton: node(),
    homeFindMatterAction: node(),
    homeAddMatterAction: node(),
    homeNewSkillAction: node(),
    homePrepareMatterAction: node(),
    homeMatterSearchPanel: node({ hidden: true }),
    homeMatterSearchInput: node(),
    homeMatterSearchMeta: node(),
    homeMattersList: node(),
  };
}

function createSettingsDocumentNodes() {
  const node = (extra = {}) => ({
    hidden: false,
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false,
    handlers: {},
    addEventListener(event, handler) {
      this.handlers[event] = handler;
    },
    ...extra,
  });
  return {
    settingsForm: node(),
    settingsMattersHome: node({ value: "/tmp/matters" }),
    settingsError: node({ hidden: true }),
    settingsSubmit: node(),
    settingsCancel: node(),
    aiSettingsForm: node(),
    aiApiKey: node(),
    aiModel: node({ value: "gpt-5.4-mini" }),
    aiMaxOutputTokens: node({ value: "3000" }),
    aiSettingsSubmit: node(),
    aiSettingsTest: node(),
    aiSettingsMessage: node(),
    aiSettingsError: node({ hidden: true }),
    aiKeyStatus: node({ textContent: "Configured" }),
    aiProviderStatus: node(),
    skillRouterForm: node(),
    skillIntentRequest: node(),
    skillIntentOverrideLabel: node({ hidden: true }),
    skillIntentOverride: node(),
    skillRouterSubmit: node(),
    skillRouterError: node({ hidden: true }),
    skillRouterResult: node({ hidden: true }),
  };
}

function jsonResponse(payload, options = {}) {
  const ok = options.ok ?? true;
  return {
    ok,
    status: options.status || (ok ? 200 : 500),
    async json() {
      return payload;
    },
  };
}
