import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PROVIDERS,
  AI_TASKS,
  DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
  MODEL_POLICY_VERSION,
  listModelPolicyTasks,
  resolveModelPolicy,
} from "../shared/model-policy.mjs";
import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
} from "../shared/ai-defaults.mjs";
import { DEFAULT_RESPONSES_ENDPOINT } from "../shared/responses-client.mjs";

test("model policy lists current AI task names", () => {
  assert.deepEqual(listModelPolicyTasks(), [
    AI_TASKS.SKILL_ROUTER,
    AI_TASKS.SOURCE_BACKED_ANALYSIS,
  ]);
});

test("skill router policy matches current OpenAI-direct defaults", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.SKILL_ROUTER, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SKILL_ROUTER,
    tier: "router",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: DEFAULT_OPENAI_MODEL,
    maxOutputTokens: DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
    fallback: "fail_closed",
  });
});

test("source-backed analysis policy matches current list-of-dates defaults", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: DEFAULT_OPENAI_MODEL,
    maxOutputTokens: DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
    fallback: "fail_closed",
  });
});

test("model policy preserves current environment override behavior", () => {
  assert.equal(resolveModelPolicy(AI_TASKS.SKILL_ROUTER, {
    env: {
      OPENAI_MODEL: "custom-model",
      OPENAI_ROUTER_MAX_OUTPUT_TOKENS: "900",
      OPENAI_MAX_OUTPUT_TOKENS: "2048",
    },
  }).maxOutputTokens, 900);

  assert.deepEqual(resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, {
    env: {
      OPENAI_MODEL: "custom-model",
      OPENAI_ROUTER_MAX_OUTPUT_TOKENS: "900",
      OPENAI_MAX_OUTPUT_TOKENS: "2048",
    },
  }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: "custom-model",
    maxOutputTokens: 2048,
    fallback: "fail_closed",
  });
});

test("model policy rejects unknown tasks", () => {
  assert.throws(
    () => resolveModelPolicy("drafting", { env: {} }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /Unknown AI task/);
      return true;
    },
  );
});
