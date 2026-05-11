import assert from "node:assert/strict";
import test from "node:test";
import {
  createAiCommandBox,
  parseDeterministicCommand,
} from "../frontend/ai-command-box.js";

test("command parser maps exact slash commands and static aliases", () => {
  assert.deepEqual(parseDeterministicCommand("/extract"), { type: "skill", command: "/extract" });
  assert.deepEqual(parseDeterministicCommand("extract"), { type: "skill", command: "/extract" });
  assert.deepEqual(parseDeterministicCommand("describe sources"), { type: "skill", command: "/describe_sources" });
  assert.deepEqual(parseDeterministicCommand("source labels"), { type: "skill", command: "/describe_sources" });
  assert.deepEqual(parseDeterministicCommand("list of dates"), { type: "skill", command: "/create_listofdates" });
  assert.deepEqual(parseDeterministicCommand("chronology"), { type: "skill", command: "/create_listofdates" });
  assert.deepEqual(parseDeterministicCommand("doctor"), { type: "skill", command: "/doctor" });
  assert.deepEqual(parseDeterministicCommand("show status"), { type: "status" });
  assert.deepEqual(parseDeterministicCommand("status"), { type: "status" });
});

test("command parser does not fuzzy-match unsupported text", () => {
  assert.equal(parseDeterministicCommand("please extract this"), null);
  assert.equal(parseDeterministicCommand("/describe-sources"), null);
  assert.equal(parseDeterministicCommand("create a list of dates skill"), null);
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

function fakeCtx({ form, inputValue }) {
  const statusCalls = [];
  const terminalOutput = { textContent: "" };
  const statusBarRight = { textContent: "" };
  return {
    renderedOverview: false,
    statusCalls,
    elements: {
      aiCommandForm: form,
      aiCommandInput: { value: inputValue },
      aiCommandSubmit: { disabled: false, textContent: "Go" },
      aiCommandCopyReport: fakeButton(),
      aiCommandReportStatus: fakeClassedText(),
      breadcrumbs: { textContent: "" },
      editorContent: { innerHTML: "" },
      statusBarRight,
      terminalOutput,
    },
    getActiveMatter: () => ({ folderName: "Demo Matter" }),
    renderSkillOverview() {
      this.renderedOverview = true;
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
