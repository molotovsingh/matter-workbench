import {
  extractResponsesOutputText,
  fetchProviderJsonWithTimeout,
  parseOpenAiJsonOutput,
} from "./provider-http.mjs";

export const DEFAULT_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export async function requestResponsesJson({
  apiKey,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
  body,
  missingApiKeyMessage = "OPENAI_API_KEY is required",
  fetchImpl = fetch,
  timeoutMs,
} = {}) {
  if (!apiKey) {
    const error = new Error(missingApiKeyMessage);
    error.statusCode = 409;
    throw error;
  }

  const payload = await fetchResponses({ apiKey, endpoint, body, fetchImpl, timeoutMs });
  return parseOpenAiJsonOutput(payload, "OpenAI response");
}

export async function fetchResponses({
  apiKey,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
  body,
  fetchImpl = fetch,
  timeoutMs,
} = {}) {
  return fetchProviderJsonWithTimeout({
    fetchImpl,
    endpoint,
    apiKey,
    body,
    timeoutMs,
    timeoutMessage: timeoutMs ? `OpenAI Responses API request timed out after ${timeoutMs}ms` : "OpenAI Responses API request timed out",
    isErrorPayload: ({ response, payload }) => !response.ok || Boolean(payload?.error),
  });
}

export { extractResponsesOutputText };
