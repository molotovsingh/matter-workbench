import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_RUN_CONTEXT_FIELDS,
  AI_RUN_LEDGER_FIELDS,
  AI_RUN_STATUS_FIELDS,
  normalizeAiRunMetadata,
} from "../shared/ai-run-metadata.mjs";

test("AI run metadata normalizer preserves status fields and drops empty noise", () => {
  assert.deepEqual(
    normalizeAiRunMetadata({
      provider: " openrouter ",
      model: " openai/gpt-4.1 ",
      returnedProvider: "Friendli",
      policyPromptVersion: "legal-workbench-policy/v1",
      maxOutputTokens: "8000",
      secret: "sk-secret",
    }, { fields: AI_RUN_STATUS_FIELDS }),
    {
      provider: "openrouter",
      model: "openai/gpt-4.1",
      returnedProvider: "Friendli",
      policyPromptVersion: "legal-workbench-policy/v1",
      maxOutputTokens: 8000,
    },
  );
});

test("AI run metadata normalizer can preserve empty ledger fields for stable store shape", () => {
  assert.deepEqual(
    normalizeAiRunMetadata({ provider: "openai-direct" }, {
      fields: AI_RUN_LEDGER_FIELDS,
      includeEmptyFields: true,
    }),
    {
      provider: "openai-direct",
      model: "",
      task: "",
      policyPromptVersion: "",
    },
  );
});

test("AI run metadata normalizer preserves context usage without unrelated provider payload", () => {
  assert.deepEqual(
    normalizeAiRunMetadata({
      policyVersion: "model-policy/v1-current",
      policyPromptVersion: "legal-workbench-policy/v1",
      task: "source_backed_analysis",
      tier: "paid",
      provider: "openrouter",
      model: "openai/gpt-4.1",
      fallback: "fail_closed",
      returnedModel: "openai/gpt-4.1",
      usage: {
        promptTokens: 100,
        completionTokens: 25,
        totalTokens: 125,
        cost: 0.01,
        raw: "not retained",
      },
      providerHeaders: {
        authorization: "Bearer sk-secret",
      },
    }, {
      fields: AI_RUN_CONTEXT_FIELDS,
      includeUsage: true,
    }),
    {
      policyVersion: "model-policy/v1-current",
      policyPromptVersion: "legal-workbench-policy/v1",
      task: "source_backed_analysis",
      tier: "paid",
      provider: "openrouter",
      model: "openai/gpt-4.1",
      fallback: "fail_closed",
      returnedModel: "openai/gpt-4.1",
      usage: {
        promptTokens: 100,
        completionTokens: 25,
        totalTokens: 125,
        cost: 0.01,
      },
    },
  );
});
