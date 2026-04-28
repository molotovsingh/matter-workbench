import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
} from "./ai-defaults.mjs";
import { DEFAULT_RESPONSES_ENDPOINT } from "./responses-client.mjs";

export const MODEL_POLICY_VERSION = "model-policy/v1-current";

export const AI_TASKS = Object.freeze({
  SKILL_ROUTER: "skill_router",
  SOURCE_BACKED_ANALYSIS: "source_backed_analysis",
  SOURCE_DESCRIPTION: "source_description",
});

export const AI_PROVIDERS = Object.freeze({
  OPENAI_DIRECT: "openai-direct",
  OPENROUTER: "openrouter",
});

export const DEFAULT_ROUTER_MAX_OUTPUT_TOKENS = Math.min(1200, DEFAULT_OPENAI_MAX_OUTPUT_TOKENS);
export const DEFAULT_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS = 1200;
export const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const TASK_POLICIES = Object.freeze({
  [AI_TASKS.SKILL_ROUTER]: Object.freeze({
    task: AI_TASKS.SKILL_ROUTER,
    tier: "router",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    modelEnvKey: "OPENAI_MODEL",
    maxOutputTokensEnvKey: "OPENAI_ROUTER_MAX_OUTPUT_TOKENS",
    defaultMaxOutputTokens: DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
  }),
  [AI_TASKS.SOURCE_BACKED_ANALYSIS]: Object.freeze({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    modelEnvKey: "OPENAI_MODEL",
    maxOutputTokensEnvKey: "OPENAI_MAX_OUTPUT_TOKENS",
    defaultMaxOutputTokens: DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  }),
  [AI_TASKS.SOURCE_DESCRIPTION]: Object.freeze({
    task: AI_TASKS.SOURCE_DESCRIPTION,
    tier: "source_description",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_OPENROUTER_ENDPOINT,
    fallback: "fail_closed",
    modelEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_MODEL",
    maxOutputTokensEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS",
    providerOrderEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_ORDER",
    defaultMaxOutputTokens: DEFAULT_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS,
  }),
});

export function resolveModelPolicy(task, { env = process.env } = {}) {
  const base = TASK_POLICIES[task];
  if (!base) {
    const error = new Error(`Unknown AI task: ${task || "none"}`);
    error.statusCode = 400;
    throw error;
  }

  return {
    policyVersion: MODEL_POLICY_VERSION,
    task: base.task,
    tier: base.tier,
    provider: base.provider,
    endpoint: base.endpoint,
    model: env[base.modelEnvKey] || (base.provider === AI_PROVIDERS.OPENAI_DIRECT ? DEFAULT_OPENAI_MODEL : ""),
    maxOutputTokens: parsePositiveInteger(env[base.maxOutputTokensEnvKey]) || base.defaultMaxOutputTokens,
    fallback: base.fallback,
    ...(base.providerOrderEnvKey ? { providerOrder: parseProviderOrder(env[base.providerOrderEnvKey]) } : {}),
  };
}

export function listModelPolicyTasks() {
  return Object.keys(TASK_POLICIES);
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseProviderOrder(value) {
  return String(value || "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
}
