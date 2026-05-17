import assert from "node:assert/strict";
import test from "node:test";
import { createAiCommandBox } from "../frontend/ai-command-box.js";
import {
  completeReadiness,
  fakeCtx,
  fakeForm,
  noSkillOverlapDecision,
} from "../test-support/ai-command-box-helpers.mjs";

// Skill idea interview, sample-review, and activation flows.

test("command box skips generic questions when a detailed skill specification is supplied", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "new skill" });
  ctx.elements.editorContent.innerHTML = "<h1>Existing matter overview</h1>";
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called during new skill mode");
    },
    planSkillIdeaInterviewProvider: async () => {
      throw new Error("planner unavailable");
    },
  });

  box.wire();
  await form.submit();
  ctx.elements.aiCommandInput.value = "You are a Limitation Law Expert. For any given case, fact situation, or cause of action, strictly check the limitation period under the Limitation Act, 1963. Steps: Identify the exact Article(s) applicable. State the prescribed limitation period. Calculate when the limitation starts. Check if the suit or application is within time or barred. Mention extensions, exclusions, or savings under Sections 5, 6, 12-15, 18-20. Give a clear final answer: Within time or Barred by limitation with brief reasoning.";
  await form.submit();

  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.equal(ctx.elements.aiCommandSubmit.textContent, "→");
  assert.equal(ctx.elements.aiCommandInput.placeholder, "Generate sample, Edit answers, or Cancel");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Ready to generate a sample output/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Generate sample from this matter/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /No follow-up questions were needed/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Save idea/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /What source or citation discipline should it follow/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Existing matter overview</h1>");
  assert.equal(ctx.statusCalls.at(-1).bar, "Ready for Sample");
});

test("command box reports deterministic fallback when model planner is unavailable", async () => {
  let copied = "";
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "new skill" });
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called during new skill mode");
    },
    writeClipboardText: async (text) => {
      copied = text;
    },
    planSkillIdeaInterviewProvider: async () => ({
      __plannerMeta: {
        enabled: false,
        used: false,
        fallback: "deterministic_fallback",
        reason: "OPENROUTER_SKILL_INTERVIEW_PLANNER_MODEL is not configured",
      },
    }),
  });

  box.wire();
  await form.submit();
  ctx.elements.aiCommandInput.value = "it should read the list of dates and draft a warm client email";
  await form.submit();

  assert.match(ctx.elements.aiCommandSession.innerHTML, /Planner: deterministic fallback/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Fallback reason: OPENROUTER_SKILL_INTERVIEW_PLANNER_MODEL is not configured/);
  assert.match(String(ctx.statusCalls.at(-1).terminal), /planner fallback: OPENROUTER_SKILL_INTERVIEW_PLANNER_MODEL is not configured/);
  await box.copyLatestReport();
  assert.match(copied, /- Planner: deterministic fallback/);
  assert.match(copied, /- Planner fallback reason: OPENROUTER_SKILL_INTERVIEW_PLANNER_MODEL is not configured/);
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Planner: deterministic/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Not runnable yet|Temporary browser-memory session/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Existing matter overview</h1>");
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Idea Interview");
  assert.equal(interactionLogs.length, 1);
  assert.equal(interactionLogs[0].matched_command, "skill_idea/interview");
  assert.equal(interactionLogs[0].rendered_state, "skill_idea/interview");
  assert.equal(interactionLogs[0].status, "opened_interview");
  assert.equal(interactionLogs[0].provider_run_invoked, false);
  assert.equal(interactionLogs[0].planner_source, "deterministic");
  await box.copyLatestReport();
  assert.match(copied, /- Matched command: `skill_idea\/interview`/);
  assert.match(copied, /- Planner: deterministic/);
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Idea Interview");
});

test("command box enters explicit new skill mode without router check", async () => {
  const interactionLogs = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "new skill" });
  ctx.elements.editorContent.innerHTML = "<h1>Existing matter overview</h1>";
  const box = createAiCommandBox(ctx, {
    logCommandInteraction: async (body) => interactionLogs.push(body),
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called when entering new skill mode");
    },
  });

  box.wire();
  await form.submit();

  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.equal(ctx.elements.aiCommandInput.placeholder, "Describe the skill you want...");
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /New skill idea/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Describe the skill you want in your own words/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /It will not generate code, prompts, or run a provider-backed skill/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Existing matter overview</h1>");
  assert.equal(ctx.statusCalls.at(-1).bar, "New Skill Idea");
  assert.equal(interactionLogs.length, 1);
  assert.equal(interactionLogs[0].matched_command, "skill_idea/new");
  assert.equal(interactionLogs[0].status, "awaiting_skill_idea");
  assert.equal(interactionLogs[0].provider_run_invoked, false);
});

test("command box treats freeform text as a skill idea after new skill mode", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "new skill" });
  ctx.elements.editorContent.innerHTML = "<h1>Existing matter overview</h1>";
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called during new skill mode");
    },
  });

  box.wire();
  await form.submit();
  ctx.elements.aiCommandInput.value = "it should read the list of dates and draft a warm client email saying we have reviewed the matter and further work is happening";
  await form.submit();

  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What I understood/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of \d+/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /\/create_listofdates/);
  assert.doesNotMatch(ctx.elements.editorContent.innerHTML, /Router decision/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Existing matter overview</h1>");
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Idea Interview");
});

test("command box asks for a matter before sample generation from ready state", async () => {
  const savedIdeas = [];
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "new skill",
    activeMatter: null,
  });
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called during new skill mode");
    },
    saveSkillIdea: async (body) => {
      savedIdeas.push(body);
      return { idea: { id: "idea_no_matter", ...body } };
    },
  });

  box.wire();
  await form.submit();
  ctx.elements.aiCommandInput.value = "You are a Limitation Law Expert. Steps: Identify exact Articles, state the limitation period, calculate when limitation starts from cause of action or knowledge, check within time or barred, mention Sections 5, 6, 12-15, 18-20, and give a clear final answer.";
  await form.submit();

  assert.match(ctx.elements.aiCommandSession.innerHTML, /Ready to generate a sample output/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Pick matter to test this skill/);
  assert.deepEqual(savedIdeas, []);

  await box.handleCommand({ userRequest: "generate sample" });

  assert.deepEqual(savedIdeas, []);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Pick a test matter before generating sample output/);
  assert.equal(ctx.statusCalls.at(-1).bar, "No Test Matter");
});

test("command box uses model-planned interview only after explicit new skill mode", async () => {
  const plannerCalls = [];
  let copied = "";
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "new skill" });
  ctx.elements.editorContent.innerHTML = "<h1>Existing matter overview</h1>";
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called during new skill mode");
    },
    writeClipboardText: async (text) => {
      copied = text;
    },
    planSkillIdeaInterviewProvider: async (body) => {
      plannerCalls.push(body);
      return {
        mode: "new_skill",
        target_skill: "Draft Warm Client Update Email from List of Dates",
        understood_summary: "You want a client update email skill that drafts careful, reassuring client communication from reviewed matter artifacts.",
        inferred_design_brief: {
          intendedUser: "Lawyer preparing client communication",
          problem: "Draft a careful client update email after matter review without giving final legal advice too early.",
          expectedInputs: "List of Dates, matter metadata, and lawyer instructions.",
          expectedOutputArtifact: "30_Drafts/Client Update Email.md",
          targetLane: "30_Drafts",
          paidPosture: "paid",
          riskLevel: "high",
          notes: "Client-facing email. Keep raw FILE citations internal unless lawyer asks.",
        },
        default_assumptions: ["Source-backed reasoning remains internal; do not show raw FILE citations in the client email."],
        questions: [
          {
            id: "emailGoal",
            label: "What should the email accomplish?",
            help: "Choose the communication goal before this becomes a skill.",
            examples: ["reassure client", "explain next steps", "request documents"],
          },
          {
            id: "tone",
            label: "What tone should it use?",
            help: "Client-facing tone controls how cautious the draft should be.",
            examples: ["warm", "formal", "concise", "reassuring"],
          },
        ],
        open_questions: [],
        risk_flags: ["External-facing draft requires lawyer review."],
        __plannerMeta: {
          provider: "openrouter",
          model: "openai/gpt-4.1",
          used: true,
        },
      };
    },
  });

  box.wire();
  await form.submit();
  ctx.elements.aiCommandInput.value = "it should read the list of dates and draft a warm client email saying we have reviewed the matter and further work is happening";
  await form.submit();

  assert.equal(plannerCalls.length, 1);
  assert.equal(plannerCalls[0].skillIdea.mode, "new_skill");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /client update email skill/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Planner: openrouter \/ openai\/gpt-4\.1/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What should the email accomplish/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 2/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /What source or citation discipline should it follow/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Likely related skill/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Existing matter overview</h1>");
  assert.match(String(ctx.statusCalls.at(-1).terminal), /model-planned interview opened/);
  await box.copyLatestReport();
  assert.match(copied, /- Planner: openrouter \/ openai\/gpt-4\.1/);
});

test("command box renders model-planned interviews with more than three questions", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "new skill" });
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called during new skill mode");
    },
    planSkillIdeaInterviewProvider: async () => ({
      mode: "new_skill",
      target_skill: "",
      understood_summary: "You want a multi-step client communication skill.",
      inferred_design_brief: {
        intendedUser: "Lawyer",
        problem: "Prepare client communication and document requests.",
        expectedInputs: "Matter context and lawyer instructions.",
        expectedOutputArtifact: "30_Drafts/Client Update Email.md",
        targetLane: "30_Drafts",
        paidPosture: "paid",
        riskLevel: "high",
        notes: "Client-facing draft requires review.",
      },
      default_assumptions: ["Do not expose raw FILE citations in client-facing drafts unless requested."],
      questions: Array.from({ length: 6 }, (_, index) => ({
        id: `q${index + 1}`,
        label: `Question ${index + 1}?`,
        help: `Help ${index + 1}.`,
        examples: [`example ${index + 1}`],
      })),
      open_questions: [],
      risk_flags: ["External-facing draft requires lawyer review."],
      __plannerMeta: {
        provider: "openai-direct",
        model: "gpt-5.4",
        used: true,
      },
    }),
  });

  box.wire();
  await form.submit();
  ctx.elements.aiCommandInput.value = "draft a client update email that also requests missing documents and explains next steps";
  await form.submit();

  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question \d+ of \d+/);
  await box.handleCommand({ userRequest: "Answer one." });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 2/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question \d+ of \d+/);
  await box.handleCommand({ userRequest: "Answer two." });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 3/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question \d+ of \d+/);
  await box.handleCommand({ userRequest: "Answer three." });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 4/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question \d+ of \d+/);
  await box.handleCommand({ userRequest: "Answer four." });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 5/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question \d+ of \d+/);
  await box.handleCommand({ userRequest: "Answer five." });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 6/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question \d+ of \d+/);
});

test("command box cancels explicit new skill mode without saving", async () => {
  const savedIdeas = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "new skill" });
  const box = createAiCommandBox(ctx, {
    saveSkillIdea: async (body) => {
      savedIdeas.push(body);
      return { idea: body };
    },
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called during new skill mode");
    },
  });

  box.wire();
  await form.submit();
  ctx.elements.aiCommandInput.value = "cancel";
  await form.submit();

  assert.deepEqual(savedIdeas, []);
  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.equal(ctx.elements.aiCommandInput.placeholder, "Ask about this matter, run a skill, or search documents");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /New skill idea cancelled/);
  assert.equal(ctx.statusCalls.at(-1).bar, "New Skill Cancelled");
});

test("command box new skill mode works without an active matter", async () => {
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "new skill",
    activeMatter: null,
  });
  ctx.elements.editorContent.innerHTML = "<h1>Landing</h1>";
  const box = createAiCommandBox(ctx, {
    checkSkillIntent: async () => {
      throw new Error("router/check should not be called during no-matter new skill mode");
    },
  });

  box.wire();
  await form.submit();
  assert.match(ctx.elements.aiCommandSession.innerHTML, /No active matter/);
  ctx.elements.aiCommandInput.value = "make a limitation checker";
  await form.submit();

  assert.equal(ctx.elements.aiCommandSession.hidden, false);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /limitation review skill/i);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of \d+/);
  assert.doesNotMatch(ctx.elements.editorContent.innerHTML, /Router decision/);
  assert.equal(ctx.elements.editorContent.innerHTML, "<h1>Landing</h1>");
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of \d+/);
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Whose limitation position should it assess/i);
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /This may already be covered/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /\/create_listofdates/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /72%/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Open full result/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Use or improve existing skill/);
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  await box.handleCommand({ userRequest: "Every point needs source labels and FILE citations." });
  assert.equal(interactionLogs.at(-1).status, "question_answered");
  assert.equal(interactionLogs.at(-1).rendered_state, "skill_idea/question");
  assert.equal(interactionLogs.at(-1).typed_input, "Every point needs source labels and FILE citations.");
  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 2/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 2 of 3/);
  await box.handleCommand({ userRequest: "Whole matter pleadings only." });
  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 3/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 3 of 3/);
  await box.handleCommand({ userRequest: "Use lawyer-facing language but avoid final conclusions." });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Ready to generate a sample output/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Generate sample from this matter/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Save idea/);
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Draft complete/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Copy Review Packet/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Mark ready for review/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Open in Skills/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Start another idea/);

  await box.handleCommand({ userRequest: "copy review packet" });
  assert.match(copied, /^# Skill Idea Review Packet/);
  assert.match(copied, /- Status: Draft complete - ready to mark for review/);
  assert.match(copied, /This is not a runnable skill/);
  assert.doesNotMatch(copied, /API_KEY|\.env|source document text/i);

  await box.handleCommand({ userRequest: "mark ready for review" });
  assert.deepEqual(statusUpdates, [{ id: "idea_session_1", status: "ready_for_review" }]);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Status<\/dt><dd>Ready to review/);

  await box.handleCommand({ userRequest: "edit answers" });
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  await box.handleCommand({ userRequest: "Use exhibit labels and raw citations." });
  assert.equal(ctx.elements.aiCommandInput.value, "");
  await box.handleCommand({ userRequest: "Whole matter pleadings only." });
  assert.equal(ctx.elements.aiCommandInput.value, "");
  await box.handleCommand({ userRequest: "Civil litigation review." });
  assert.equal(ctx.elements.aiCommandInput.value, "");
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Ready to generate a sample output/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Generate sample from this matter/);
  await box.handleCommand({ userRequest: "save updates" });
  assert.equal(savedIdeas.length, 1);
  assert.equal(designBriefUpdates.length, 1);
  assert.equal(designBriefUpdates[0].id, "idea_session_1");
  assert.match(designBriefUpdates[0].designBrief.notes, /Use exhibit labels and raw citations/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Saved skill idea/);
});

test("command box generates, revises, copies a sample, and creates a skill when it looks right", async () => {
  const sampleCalls = [];
  const savedIdeas = [];
  const interactionLogs = [];
  const createSkillCalls = [];
  let approvedSampleId = "";
  let copied = "";
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "create a skill to draft a warm client update email" });
  const box = createAiCommandBox(ctx, {
    logCommandInteraction: async (body) => interactionLogs.push(body),
    saveSkillIdea: async (body) => {
      savedIdeas.push(body);
      return {
        idea: {
          id: "idea_sample_1",
          text: body.text,
          createdAt: "2026-05-13T10:00:00.000Z",
          status: "incomplete",
          designBrief: {
            ...body.designBrief,
            expectedOutputArtifact: body.designBrief.expectedOutputArtifact || "30_Drafts/Client Update Email.md",
            targetLane: body.designBrief.targetLane || "30_Drafts",
          },
          readiness: completeReadiness(),
          matter: {
            matterName: "Demo Matter",
            folderName: "Demo Matter",
          },
        },
      };
    },
    generateSkillIdeaSampleOutput: async (body) => {
      sampleCalls.push(body);
      return {
        schema_version: "skill-sample-output/v1",
        sample_id: `sample_${sampleCalls.length}`,
        generated_at: "2026-05-13T10:01:00.000Z",
        matter: {
          matter_name: "Demo Matter",
          folder_name: "Demo Matter",
        },
        idea: body.idea,
        feedback: body.feedback || "",
        sample_markdown: sampleCalls.length === 1
          ? "# Client Update Email\n\nWe reviewed the matter and are continuing work."
          : "# Client Update Email\n\nWe have reviewed the matter and will continue carefully.",
        ai_run: {
          provider: "openai-direct",
          model: "gpt-5.4",
          task: "skill_sample_output",
        },
        warnings: ["Sample output only. Skill creation is not available yet."],
      };
    },
    listSkillIdeaSamples: async (ideaId) => ({
      schema_version: "skill-samples/v1",
      ideaId,
      samples: sampleCalls.map((call, index) => ({
        id: `sample_${index + 1}`,
        ideaId,
        version: index + 1,
        createdAt: `2026-05-13T10:0${index + 1}:00.000Z`,
        approved: approvedSampleId === `sample_${index + 1}`,
        approvedAt: approvedSampleId === `sample_${index + 1}` ? "2026-05-13T10:03:00.000Z" : "",
        state: approvedSampleId === `sample_${index + 1}` ? "approved_current" : "current",
        matter: {
          matter_name: "Demo Matter",
          folder_name: "Demo Matter",
        },
        sampleMarkdown: index === 0
          ? "# Client Update Email\n\nWe reviewed the matter and are continuing work."
          : "# Client Update Email\n\nWe have reviewed the matter and will continue carefully.",
        feedback: call.feedback || "",
        aiRun: {
          provider: "openai-direct",
          model: "gpt-5.4",
          task: "skill_sample_output",
        },
      })),
    }),
    approveSkillIdeaSample: async (ideaId, sampleId) => {
      approvedSampleId = sampleId;
      return {
        sample: {
          id: sampleId,
          ideaId,
          approved: true,
          approvedAt: "2026-05-13T10:02:00.000Z",
        },
      };
    },
    checkSkillIntent: noSkillOverlapDecision,
    createSkillFromIdea: async (ideaId) => {
      createSkillCalls.push(ideaId);
      return {
        skill: {
          id: "skill_client_update",
          title: "Client Update Email",
          slash: "/client_update_email",
          status: "active",
          version: 1,
          targetLane: "30_Drafts",
          outputArtifact: "30_Drafts/Client Update Email.md",
          modelPolicy: {
            provider: "openai-direct",
            model: "gpt-5.4",
          },
        },
      };
    },
    writeClipboardText: async (text) => {
      copied = text;
    },
  });

  box.wire();
  await form.submit();
  await box.handleCommand({ userRequest: "Reassure client and mention next steps." });
  await box.handleCommand({ userRequest: "Warm, formal, and cautious." });
  await box.handleCommand({ userRequest: "Status and next steps only." });

  assert.deepEqual(savedIdeas, []);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Ready to generate a sample output/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Generate sample from this matter/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Save idea/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Skill Ready|Use \//);

  await box.handleCommand({ userRequest: "generate sample" });

  assert.equal(savedIdeas.length, 1);
  assert.equal(sampleCalls.length, 1);
  assert.equal(sampleCalls[0].idea.id, "idea_sample_1");
  assert.equal(sampleCalls[0].feedback, "");
  assert.match(ctx.elements.editorContent.innerHTML, /Sample Output/);
  assert.match(ctx.elements.editorContent.innerHTML, /Client Update Email/);
  assert.match(ctx.elements.editorContent.innerHTML, /This did not create a runnable skill/);
  assert.match(ctx.elements.editorContent.innerHTML, /Sample Ledger/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Sample v1 ready for review/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Sample Ledger/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Sample v1/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /openai-direct \/ gpt-5\.4/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Looks useful/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Sample warnings/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Skill creation is not available yet/);
  assert.equal(interactionLogs.at(-1).status, "sample_generated");
  assert.equal(interactionLogs.at(-1).provider_run_invoked, true);

  await box.handleCommand({ userRequest: "Make it more cautious." });

  assert.equal(sampleCalls.length, 2);
  assert.equal(sampleCalls[1].feedback, "Make it more cautious.");
  assert.match(sampleCalls[1].previousSample, /continuing work/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Sample v2 ready for review/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Sample v1/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Feedback<\/dt><dd>Make it more cautious\./);

  await box.handleCommand({ userRequest: "copy sample" });

  assert.match(copied, /^# Skill Sample Output/);
  assert.match(copied, /Awaiting review/);
  assert.match(copied, /This is not a runnable skill/);
  assert.doesNotMatch(copied, /API_KEY|\.env|full extraction records/i);

  await box.handleCommand({ userRequest: "copy sample v1" });
  assert.match(copied, /- Sample: v1/);
  assert.match(copied, /Ledger state: Current/);
  assert.doesNotMatch(copied, /API_KEY|\.env|full extraction records/i);

  await box.handleCommand({ userRequest: "looks right" });

  assert.deepEqual(createSkillCalls, ["idea_sample_1"]);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Skill Ready/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /\/client_update_email/);
  assert.match(ctx.elements.editorContent.innerHTML, /You can use this skill by typing/);
  assert.equal(interactionLogs.at(-3).status, "sample_approved");
  assert.equal(interactionLogs.at(-3).provider_run_invoked, false);
  assert.equal(interactionLogs.at(-2).status, "overlap_checked");
  assert.equal(interactionLogs.at(-2).provider_run_invoked, true);
  assert.equal(interactionLogs.at(-1).status, "skill_created");
  assert.equal(interactionLogs.at(-1).provider_run_invoked, true);
});

test("command box creates a runnable skill only after current sample approval", async () => {
  const sampleCalls = [];
  const createSkillCalls = [];
  const runCalls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "create a skill to map parties and officers" });
  const box = createAiCommandBox(ctx, {
    loadSkillRegistry: async () => ({
      skills: [{
        configurable: true,
        status: "active",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        purpose: "Map formal party names and officers.",
      }],
    }),
    saveSkillIdea: async (body) => ({
      idea: {
        id: "idea_party_map",
        text: body.text,
        createdAt: "2026-05-13T10:00:00.000Z",
        status: "incomplete",
        designBrief: {
          ...body.designBrief,
          expectedOutputArtifact: "20_Workshop/Party and Officer Map.md",
          targetLane: "20_Workshop",
        },
        readiness: completeReadiness(),
        matter: {
          matterName: "Demo Matter",
          folderName: "Demo Matter",
        },
      },
    }),
    generateSkillIdeaSampleOutput: async (body) => {
      sampleCalls.push(body);
      return {
        schema_version: "skill-sample-output/v1",
        sample_id: "sample_party_1",
        generated_at: "2026-05-13T10:01:00.000Z",
        matter: {
          matter_name: "Demo Matter",
          folder_name: "Demo Matter",
        },
        idea: body.idea,
        feedback: "",
        sample_markdown: "# Party and Officer Map\n\nA party row cites FILE-0001 p1.b1.",
        ai_run: {
          provider: "openai-direct",
          model: "gpt-5.4",
          task: "skill_sample_output",
        },
        warnings: [],
      };
    },
    approveSkillIdeaSample: async (ideaId, sampleId) => ({
      sample: {
        id: sampleId,
        ideaId,
        approved: true,
        approvedAt: "2026-05-13T10:02:00.000Z",
      },
    }),
    checkSkillIntent: noSkillOverlapDecision,
    createSkillFromIdea: async (ideaId) => {
      createSkillCalls.push(ideaId);
      return {
        skill: {
          id: "skill_party",
          title: "Party and Officer Map",
          slash: "/party_officer_map",
          status: "active",
          version: 1,
          targetLane: "20_Workshop",
          outputArtifact: "20_Workshop/Party and Officer Map.md",
          modelPolicy: {
            provider: "openai-direct",
            model: "gpt-5.4",
          },
        },
      };
    },
    runConfigurableSkill: async (body) => {
      runCalls.push(body);
      return {
        schema_version: "configurable-skill-run/v1",
        state: "written",
        skill: {
          slash: "/party_officer_map",
          title: "Party and Officer Map",
          version: 1,
        },
        markdown: "# Party and Officer Map\n\nA party row cites FILE-0001 p1.b1.",
        outputPaths: {
          markdown: "20_Workshop/Party and Officer Map.md",
          json: "20_Workshop/Party and Officer Map.json",
        },
        aiRun: {
          provider: "openai-direct",
          model: "gpt-5.4",
        },
        runId: "run_party_1",
        runRecord: {
          id: "run_party_1",
          slash: "/party_officer_map",
          title: "Party and Officer Map",
          version: 1,
          status: "succeeded",
          matterName: "Demo Matter",
          matterFolder: "Demo Matter",
          startedAt: "2026-05-13T10:03:00.000Z",
          finishedAt: "2026-05-13T10:04:00.000Z",
          outputPaths: {
            markdown: "20_Workshop/Party and Officer Map.md",
            json: "20_Workshop/Party and Officer Map.json",
          },
          aiRun: {
            provider: "openai-direct",
            model: "gpt-5.4",
          },
          overwrite: "not_needed",
        },
      };
    },
  });

  box.wire();
  await form.submit();
  await box.handleCommand({ userRequest: "Formal party names, officers, aliases." });
  await box.handleCommand({ userRequest: "Issue-wise internal table." });
  await box.handleCommand({ userRequest: "Use source citations for each factual entry." });
  await box.handleCommand({ userRequest: "generate sample" });

  assert.equal(createSkillCalls.length, 0);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /data-skill-interview-action="create-skill"/);

  await box.handleCommand({ userRequest: "looks right" });

  assert.deepEqual(createSkillCalls, ["idea_party_map"]);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Skill Ready/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /\/party_officer_map/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Sample Ledger|Looks useful|Try creating skill/);
  assert.match(ctx.elements.editorContent.innerHTML, /You can use this skill by typing/);
  assert.match(ctx.elements.editorContent.innerHTML, /\/party_officer_map/);
  assert.equal(ctx.elements.aiCommandInput.placeholder, "Type /party_officer_map to run it, or another action");
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Ready");

  ctx.elements.aiCommandInput.value = "/party_officer_map";
  await form.submit();

  assert.deepEqual(runCalls, [{ slash: "/party_officer_map", overwrite: false }]);
  assert.match(ctx.elements.editorContent.innerHTML, /Party and Officer Map/);
  assert.match(ctx.elements.editorContent.innerHTML, /Party and Officer Map v1/);
  assert.match(ctx.elements.editorContent.innerHTML, /run_party_1/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Run complete/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Party and Officer Map v1/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Looks good/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Improve this skill/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Run again/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Open output/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Copy Run Report/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Skill Complete");

  await box.handleCommand({ userRequest: "looks good" });

  assert.deepEqual(runCalls, [{ slash: "/party_officer_map", overwrite: false }]);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Marked as good for this run/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Run Accepted");
});

test("command box lets a freeform distinct justification override a repeated overlap gate", async () => {
  const sampleCalls = [];
  const createSkillCalls = [];
  const routerCalls = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "create a skill to build a case chronology from extracted records" });
  const box = createAiCommandBox(ctx, {
    saveSkillIdea: async (body) => ({
      idea: {
        id: "idea_chronology_duplicate",
        text: body.text,
        createdAt: "2026-05-14T10:00:00.000Z",
        status: "incomplete",
        designBrief: {
          ...body.designBrief,
          expectedOutputArtifact: "10_Library/List of Dates.md",
          targetLane: "10_Library",
        },
        readiness: completeReadiness(),
        matter: {
          matterName: "Demo Matter",
          folderName: "Demo Matter",
        },
      },
    }),
    generateSkillIdeaSampleOutput: async (body) => {
      sampleCalls.push(body);
      return {
        schema_version: "skill-sample-output/v1",
        sample_id: "sample_chrono_1",
        generated_at: "2026-05-14T10:01:00.000Z",
        matter: {
          matter_name: "Demo Matter",
          folder_name: "Demo Matter",
        },
        idea: body.idea,
        feedback: "",
        sample_markdown: "# Chronology\n\nA dated row cites FILE-0001 p1.b1.",
        ai_run: {
          provider: "openai-direct",
          model: "gpt-5.4",
          task: "skill_sample_output",
        },
        warnings: [],
      };
    },
    approveSkillIdeaSample: async (ideaId, sampleId) => ({
      sample: {
        id: sampleId,
        ideaId,
        approved: true,
        approvedAt: "2026-05-14T10:02:00.000Z",
      },
    }),
    checkSkillIntent: async (body) => {
      routerCalls.push(body);
      return {
        decision: "needs_user_approval",
        recommended_action: "modify_existing_skill",
        matched_skill: "/create_listofdates",
        confidence: 0.97,
        reason: "This chronology request overlaps with the existing list-of-dates skill.",
        suggested_next_action: "Improve /create_listofdates instead of creating another chronology skill.",
        user_gate_required: true,
        mece_violation: true,
      };
    },
    createSkillFromIdea: async (ideaId, body = {}) => {
      createSkillCalls.push({ ideaId, body });
      return {
        skill: {
          id: "skill_distinct_chrono",
          title: "Distinct Chronology Review",
          slash: "/distinct_chronology_review",
          status: "active",
          version: 1,
          targetLane: "20_Workshop",
          outputArtifact: "20_Workshop/Distinct Chronology Review.md",
          modelPolicy: {
            provider: "openai-direct",
            model: "gpt-5.4",
          },
        },
      };
    },
  });

  box.wire();
  await form.submit();
  await box.handleCommand({ userRequest: "Chronology from extraction records." });
  await box.handleCommand({ userRequest: "Timeline table." });
  await box.handleCommand({ userRequest: "Use source citations." });
  await box.handleCommand({ userRequest: "generate sample" });
  await box.handleCommand({ userRequest: "looks right" });

  assert.equal(sampleCalls.length, 1);
  assert.deepEqual(createSkillCalls, []);
  assert.equal(routerCalls.length, 1);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /This may already be covered/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Create separate skill anyway/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /\/create_listofdates/);
  assert.equal(ctx.statusCalls.at(-1).bar, "Review Existing Skill");

  await box.handleCommand({ userRequest: "this produces a workshop issue review, not the library chronology artifact" });

  assert.equal(routerCalls.length, 2);
  assert.equal(routerCalls[1].overrideJustification, "this produces a workshop issue review, not the library chronology artifact");
  assert.deepEqual(createSkillCalls, [{
    ideaId: "idea_chronology_duplicate",
    body: {
      overlapOverrideJustification: "this produces a workshop issue review, not the library chronology artifact",
    },
  }]);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Skill Ready/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /\/distinct_chronology_review/);
});

test("command box invalidates generated sample after design brief edits", async () => {
  const sampleCalls = [];
  const savedIdeas = [];
  const designBriefUpdates = [];
  const form = fakeForm();
  const ctx = fakeCtx({ form, inputValue: "create a skill to draft a warm client update email" });
  const box = createAiCommandBox(ctx, {
    saveSkillIdea: async (body) => {
      savedIdeas.push(body);
      return {
        idea: {
          id: "idea_stale_sample",
          text: body.text,
          createdAt: "2026-05-13T10:00:00.000Z",
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
          createdAt: "2026-05-13T10:00:00.000Z",
          status: "incomplete",
          designBrief,
          readiness: completeReadiness(),
          matter: {
            matterName: "Demo Matter",
            folderName: "Demo Matter",
          },
        },
      };
    },
    generateSkillIdeaSampleOutput: async (body) => {
      sampleCalls.push(body);
      return {
        schema_version: "skill-sample-output/v1",
        sample_id: `sample_${sampleCalls.length}`,
        generated_at: "2026-05-13T10:01:00.000Z",
        matter: {
          matter_name: "Demo Matter",
          folder_name: "Demo Matter",
        },
        idea: body.idea,
        feedback: body.feedback || "",
        sample_markdown: `# Client Update Email\n\nSample version ${sampleCalls.length}.`,
        ai_run: {
          provider: "openai-direct",
          model: "gpt-5.4",
          task: "skill_sample_output",
        },
        warnings: [],
      };
    },
    writeClipboardText: async () => {},
  });

  box.wire();
  await form.submit();
  await box.handleCommand({ userRequest: "Reassure client and mention next steps." });
  await box.handleCommand({ userRequest: "Warm, formal, and cautious." });
  await box.handleCommand({ userRequest: "Status and next steps only." });
  await box.handleCommand({ userRequest: "generate sample" });

  await box.handleCommand({ userRequest: "edit answers" });
  await box.handleCommand({ userRequest: "Reassure client, mention next steps, and request missing documents." });
  await box.handleCommand({ userRequest: "Warm but more formal." });
  await box.handleCommand({ userRequest: "Status, next steps, and document request." });
  await box.handleCommand({ userRequest: "save updates" });

  assert.equal(designBriefUpdates.length, 1);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Design brief changed after this sample was generated/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Stale/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Skill Ready/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /data-skill-interview-action="approve-sample" disabled/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /data-skill-interview-action="create-skill"/);

  await box.handleCommand({ userRequest: "looks right" });

  assert.match(ctx.elements.aiCommandSession.innerHTML, /Regenerate the sample after the design brief changes before approving it/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Skill Ready/);

  await box.handleCommand({ userRequest: "regenerate sample" });
  assert.equal(sampleCalls.length, 2);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Sample v2 ready for review/);
});

test("command box keeps sample review attributed to generated matter after matter switch", async () => {
  const activeMatter = {
    folderName: "Matter A Folder",
    metadata: { matterName: "Matter A Legal" },
  };
  const form = fakeForm();
  const ctx = fakeCtx({
    form,
    inputValue: "create a skill to draft a warm client update email",
    activeMatter,
  });
  const box = createAiCommandBox(ctx, {
    saveSkillIdea: async (body) => ({
      idea: {
        id: "idea_matter_switch",
        text: body.text,
        createdAt: "2026-05-13T10:00:00.000Z",
        status: "incomplete",
        designBrief: body.designBrief,
        readiness: completeReadiness(),
        matter: {
          matterName: "Matter A Legal",
          folderName: "Matter A Folder",
        },
      },
    }),
    generateSkillIdeaSampleOutput: async (body) => ({
      schema_version: "skill-sample-output/v1",
      sample_id: "sample_matter_a",
      generated_at: "2026-05-13T10:01:00.000Z",
      matter: {
        matter_name: "Matter A Legal",
        folder_name: "Matter A Folder",
      },
      idea: body.idea,
      feedback: body.feedback || "",
      sample_markdown: "# Client Update Email\n\nSample for Matter A.",
      ai_run: {
        provider: "openai-direct",
        model: "gpt-5.4",
        task: "skill_sample_output",
      },
      warnings: [],
    }),
    approveSkillIdeaSample: async (ideaId, sampleId) => ({
      sample: {
        id: sampleId,
        ideaId,
        approved: true,
        approvedAt: "2026-05-13T10:02:00.000Z",
      },
    }),
  });

  box.wire();
  await form.submit();
  await box.handleCommand({ userRequest: "Reassure client and mention next steps." });
  await box.handleCommand({ userRequest: "Warm, formal, and cautious." });
  await box.handleCommand({ userRequest: "Status and next steps only." });
  await box.handleCommand({ userRequest: "generate sample" });

  activeMatter.folderName = "Matter B Folder";
  activeMatter.metadata.matterName = "Matter B Legal";
  await box.handleCommand({ userRequest: "copy sample" });

  assert.match(ctx.elements.aiCommandSession.innerHTML, /Matter A Legal/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Matter A Folder/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Matter B Legal/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Matter B Folder/);
  assert.match(ctx.elements.editorContent.innerHTML, /Matter A Legal/);
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
  assert.match(ctx.elements.aiCommandSession.innerHTML, /Question 1/);
  assert.doesNotMatch(ctx.elements.aiCommandSession.innerHTML, /Question 1 of 3/);
  assert.match(ctx.elements.aiCommandSession.innerHTML, /What should change/);
});
