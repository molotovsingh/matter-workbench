import { extractResponsesOutputText } from "./responses-client.mjs";
import { makeHttpError } from "./safe-paths.mjs";

export async function fetchProviderJsonWithTimeout({
  fetchImpl,
  endpoint,
  apiKey,
  body,
  timeoutMs,
  extraHeaders = {},
  isErrorPayload = defaultProviderErrorPredicate,
  mapProviderError,
  timeoutMessage,
}) {
  const controller = Number.isInteger(timeoutMs) && timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    payload = await response.json().catch((error) => {
      if (controller?.signal.aborted || error?.name === "AbortError") throw error;
      return null;
    });
  } catch (error) {
    if (controller?.signal.aborted || error?.name === "AbortError") {
      throw makeHttpError(timeoutMessage || `Provider request timed out after ${timeoutMs}ms`, 504, "provider.timeout");
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (isErrorPayload({ response, payload })) {
    if (mapProviderError) throw mapProviderError(response, payload);
    const message = formatProviderErrorMessage(response, payload);
    throw makeHttpError(message, response?.status >= 400 && response.status < 500 ? 502 : 503, "provider.error");
  }
  return payload;
}

function defaultProviderErrorPredicate({ response, payload }) {
  return !response.ok || Boolean(payload?.error) || Boolean(firstChoiceError(payload));
}

export function parseOpenAiJsonOutput(payload, label) {
  const outputText = extractResponsesOutputText(payload);
  if (!outputText) throw makeHttpError(`${label} response did not include output text`, 502, "provider.empty_output");
  try {
    return JSON.parse(outputText);
  } catch (error) {
    throw makeHttpError(`${label} response was not valid JSON: ${error.message}`, 502, "provider.invalid_json");
  }
}

export function extractOpenAiOutputText(payload, label) {
  const outputText = extractResponsesOutputText(payload);
  if (!outputText) throw makeHttpError(`${label} response did not include output text`, 502, "provider.empty_output");
  return outputText;
}

export function parseOpenRouterJsonMessage(payload, label) {
  const choiceError = firstChoiceError(payload);
  if (choiceError) throw makeHttpError(formatProviderErrorMessage(null, { error: choiceError }), 502, "provider.error");
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw makeHttpError(`${label} response was not valid JSON: ${error.message}`, 502, "provider.invalid_json");
    }
  }
  if (content && typeof content === "object") return content;
  throw makeHttpError(`${label} response did not include JSON message content`, 502, "provider.empty_output");
}

function formatProviderErrorMessage(response, payload) {
  const error = payload?.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
    const rawMessage = summarizeRawProviderError(error.metadata?.raw);
    if (rawMessage) return rawMessage;
  }
  return `Provider returned ${response?.status || "an error"}`;
}

function firstChoiceError(payload) {
  if (!Array.isArray(payload?.choices)) return null;
  return payload.choices.find((choice) => choice?.error)?.error || null;
}

function summarizeRawProviderError(raw) {
  if (!raw) return "";
  if (typeof raw === "string") {
    try {
      return summarizeRawProviderError(JSON.parse(raw)) || truncateProviderError(raw);
    } catch {
      return truncateProviderError(raw);
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return truncateProviderError(String(raw));
  const message = raw?.error?.message || raw?.message || raw?.error;
  if (typeof message === "string" && message.trim()) return truncateProviderError(message);
  try {
    return truncateProviderError(JSON.stringify(raw));
  } catch {
    return "";
  }
}

function truncateProviderError(value, limit = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}...`;
}

export function extractOpenRouterMessageText(payload, label) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  throw makeHttpError(`${label} response did not include message content`, 502, "provider.empty_output");
}
