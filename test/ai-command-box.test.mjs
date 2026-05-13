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
  const cases = [
    ["create a new skill for checking limitation", "checking limitation"],
    ["create a new skill to check limitation", "check limitation"],
    ["create a new skill that does one job - checks limitation", "does one job - checks limitation"],
    ["create new skill that checks limitation", "checks limitation"],
    ["create a skill for filing bundles", "filing bundles"],
    ["create a skill to summarize pleadings", "summarize pleadings"],
    ["create a skill that checks limitation", "checks limitation"],
    ["make a new skill for checking limitation", "checking limitation"],
    ["make new skill that checks limitation", "checks limitation"],
    ["make a new skill that summarises the best case pleadings for the lawyer", "summarises the best case pleadings for the lawyer"],
    ["make a skill for extracting prayer clauses", "extracting prayer clauses"],
    ["make a skill that extracts prayer clauses", "extracts prayer clauses"],
    ["new skill bundle exhibits", "bundle exhibits"],
    ["I need a skill that checks limitation", "checks limitation"],
    ["I want a skill that determines the limitation of the matter", "determines the limitation of the matter"],
    ["I want a new skill that determines limitation", "determines limitation"],
    ["I want a skill to determine limitation", "determine limitation"],
    ["I want a new skill to determine limitation", "determine limitation"],
    ["I want a skill for limitation review", "limitation review"],
    ["I want a new skil for limitation review", "limitation review"],
    ["can we make a skill for filing bundles", "filing bundles"],
    ["create a new skil for checking if limitatation is for or against the client", "checking if limitatation is for or against the client"],
  ];
  for (const [input, idea] of cases) {
    assert.deepEqual(parseSkillIdeaInput(input), {
      type: "skill_idea",
      text: input,
      idea,
    });
  }
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

test("command box opens deterministic skill idea interview session without running skills or router check", async () => {
  const calls = [];
  const interactionLogs = [];
  let copied = "";
  const savedIdeas = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "create a new skill for checking if limitation is for or against the client" });
  ctx.elements.editorContent.innerHTML = "<h1>Existing matter overview</h1>";
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called for explicit skill ideas");
    },
    logCommandInteraction: async (body) => interactionLogs.push(body),
    writeClipboardText: async (text) => {
      copied = text;
    },
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

  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.deepEqual(savedIdeas, []);
  assert.deepEqual(calls, []);
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What I understood/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Not runnable yet|Temporary browser-memory session/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Existing matter overview</h1>");
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Idea Interview");
  assert.equal(interactionLogs.length, 1);
  assert.equal(interactionLogs[0].matched_command, "skill_idea/interview");
  assert.equal(interactionLogs[0].rendered_state, "skill_idea/interview");
  assert.equal(interactionLogs[0].status, "opened_interview");
  assert.equal(interactionLogs[0].provider_run_invoked, false);
  await box.copyLatestReport();
  assert.match(copied, /- Matched command: `skill_idea\/interview`/);
});

test("command interaction logging failure does not block command behavior", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "create a skill to summarize pleadings" });
  const box = createAiCommandBox(ctx, {
    logCommandInteraction: () => {
      throw new Error("local log unavailable");
    },
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called for explicit skill ideas");
    },
  });

  box.wire();
  await form.submit();

  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What I understood/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Idea Interview");
});

test("command box catches typo skill idea phrasing before router check", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "create a new skil for checking if limitatation is for or against the client" });
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called for explicit skill ideas");
    },
  });

  box.wire();
  await form.submit();

  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What I understood/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  assert.doesNotMatch(ctx.elements.editorContent.innerHTML, /Router decision/);
});

test("command box starts skill idea interview for create-new-skill-that without active matter", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "create a new skill that does one job - checks if the issue is within or outside of limitation",
    activeMatter: null,
  });
  ctx.elements.editorContent.innerHTML = "<h1>Landing</h1>";
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called for explicit skill ideas");
    },
  });

  box.wire();
  await form.submit();

  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What I understood/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1 of/);
  assert.doesNotMatch(ctx.elements.editorContent.innerHTML, /Router decision/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Landing</h1>");
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Idea Interview");
});

test("command box starts limitation interview for i-want-a-skill phrasing", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "i want a skill that determines the limitation of the matter",
  });
  ctx.elements.editorContent.innerHTML = "<h1>Existing matter overview</h1>";
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called for explicit skill ideas");
    },
  });

  box.wire();
  await form.submit();

  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What I understood/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /limitation review skill/i);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Whose limitation position should the skill assess/i);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /both sides from client perspective/i);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Special-statute rule/i);
  assert.doesNotMatch(ctx.elements.editorContent.innerHTML, /Router decision/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Existing matter overview</h1>");
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Idea Interview");
});

test("command box starts weakness review interview with client-risk questions", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "create a skill to find weaknesses and opponent arguments from the client perspective",
  });
  ctx.elements.editorContent.innerHTML = "<h1>Existing matter overview</h1>";
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called for explicit skill ideas");
    },
  });

  box.wire();
  await form.submit();

  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What I understood/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /weakness review skill/i);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What type of weaknesses should it focus on/i);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /procedural\/legal risks/);
  assert.doesNotMatch(ctx.elements.editorContent.innerHTML, /Router decision/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Existing matter overview</h1>");
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Idea Interview");
});

test("command box renders router fallback inside the rail without replacing the central pane", async () => {
  const interactionLogs = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "please evaluate whether this overlaps a skill" });
  ctx.elements.editorContent.innerHTML = "<h1>Existing matter overview</h1>";
  const box = createAiCommandBox(ctx, {
    logCommandInteraction: async (body) => interactionLogs.push(body),
    checkSkillIntent: async (body) => {
      assert.equal(body.userRequest, "please evaluate whether this overlaps a skill");
      return {
        decision: "modification_candidate",
        recommended_action: "Review existing skill before adding anything new.",
        matched_skill: "/create_listofdates",
        confidence: 0.72,
        reason: "The request sounds close to chronology output.",
        suggested_next_action: "Clarify whether this changes an existing skill.",
        user_gate_required: true,
      };
    },
  });

  box.wire();
  await form.submit();

  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Existing matter overview</h1>");
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Router\/check result/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /modification_candidate/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /\/create_listofdates/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /72%/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Open full result/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Approve modification/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Router Ready");
  assert.equal(interactionLogs.length, 1);
  assert.equal(interactionLogs[0].matched_command, "router/check");
  assert.equal(interactionLogs[0].rendered_state, "router/check");
  assert.equal(interactionLogs[0].status, "router_checked");
  assert.equal(interactionLogs[0].router_decision.matched_skill, "/create_listofdates");
  assert.equal(interactionLogs[0].provider_run_invoked, true);
});

test("command box skill idea interview session saves answers into a design brief", async () => {
  const calls = [];
  const interactionLogs = [];
  const savedIdeas = [];
  const statusUpdates = [];
  const designBriefUpdates = [];
  let copied = "";
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "make a new skill that summarises the best case pleadings for the lawyer" });
  const box = createAiCommandBox(ctx, {
    logCommandInteraction: async (body) => interactionLogs.push(body),
    loadSkillRegistry: async () => ({
      skills: [],
    }),
    saveSkillIdea: async (body) => {
      savedIdeas.push(body);
      return {
        idea: {
          id: "idea_session_1",
          text: body.text,
          createdAt: "2026-05-12T10:00:00.000Z",
          status: "incomplete",
          designBrief: body.designBrief,
          readiness: completeReadiness(),
          matter: {
            matterName: "Demo Matter",
            folderName: "Demo Matter",
          },
        },
      };
    },
    updateSkillIdeaDesignBrief: async (id, designBrief) => {
      designBriefUpdates.push({ id, designBrief });
      return {
        idea: {
          id,
          text: savedIdeas[0].text,
          createdAt: "2026-05-12T10:00:00.000Z",
          status: "ready_for_review",
          designBrief,
          readiness: completeReadiness(),
          matter: {
            matterName: "Demo Matter",
            folderName: "Demo Matter",
          },
        },
      };
    },
    updateSkillIdeaStatus: async (id, status) => {
      statusUpdates.push({ id, status });
      return {
        idea: {
          id,
          text: savedIdeas[0].text,
          createdAt: "2026-05-12T10:00:00.000Z",
          status,
          designBrief: savedIdeas[0].designBrief,
          readiness: completeReadiness(),
          matter: {
            matterName: "Demo Matter",
            folderName: "Demo Matter",
          },
        },
      };
    },
    writeClipboardText: async (text) => {
      copied = text;
    },
    skillDispatch: {
      "/create_listofdates": async (command) => calls.push(command),
    },
  });

  box.wire();
  await form.submit();
  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  await box.handleCommand({ userRequest: "Every point needs source labels and FILE citations." });
  assert.equal(interactionLogs.at(-1).status, "question_answered");
  assert.equal(interactionLogs.at(-1).rendered_state, "skill_idea/question");
  assert.equal(interactionLogs.at(-1).typed_input, "Every point needs source labels and FILE citations.");
  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 2 of 3/);
  await box.handleCommand({ userRequest: "Whole matter pleadings only." });
  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 3 of 3/);
  await box.handleCommand({ userRequest: "Use lawyer-facing language but avoid final conclusions." });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Ready to save this skill idea/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Save idea/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Edit answers/);
  assert.deepEqual(savedIdeas, []);

  await box.handleCommand({ userRequest: "save idea" });

  assert.deepEqual(calls, []);
  assert.equal(savedIdeas.length, 1);
  assert.equal(interactionLogs.at(-1).status, "saved_idea");
  assert.equal(interactionLogs.at(-1).skill_idea_id, "idea_session_1");
  assert.equal(interactionLogs.at(-1).provider_run_invoked, false);
  assert.equal(savedIdeas[0].text, "make a new skill that summarises the best case pleadings for the lawyer");
  assert.equal(savedIdeas[0].designBrief.expectedOutputArtifact, "20_Workshop/Pleadings Summary.md");
  assert.match(savedIdeas[0].designBrief.notes, /Every point needs source labels and FILE citations/);
  assert.match(savedIdeas[0].designBrief.notes, /Whole matter pleadings only/);
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Saved skill idea/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Incomplete - ready to mark for review/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Copy Review Packet/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Mark ready for review/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Open in Skills/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Start another idea/);

  await box.handleCommand({ userRequest: "copy review packet" });
  assert.match(copied, /^# Skill Idea Review Packet/);
  assert.match(copied, /- Status: Incomplete - ready to mark for review/);
  assert.match(copied, /This is not a runnable skill/);
  assert.doesNotMatch(copied, /API_KEY|\.env|source document text/i);

  await box.handleCommand({ userRequest: "mark ready for review" });
  assert.deepEqual(statusUpdates, [{ id: "idea_session_1", status: "ready_for_review" }]);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Status<\/dt><dd>Ready for review/);

  await box.handleCommand({ userRequest: "edit answers" });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  await box.handleCommand({ userRequest: "Use exhibit labels and raw citations." });
  assert.equal(ctx.elements.aiCommandInput.value, "");
  await box.handleCommand({ userRequest: "Whole matter pleadings only." });
  assert.equal(ctx.elements.aiCommandInput.value, "");
  await box.handleCommand({ userRequest: "Civil litigation review." });
  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Ready to save updates/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Save updates/);
  await box.handleCommand({ userRequest: "save updates" });
  assert.equal(savedIdeas.length, 1);
  assert.equal(designBriefUpdates.length, 1);
  assert.equal(designBriefUpdates[0].id, "idea_session_1");
  assert.match(designBriefUpdates[0].designBrief.notes, /Use exhibit labels and raw citations/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Saved skill idea/);
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Likely related skill/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /\/create_listofdates/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What should change/);
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

function completeReadiness() {
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
