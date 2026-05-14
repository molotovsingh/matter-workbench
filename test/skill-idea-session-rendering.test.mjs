import assert from "node:assert/strict";
import test from "node:test";
import {
  describeInterviewPlanner,
  renderAnsweredQuestions,
  renderQuestionExamples,
  renderSavedSkillIdeaChecklist,
  renderSkillIdeaUnderstood,
} from "../frontend/skill-idea-session-rendering.js";

test("skill idea session rendering describes model and fallback planners", () => {
  assert.deepEqual(describeInterviewPlanner({
    planner: {
      used: true,
      provider: "openai-direct",
      model: "gpt-5.4",
    },
  }), {
    source: "model",
    model: "openai-direct / gpt-5.4",
    fallbackReason: "",
  });

  assert.deepEqual(describeInterviewPlanner({
    planner: {
      used: false,
      reason: "planner disabled",
    },
  }), {
    source: "deterministic fallback",
    model: "",
    fallbackReason: "planner disabled",
  });
});

test("skill idea session rendering escapes interview content", () => {
  const html = renderSkillIdeaUnderstood({
    understood: "<script>alert(1)</script>",
    targetSkill: "/party_officer_map",
    defaultAssumptions: ["Use source citations"],
    planner: {
      used: false,
      reason: "SKILL_INTERVIEW_PLANNER_ENABLED is not enabled",
    },
  });

  assert.match(html, /What I understood/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Planner: deterministic fallback/);
  assert.match(html, /Fallback reason: SKILL_INTERVIEW_PLANNER_ENABLED is not enabled/);
  assert.match(html, /Likely related skill: <code>\/party_officer_map<\/code>/);
});

test("skill idea session rendering shows answers, examples, and checklist", () => {
  const interview = {
    questions: [
      { id: "tone", label: "What tone?", examples: ["formal", "warm"] },
      { id: "scope", label: "What scope?" },
    ],
  };

  assert.match(renderQuestionExamples(interview.questions[0]), /Examples: formal, warm\./);
  assert.match(renderAnsweredQuestions(interview, { tone: "formal" }), /What tone\?/);
  assert.doesNotMatch(renderAnsweredQuestions(interview, { tone: "formal" }), /What scope\?/);

  const checklist = renderSavedSkillIdeaChecklist({
    ready: false,
    items: [
      { label: "Intended user present", passed: true },
      { label: "Expected output present", passed: false },
    ],
  });
  assert.match(checklist, /Readiness checklist/);
  assert.match(checklist, /OK/);
  assert.match(checklist, /Missing/);
});
