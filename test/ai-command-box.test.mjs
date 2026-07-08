import assert from "node:assert/strict";
import test from "node:test";
import { createAiCommandBox } from "../frontend/ai-command-box.js";
import { fakeCtx, fakeForm } from "../test-support/ai-command-box-helpers.mjs";

// Core command dispatch and utility interactions.

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
  assert.equal(ctx.elements.aiCommandSubmit.textContent, "→");
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
      "/create_case_timeline": async (command) => calls.push(command),
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
          slash: "/create_case_timeline",
          artifacts: [
            "10_Library/Case Timeline.md",
            "10_Library/Case Timeline.json",
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
      "/create_case_timeline": async () => {
        ctx.setStatus({
          bar: "Rerun Confirmation",
          terminal: "[listofdates] rerun confirmation shown",
        });
        ctx.setStatus({
          bar: "Case Timeline Cancelled",
          terminal: "[listofdates] rerun cancelled by user",
        });
      },
    },
  });

  box.wire();
  await form.submit();
  await box.copyLatestReport();

  assert.match(copied, /- Typed input: `chronology`/);
  assert.match(copied, /- Matched command: `\/create_case_timeline`/);
  assert.match(copied, /- Status: cancelled/);
  assert.match(copied, /- Provider\/model: Friendli \/ openai\/gpt-4\.1/);
  assert.match(copied, /10_Library\/Case Timeline\.md/);
  assert.match(copied, /\[listofdates\] rerun cancelled by user/);
});
