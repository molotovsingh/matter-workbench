import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PROVIDERS,
  AI_TASKS,
  DEFAULT_CONFIGURABLE_SKILL_RUN_MAX_OUTPUT_TOKENS,
  DEFAULT_CONFIGURABLE_SKILL_RUN_MODEL,
  DEFAULT_CONFIGURABLE_SKILL_RUN_TIMEOUT_MS,
  DEFAULT_COPILOT_ANSWER_MAX_OUTPUT_TOKENS,
  DEFAULT_COPILOT_ANSWER_MODEL,
  DEFAULT_COPILOT_ANSWER_PROVIDER,
  DEFAULT_COPILOT_ANSWER_TIMEOUT_MS,
  DEFAULT_CREATE_LISTOFDATES_PASS1_MAX_OUTPUT_TOKENS,
  DEFAULT_CREATE_LISTOFDATES_PASS1_MODEL,
  DEFAULT_CREATE_LISTOFDATES_PASS1_TIMEOUT_MS,
  DEFAULT_CREATE_LISTOFDATES_PASS2_MAX_OUTPUT_TOKENS,
  DEFAULT_CREATE_LISTOFDATES_PASS2_MODEL,
  DEFAULT_CREATE_LISTOFDATES_PASS2_TIMEOUT_MS,
  DEFAULT_SKILL_AUTHORING_MAX_OUTPUT_TOKENS,
  DEFAULT_SKILL_AUTHORING_MODEL,
  DEFAULT_SKILL_AUTHORING_TIMEOUT_MS,
  DEFAULT_SKILL_DESIGN_INTERVIEW_MODEL,
  DEFAULT_SKILL_SAMPLE_OUTPUT_MODEL,
  DEFAULT_OPENROUTER_ENDPOINT,
  DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
  DEFAULT_SKILL_DESIGN_INTERVIEW_MAX_OUTPUT_TOKENS,
  DEFAULT_SKILL_DESIGN_INTERVIEW_TIMEOUT_MS,
  DEFAULT_SKILL_SAMPLE_OUTPUT_MAX_OUTPUT_TOKENS,
  DEFAULT_SKILL_SAMPLE_OUTPUT_TIMEOUT_MS,
  DEFAULT_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS,
  DEFAULT_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS,
  DEFAULT_SOURCE_DESCRIPTION_MODEL,
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
    AI_TASKS.SKILL_DESIGN_INTERVIEW,
    AI_TASKS.SKILL_SAMPLE_OUTPUT,
    AI_TASKS.SKILL_AUTHORING,
    AI_TASKS.CONFIGURABLE_SKILL_RUN,
    AI_TASKS.COPILOT_ANSWER,
    AI_TASKS.CREATE_LISTOFDATES_PASS1,
    AI_TASKS.CREATE_LISTOFDATES_PASS2,
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

test("skill design interview policy defaults to OpenAI direct gpt-5.4 with deterministic fallback", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.SKILL_DESIGN_INTERVIEW, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SKILL_DESIGN_INTERVIEW,
    tier: "skill_design_interview",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: DEFAULT_SKILL_DESIGN_INTERVIEW_MODEL,
    maxOutputTokens: DEFAULT_SKILL_DESIGN_INTERVIEW_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_SKILL_DESIGN_INTERVIEW_TIMEOUT_MS,
    fallback: "deterministic_fallback",
  });

  assert.deepEqual(resolveModelPolicy(AI_TASKS.SKILL_DESIGN_INTERVIEW, {
    env: {
      SKILL_INTERVIEW_PLANNER_PROVIDER: "openai-direct",
      OPENAI_SKILL_INTERVIEW_PLANNER_MODEL: "gpt-5.4",
      OPENAI_SKILL_INTERVIEW_PLANNER_MAX_OUTPUT_TOKENS: "2600",
      OPENAI_SKILL_INTERVIEW_PLANNER_TIMEOUT_MS: "90000",
    },
  }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SKILL_DESIGN_INTERVIEW,
    tier: "skill_design_interview",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: "gpt-5.4",
    maxOutputTokens: 2600,
    timeoutMs: 90000,
    fallback: "deterministic_fallback",
  });

  assert.deepEqual(resolveModelPolicy(AI_TASKS.SKILL_DESIGN_INTERVIEW, {
    env: {
      SKILL_INTERVIEW_PLANNER_PROVIDER: "openrouter",
      OPENROUTER_SKILL_INTERVIEW_PLANNER_MODEL: "openai/gpt-4.1",
      OPENROUTER_SKILL_INTERVIEW_PLANNER_MAX_OUTPUT_TOKENS: "2200",
      OPENROUTER_SKILL_INTERVIEW_PLANNER_TIMEOUT_MS: "30000",
    },
  }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SKILL_DESIGN_INTERVIEW,
    tier: "skill_design_interview",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_OPENROUTER_ENDPOINT,
    model: "openai/gpt-4.1",
    maxOutputTokens: 2200,
    timeoutMs: 30000,
    fallback: "deterministic_fallback",
  });
});

test("skill sample output policy defaults to OpenAI direct gpt-5.4 and fails closed", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.SKILL_SAMPLE_OUTPUT, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SKILL_SAMPLE_OUTPUT,
    tier: "skill_sample_output",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: DEFAULT_SKILL_SAMPLE_OUTPUT_MODEL,
    maxOutputTokens: DEFAULT_SKILL_SAMPLE_OUTPUT_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_SKILL_SAMPLE_OUTPUT_TIMEOUT_MS,
    fallback: "fail_closed",
  });

  assert.deepEqual(resolveModelPolicy(AI_TASKS.SKILL_SAMPLE_OUTPUT, {
    env: {
      SKILL_SAMPLE_OUTPUT_PROVIDER: "openai-direct",
      OPENAI_SKILL_SAMPLE_OUTPUT_MODEL: "gpt-5.4",
      OPENAI_SKILL_SAMPLE_OUTPUT_MAX_OUTPUT_TOKENS: "5000",
      OPENAI_SKILL_SAMPLE_OUTPUT_TIMEOUT_MS: "100000",
    },
  }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SKILL_SAMPLE_OUTPUT,
    tier: "skill_sample_output",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: "gpt-5.4",
    maxOutputTokens: 5000,
    timeoutMs: 100000,
    fallback: "fail_closed",
  });
});

test("skill authoring and configurable run policies default to OpenAI direct gpt-5.4", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.SKILL_AUTHORING, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SKILL_AUTHORING,
    tier: "skill_authoring",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: DEFAULT_SKILL_AUTHORING_MODEL,
    maxOutputTokens: DEFAULT_SKILL_AUTHORING_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_SKILL_AUTHORING_TIMEOUT_MS,
    fallback: "fail_closed",
  });

  assert.deepEqual(resolveModelPolicy(AI_TASKS.CONFIGURABLE_SKILL_RUN, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.CONFIGURABLE_SKILL_RUN,
    tier: "configurable_skill_run",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: DEFAULT_CONFIGURABLE_SKILL_RUN_MODEL,
    maxOutputTokens: DEFAULT_CONFIGURABLE_SKILL_RUN_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_CONFIGURABLE_SKILL_RUN_TIMEOUT_MS,
    fallback: "fail_closed",
  });
});

test("copilot answer policy has a separate fail-closed task class", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.COPILOT_ANSWER, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.COPILOT_ANSWER,
    tier: "copilot_answer",
    provider: DEFAULT_COPILOT_ANSWER_PROVIDER,
    endpoint: DEFAULT_OPENROUTER_ENDPOINT,
    model: DEFAULT_COPILOT_ANSWER_MODEL,
    maxOutputTokens: DEFAULT_COPILOT_ANSWER_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_COPILOT_ANSWER_TIMEOUT_MS,
    fallback: "fail_closed",
    providerOrder: [],
  });
});

test("copilot answer policy keeps saved provider and model overrides authoritative", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.COPILOT_ANSWER, {
    env: {
      COPILOT_ANSWER_PROVIDER: "openai-direct",
      OPENAI_COPILOT_ANSWER_MODEL: "gpt-5.4-mini",
    },
  }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.COPILOT_ANSWER,
    tier: "copilot_answer",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: "gpt-5.4-mini",
    maxOutputTokens: DEFAULT_COPILOT_ANSWER_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_COPILOT_ANSWER_TIMEOUT_MS,
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

test("two-pass list-of-dates policies default to proven gated model pair", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.CREATE_LISTOFDATES_PASS1, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.CREATE_LISTOFDATES_PASS1,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: DEFAULT_CREATE_LISTOFDATES_PASS1_MODEL,
    maxOutputTokens: DEFAULT_CREATE_LISTOFDATES_PASS1_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_CREATE_LISTOFDATES_PASS1_TIMEOUT_MS,
    fallback: "fail_closed",
  });

  assert.deepEqual(resolveModelPolicy(AI_TASKS.CREATE_LISTOFDATES_PASS2, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.CREATE_LISTOFDATES_PASS2,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    model: DEFAULT_CREATE_LISTOFDATES_PASS2_MODEL,
    maxOutputTokens: DEFAULT_CREATE_LISTOFDATES_PASS2_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_CREATE_LISTOFDATES_PASS2_TIMEOUT_MS,
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

test("source-backed analysis policy can explicitly use OpenRouter", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, {
    env: {
      SOURCE_BACKED_ANALYSIS_PROVIDER: "openrouter",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL: "qwen/qwen3-source-backed",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS: "1800",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS: "45000",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT: "price",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_PROMPT_PRICE: "0.15",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_COMPLETION_PRICE: "0.60",
    },
  }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_OPENROUTER_ENDPOINT,
    model: "qwen/qwen3-source-backed",
    maxOutputTokens: 1800,
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

test("source-backed OpenRouter policy rejects mixed provider pin and price routing", () => {
  assert.throws(
    () => resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, {
      env: {
        SOURCE_BACKED_ANALYSIS_PROVIDER: "openrouter",
        OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL: "qwen/qwen3-source-backed",
        OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_ORDER: "akashml/fp8",
        OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT: "price",
      },
    }),
    /provider order cannot be combined with provider sort or max price routing/,
  );
});

test("source-backed OpenRouter policy rejects invalid provider sort", () => {
  assert.throws(
    () => resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, {
      env: {
        SOURCE_BACKED_ANALYSIS_PROVIDER: "openrouter",
        OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL: "qwen/qwen3-source-backed",
        OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT: "cheap",
      },
    }),
    /Invalid OpenRouter provider sort: cheap/,
  );
});

test("source-backed analysis policy rejects unsupported explicit providers", () => {
  assert.throws(
    () => resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, {
      env: { SOURCE_BACKED_ANALYSIS_PROVIDER: "auto-router" },
    }),
    /Unsupported provider for source_backed_analysis: auto-router/,
  );
});

test("source-backed OpenRouter policy has a default timeout", () => {
  assert.equal(resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, {
    env: {
      SOURCE_BACKED_ANALYSIS_PROVIDER: "openrouter",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL: "qwen/qwen3-source-backed",
    },
  }).timeoutMs, DEFAULT_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS);
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

test("source description policy defaults to quality-first OpenRouter source labels", () => {
  assert.deepEqual(resolveModelPolicy(AI_TASKS.SOURCE_DESCRIPTION, { env: {} }), {
    policyVersion: MODEL_POLICY_VERSION,
    task: AI_TASKS.SOURCE_DESCRIPTION,
    tier: "source_description",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_OPENROUTER_ENDPOINT,
    model: DEFAULT_SOURCE_DESCRIPTION_MODEL,
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
