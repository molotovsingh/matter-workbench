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
const OPENROUTER_PROVIDER_SORTS = new Set(["price", "throughput", "latency"]);

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
    providerSortEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_SORT",
    maxPromptPriceEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_MAX_PROMPT_PRICE",
    maxCompletionPriceEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_MAX_COMPLETION_PRICE",
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

  const policy = {
    policyVersion: MODEL_POLICY_VERSION,
    task: base.task,
    tier: base.tier,
    provider: base.provider,
    endpoint: base.endpoint,
    model: env[base.modelEnvKey] || (base.provider === AI_PROVIDERS.OPENAI_DIRECT ? DEFAULT_OPENAI_MODEL : ""),
    maxOutputTokens: parsePositiveInteger(env[base.maxOutputTokensEnvKey]) || base.defaultMaxOutputTokens,
    fallback: base.fallback,
    ...(base.providerOrderEnvKey ? { providerOrder: parseProviderOrder(env[base.providerOrderEnvKey]) } : {}),
    ...(base.providerSortEnvKey ? parseProviderSortSetting(env[base.providerSortEnvKey]) : {}),
    ...(base.maxPromptPriceEnvKey || base.maxCompletionPriceEnvKey
      ? parseMaxPriceSetting(env[base.maxPromptPriceEnvKey], env[base.maxCompletionPriceEnvKey])
      : {}),
  };
  validateOpenRouterRouting(policy);
  return policy;
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

function parseProviderSortSetting(value) {
  const providerSort = String(value || "").trim();
  return providerSort ? { providerSort } : {};
}

function parseMaxPriceSetting(promptValue, completionValue) {
  const prompt = parsePositiveNumber(promptValue);
  const completion = parsePositiveNumber(completionValue);
  const maxPrice = {};
  if (prompt !== null) maxPrice.prompt = prompt;
  if (completion !== null) maxPrice.completion = completion;
  return Object.keys(maxPrice).length ? { maxPrice } : {};
}

function parsePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validateOpenRouterRouting(policy) {
  if (policy.provider !== AI_PROVIDERS.OPENROUTER) return;

  if (policy.providerSort && !OPENROUTER_PROVIDER_SORTS.has(policy.providerSort)) {
    const error = new Error(`Invalid OpenRouter provider sort: ${policy.providerSort}`);
    error.statusCode = 400;
    throw error;
  }

  if (policy.providerOrder?.length && (policy.providerSort || policy.maxPrice)) {
    const error = new Error("OpenRouter provider order cannot be combined with provider sort or max price routing.");
    error.statusCode = 400;
    throw error;
  }
}
