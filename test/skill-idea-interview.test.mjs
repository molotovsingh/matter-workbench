import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSkillIdeaInterview,
  buildSkillIdeaPayloadFromInterview,
  planSkillIdeaInterview,
  parseAdaptiveSkillIdeaInput,
} from "../frontend/skill-idea-interview.js";

test("skill idea interview plans limitation review with legally apt questions", () => {
  const interview = buildSkillIdeaInterview({
    text: "create a new skill that checks if the issue is within or outside of limitation",
    idea: "checks if the issue is within or outside of limitation",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.match(interview.understood, /limitation review skill/i);
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Limitation Review.md");
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.riskLevel, "high");
  assert.match(interview.defaultAssumptions.join("\n"), /every limitation date and conclusion must cite source labels plus raw FILE-NNNN pX\.bY citations/i);
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["limitationPosition", "decisionShape", "legalSetting"],
  );
  assert.match(interview.questions[0].label, /Whose limitation position/i);
  assert.doesNotMatch(interview.questions[0].label, /citation/i);
});

test("skill idea interview plans pleading summary with pleading-specific questions", () => {
  const interview = buildSkillIdeaInterview({
    text: "make a new skill that summarises the best case pleadings for the lawyer",
    idea: "summarises the best case pleadings for the lawyer",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.match(interview.understood, /pleading-review skill/i);
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Pleadings Summary.md");
  assert.equal(interview.designBrief.paidPosture, "unknown");
  assert.equal(interview.designBrief.riskLevel, "medium");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["outputShape", "pleadingScope", "factTreatment"],
  );
  assert.match(interview.questions[0].examples.join(" "), /issue-wise matrix/);
  assert.match(interview.questions[2].label, /admitted facts, disputed allegations, and unsupported assertions/i);
});

test("skill idea interview plans evidence-gap review with gap-specific questions", () => {
  const interview = buildSkillIdeaInterview({
    text: "create a skill to find missing documents and evidence gaps",
    idea: "find missing documents and evidence gaps",
  });

  assert.equal(interview.mode, "new_skill");
  assert.match(interview.understood, /evidence-gap skill/i);
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Evidence Gaps.md");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["gapGrouping", "followUps", "gapPriority"],
  );
  assert.match(interview.questions[1].label, /follow-up documents or questions/i);
  assert.match(interview.questions[2].label, /critical vs optional gaps/i);
});

test("skill idea interview plans weakness review with client-risk questions", () => {
  const interview = buildSkillIdeaInterview({
    text: "create a skill to find weaknesses and opponent arguments from the client perspective",
    idea: "find weaknesses and opponent arguments from the client perspective",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.match(interview.understood, /weakness review skill/i);
  assert.match(interview.understood, /adverse facts, evidence gaps, contradictions/i);
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Weakness Review.md");
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.riskLevel, "high");
  assert.match(interview.designBrief.problem, /opponent arguments/i);
  assert.match(interview.designBrief.notes, /candid internal lawyer review/i);
  assert.match(interview.defaultAssumptions.join("\n"), /every factual weakness must cite source labels plus raw FILE-NNNN pX\.bY citations/i);
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["weaknessFocus", "weaknessStructure", "weaknessAudience"],
  );
  assert.match(interview.questions[0].label, /type of weaknesses/i);
  assert.match(interview.questions[0].examples.join(" "), /procedural\/legal risks/);
  assert.match(interview.questions[1].examples.join(" "), /issue-wise weakness table/);
  assert.match(interview.questions[2].examples.join(" "), /internal lawyer only/);
});

test("skill idea interview detects adjacent list-of-dates improvement", () => {
  const interview = buildSkillIdeaInterview({
    text: "can we make a skill for list of dates to flag limitation issues",
    idea: "list of dates to flag limitation issues",
  });

  assert.equal(interview.mode, "adjacent_improvement");
  assert.equal(interview.targetSkill, "/create_listofdates");
  assert.match(interview.understood, /Create List of Dates/);
  assert.equal(interview.designBrief.targetLane, "10_Library");
  assert.equal(interview.designBrief.expectedOutputArtifact, "10_Library/List of Dates.md");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["change", "unchanged", "artifact"],
  );
});

test("skill idea interview treats pleading summary as a new skill, not list-of-dates modification", () => {
  const interview = buildSkillIdeaInterview({
    text: "make a new skill that summarises the best case pleadings for the lawyer",
    idea: "summarises the best case pleadings for the lawyer",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Pleadings Summary.md");
  assert.doesNotMatch(interview.understood, /Create List of Dates/);
});

test("skill interview planner falls back deterministically without provider configuration", async () => {
  const interview = await planSkillIdeaInterview({
    text: "create a skill to find missing documents and evidence gaps",
    idea: "find missing documents and evidence gaps",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Evidence Gaps.md");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["gapGrouping", "followUps", "gapPriority"],
  );
});

test("skill interview planner falls back deterministically when provider fails", async () => {
  const interview = await planSkillIdeaInterview({
    text: "create a new skill that checks if the issue is within or outside of limitation",
    idea: "checks if the issue is within or outside of limitation",
  }, "", {
    plannerProvider: async () => {
      throw new Error("planner unavailable");
    },
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Limitation Review.md");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["limitationPosition", "decisionShape", "legalSetting"],
  );
});

test("adaptive skill idea parser catches adjacent improvement requests without skill wording", () => {
  assert.deepEqual(parseAdaptiveSkillIdeaInput("can list of dates also flag limitation issues"), {
    type: "skill_idea",
    text: "can list of dates also flag limitation issues",
    idea: "can list of dates also flag limitation issues",
  });
  assert.equal(parseAdaptiveSkillIdeaInput("list of dates"), null);
  assert.equal(parseAdaptiveSkillIdeaInput("please extract"), null);
});

test("skill idea interview payload stores answers in design brief notes", () => {
  const interview = buildSkillIdeaInterview({
    text: "make a new skill that summarises the best case pleadings for the lawyer",
    idea: "summarises the best case pleadings for the lawyer",
  });
  const payload = buildSkillIdeaPayloadFromInterview({
    interview,
    answers: {
      outputShape: "Issue-wise matrix.",
      pleadingScope: "Plaint and written statement.",
      factTreatment: "Separate admissions, disputes, and unsupported assertions.",
    },
    designBrief: {
      expectedOutputArtifact: "20_Workshop/Pleading Issues.md",
    },
  });

  assert.equal(payload.text, "make a new skill that summarises the best case pleadings for the lawyer");
  assert.equal(payload.designBrief.expectedOutputArtifact, "20_Workshop/Pleading Issues.md");
  assert.equal(payload.designBrief.targetLane, "20_Workshop");
  assert.match(payload.designBrief.notes, /Interview answers:/);
  assert.match(payload.designBrief.notes, /Default evidence rule:/);
  assert.match(payload.designBrief.notes, /Issue-wise matrix/);
  assert.match(payload.designBrief.notes, /Separate admissions, disputes, and unsupported assertions/);
});
