import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PROVIDERS,
  AI_TASKS,
  DEFAULT_OPENROUTER_ENDPOINT,
  DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
  DEFAULT_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS,
  DEFAULT_SOURCE_DESCRIPTION_TIMEOUT_MS,
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
    AI_TASKS.SOURCE_DESCRIPTION,
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

test("source description policy uses OpenRouter env configuration", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.SOURCE_DESCRIPTION, {
    env: {
      OPENROUTER_SOURCE_DESCRIPTION_MODEL: "meta-llama/llama-3.3-70b-instruct",
      OPENROUTER_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS: "1400",
      OPENROUTER_SOURCE_DESCRIPTION_TIMEOUT_MS: "45000",
      OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_SORT: "price",
      OPENROUTER_SOURCE_DESCRIPTION_MAX_PROMPT_PRICE: "0.15",
      OPENROUTER_SOURCE_DESCRIPTION_MAX_COMPLETION_PRICE: "0.60",
    },
  }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SOURCE_DESCRIPTION,
    tier: "source_description",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_OPENROUTER_ENDPOINT,
    model: "meta-llama/llama-3.3-70b-instruct",
    maxOutputTokens: 1400,
    timeoutMs: 45000,
    fallback: "fail_closed",
    providerOrder: [],
    providerSort: "price",
    maxPrice: {
      prompt: 0.15,
      completion: 0.60,
    },
  });
});

test("source description policy rejects mixed provider pin and price routing", () => {
  assert.throws(
    () => resolveModelPolicy(AI_TASKS.SOURCE_DESCRIPTION, {
      env: {
        OPENROUTER_SOURCE_DESCRIPTION_MODEL: "meta-llama/llama-3.3-70b-instruct",
        OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_ORDER: "akashml/fp8",
        OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_SORT: "price",
      },
    }),
    /provider order cannot be combined with provider sort or max price routing/,
  );
});

test("source description policy rejects invalid provider sort", () => {
  assert.throws(
    () => resolveModelPolicy(AI_TASKS.SOURCE_DESCRIPTION, {
      env: {
        OPENROUTER_SOURCE_DESCRIPTION_MODEL: "meta-llama/llama-3.3-70b-instruct",
        OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_SORT: "cheap",
      },
    }),
    /Invalid OpenRouter provider sort: cheap/,
  );
});

test("source description policy is unconfigured without an OpenRouter model", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.SOURCE_DESCRIPTION, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SOURCE_DESCRIPTION,
    tier: "source_description",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_OPENROUTER_ENDPOINT,
    model: "",
    maxOutputTokens: DEFAULT_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_SOURCE_DESCRIPTION_TIMEOUT_MS,
    fallback: "fail_closed",
    providerOrder: [],
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
