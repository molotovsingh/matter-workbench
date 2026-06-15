export const DEFAULT_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const PROVIDER_QUOTA_EXCEEDED_CODE = "provider.quota_exceeded";
const PROVIDER_QUOTA_EXCEEDED_MESSAGE = "AI quota or billing limit reached. Ask the operator to check the AI account before trying again.";

export async function requestResponsesJson({
  apiKey,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
  body,
  missingApiKeyMessage = "OPENAI_API_KEY is required",
} = {}) {
  if (!apiKey) {
    const error = new Error(missingApiKeyMessage);
    error.statusCode = 409;
    throw error;
  }

  const payload = await fetchResponses({ apiKey, endpoint, body });
  const outputText = extractResponsesOutputText(payload);
  if (!outputText) {
    const error = new Error("OpenAI response did not include output text");
    error.statusCode = 502;
    throw error;
  }
  try {
    return JSON.parse(outputText);
  } catch (parseError) {
    const error = new Error(`OpenAI response was not valid JSON: ${parseError.message}`);
    error.statusCode = 502;
    throw error;
  }
}

export async function fetchResponses({ apiKey, endpoint = DEFAULT_RESPONSES_ENDPOINT, body } = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const providerMessage = payload?.error?.message || `OpenAI Responses API returned ${response.status}`;
    const code = classifyResponsesProviderErrorCode(payload, providerMessage);
    const error = new Error(providerErrorMessageForCode(code, providerMessage));
    error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
    error.code = code;
    throw error;
  }
  return payload;
}

export function extractResponsesOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("").trim();
}

function classifyResponsesProviderErrorCode(payload, message = "") {
  const providerCode = typeof payload?.error?.code === "string" ? payload.error.code : "";
  const providerType = typeof payload?.error?.type === "string" ? payload.error.type : "";
  const haystack = `${providerCode} ${providerType} ${message}`.toLowerCase();
  if (
    haystack.includes("insufficient_quota")
    || haystack.includes("exceeded your current quota")
    || haystack.includes("billing")
    || haystack.includes("payment required")
  ) {
    return PROVIDER_QUOTA_EXCEEDED_CODE;
  }
  return "provider.error";
}

function providerErrorMessageForCode(code, message = "") {
  if (code === PROVIDER_QUOTA_EXCEEDED_CODE) return PROVIDER_QUOTA_EXCEEDED_MESSAGE;
  return message;
}
