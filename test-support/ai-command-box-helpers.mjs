import assert from "node:assert/strict";

export function fakeCtx({
  form,
  inputValue,
  activeMatter = { folderName: "Demo Matter" },
  openWorkspaceLane,
  openFilePreview,
}) {
  const statusCalls = [];
  const terminalOutput = { textContent: "" };
  const statusBarRight = { textContent: "" };
  const aiCommandInput = fakeInput(inputValue);
  return {
    renderedOverview: false,
    renderedSkills: false,
    statusCalls,
    elements: {
      aiCommandForm: form,
      aiCommandInput,
      aiCommandSubmit: { disabled: false, textContent: "→" },
      aiCommandSuggestions: fakeSuggestions(),
      aiCommandSession: fakeSession(),
      aiCommandCopyReport: fakeButton(),
      aiCommandReportStatus: fakeClassedText(),
      breadcrumbs: { textContent: "" },
      editorContent: { innerHTML: "" },
      statusBarRight,
      terminalOutput,
    },
    getActiveMatter: () => activeMatter,
    openWorkspaceLane,
    renderSkillOverview() {
      this.renderedOverview = true;
    },
    async renderSkills() {
      this.renderedSkills = true;
      this.setStatus({
        bar: "Skills",
        terminal: "[skills] viewing registry",
      });
    },
    openFilePreview,
    setStatus(status) {
      statusCalls.push(status);
      if (status.bar !== undefined) statusBarRight.textContent = status.bar;
      if (status.terminal !== undefined) {
        const lines = Array.isArray(status.terminal) ? status.terminal : [status.terminal];
        terminalOutput.textContent = terminalOutput.textContent
          ? `${terminalOutput.textContent}\n${lines.join("\n")}`
          : lines.join("\n");
      }
    },
  };
}

export async function noSkillOverlapDecision() {
  return {
    decision: "adjacent_skill",
    recommended_action: "adjacent_skill",
    matched_skill: "",
    confidence: 0.61,
    reason: "No existing skill directly covers this request.",
    suggested_next_action: "Continue with skill creation.",
    user_gate_required: false,
    mece_violation: false,
  };
}

export function completeReadiness() {
  const items = [
    ["intendedUser", "Intended user present"],
    ["problem", "Problem/job present"],
    ["expectedInputs", "Expected inputs present"],
    ["expectedOutputArtifact", "Expected output artifact present"],
    ["targetLane", "Target lane selected"],
    ["paidPosture", "Paid/free posture selected"],
    ["riskLevel", "Risk level selected"],
    ["notes", "Notes or acceptance criteria present"],
  ].map(([key, label]) => ({ key, label, passed: true }));
  return {
    state: "ready_for_review",
    ready: true,
    passedCount: items.length,
    totalCount: items.length,
    items,
  };
}

export function fakeForm() {
  let submitHandler = null;
  return {
    addEventListener(event, handler) {
      if (event === "submit") submitHandler = handler;
    },
    async submit() {
      assert.ok(submitHandler, "submit handler should be wired");
      await submitHandler({ preventDefault() {} });
    },
  };
}

function fakeInput(value) {
  const listeners = new Map();
  return {
    value,
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    async fire(event) {
      if (listeners.has(event)) await listeners.get(event)({});
    },
    async keydown(key) {
      if (!listeners.has("keydown")) return;
      await listeners.get("keydown")({
        key,
        preventDefault() {},
      });
    },
  };
}

function fakeSuggestions() {
  return {
    hidden: true,
    _innerHTML: "",
    buttons: [],
    set innerHTML(value) {
      this._innerHTML = value;
      this.buttons = Array.from(value.matchAll(/data-command-suggestion="([^"]+)"/g)).map((match) => ({
        dataset: { commandSuggestion: match[1] },
        addEventListener() {},
      }));
    },
    get innerHTML() {
      return this._innerHTML;
    },
    querySelectorAll() {
      return this.buttons;
    },
  };
}

function fakeSession() {
  return {
    hidden: true,
    innerHTML: "",
    querySelectorAll() {
      return [];
    },
  };
}

function fakeButton() {
  let clickHandler = null;
  return {
    disabled: false,
    hidden: false,
    textContent: "",
    addEventListener(event, handler) {
      if (event === "click") clickHandler = handler;
    },
    async click() {
      assert.ok(clickHandler, "click handler should be wired");
      await clickHandler();
    },
  };
}

function fakeClassedText() {
  return {
    textContent: "",
    classList: {
      toggle() {},
    },
  };
}
