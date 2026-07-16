import { modelPolicyMetadata, resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import { AI_PROVIDERS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { createListOfDatesProvider } from "./providers.mjs";

export const TWO_PASS_ENV_FLAG = "CREATE_LISTOFDATES_TWO_PASS_ENABLED";
export const DEFAULT_CASE_TIMELINE_MAX_OUTPUT_TOKENS = 9000;
export const OPENAI_CASE_TIMELINE_MAX_OUTPUT_TOKENS_ENV = "OPENAI_CASE_TIMELINE_MAX_OUTPUT_TOKENS";
export const OPENROUTER_CASE_TIMELINE_MAX_OUTPUT_TOKENS_ENV = "OPENROUTER_CASE_TIMELINE_MAX_OUTPUT_TOKENS";

export function isTwoPassListOfDatesEnabled({ env, options }) {
  if (typeof options.twoPass === "boolean") return options.twoPass;
  return ["1", "true", "yes", "on"].includes(String(env[TWO_PASS_ENV_FLAG] || "").trim().toLowerCase());
}

export function createConfiguredListOfDatesProvider({
  task,
  options,
  env,
  prompt,
  injectedProvider,
  providerFactory = createListOfDatesProvider,
}) {
  const modelPolicy = resolveModelPolicy(task, { env });
  const providerConfig = resolveProviderConfig(modelPolicy, {
    endpoint: options.endpoint,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
  });
  providerConfig.maxOutputTokens = caseTimelineMaxOutputTokens({
    explicitValue: options.maxOutputTokens,
    provider: providerConfig.provider,
    policyValue: providerConfig.maxOutputTokens,
    env,
  });
  const baseAiRun = modelPolicyMetadata(modelPolicy, providerConfig);
  const providerArgs = {
    providerConfig,
    apiKey: options.apiKey,
    env,
    fetchImpl: options.fetchImpl || fetch,
    prompt,
  };
  if (providerFactory === createListOfDatesProvider) {
    providerArgs.task = task;
    providerArgs.providerService = options.providerService;
  }
  const provider = injectedProvider || providerFactory(providerArgs);
  return { provider, baseAiRun };
}

export function caseTimelineMaxOutputTokens({
  explicitValue,
  provider = "",
  policyValue,
  env = {},
} = {}) {
  const explicit = positiveInteger(explicitValue);
  if (explicit) return explicit;
  const dedicatedKey = provider === AI_PROVIDERS.OPENROUTER
    ? OPENROUTER_CASE_TIMELINE_MAX_OUTPUT_TOKENS_ENV
    : OPENAI_CASE_TIMELINE_MAX_OUTPUT_TOKENS_ENV;
  const dedicated = positiveInteger(env[dedicatedKey]);
  if (dedicated) return dedicated;
  return Math.max(positiveInteger(policyValue) || 0, DEFAULT_CASE_TIMELINE_MAX_OUTPUT_TOKENS);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}
