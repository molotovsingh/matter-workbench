import assert from "node:assert/strict";
import test from "node:test";
import { classifyConfigurableSkillRunInput } from "../frontend/configurable-skill-run-commands.js";

test("configurable run command classifier handles action-sheet commands", () => {
  assert.equal(classifyConfigurableSkillRunInput("run again", { phase: "action_sheet" }), "show_overwrite_prompt");
  assert.equal(classifyConfigurableSkillRunInput("replace output document", { phase: "action_sheet" }), "show_overwrite_prompt");
  assert.equal(classifyConfigurableSkillRunInput("keep current", { phase: "action_sheet" }), "clear_action_sheet");
  assert.equal(classifyConfigurableSkillRunInput("cancel", { phase: "action_sheet" }), "clear_action_sheet");
});

test("configurable run command classifier handles overwrite-review commands", () => {
  assert.equal(classifyConfigurableSkillRunInput("open output", { phase: "overwrite" }), "open_output");
  assert.equal(classifyConfigurableSkillRunInput("looks good", { phase: "overwrite" }), "accept_run");
  assert.equal(classifyConfigurableSkillRunInput("revise this skill", { phase: "overwrite" }), "improve_skill");
  assert.equal(classifyConfigurableSkillRunInput("keep existing output", { phase: "overwrite" }), "cancel_overwrite");
  assert.equal(classifyConfigurableSkillRunInput("replace output document", { phase: "overwrite" }), "replace_output");
});

test("configurable run command classifier preserves freeform improvement text", () => {
  assert.equal(classifyConfigurableSkillRunInput("cancel", { phase: "improve" }), "cancel_improvement");
  assert.equal(classifyConfigurableSkillRunInput("add confidence columns", { phase: "improve" }), "save_improvement");
});
