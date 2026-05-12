import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSkillIdeaInterview,
  buildSkillIdeaPayloadFromInterview,
  parseAdaptiveSkillIdeaInput,
} from "../frontend/skill-idea-interview.js";

test("skill idea interview infers a simple pleading-summary brief without provider routing", () => {
  const interview = buildSkillIdeaInterview({
    text: "create a skill to summarize pleadings",
    idea: "summarize pleadings",
  });

  assert.equal(interview.mode, "new_skill");
  assert.equal(interview.targetSkill, "");
  assert.match(interview.understood, /summarize pleadings/i);
  assert.equal(interview.designBrief.targetLane, "20_Workshop");
  assert.equal(interview.designBrief.expectedOutputArtifact, "20_Workshop/Pleadings Summary.md");
  assert.equal(interview.designBrief.paidPosture, "unknown");
  assert.equal(interview.designBrief.riskLevel, "medium");
  assert.deepEqual(
    interview.questions.map((question) => question.id),
    ["citationDiscipline", "matterScope", "legalSetting"],
  );
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
    text: "create a skill to summarize pleadings",
    idea: "summarize pleadings",
  });
  const payload = buildSkillIdeaPayloadFromInterview({
    interview,
    answers: {
      citationDiscipline: "Every point needs FILE-NNNN pX.bY citations.",
      matterScope: "Whole matter.",
      legalSetting: "Civil recovery; avoid final conclusions.",
    },
    designBrief: {
      expectedOutputArtifact: "20_Workshop/Pleading Issues.md",
    },
  });

  assert.equal(payload.text, "create a skill to summarize pleadings");
  assert.equal(payload.designBrief.expectedOutputArtifact, "20_Workshop/Pleading Issues.md");
  assert.equal(payload.designBrief.targetLane, "20_Workshop");
  assert.match(payload.designBrief.notes, /Interview answers:/);
  assert.match(payload.designBrief.notes, /Every point needs FILE-NNNN pX\.bY citations/);
  assert.match(payload.designBrief.notes, /Civil recovery; avoid final conclusions/);
});
