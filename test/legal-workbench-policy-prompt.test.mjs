import assert from "node:assert/strict";
import test from "node:test";

import {
  COPILOT_DRAFT_POLICY_PROMPT,
  NATIVE_SKILL_POLICY_PROMPTS,
  legalWorkbenchSystemPrompt,
} from "../shared/legal-workbench-policy-prompt.mjs";

test("global policy prompt carries draft ownership and dispatch boundaries", () => {
  const prompt = legalWorkbenchSystemPrompt("Summarize the matter.");

  assert.match(prompt, /lawyer-review work product/i);
  assert.match(prompt, /Do not silently overwrite lawyer edits/i);
});

test("copilot policy is explicit about transient work and bounded amendments", () => {
  const prompt = legalWorkbenchSystemPrompt("Answer a matter question.", { copilot: true });

  assert.match(prompt, /Matter Co-pilot and draft ownership policy/i);
  assert.match(prompt, /Transient copilot answers are not durable matter artifacts/i);
  assert.match(prompt, /prefer bounded paragraph, section, or issue-level amendments/i);
  assert.match(prompt, /40_Dispatch copies are frozen snapshots/i);
});

test("source-label policy separates model polish from lawyer confirmation", () => {
  assert.match(NATIVE_SKILL_POLICY_PROMPTS.source_labels, /second-pass model review/i);
  assert.match(NATIVE_SKILL_POLICY_PROMPTS.source_labels, /never represent model-polished labels as lawyer-confirmed/i);
});

test("copilot draft policy remains available as a composable section", () => {
  assert.match(COPILOT_DRAFT_POLICY_PROMPT, /lawyer-owned working drafts/i);
});
