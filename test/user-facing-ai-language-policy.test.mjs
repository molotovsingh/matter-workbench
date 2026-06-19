import assert from "node:assert/strict";
import test from "node:test";

import {
  USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE,
  containsUserFacingRestrictedAiLanguage,
} from "../shared/user-facing-ai-language-policy.js";

test("user-facing AI language policy catches restricted provider terms", () => {
  assert.equal(containsUserFacingRestrictedAiLanguage("OpenRouter quota exceeded for model openai/gpt-5.4"), true);
  assert.equal(containsUserFacingRestrictedAiLanguage({ message: "OPENROUTER_API_KEY missing" }), true);
  assert.equal(containsUserFacingRestrictedAiLanguage({ provider: null, model: "", message: "Ready" }), false);
  assert.equal(containsUserFacingRestrictedAiLanguage("The assistant is ready for the workspace."), false);
  assert.equal(containsUserFacingRestrictedAiLanguage({ message: USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE }), false);
});
