export function parseOpenRouterJsonContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    try {
      return attachOpenRouterAiRunMetadata(JSON.parse(content), payload);
    } catch (parseError) {
      const error = new Error(`OpenRouter response did not include valid JSON message content: ${parseError.message}`);
      error.statusCode = 502;
      throw error;
    }
  }
  if (content && typeof content === "object") return attachOpenRouterAiRunMetadata(content, payload);
  const error = new Error("OpenRouter response did not include JSON message content");
  error.statusCode = 502;
  throw error;
}

export function createOpenRouterProviderError(response, payload) {
  const errorPayload = payload?.error || {};
  const error = new Error(formatOpenRouterErrorMessage(response, errorPayload));
  error.statusCode = mapOpenRouterErrorStatus(response?.status, errorPayload.code);
  const providerName = normalizeOptionalString(errorPayload?.metadata?.provider_name);
  if (providerName) error.providerName = providerName;
  if (errorPayload.code) error.openRouterCode = errorPayload.code;
  return error;
}

export function formatOpenRouterErrorMessage(response, errorPayload = {}) {
  const baseMessage = normalizeOptionalString(errorPayload.message) || `OpenRouter returned ${response?.status || "an error"}`;
  const providerName = normalizeOptionalString(errorPayload?.metadata?.provider_name);
  const rawMessage = summarizeOpenRouterRawError(errorPayload?.metadata?.raw);
  const parts = [baseMessage];
  if (providerName) parts.push(`provider: ${providerName}`);
  if (rawMessage) parts.push(`upstream: ${rawMessage}`);
  return parts.join(" | ");
}

export function summarizeOpenRouterRawError(raw) {
  if (!raw) return "";
  if (typeof raw === "string") {
    try {
      return summarizeOpenRouterRawError(JSON.parse(raw)) || truncateOpenRouterErrorDetail(raw);
    } catch {
      return truncateOpenRouterErrorDetail(raw);
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return truncateOpenRouterErrorDetail(String(raw));
  const message = normalizeOptionalString(raw?.error?.message)
    || normalizeOptionalString(raw?.message)
    || normalizeOptionalString(raw?.error);
  if (message) return truncateOpenRouterErrorDetail(message);
  try {
    return truncateOpenRouterErrorDetail(JSON.stringify(raw));
  } catch {
    return "";
  }
}

export function truncateOpenRouterErrorDetail(value, limit = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}...`;
}

export function mapOpenRouterErrorStatus(responseStatus, errorCode) {
  const status = Number(errorCode) || Number(responseStatus);
  if (status >= 500) return 503;
  return 502;
}

export function attachOpenRouterAiRunMetadata(content, payload) {
  const aiRun = extractOpenRouterAiRunMetadata(payload);
  if (!Object.keys(aiRun).length) return content;
  return {
    ...content,
    ai_run: aiRun,
  };
}

export function extractOpenRouterAiRunMetadata(payload) {
  const metadata = {};
  const returnedModel = normalizeOptionalString(payload?.model);
  const returnedProvider = normalizeOptionalString(payload?.provider)
    || normalizeOptionalString(payload?.provider_name)
    || normalizeOptionalString(payload?.choices?.[0]?.provider);
  const usage = normalizeOpenRouterUsage(payload?.usage);
  if (returnedModel) metadata.returnedModel = returnedModel;
  if (returnedProvider) metadata.returnedProvider = returnedProvider;
  if (usage) metadata.usage = usage;
  return metadata;
}

export function normalizeOpenRouterUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const normalized = {};
  const promptTokens = parseNonNegativeInteger(usage.prompt_tokens ?? usage.promptTokens);
  const completionTokens = parseNonNegativeInteger(usage.completion_tokens ?? usage.completionTokens);
  const totalTokens = parseNonNegativeInteger(usage.total_tokens ?? usage.totalTokens);
  const cost = parseNonNegativeNumber(usage.cost);
  if (promptTokens !== null) normalized.promptTokens = promptTokens;
  if (completionTokens !== null) normalized.completionTokens = completionTokens;
  if (totalTokens !== null) normalized.totalTokens = totalTokens;
  if (cost !== null) normalized.cost = cost;
  return Object.keys(normalized).length ? normalized : null;
}

export function normalizeOptionalString(value) {
  const text = String(value || "").trim();
  return text || "";
}

function parseNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function parseNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
