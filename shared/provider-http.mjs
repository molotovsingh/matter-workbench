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
      throw makeHttpError(timeoutMessage || `Provider request timed out after ${timeoutMs}ms`, 504);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (isErrorPayload({ response, payload })) {
    if (mapProviderError) throw mapProviderError(response, payload);
    const message = payload?.error?.message || `Provider returned ${response?.status || "an error"}`;
    throw makeHttpError(message, response?.status >= 400 && response.status < 500 ? 502 : 503);
  }
  return payload;
}

function defaultProviderErrorPredicate({ response, payload }) {
  return !response.ok || Boolean(payload?.error);
}

export function parseOpenAiJsonOutput(payload, label) {
  const outputText = extractResponsesOutputText(payload);
  if (!outputText) throw makeHttpError(`${label} response did not include output text`, 502);
  try {
    return JSON.parse(outputText);
  } catch (error) {
    throw makeHttpError(`${label} response was not valid JSON: ${error.message}`, 502);
  }
}

export function extractOpenAiOutputText(payload, label) {
  const outputText = extractResponsesOutputText(payload);
  if (!outputText) throw makeHttpError(`${label} response did not include output text`, 502);
  return outputText;
}

export function parseOpenRouterJsonMessage(payload, label) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw makeHttpError(`${label} response was not valid JSON: ${error.message}`, 502);
    }
  }
  if (content && typeof content === "object") return content;
  throw makeHttpError(`${label} response did not include JSON message content`, 502);
}

export function extractOpenRouterMessageText(payload, label) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  throw makeHttpError(`${label} response did not include message content`, 502);
}
