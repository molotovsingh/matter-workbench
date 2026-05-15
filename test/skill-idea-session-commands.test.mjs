import assert from "node:assert/strict";
import test from "node:test";
import { classifySkillIdeaSessionInput } from "../frontend/skill-idea-session-commands.js";

test("skill idea session command classifier handles global and question states", () => {
  assert.deepEqual(classifySkillIdeaSessionInput("cancel", { ready: true }), { action: "cancel" });
  assert.deepEqual(classifySkillIdeaSessionInput("   ", { ready: true }), { action: "blank" });
  assert.deepEqual(classifySkillIdeaSessionInput("answer text", { ready: false }), { action: "answer_question" });
});

test("skill idea session command classifier handles unsaved ready idea commands", () => {
  assert.deepEqual(classifySkillIdeaSessionInput("save updates", { ready: true }), { action: "save" });
  assert.deepEqual(classifySkillIdeaSessionInput("edit", { ready: true }), { action: "edit_answers" });
  assert.deepEqual(classifySkillIdeaSessionInput("generate sample from this matter", { ready: true }), {
    action: "generate_sample",
    feedback: "",
  });
  assert.deepEqual(classifySkillIdeaSessionInput("copy sample", { ready: true }), { action: "unknown" });
});

test("skill idea session command classifier handles saved idea sample actions", () => {
  const state = { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false };

  assert.deepEqual(classifySkillIdeaSessionInput("regenerate sample", state), {
    action: "generate_sample",
    feedback: "Regenerate the sample with the current design brief.",
  });
  assert.deepEqual(classifySkillIdeaSessionInput("copy sample", state), { action: "copy_sample" });
  assert.deepEqual(classifySkillIdeaSessionInput("copy sample v2", state), { action: "copy_sample_version", version: 2 });
  assert.deepEqual(classifySkillIdeaSessionInput("looks right", state), { action: "approve_sample" });
  assert.deepEqual(classifySkillIdeaSessionInput("create skill", state), { action: "create_skill" });
  assert.deepEqual(classifySkillIdeaSessionInput("copy review packet", state), { action: "copy_review_packet" });
  assert.deepEqual(classifySkillIdeaSessionInput("mark ready", state), { action: "mark_ready" });
  assert.deepEqual(classifySkillIdeaSessionInput("open skills", state), { action: "open_skills" });
  assert.deepEqual(classifySkillIdeaSessionInput("start another idea", state), { action: "start_another" });
});

test("skill idea session command classifier treats freeform text as feedback only for unapproved samples", () => {
  assert.deepEqual(classifySkillIdeaSessionInput("make it shorter", {
    ready: true,
    hasSavedIdea: true,
    hasActiveSample: true,
    sampleApproved: false,
  }), {
    action: "sample_feedback",
    feedback: "make it shorter",
  });
  assert.deepEqual(classifySkillIdeaSessionInput("make it shorter", {
    ready: true,
    hasSavedIdea: true,
    hasActiveSample: true,
    sampleApproved: true,
  }), { action: "unknown" });
});
