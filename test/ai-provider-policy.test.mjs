import assert from "node:assert/strict";
import test from "node:test";
import { modelPolicyMetadata, resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT } from "../shared/responses-client.mjs";

test("provider config preserves current OpenAI-direct policy defaults", () => {
  const policy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env: {} });

  assert.deepEqual(resolveProviderConfig(policy), {
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: policy.model,
    maxOutputTokens: policy.maxOutputTokens,
  });
});

test("provider config preserves current environment override behavior", () => {
  const policy = resolveModelPolicy(AI_TASKS.SKILL_ROUTER, {
    env: {
      OPENAI_MODEL: "policy-model",
      OPENAI_ROUTER_MAX_OUTPUT_TOKENS: "777",
    },
  });

  assert.deepEqual(resolveProviderConfig(policy), {
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: "policy-model",
    maxOutputTokens: 777,
  });
});

test("provider config applies request overrides without changing invalid token fallback", () => {
  const policy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, {
    env: {
      OPENAI_MODEL: "policy-model",
      OPENAI_MAX_OUTPUT_TOKENS: "3456",
    },
  });

  assert.deepEqual(resolveProviderConfig(policy, {
    endpoint: "http://127.0.0.1:9999/v1/responses",
    model: "request-model",
    maxOutputTokens: "invalid",
  }), {
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: "http://127.0.0.1:9999/v1/responses",
    model: "request-model",
    maxOutputTokens: 3456,
  });
});

test("provider metadata mirrors request-ready config without endpoint or keys", () => {
  const policy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, {
    env: {
      OPENAI_MODEL: "policy-model",
      OPENAI_MAX_OUTPUT_TOKENS: "3456",
    },
  });
  const providerConfig = resolveProviderConfig(policy);

  assert.deepEqual(modelPolicyMetadata(policy, providerConfig), {
    policyVersion: policy.policyVersion,
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    model: "policy-model",
    maxOutputTokens: 3456,
    fallback: "fail_closed",
  });
});

test("provider config resolves OpenRouter source description policy", () => {
  const policy = resolveModelPolicy(AI_TASKS.SOURCE_DESCRIPTION, {
    env: {
      OPENROUTER_SOURCE_DESCRIPTION_MODEL: "meta-llama/source-description-model",
      OPENROUTER_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS: "1200",
      OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_ORDER: "akashml/fp8",
    },
  });
  const providerConfig = resolveProviderConfig(policy);

  assert.deepEqual(providerConfig, {
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/source-description-model",
    maxOutputTokens: 1200,
    providerOrder: ["akashml/fp8"],
    requireParameters: true,
    allowFallbacks: false,
  });
  assert.deepEqual(modelPolicyMetadata(policy, providerConfig), {
    policyVersion: policy.policyVersion,
    task: AI_TASKS.SOURCE_DESCRIPTION,
    tier: "source_description",
    provider: AI_PROVIDERS.OPENROUTER,
    model: "meta-llama/source-description-model",
    maxOutputTokens: 1200,
    fallback: "fail_closed",
  });
});

test("provider config rejects unsupported providers", () => {
  assert.throws(
    () => resolveProviderConfig({
      provider: "made-up-provider",
      endpoint: "https://example.invalid/api",
      model: "example",
      maxOutputTokens: 1000,
    }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /Unsupported AI provider/);
      return true;
    },
  );
});
