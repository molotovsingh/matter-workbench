import assert from "node:assert/strict";
import test from "node:test";
import {
  createAiCommandBox,
  listSlashCommandSuggestions,
  parseDeterministicCommand,
  parseSkillIdeaInput,
} from "../frontend/ai-command-box.js";

test("command parser maps exact slash commands and static aliases", () => {
  assert.deepEqual(parseDeterministicCommand("/extract"), { type: "skill", command: "/extract" });
  assert.deepEqual(parseDeterministicCommand("extract"), { type: "skill", command: "/extract" });
  assert.deepEqual(parseDeterministicCommand("describe sources"), { type: "skill", command: "/describe_sources" });
  assert.deepEqual(parseDeterministicCommand("source labels"), { type: "skill", command: "/describe_sources" });
  assert.deepEqual(parseDeterministicCommand("/context_preview"), { type: "skill", command: "/context_preview" });
  assert.deepEqual(parseDeterministicCommand("context"), { type: "skill", command: "/context_preview" });
  assert.deepEqual(parseDeterministicCommand("show context"), { type: "skill", command: "/context_preview" });
  assert.deepEqual(parseDeterministicCommand("/context_search"), { type: "search", command: "/context_search", query: "" });
  assert.deepEqual(parseDeterministicCommand("search"), { type: "search", command: "/context_search", query: "" });
  assert.deepEqual(parseDeterministicCommand("find"), { type: "search", command: "/context_search", query: "" });
  assert.deepEqual(parseDeterministicCommand("search payment receipts"), { type: "search", command: "/context_search", query: "payment receipts" });
  assert.deepEqual(parseDeterministicCommand("find legal notice"), { type: "search", command: "/context_search", query: "legal notice" });
  assert.deepEqual(parseDeterministicCommand("list of dates"), { type: "skill", command: "/create_listofdates" });
  assert.deepEqual(parseDeterministicCommand("chronology"), { type: "skill", command: "/create_listofdates" });
  assert.deepEqual(parseDeterministicCommand("doctor"), { type: "skill", command: "/doctor" });
  assert.deepEqual(parseDeterministicCommand("open inbox"), { type: "lane", input: "open inbox", lanePath: "00_Inbox" });
  assert.deepEqual(parseDeterministicCommand("open library"), { type: "lane", input: "open library", lanePath: "10_Library" });
  assert.deepEqual(parseDeterministicCommand("show library"), { type: "lane", input: "show library", lanePath: "10_Library" });
  assert.deepEqual(parseDeterministicCommand("open workshop"), { type: "lane", input: "open workshop", lanePath: "20_Workshop" });
  assert.deepEqual(parseDeterministicCommand("open drafts"), { type: "lane", input: "open drafts", lanePath: "30_Drafts" });
  assert.deepEqual(parseDeterministicCommand("show drafts"), { type: "lane", input: "show drafts", lanePath: "30_Drafts" });
  assert.deepEqual(parseDeterministicCommand("open dispatch"), { type: "lane", input: "open dispatch", lanePath: "40_Dispatch" });
  assert.deepEqual(parseDeterministicCommand("show status"), { type: "status" });
  assert.deepEqual(parseDeterministicCommand("status"), { type: "status" });
  assert.deepEqual(parseDeterministicCommand("open skills"), { type: "skills", input: "open skills" });
  assert.deepEqual(parseDeterministicCommand("show skills"), { type: "skills", input: "show skills" });
  assert.deepEqual(parseDeterministicCommand("skills"), { type: "skills", input: "skills" });
});

test("command parser does not fuzzy-match unsupported text", () => {
  assert.equal(parseDeterministicCommand("please extract this"), null);
  assert.equal(parseDeterministicCommand("/describe-sources"), null);
  assert.equal(parseDeterministicCommand("create a list of dates skill"), null);
});

test("skill idea parser detects explicit proposal phrases only", () => {
  assert.deepEqual(parseSkillIdeaInput("create a skill to summarize pleadings"), {
    type: "skill_idea",
    text: "create a skill to summarize pleadings",
    idea: "summarize pleadings",
  });
  assert.deepEqual(parseSkillIdeaInput("create a skil to summarise the best case pleadings"), {
    type: "skill_idea",
    text: "create a skil to summarise the best case pleadings",
    idea: "summarise the best case pleadings",
  });
  assert.deepEqual(parseSkillIdeaInput("new skill bundle exhibits"), {
    type: "skill_idea",
    text: "new skill bundle exhibits",
    idea: "bundle exhibits",
  });
  assert.deepEqual(parseSkillIdeaInput("I need a skill that checks limitation"), {
    type: "skill_idea",
    text: "I need a skill that checks limitation",
    idea: "checks limitation",
  });
  assert.deepEqual(parseSkillIdeaInput("can we make a skill for filing bundles"), {
    type: "skill_idea",
    text: "can we make a skill for filing bundles",
    idea: "filing bundles",
  });
  assert.equal(parseSkillIdeaInput("please extract this"), null);
  assert.equal(parseSkillIdeaInput("list of dates"), null);
});

test("slash command suggestions are explicit and description-backed", () => {
  assert.deepEqual(
    listSlashCommandSuggestions("/").map((suggestion) => suggestion.command),
    ["/matter-init", "/extract", "/describe_sources", "/context_preview", "/context_search", "/create_listofdates", "/doctor"],
  );
  assert.deepEqual(
    listSlashCommandSuggestions("/de").map((suggestion) => suggestion.command),
    ["/describe_sources"],
  );
  assert.equal(listSlashCommandSuggestions("chronology").length, 0);
  assert.match(listSlashCommandSuggestions("/create")[0].description, /chronology/i);
  assert.match(listSlashCommandSuggestions("/context")[0].description, /evidence packet/i);
  assert.match(listSlashCommandSuggestions("/context_s")[0].description, /locally/i);
});

test("command box dispatches deterministic slash commands through injected skill runners", async () => {
  const calls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "/extract" });
  const box = createAiCommandBox(ctx, {
    skillDispatch: {
      "/extract": async (command) => calls.push(command),
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(calls, ["/extract"]);
  assert.equal(ctx.elements.aiCommandSubmit.disabled, false);
  assert.equal(ctx.elements.aiCommandSubmit.textContent, "Go");
  assert.match(ctx.statusCalls[0].terminal, /\[ai-command\] \/extract -> \/extract/);
});

test("command box dispatches aliases through the same skill runner path", async () => {
  const calls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "source labels" });
  const box = createAiCommandBox(ctx, {
    skillDispatch: {
      "/describe_sources": async (command) => calls.push(command),
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(calls, ["/describe_sources"]);
});

test("command box status command renders matter overview without running a skill", async () => {
  const calls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "show status" });
  const box = createAiCommandBox(ctx, {
    skillDispatch: {
      "/extract": async (command) => calls.push(command),
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(calls, []);
  assert.equal(ctx.renderedOverview, true);
  assert.equal(ctx.statusCalls.at(-1).bar, "Matter Status");
});

test("command box opens workspace lanes without running a skill", async () => {
  const calls = [];
  const openedLanes = [];
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "open library",
    openWorkspaceLane: (lanePath) => {
      openedLanes.push(lanePath);
      ctx.setStatus({
        bar: "Lane Opened",
        terminal: `[workspace] opened ${lanePath}`,
      });
      return { ok: true };
    },
  });
  const box = createAiCommandBox(ctx, {
    skillDispatch: {
      "/create_listofdates": async (command) => calls.push(command),
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(calls, []);
  assert.deepEqual(openedLanes, ["10_Library"]);
  assert.equal(ctx.statusCalls.at(-1).bar, "Lane Opened");
});

test("command box opens the read-only skills page without running a skill", async () => {
  const calls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "open skills" });
  const box = createAiCommandBox(ctx, {
    skillDispatch: {
      "/extract": async (command) => calls.push(command),
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(calls, []);
  assert.equal(ctx.renderedSkills, true);
  assert.equal(ctx.statusCalls.at(-1).bar, "Skills");
});

test("command box dispatches context search aliases without provider routing", async () => {
  const calls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "find payment receipts" });
  const box = createAiCommandBox(ctx, {
    skillDispatch: {
      "/context_search": async (payload) => {
        calls.push(payload);
        ctx.setStatus({
          bar: "Context Search Ready",
          terminal: "[context-search] matches: 2",
        });
      },
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(calls, [{
    command: "/context_search",
    query: "payment receipts",
    typedInput: "find payment receipts",
  }]);
  assert.equal(ctx.statusCalls.at(-1).bar, "Context Search Ready");
});

test("command box opens deterministic skill idea interview without running skills or router check", async () => {
  const calls = [];
  const savedIdeas = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "create a skill to summarize pleadings" });
  const box = createAiCommandBox(ctx, {
    saveSkillIdea: async (body) => {
      savedIdeas.push(body);
      return {
        idea: {
          id: "idea_test_1",
          text: body.text,
          createdAt: "2026-05-12T10:00:00.000Z",
          status: "incomplete",
          matter: {
            matterName: "Demo Matter",
            folderName: "Demo Matter",
          },
        },
      };
    },
    skillDispatch: {
      "/extract": async (command) => calls.push(command),
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(savedIdeas, []);
  assert.deepEqual(calls, []);
  assert.match(ctx.elements.editorContent.innerHTML, /What I understood/);
  assert.match(ctx.elements.editorContent.innerHTML, /Question/);
  assert.match(ctx.elements.editorContent.innerHTML, /Save idea/);
  assert.match(ctx.elements.editorContent.innerHTML, /Not runnable yet/);
  assert.match(ctx.elements.editorContent.innerHTML, /20_Workshop\/Pleadings Summary\.md/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Idea Interview");
});

test("command box interview detects adjacent list-of-dates improvement", async () => {
  const calls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "can list of dates also flag limitation issues" });
  const box = createAiCommandBox(ctx, {
    skillDispatch: {
      "/create_listofdates": async (command) => calls.push(command),
    },
  });

  box.wire();
  await form.submit();

  assert.deepEqual(calls, []);
  assert.match(ctx.elements.editorContent.innerHTML, /Likely related skill/);
  assert.match(ctx.elements.editorContent.innerHTML, /\/create_listofdates/);
  assert.match(ctx.elements.editorContent.innerHTML, /What should change/);
  assert.match(ctx.elements.editorContent.innerHTML, /What must stay unchanged/);
});

test("command box lane command asks for a matter before opening lanes", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "show drafts",
    activeMatter: { folderName: "" },
    openWorkspaceLane: (lanePath) => {
      ctx.setStatus({
        bar: "No Matter",
        terminal: `[workspace] lane requested without active matter: ${lanePath}`,
      });
      return { ok: false, reason: "no_matter" };
    },
  });
  const box = createAiCommandBox(ctx);

  box.wire();
  await form.submit();

  assert.equal(ctx.statusCalls.at(-1).bar, "No Matter");
  assert.match(ctx.elements.terminalOutput.textContent, /without active matter/);
});

test("command box keyboard suggestion selection fills and runs the command", async () => {
  const calls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "/" });
  const box = createAiCommandBox(ctx, {
    skillDispatch: {
      "/extract": async (command) => calls.push(command),
    },
  });

  box.wire();
  await ctx.elements.aiCommandInput.fire("input");
  await ctx.elements.aiCommandInput.keydown("ArrowDown");
  await ctx.elements.aiCommandInput.keydown("Enter");

  assert.deepEqual(calls, ["/extract"]);
  assert.equal(ctx.elements.aiCommandInput.value, "/extract");
  assert.equal(ctx.elements.aiCommandSuggestions.hidden, true);
});

test("command box copies a safe markdown report for the latest command", async () => {
  let copied = "";
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "/extract" });
  const box = createAiCommandBox(ctx, {
    now: () => new Date("2026-05-12T10:00:00.000Z"),
    writeClipboardText: async (text) => {
      copied = text;
    },
    loadMatterStatus: async () => ({
      stages: [
        {
          slash: "/extract",
          artifacts: ["00_Inbox/Intake 01 - Initial/Extraction Log.csv"],
        },
      ],
    }),
    skillDispatch: {
      "/extract": async () => {
        ctx.setStatus({
          bar: "Extract Complete",
          terminal: [
            "[extract] INTAKE-01: extracted 1, cached 0, skipped 0, failed 0",
            "[extract] totals: 1 extracted, 0 cached, 0 skipped, 0 failed",
          ],
        });
      },
    },
  });

  box.wire();
  await form.submit();
  await box.copyLatestReport();

  assert.match(copied, /^# Command Report/);
  assert.match(copied, /- Matter: Demo Matter/);
  assert.match(copied, /- Matter folder: Demo Matter/);
  assert.match(copied, /- Typed input: `\/extract`/);
  assert.match(copied, /- Matched command: `\/extract`/);
  assert.match(copied, /- Status: ran/);
  assert.match(copied, /00_Inbox\/Intake 01 - Initial\/Extraction Log\.csv/);
  assert.match(copied, /\[extract\] totals: 1 extracted/);
  assert.doesNotMatch(copied, /API_KEY|\.env|source document text/i);
});

test("command report records paid rerun cancellation without running a new artifact", async () => {
  let copied = "";
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "chronology" });
  const box = createAiCommandBox(ctx, {
    now: () => new Date("2026-05-12T10:05:00.000Z"),
    writeClipboardText: async (text) => {
      copied = text;
    },
    loadMatterStatus: async () => ({
      stages: [
        {
          slash: "/create_listofdates",
          artifacts: [
            "10_Library/List of Dates.md",
            "10_Library/List of Dates.json",
          ],
          aiRun: {
            provider: "openrouter",
            returnedProvider: "Friendli",
            model: "openai/gpt-4.1",
          },
        },
      ],
    }),
    skillDispatch: {
      "/create_listofdates": async () => {
        ctx.setStatus({
          bar: "Rerun Confirmation",
          terminal: "[listofdates] rerun confirmation shown",
        });
        ctx.setStatus({
          bar: "List of Dates Cancelled",
          terminal: "[listofdates] rerun cancelled by user",
        });
      },
    },
  });

  box.wire();
  await form.submit();
  await box.copyLatestReport();

  assert.match(copied, /- Typed input: `chronology`/);
  assert.match(copied, /- Matched command: `\/create_listofdates`/);
  assert.match(copied, /- Status: cancelled/);
  assert.match(copied, /- Provider\/model: Friendli \/ openai\/gpt-4\.1/);
  assert.match(copied, /10_Library\/List of Dates\.md/);
  assert.match(copied, /\[listofdates\] rerun cancelled by user/);
});

function fakeCtx({
  form,
  inputValue,
  activeMatter = { folderName: "Demo Matter" },
  openWorkspaceLane,
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
      aiCommandSubmit: { disabled: false, textContent: "Go" },
      aiCommandSuggestions: fakeSuggestions(),
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

function fakeForm() {
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

function fakeButton() {
  let clickHandler = null;
  return {
    disabled: false,
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
