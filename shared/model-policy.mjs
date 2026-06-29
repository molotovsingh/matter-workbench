import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
} from "./ai-defaults.mjs";
import { DEFAULT_RESPONSES_ENDPOINT } from "./responses-client.mjs";

export const MODEL_POLICY_VERSION = "model-policy/v1-current";

export const AI_TASKS = Object.freeze({
  SKILL_ROUTER: "skill_router",
  SKILL_DESIGN_INTERVIEW: "skill_design_interview",
  SKILL_SAMPLE_OUTPUT: "skill_sample_output",
  SKILL_AUTHORING: "skill_authoring",
  CONFIGURABLE_SKILL_RUN: "configurable_skill_run",
  COPILOT_ANSWER: "copilot_answer",
  COPILOT_WEB_RESEARCH: "copilot_web_research",
  CREATE_LISTOFDATES_PASS1: "create_listofdates_pass1",
  CREATE_LISTOFDATES_PASS2: "create_listofdates_pass2",
  SOURCE_BACKED_ANALYSIS: "source_backed_analysis",
  SOURCE_DESCRIPTION: "source_description",
});

export const AI_PROVIDERS = Object.freeze({
  OPENAI_DIRECT: "openai-direct",
  OPENROUTER: "openrouter",
});

export const DEFAULT_ROUTER_MAX_OUTPUT_TOKENS = Math.min(1200, DEFAULT_OPENAI_MAX_OUTPUT_TOKENS);
export const DEFAULT_SKILL_ROUTER_OPENROUTER_MODEL = "openai/gpt-5.4-mini";
export const DEFAULT_SKILL_ROUTER_OPENROUTER_TIMEOUT_MS = 30_000;
export const DEFAULT_SKILL_DESIGN_INTERVIEW_MODEL = "gpt-5.4";
export const DEFAULT_SKILL_DESIGN_INTERVIEW_OPENROUTER_MODEL = "openai/gpt-5.4";
export const DEFAULT_SKILL_DESIGN_INTERVIEW_MAX_OUTPUT_TOKENS = 2600;
export const DEFAULT_SKILL_DESIGN_INTERVIEW_TIMEOUT_MS = 90_000;
export const DEFAULT_SKILL_SAMPLE_OUTPUT_MODEL = "gpt-5.4";
export const DEFAULT_SKILL_SAMPLE_OUTPUT_OPENROUTER_MODEL = "openai/gpt-5.4";
export const DEFAULT_SKILL_SAMPLE_OUTPUT_MAX_OUTPUT_TOKENS = 6000;
export const DEFAULT_SKILL_SAMPLE_OUTPUT_TIMEOUT_MS = 120_000;
export const DEFAULT_SKILL_AUTHORING_MODEL = "gpt-5.4";
export const DEFAULT_SKILL_AUTHORING_OPENROUTER_MODEL = "openai/gpt-5.4";
export const DEFAULT_SKILL_AUTHORING_MAX_OUTPUT_TOKENS = 5000;
export const DEFAULT_SKILL_AUTHORING_TIMEOUT_MS = 120_000;
export const DEFAULT_CONFIGURABLE_SKILL_RUN_MODEL = "gpt-5.4";
export const DEFAULT_CONFIGURABLE_SKILL_RUN_OPENROUTER_MODEL = "openai/gpt-5.4";
export const DEFAULT_CONFIGURABLE_SKILL_RUN_MAX_OUTPUT_TOKENS = 8000;
export const DEFAULT_CONFIGURABLE_SKILL_RUN_TIMEOUT_MS = 120_000;
export const DEFAULT_COPILOT_ANSWER_PROVIDER = AI_PROVIDERS.OPENROUTER;
export const DEFAULT_COPILOT_ANSWER_MODEL = "openai/gpt-4.1";
export const DEFAULT_COPILOT_ANSWER_OPENAI_MODEL = "gpt-5.4-mini";
export const DEFAULT_COPILOT_ANSWER_MAX_OUTPUT_TOKENS = 2200;
export const DEFAULT_COPILOT_ANSWER_TIMEOUT_MS = 90_000;
export const COPILOT_MODEL_PRESETS = Object.freeze([
  Object.freeze({ label: "Low", shortLabel: "Low", provider: AI_PROVIDERS.OPENAI_DIRECT, model: "gpt-4o-mini" }),
  Object.freeze({ label: "Medium", shortLabel: "Medium", provider: AI_PROVIDERS.OPENAI_DIRECT, model: "gpt-5.4-mini" }),
  Object.freeze({ label: "High", shortLabel: "High", provider: AI_PROVIDERS.OPENAI_DIRECT, model: "gpt-5.4" }),
  Object.freeze({ label: "Highest", shortLabel: "Highest", provider: AI_PROVIDERS.OPENAI_DIRECT, model: "gpt-5.5" }),
]);
export const DEFAULT_COPILOT_WEB_RESEARCH_PROVIDER = AI_PROVIDERS.OPENROUTER;
export const DEFAULT_COPILOT_WEB_RESEARCH_MODEL = "openai/gpt-5.4";
export const DEFAULT_COPILOT_WEB_RESEARCH_OPENAI_MODEL = "gpt-5.4";
export const DEFAULT_COPILOT_WEB_RESEARCH_MAX_OUTPUT_TOKENS = 3600;
export const DEFAULT_COPILOT_WEB_RESEARCH_TIMEOUT_MS = 120_000;
export const DEFAULT_CREATE_LISTOFDATES_PASS1_MODEL = "gpt-4.1";
export const DEFAULT_CREATE_LISTOFDATES_PASS1_MAX_OUTPUT_TOKENS = 9000;
export const DEFAULT_CREATE_LISTOFDATES_PASS1_TIMEOUT_MS = 120_000;
export const DEFAULT_CREATE_LISTOFDATES_PASS2_MODEL = "gpt-5.4-mini";
export const DEFAULT_CREATE_LISTOFDATES_PASS2_MAX_OUTPUT_TOKENS = 9000;
export const DEFAULT_CREATE_LISTOFDATES_PASS2_TIMEOUT_MS = 120_000;
export const DEFAULT_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS = 90_000;
export const DEFAULT_SOURCE_DESCRIPTION_OPENAI_MODEL = "gpt-5.4";
export const DEFAULT_SOURCE_DESCRIPTION_MODEL = "openai/gpt-4.1";
export const DEFAULT_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS = 6000;
export const DEFAULT_SOURCE_DESCRIPTION_TIMEOUT_MS = 240_000;
export const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_PROVIDER_SORTS = new Set(["price", "throughput", "latency"]);

const TASK_POLICIES = Object.freeze({
  [AI_TASKS.SKILL_ROUTER]: Object.freeze({
    task: AI_TASKS.SKILL_ROUTER,
    tier: "router",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "SKILL_ROUTER_PROVIDER",
    modelEnvKey: "OPENAI_MODEL",
    maxOutputTokensEnvKey: "OPENAI_ROUTER_MAX_OUTPUT_TOKENS",
    openRouterModelEnvKey: "OPENROUTER_SKILL_ROUTER_MODEL",
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_SKILL_ROUTER_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_SKILL_ROUTER_TIMEOUT_MS",
    defaultOpenRouterModel: DEFAULT_SKILL_ROUTER_OPENROUTER_MODEL,
    defaultMaxOutputTokens: DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
    defaultOpenRouterTimeoutMs: DEFAULT_SKILL_ROUTER_OPENROUTER_TIMEOUT_MS,
  }),
  [AI_TASKS.SKILL_DESIGN_INTERVIEW]: Object.freeze({
    task: AI_TASKS.SKILL_DESIGN_INTERVIEW,
    tier: "skill_design_interview",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "deterministic_fallback",
    providerEnvKey: "SKILL_INTERVIEW_PLANNER_PROVIDER",
    modelEnvKey: "OPENAI_SKILL_INTERVIEW_PLANNER_MODEL",
    maxOutputTokensEnvKey: "OPENAI_SKILL_INTERVIEW_PLANNER_MAX_OUTPUT_TOKENS",
    timeoutMsEnvKey: "OPENAI_SKILL_INTERVIEW_PLANNER_TIMEOUT_MS",
    defaultModel: DEFAULT_SKILL_DESIGN_INTERVIEW_MODEL,
    openRouterModelEnvKey: "OPENROUTER_SKILL_INTERVIEW_PLANNER_MODEL",
    defaultOpenRouterModel: DEFAULT_SKILL_DESIGN_INTERVIEW_OPENROUTER_MODEL,
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_SKILL_INTERVIEW_PLANNER_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_SKILL_INTERVIEW_PLANNER_TIMEOUT_MS",
    defaultMaxOutputTokens: DEFAULT_SKILL_DESIGN_INTERVIEW_MAX_OUTPUT_TOKENS,
    defaultTimeoutMs: DEFAULT_SKILL_DESIGN_INTERVIEW_TIMEOUT_MS,
  }),
  [AI_TASKS.SKILL_SAMPLE_OUTPUT]: Object.freeze({
    task: AI_TASKS.SKILL_SAMPLE_OUTPUT,
    tier: "skill_sample_output",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "SKILL_SAMPLE_OUTPUT_PROVIDER",
    modelEnvKey: "OPENAI_SKILL_SAMPLE_OUTPUT_MODEL",
    maxOutputTokensEnvKey: "OPENAI_SKILL_SAMPLE_OUTPUT_MAX_OUTPUT_TOKENS",
    timeoutMsEnvKey: "OPENAI_SKILL_SAMPLE_OUTPUT_TIMEOUT_MS",
    defaultModel: DEFAULT_SKILL_SAMPLE_OUTPUT_MODEL,
    openRouterModelEnvKey: "OPENROUTER_SKILL_SAMPLE_OUTPUT_MODEL",
    defaultOpenRouterModel: DEFAULT_SKILL_SAMPLE_OUTPUT_OPENROUTER_MODEL,
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_SKILL_SAMPLE_OUTPUT_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_SKILL_SAMPLE_OUTPUT_TIMEOUT_MS",
    defaultMaxOutputTokens: DEFAULT_SKILL_SAMPLE_OUTPUT_MAX_OUTPUT_TOKENS,
    defaultTimeoutMs: DEFAULT_SKILL_SAMPLE_OUTPUT_TIMEOUT_MS,
  }),
  [AI_TASKS.SKILL_AUTHORING]: Object.freeze({
    task: AI_TASKS.SKILL_AUTHORING,
    tier: "skill_authoring",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "SKILL_AUTHORING_PROVIDER",
    modelEnvKey: "OPENAI_SKILL_AUTHORING_MODEL",
    maxOutputTokensEnvKey: "OPENAI_SKILL_AUTHORING_MAX_OUTPUT_TOKENS",
    timeoutMsEnvKey: "OPENAI_SKILL_AUTHORING_TIMEOUT_MS",
    defaultModel: DEFAULT_SKILL_AUTHORING_MODEL,
    openRouterModelEnvKey: "OPENROUTER_SKILL_AUTHORING_MODEL",
    defaultOpenRouterModel: DEFAULT_SKILL_AUTHORING_OPENROUTER_MODEL,
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_SKILL_AUTHORING_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_SKILL_AUTHORING_TIMEOUT_MS",
    defaultMaxOutputTokens: DEFAULT_SKILL_AUTHORING_MAX_OUTPUT_TOKENS,
    defaultTimeoutMs: DEFAULT_SKILL_AUTHORING_TIMEOUT_MS,
  }),
  [AI_TASKS.CONFIGURABLE_SKILL_RUN]: Object.freeze({
    task: AI_TASKS.CONFIGURABLE_SKILL_RUN,
    tier: "configurable_skill_run",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "CONFIGURABLE_SKILL_RUN_PROVIDER",
    modelEnvKey: "OPENAI_CONFIGURABLE_SKILL_RUN_MODEL",
    maxOutputTokensEnvKey: "OPENAI_CONFIGURABLE_SKILL_RUN_MAX_OUTPUT_TOKENS",
    timeoutMsEnvKey: "OPENAI_CONFIGURABLE_SKILL_RUN_TIMEOUT_MS",
    defaultModel: DEFAULT_CONFIGURABLE_SKILL_RUN_MODEL,
    openRouterModelEnvKey: "OPENROUTER_CONFIGURABLE_SKILL_RUN_MODEL",
    defaultOpenRouterModel: DEFAULT_CONFIGURABLE_SKILL_RUN_OPENROUTER_MODEL,
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_CONFIGURABLE_SKILL_RUN_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_CONFIGURABLE_SKILL_RUN_TIMEOUT_MS",
    defaultMaxOutputTokens: DEFAULT_CONFIGURABLE_SKILL_RUN_MAX_OUTPUT_TOKENS,
    defaultTimeoutMs: DEFAULT_CONFIGURABLE_SKILL_RUN_TIMEOUT_MS,
  }),
  [AI_TASKS.COPILOT_ANSWER]: Object.freeze({
    task: AI_TASKS.COPILOT_ANSWER,
    tier: "copilot_answer",
    provider: DEFAULT_COPILOT_ANSWER_PROVIDER,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "COPILOT_ANSWER_PROVIDER",
    modelEnvKey: "OPENAI_COPILOT_ANSWER_MODEL",
    maxOutputTokensEnvKey: "OPENAI_COPILOT_ANSWER_MAX_OUTPUT_TOKENS",
    timeoutMsEnvKey: "OPENAI_COPILOT_ANSWER_TIMEOUT_MS",
    defaultModel: DEFAULT_COPILOT_ANSWER_OPENAI_MODEL,
    openRouterModelEnvKey: "OPENROUTER_COPILOT_ANSWER_MODEL",
    defaultOpenRouterModel: DEFAULT_COPILOT_ANSWER_MODEL,
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_COPILOT_ANSWER_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_COPILOT_ANSWER_TIMEOUT_MS",
    providerOrderEnvKey: "OPENROUTER_COPILOT_ANSWER_PROVIDER_ORDER",
    providerSortEnvKey: "OPENROUTER_COPILOT_ANSWER_PROVIDER_SORT",
    maxPromptPriceEnvKey: "OPENROUTER_COPILOT_ANSWER_MAX_PROMPT_PRICE",
    maxCompletionPriceEnvKey: "OPENROUTER_COPILOT_ANSWER_MAX_COMPLETION_PRICE",
    defaultMaxOutputTokens: DEFAULT_COPILOT_ANSWER_MAX_OUTPUT_TOKENS,
    defaultTimeoutMs: DEFAULT_COPILOT_ANSWER_TIMEOUT_MS,
  }),
  [AI_TASKS.COPILOT_WEB_RESEARCH]: Object.freeze({
    task: AI_TASKS.COPILOT_WEB_RESEARCH,
    tier: "copilot_web_research",
    provider: DEFAULT_COPILOT_WEB_RESEARCH_PROVIDER,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "COPILOT_WEB_RESEARCH_ANSWER_PROVIDER",
    modelEnvKey: "OPENAI_COPILOT_WEB_RESEARCH_ANSWER_MODEL",
    maxOutputTokensEnvKey: "OPENAI_COPILOT_WEB_RESEARCH_ANSWER_MAX_OUTPUT_TOKENS",
    timeoutMsEnvKey: "OPENAI_COPILOT_WEB_RESEARCH_ANSWER_TIMEOUT_MS",
    defaultModel: DEFAULT_COPILOT_WEB_RESEARCH_OPENAI_MODEL,
    openRouterModelEnvKey: "OPENROUTER_COPILOT_WEB_RESEARCH_ANSWER_MODEL",
    defaultOpenRouterModel: DEFAULT_COPILOT_WEB_RESEARCH_MODEL,
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_COPILOT_WEB_RESEARCH_ANSWER_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_COPILOT_WEB_RESEARCH_ANSWER_TIMEOUT_MS",
    defaultMaxOutputTokens: DEFAULT_COPILOT_WEB_RESEARCH_MAX_OUTPUT_TOKENS,
    defaultTimeoutMs: DEFAULT_COPILOT_WEB_RESEARCH_TIMEOUT_MS,
  }),
  [AI_TASKS.CREATE_LISTOFDATES_PASS1]: Object.freeze({
    task: AI_TASKS.CREATE_LISTOFDATES_PASS1,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "CREATE_LISTOFDATES_PASS1_PROVIDER",
    modelEnvKey: "OPENAI_CREATE_LISTOFDATES_PASS1_MODEL",
    maxOutputTokensEnvKey: "OPENAI_CREATE_LISTOFDATES_PASS1_MAX_OUTPUT_TOKENS",
    timeoutMsEnvKey: "OPENAI_CREATE_LISTOFDATES_PASS1_TIMEOUT_MS",
    defaultModel: DEFAULT_CREATE_LISTOFDATES_PASS1_MODEL,
    openRouterModelEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS1_MODEL",
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS1_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS1_TIMEOUT_MS",
    providerOrderEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS1_PROVIDER_ORDER",
    providerSortEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS1_PROVIDER_SORT",
    maxPromptPriceEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS1_MAX_PROMPT_PRICE",
    maxCompletionPriceEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS1_MAX_COMPLETION_PRICE",
    defaultMaxOutputTokens: DEFAULT_CREATE_LISTOFDATES_PASS1_MAX_OUTPUT_TOKENS,
    defaultTimeoutMs: DEFAULT_CREATE_LISTOFDATES_PASS1_TIMEOUT_MS,
  }),
  [AI_TASKS.CREATE_LISTOFDATES_PASS2]: Object.freeze({
    task: AI_TASKS.CREATE_LISTOFDATES_PASS2,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "CREATE_LISTOFDATES_PASS2_PROVIDER",
    modelEnvKey: "OPENAI_CREATE_LISTOFDATES_PASS2_MODEL",
    maxOutputTokensEnvKey: "OPENAI_CREATE_LISTOFDATES_PASS2_MAX_OUTPUT_TOKENS",
    timeoutMsEnvKey: "OPENAI_CREATE_LISTOFDATES_PASS2_TIMEOUT_MS",
    defaultModel: DEFAULT_CREATE_LISTOFDATES_PASS2_MODEL,
    openRouterModelEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS2_MODEL",
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS2_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS2_TIMEOUT_MS",
    providerOrderEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS2_PROVIDER_ORDER",
    providerSortEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS2_PROVIDER_SORT",
    maxPromptPriceEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS2_MAX_PROMPT_PRICE",
    maxCompletionPriceEnvKey: "OPENROUTER_CREATE_LISTOFDATES_PASS2_MAX_COMPLETION_PRICE",
    defaultMaxOutputTokens: DEFAULT_CREATE_LISTOFDATES_PASS2_MAX_OUTPUT_TOKENS,
    defaultTimeoutMs: DEFAULT_CREATE_LISTOFDATES_PASS2_TIMEOUT_MS,
  }),
  [AI_TASKS.SOURCE_BACKED_ANALYSIS]: Object.freeze({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    tier: "source_backed_analysis",
    provider: AI_PROVIDERS.OPENAI_DIRECT,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "SOURCE_BACKED_ANALYSIS_PROVIDER",
    modelEnvKey: "OPENAI_MODEL",
    maxOutputTokensEnvKey: "OPENAI_MAX_OUTPUT_TOKENS",
    defaultMaxOutputTokens: DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
    openRouterModelEnvKey: "OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL",
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS",
    providerOrderEnvKey: "OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_ORDER",
    providerSortEnvKey: "OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT",
    maxPromptPriceEnvKey: "OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_PROMPT_PRICE",
    maxCompletionPriceEnvKey: "OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_COMPLETION_PRICE",
    openRouterTimeoutMsEnvKey: "OPENROUTER_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS",
    defaultOpenRouterTimeoutMs: DEFAULT_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS,
  }),
  [AI_TASKS.SOURCE_DESCRIPTION]: Object.freeze({
    task: AI_TASKS.SOURCE_DESCRIPTION,
    tier: "source_description",
    provider: AI_PROVIDERS.OPENROUTER,
    endpoint: DEFAULT_RESPONSES_ENDPOINT,
    fallback: "fail_closed",
    providerEnvKey: "SOURCE_DESCRIPTION_PROVIDER",
    modelEnvKey: "OPENAI_SOURCE_DESCRIPTION_MODEL",
    maxOutputTokensEnvKey: "OPENAI_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS",
    timeoutMsEnvKey: "OPENAI_SOURCE_DESCRIPTION_TIMEOUT_MS",
    defaultModel: DEFAULT_SOURCE_DESCRIPTION_OPENAI_MODEL,
    openRouterModelEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_MODEL",
    openRouterMaxOutputTokensEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS",
    openRouterTimeoutMsEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_TIMEOUT_MS",
    providerOrderEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_ORDER",
    providerSortEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_PROVIDER_SORT",
    maxPromptPriceEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_MAX_PROMPT_PRICE",
    maxCompletionPriceEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_MAX_COMPLETION_PRICE",
    defaultOpenRouterModel: DEFAULT_SOURCE_DESCRIPTION_MODEL,
    defaultOpenRouterTimeoutMs: DEFAULT_SOURCE_DESCRIPTION_TIMEOUT_MS,
    defaultTimeoutMs: DEFAULT_SOURCE_DESCRIPTION_TIMEOUT_MS,
    defaultMaxOutputTokens: DEFAULT_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS,
  }),
});

const AI_TASK_STATUS_METADATA = Object.freeze([
  Object.freeze({
    task: AI_TASKS.SKILL_ROUTER,
    label: "Skill router",
    surface: "AI command routing",
  }),
  Object.freeze({
    task: AI_TASKS.SOURCE_DESCRIPTION,
    label: "/describe_sources",
    surface: "Source Index.json labels",
  }),
  Object.freeze({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    label: "/create_listofdates",
    surface: "Case Timeline chronology",
  }),
  Object.freeze({
    task: AI_TASKS.COPILOT_ANSWER,
    label: "Matter Copilot",
    surface: "Source-backed matter Q&A",
  }),
]);

export function listAiTaskStatusMetadata() {
  return AI_TASK_STATUS_METADATA.map((item) => {
    const policy = TASK_POLICIES[item.task];
    if (!policy) throw new Error(`Missing model policy for AI task status metadata: ${item.task}`);
    return {
      ...item,
      modelEnvKey: policy.modelEnvKey || "",
      openRouterModelEnvKey: policy.openRouterModelEnvKey || policy.modelEnvKey || "",
    };
  });
}

export function resolveModelPolicy(task, { env = process.env } = {}) {
  const base = TASK_POLICIES[task];
  if (!base) {
    const error = new Error(`Unknown AI task: ${task || "none"}`);
    error.statusCode = 400;
    throw error;
  }

  const provider = resolveTaskProvider(base, env);
  const policy = {
    policyVersion: MODEL_POLICY_VERSION,
    task: base.task,
    tier: base.tier,
    provider,
    endpoint: provider === AI_PROVIDERS.OPENROUTER ? DEFAULT_OPENROUTER_ENDPOINT : base.endpoint,
    model: modelForProvider(base, env, provider),
    maxOutputTokens: maxOutputTokensForProvider(base, env, provider),
    ...timeoutForProvider(base, env, provider),
    fallback: base.fallback,
    ...(provider === AI_PROVIDERS.OPENROUTER && base.providerOrderEnvKey ? { providerOrder: parseProviderOrder(env[base.providerOrderEnvKey]) } : {}),
    ...(provider === AI_PROVIDERS.OPENROUTER && base.providerSortEnvKey ? parseProviderSortSetting(env[base.providerSortEnvKey]) : {}),
    ...(provider === AI_PROVIDERS.OPENROUTER && (base.maxPromptPriceEnvKey || base.maxCompletionPriceEnvKey)
      ? parseMaxPriceSetting(env[base.maxPromptPriceEnvKey], env[base.maxCompletionPriceEnvKey])
      : {}),
  };
  validateOpenRouterRouting(policy);
  return policy;
}

function resolveTaskProvider(base, env) {
  const configured = base.providerEnvKey ? String(env[base.providerEnvKey] || "").trim() : "";
  if (!configured) return base.provider;
  if (configured === AI_PROVIDERS.OPENAI_DIRECT) return AI_PROVIDERS.OPENAI_DIRECT;
  if (configured === AI_PROVIDERS.OPENROUTER) return AI_PROVIDERS.OPENROUTER;
  const error = new Error(`Unsupported provider for ${base.task}: ${configured}`);
  error.statusCode = 400;
  throw error;
}

function modelForProvider(base, env, provider) {
  if (provider === AI_PROVIDERS.OPENROUTER) {
    return env[base.openRouterModelEnvKey || base.modelEnvKey] || base.defaultOpenRouterModel || "";
  }
  return env[base.modelEnvKey] || base.defaultModel || DEFAULT_OPENAI_MODEL;
}

function maxOutputTokensForProvider(base, env, provider) {
  if (provider === AI_PROVIDERS.OPENROUTER) {
    return parsePositiveInteger(env[base.openRouterMaxOutputTokensEnvKey || base.maxOutputTokensEnvKey])
      || base.defaultMaxOutputTokens;
  }
  return parsePositiveInteger(env[base.maxOutputTokensEnvKey]) || base.defaultMaxOutputTokens;
}

function timeoutForProvider(base, env, provider) {
  if (provider === AI_PROVIDERS.OPENROUTER) {
    const timeoutEnvKey = base.openRouterTimeoutMsEnvKey || base.timeoutMsEnvKey;
    const defaultTimeoutMs = base.defaultOpenRouterTimeoutMs || base.defaultTimeoutMs;
    return timeoutEnvKey ? { timeoutMs: parsePositiveInteger(env[timeoutEnvKey]) || defaultTimeoutMs } : {};
  }
  return base.timeoutMsEnvKey ? { timeoutMs: parsePositiveInteger(env[base.timeoutMsEnvKey]) || base.defaultTimeoutMs } : {};
}

export function listModelPolicyTasks() {
  return Object.keys(TASK_POLICIES);
}

export function listCopilotModelPresets() {
  return COPILOT_MODEL_PRESETS.map((preset) => ({ ...preset }));
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
