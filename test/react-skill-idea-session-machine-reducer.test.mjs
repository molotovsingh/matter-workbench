import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const skillIdeaSessionMachinePath = new URL("../react-ui/src/lib/skillIdeaSessionMachine.ts", import.meta.url);

async function loadSkillIdeaSessionMachine() {
  const source = await readFile(skillIdeaSessionMachinePath, "utf8");
  const skillSampleStatesUrl = dataModuleUrl(`
    export const SKILL_SAMPLE_STATE = {
      CURRENT: 'current',
      STALE: 'stale',
      APPROVED_CURRENT: 'approved_current',
      APPROVED_STALE: 'approved_stale',
    };
  `);
  const skillIdeaSessionUrl = dataModuleUrl(`
    export const SKILL_IDEA_KICKOFF_QUESTIONS = [{
      id: 'problem',
      label: 'What is the exact skill idea in one sentence?',
      examples: ['review limitation risk for a consumer complaint'],
    }];
    export const SKILL_IDEA_NAME_QUESTION = {
      id: 'skillName',
      label: 'What would you like to name this skill?',
      examples: ['Limitation Risk Review'],
    };
  `);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
    .replace(/from ['"]\.\/skillSampleStates['"]/g, `from '${skillSampleStatesUrl}'`)
    .replace(/from ['"]\.\/skillIdeaSession['"]/g, `from '${skillIdeaSessionUrl}'`);
  return await import(dataModuleUrl(compiled));
}

function dataModuleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

test("skill idea session reducer initializes blank and saved sessions", async () => {
  const { createInitialSkillIdeaSessionState } = await loadSkillIdeaSessionMachine();

  const blankSession = createInitialSkillIdeaSessionState({
    ideaText: "",
    startsWithBlankIdea: true,
    startsFromSavedIdea: false,
    initialIdea: null,
  });
  assert.equal(blankSession.phase, "interviewing");
  assert.deepEqual(blankSession.questions.map((question) => question.id), ["problem", "skillName"]);
  assert.deepEqual(blankSession.answers, {});

  const savedIdea = { id: "idea-123", text: "Limitation review", designBrief: { problem: "review limitation" } };
  const savedSession = createInitialSkillIdeaSessionState({
    ideaText: savedIdea.text,
    startsWithBlankIdea: false,
    startsFromSavedIdea: true,
    initialIdea: savedIdea,
  });
  assert.equal(savedSession.phase, "saved");
  assert.equal(savedSession.savedIdeaId, "idea-123");
  assert.equal(savedSession.savedIdea, savedIdea);
  assert.deepEqual(savedSession.answers, { skillName: "Limitation review" });
  assert.equal(savedSession.designBrief, savedIdea.designBrief);
});

test("skill idea session reducer records answers and reaches ready", async () => {
  const { createInitialSkillIdeaSessionState, reduceSkillIdeaSessionState } = await loadSkillIdeaSessionMachine();
  let session = createInitialSkillIdeaSessionState({
    ideaText: "",
    startsWithBlankIdea: true,
    startsFromSavedIdea: false,
    initialIdea: null,
  });

  session = reduceSkillIdeaSessionState(session, {
    type: "answer_question",
    answer: "review limitation risk for consumer complaints",
  });
  assert.equal(session.phase, "interviewing");
  assert.equal(session.questionIndex, 1);
  assert.equal(session.answers.problem, "review limitation risk for consumer complaints");

  session = reduceSkillIdeaSessionState(session, {
    type: "answer_question",
    answer: "Limitation Risk Review",
  });
  assert.equal(session.phase, "ready");
  assert.equal(session.questionIndex, 2);
  assert.equal(session.answers.skillName, "Limitation Risk Review");
});

test("skill idea session reducer marks saved samples stale when answers change", async () => {
  const { createInitialSkillIdeaSessionState, reduceSkillIdeaSessionState } = await loadSkillIdeaSessionMachine();
  const savedIdea = { id: "idea-123", text: "Limitation review", designBrief: { problem: "review limitation" } };
  const session = {
    ...createInitialSkillIdeaSessionState({
      ideaText: savedIdea.text,
      startsWithBlankIdea: false,
      startsFromSavedIdea: true,
      initialIdea: savedIdea,
    }),
    phase: "interviewing",
    questions: [{ id: "scope", label: "Scope?" }],
    questionIndex: 0,
    answers: {},
    sample: {
      id: "sample-1",
      output: "Sample output",
      approved: true,
      state: "approved_current",
      matterFolder: "matter-a",
    },
    createdSkill: { slash: "/limitation-review" },
    overlapGate: { decision: { decision: "create_new_skill" }, userRequest: "make a skill" },
    overlapJustification: "Separate workflow",
  };

  const updated = reduceSkillIdeaSessionState(session, { type: "answer_question", answer: "Use pleadings only" });

  assert.equal(updated.answers.scope, "Use pleadings only");
  assert.equal(updated.answersDirtySinceSave, true);
  assert.equal(updated.sample.approved, false);
  assert.equal(updated.sample.state, "approved_stale");
  assert.equal(updated.createdSkill, null);
  assert.equal(updated.overlapGate, null);
  assert.equal(updated.overlapJustification, "");
});

test("skill idea session reducer handles action-state transitions", async () => {
  const { createInitialSkillIdeaSessionState, reduceSkillIdeaSessionState } = await loadSkillIdeaSessionMachine();
  const base = {
    ...createInitialSkillIdeaSessionState({
      ideaText: "Draft client update",
      startsWithBlankIdea: false,
      startsFromSavedIdea: false,
      initialIdea: null,
    }),
    phase: "sampled",
    questions: [{ id: "output", label: "Output?" }],
    sample: { id: "sample-1", output: "Sample" },
    overlapGate: { decision: { decision: "create_new_skill" }, userRequest: "make a skill" },
    overlapJustification: "Separate workflow",
    notice: "old notice",
    error: "old error",
  };

  const sampling = reduceSkillIdeaSessionState(base, { type: "start_sampling" });
  assert.equal(sampling.phase, "sampling");
  assert.equal(sampling.overlapGate, null);
  assert.equal(sampling.overlapJustification, "");
  assert.equal(sampling.notice, null);
  assert.equal(sampling.error, null);

  const editing = reduceSkillIdeaSessionState(base, { type: "edit_answers" });
  assert.equal(editing.phase, "interviewing");
  assert.equal(editing.questionIndex, 0);
  assert.equal(editing.notice, "Editing answers will require a fresh sample before creating the skill.");
  assert.equal(editing.error, null);

  const guidance = reduceSkillIdeaSessionState(base, { type: "show_guidance", message: "Pick a matter first." });
  assert.equal(guidance.notice, "Pick a matter first.");
  assert.equal(guidance.error, null);

  const parked = reduceSkillIdeaSessionState(base, { type: "park_overlap_gate" });
  assert.equal(parked.overlapGate, null);
  assert.equal(parked.overlapJustification, "");
  assert.equal(parked.error, null);
});
