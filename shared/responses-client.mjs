export const DEFAULT_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

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
    const error = new Error(payload?.error?.message || `OpenAI Responses API returned ${response.status}`);
    error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
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
