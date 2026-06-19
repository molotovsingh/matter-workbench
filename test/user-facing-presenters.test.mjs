import assert from "node:assert/strict";
import test from "node:test";

import {
  presentAiSettingsForScopedUser,
  presentMatterCopilotAnswerForScopedUser,
} from "../routes/user-facing-presenters.mjs";
import { containsUserFacingRestrictedAiLanguage } from "../shared/user-facing-ai-language-policy.js";

test("user-facing AI settings presenter removes route details", () => {
  const presented = presentAiSettingsForScopedUser({
    provider: "OpenAI",
    envPath: "/secret/.env",
    apiKeyConfigured: true,
    aiTasks: [
      {
        task: "copilot_answer",
        label: "Matter Copilot",
        surface: "Source-backed matter Q&A",
        provider: "openrouter",
        model: "openai/gpt-5.4",
        ready: false,
        note: "OPENROUTER_API_KEY missing",
      },
    ],
    startupChecks: {
      copilot: {
        ok: false,
        provider: "openrouter",
        model: "openai/gpt-5.4",
        error: "quota exceeded",
        checkedAt: "2026-06-18T12:00:00.000Z",
      },
    },
  });

  assert.equal(presented.provider, null);
  assert.equal(presented.aiTasks[0].label, "Assistant readiness");
  assert.equal(presented.aiTasks[0].note, "Temporarily unavailable");
  assert.equal(presented.startupChecks.copilot.ok, false);
  assert.equal(containsUserFacingRestrictedAiLanguage(presented), false);
});

test("user-facing answer presenter removes backend route metadata", () => {
  const presented = presentMatterCopilotAnswerForScopedUser({
    schema_version: "matter-copilot-answer/v1",
    answer_status: "answered",
    answer_markdown: "The record indicates a filing.",
    ai_run: { provider: "openrouter", model: "openai/gpt-5.4" },
  });

  assert.equal(presented.answer_status, "answered");
  assert.equal(presented.ai_run, undefined);
  assert.equal(containsUserFacingRestrictedAiLanguage(presented), false);
});
