import assert from "node:assert/strict";
import test from "node:test";
import {
  answerCurrentSkillIdeaQuestion,
  buildSkillIdeaPlannerTerminal,
  createInitialSkillIdeaSession,
} from "../frontend/skill-idea-session-state.js";

test("skill idea session state initializes ready only when no questions remain", () => {
  assert.equal(createInitialSkillIdeaSession({ questions: [] }).ready, true);
  assert.equal(createInitialSkillIdeaSession({}).ready, true);
  assert.equal(createInitialSkillIdeaSession({ questions: [{ id: "goal" }] }).ready, false);
});

test("skill idea session state formats planner terminal lines", () => {
  assert.equal(
    buildSkillIdeaPlannerTerminal({
      plannerInfo: { source: "model" },
      userRequest: "draft client email",
    }),
    "[skill-ideas] model-planned interview opened: draft client email",
  );
  assert.deepEqual(
    buildSkillIdeaPlannerTerminal({
      plannerInfo: { source: "deterministic fallback", fallbackReason: "provider unavailable" },
      userRequest: "draft client email",
    }),
    [
      "[skill-ideas] planner fallback: provider unavailable",
      "[skill-ideas] interview opened: draft client email",
    ],
  );
  assert.equal(
    buildSkillIdeaPlannerTerminal({
      plannerInfo: { source: "deterministic" },
      userRequest: "draft client email",
    }),
    "[skill-ideas] interview opened: draft client email",
  );
});

test("skill idea session state records answers and advances readiness", () => {
  const session = createInitialSkillIdeaSession({
    questions: [
      { id: "goal" },
      { id: "tone" },
    ],
  });

  const first = answerCurrentSkillIdeaQuestion(session, "  explain next steps  ");
  assert.equal(first.ready, false);
  assert.equal(first.nextQuestionNumber, 2);
  assert.equal(session.answers.goal, "explain next steps");
  assert.equal(session.questionIndex, 1);

  const second = answerCurrentSkillIdeaQuestion(session, "warm");
  assert.equal(second.ready, true);
  assert.equal(session.answers.tone, "warm");
  assert.equal(session.ready, true);
});
