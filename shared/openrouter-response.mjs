export function createRequestSignal(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return {
      signal: null,
      cancelTimeout: () => {},
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancelTimeout: () => clearTimeout(timer),
  };
}

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
