import { AI_PROVIDERS } from "./model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT } from "./responses-client.mjs";

export function resolveProviderConfig(policy, overrides = {}) {
  assertSupportedProvider(policy);

  if (policy.provider === AI_PROVIDERS.OPENROUTER) {
    return {
      provider: policy.provider,
      endpoint: overrides.endpoint || policy.endpoint,
      model: overrides.model || policy.model,
      maxOutputTokens: parsePositiveInteger(overrides.maxOutputTokens) || policy.maxOutputTokens,
      providerOrder: normalizeProviderOrder(overrides.providerOrder) || policy.providerOrder || [],
      requireParameters: true,
      allowFallbacks: false,
    };
  }

  return {
    provider: policy.provider,
    endpoint: overrides.endpoint || policy.endpoint || DEFAULT_RESPONSES_ENDPOINT,
    model: overrides.model || policy.model,
    maxOutputTokens: parsePositiveInteger(overrides.maxOutputTokens) || policy.maxOutputTokens,
  };
}

export function modelPolicyMetadata(policy, providerConfig = resolveProviderConfig(policy)) {
  assertSupportedProvider(policy);

  return {
    policyVersion: policy.policyVersion,
    task: policy.task,
    tier: policy.tier,
    provider: providerConfig.provider,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    fallback: policy.fallback,
  };
}

function assertSupportedProvider(policy) {
  if (policy?.provider === AI_PROVIDERS.OPENAI_DIRECT) return;
  if (policy?.provider === AI_PROVIDERS.OPENROUTER) return;

  const error = new Error(`Unsupported AI provider: ${policy?.provider || "none"}`);
  error.statusCode = 400;
  throw error;
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeProviderOrder(value) {
  if (Array.isArray(value)) return value.map((provider) => String(provider).trim()).filter(Boolean);
  if (typeof value !== "string") return null;
  const providers = value.split(",").map((provider) => provider.trim()).filter(Boolean);
  return providers.length ? providers : null;
}
