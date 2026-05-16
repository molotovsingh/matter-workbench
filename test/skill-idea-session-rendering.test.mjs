import assert from "node:assert/strict";
import test from "node:test";
import {
  describeInterviewPlanner,
  renderActiveSkillIdeaQuestionHtml,
  renderAnsweredQuestions,
  renderQuestionExamples,
  renderReadySkillIdeaSessionHtml,
  renderSavedSkillIdeaChecklist,
  renderSavedSkillIdeaSessionHtml,
  renderSampleReviewButtonsHtml,
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

test("skill idea session rendering shows ready state with matter-gated sample action", () => {
  const interview = {
    understood: "Build a party map",
    questions: [],
  };
  const withoutMatter = renderReadySkillIdeaSessionHtml({ interview, activeMatter: {} });
  assert.match(withoutMatter, /Ready to generate a sample output/);
  assert.match(withoutMatter, /Pick matter to test this skill/);
  assert.match(withoutMatter, /data-skill-interview-action="generate-sample" disabled/);

  const withMatter = renderReadySkillIdeaSessionHtml({
    interview,
    activeMatter: { folderName: "Ayesha Vs Japan Airlines" },
  });
  assert.match(withMatter, /Generate sample from this matter/);
  assert.doesNotMatch(withMatter, /data-skill-interview-action="generate-sample" disabled/);
});

test("skill idea session rendering escapes active question and saved session content", () => {
  const interview = {
    understood: "Use <bad>",
    questions: [
      {
        id: "tone",
        label: "Tone <script>",
        help: "Help <script>",
        examples: ["formal"],
      },
    ],
  };
  const questionHtml = renderActiveSkillIdeaQuestionHtml({
    interview,
    questionIndex: 0,
    errorMessage: "Error <x>",
  });
  assert.match(questionHtml, /Tone &lt;script&gt;/);
  assert.match(questionHtml, /Help &lt;script&gt;/);
  assert.match(questionHtml, /Error &lt;x&gt;/);

  const savedHtml = renderSavedSkillIdeaSessionHtml({
    idea: {
      status: "incomplete",
      designBrief: {
        expectedOutputArtifact: "20_Workshop/Party <Map>.md",
        targetLane: "20_Workshop",
        riskLevel: "medium",
        intendedUser: "Lawyer",
        problem: "Map officers",
        expectedInputs: "Source records",
        paidPosture: "Paid",
      },
      readiness: {
        ready: true,
        passedCount: 8,
        totalCount: 8,
      },
    },
    interview,
    answers: { tone: "formal" },
    activeMatter: { folderName: "Ayesha Vs Japan Airlines" },
  });
  assert.match(savedHtml, /Draft complete/);
  assert.match(savedHtml, /20_Workshop\/Party &lt;Map&gt;\.md/);
  assert.match(savedHtml, /data-skill-interview-action="mark-ready"/);
});

test("skill idea session sample buttons reflect approved and created skill states", () => {
  const activeMatter = { folderName: "Ayesha Vs Japan Airlines" };
  assert.match(
    renderSampleReviewButtonsHtml({ sampleReview: {}, activeMatter }),
    /Generate sample from this matter/,
  );

  const activeSample = {
    id: "sample-1",
    state: "approved_current",
    version: 1,
  };
  assert.match(
    renderSampleReviewButtonsHtml({
      sampleReview: { activeSample, approved: true, stale: false },
      activeMatter,
    }),
    /Try creating skill again/,
  );

  assert.match(
    renderSampleReviewButtonsHtml({
      sampleReview: { activeSample, approved: false, stale: false },
      activeMatter,
    }),
    /Looks useful - create skill/,
  );

  assert.match(
    renderSampleReviewButtonsHtml({
      sampleReview: { activeSample, createdSkill: { slash: "/party_map" } },
      activeMatter,
    }),
    /data-skill-interview-action="run-created-skill"/,
  );
});

test("skill idea session surfaces sample progress and warnings", () => {
  const activeMatter = { folderName: "Ayesha Vs Japan Airlines" };
  const progressHtml = renderSavedSkillIdeaSessionHtml({
    idea: {
      status: "incomplete",
      designBrief: {},
      readiness: { ready: false, passedCount: 0, totalCount: 8, items: [] },
    },
    interview: { understood: "Build evidence review" },
    sampleReview: { generating: true },
    activeMatter,
  });
  assert.match(progressHtml, /Generating sample from Ayesha Vs Japan Airlines/);
  assert.match(progressHtml, /This may take a minute/);
  assert.match(progressHtml, /No matter files will be changed/);

  const warningHtml = renderSavedSkillIdeaSessionHtml({
    idea: {
      status: "incomplete",
      designBrief: {},
      readiness: { ready: true, passedCount: 8, totalCount: 8, items: [] },
    },
    interview: { understood: "Build evidence review" },
    sampleReview: {
      activeSample: {
        id: "sample_1",
        version: 1,
        sampleMarkdown: "# Sample",
        warnings: ["462 evidence block(s) were omitted from the bounded packet."],
      },
      samples: [],
    },
    activeMatter,
  });
  assert.match(warningHtml, /Sample warnings/);
  assert.match(warningHtml, /462 evidence block\(s\) were omitted/);
  assert.match(warningHtml, /Sample v1 ready for review/);
});
