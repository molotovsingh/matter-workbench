import { AI_PROVIDERS } from "./model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT } from "./responses-client.mjs";

const OPENROUTER_PROVIDER_SORTS = new Set(["price", "throughput", "latency"]);

export function resolveProviderConfig(policy, overrides = {}) {
  assertSupportedProvider(policy);

  if (policy.provider === AI_PROVIDERS.OPENROUTER) {
    const providerConfig = {
      provider: policy.provider,
      endpoint: overrides.endpoint || policy.endpoint,
      model: overrides.model || policy.model,
      maxOutputTokens: parsePositiveInteger(overrides.maxOutputTokens) || policy.maxOutputTokens,
      providerOrder: normalizeProviderOrder(overrides.providerOrder) || policy.providerOrder || [],
      providerSort: normalizeOptionalString(overrides.providerSort) || policy.providerSort || "",
      maxPrice: normalizeMaxPrice(overrides.maxPrice) || policy.maxPrice || null,
      requireParameters: true,
      allowFallbacks: false,
    };
    validateOpenRouterRouting(providerConfig);
    return providerConfig;
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

function normalizeOptionalString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeMaxPrice(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prompt = parsePositiveNumber(value.prompt);
  const completion = parsePositiveNumber(value.completion);
  const maxPrice = {};
  if (prompt !== null) maxPrice.prompt = prompt;
  if (completion !== null) maxPrice.completion = completion;
  return Object.keys(maxPrice).length ? maxPrice : null;
}

function parsePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validateOpenRouterRouting(config) {
  if (config.providerSort && !OPENROUTER_PROVIDER_SORTS.has(config.providerSort)) {
    const error = new Error(`Invalid OpenRouter provider sort: ${config.providerSort}`);
    error.statusCode = 400;
    throw error;
  }

  if (config.providerOrder.length && (config.providerSort || config.maxPrice)) {
    const error = new Error("OpenRouter provider order cannot be combined with provider sort or max price routing.");
    error.statusCode = 400;
    throw error;
  }
}
