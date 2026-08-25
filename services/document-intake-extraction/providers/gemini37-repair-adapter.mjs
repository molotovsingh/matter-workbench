import { createPinnedProviderAdapter } from "./pinned-provider-adapter.mjs";
import { fetchProviderJson, providerError } from "./provider-http.mjs";

export const GEMINI37_REPAIR_CAPABILITY = Object.freeze({
  provider: "gemini",
  model: "gemini-3.7-flash",
  adapterVersion: "gemini37-legal-page-repair-adapter/1.0.0-thinking-low",
});

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    page: { type: "integer" },
    markdown: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["page", "markdown", "warnings"],
};

export function createGemini37RepairPageAdapter({
  apiKey,
  endpointBase = "https://generativelanguage.googleapis.com/v1beta",
  fetchImpl = fetch,
  timeoutMs = 180_000,
  thinkingLevel = "LOW",
  inputUsdPerMillionTokens = 0.75,
  outputUsdPerMillionTokens = 3.75,
} = {}) {
  const secret = requiredSecret(apiKey, "Gemini API key");
  const normalizedThinking = normalizeThinkingLevel(thinkingLevel);
  if (normalizedThinking !== "LOW") throw new Error("controlled Gemini 3.7 repair evidence is pinned to LOW thinking");
  const inputPrice = positiveNumber(inputUsdPerMillionTokens, "inputUsdPerMillionTokens");
  const outputPrice = positiveNumber(outputUsdPerMillionTokens, "outputUsdPerMillionTokens");
  const endpoint = `${String(endpointBase).replace(/\/+$/, "")}/models/${encodeURIComponent(GEMINI37_REPAIR_CAPABILITY.model)}:generateContent`;
  return createPinnedProviderAdapter({
    ...GEMINI37_REPAIR_CAPABILITY,
    async extractPage({ pageNumber, source }) {
      const pdfBytes = await readPageBytes(source);
      const { payload, requestId } = await fetchProviderJson({
        fetchImpl,
        url: endpoint,
        provider: "Gemini repair",
        timeoutMs,
        apiKey: secret,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": secret },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: repairPrompt(pageNumber) },
                { inlineData: { mimeType: "application/pdf", data: pdfBytes.toString("base64") } },
              ],
            }],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: RESPONSE_SCHEMA,
              thinkingConfig: { thinkingLevel: normalizedThinking },
            },
          }),
        },
      });
      const usage = normalizeUsage(payload.usageMetadata);
      const billedCostUsd = usage.inputUnits * inputPrice / 1_000_000 + usage.outputUnits * outputPrice / 1_000_000;
      const finishReason = String(payload.candidates?.[0]?.finishReason || "complete").toLowerCase();
      let parsed;
      try {
        parsed = parseGeminiJson(payload);
      } catch (error) {
        throw providerError("Gemini repair returned an invalid structured page", "provider.invalid_response", {
          retryable: false,
          billingKnown: true,
          requestId,
          usage,
          billedCostUsd,
          finishReason,
          cause: error,
        });
      }
      return {
        pageNumber,
        text: parsed.markdown,
        finishReason,
        requestId,
        usage,
        billedCostUsd,
        diagnostics: Array.isArray(parsed.warnings) ? parsed.warnings.map((warning) => String(warning).slice(0, 300)) : [],
      };
    },
  });
}

function repairPrompt(pageNumber) {
  return [
    `Transcribe visible text from legal-document page ${pageNumber}.`,
    "Return the visible text only; do not summarize, infer missing words, normalize legal meaning, or add analysis.",
    "Preserve reading order, useful line breaks, dates, amounts, party names, section references, and exhibit marks exactly.",
    "If text is illegible, omit it and add a short warning rather than guessing.",
    `Return strict JSON with page=${pageNumber}, markdown, and warnings.`,
  ].join(" ");
}

function parseGeminiJson(payload) {
  if (payload && typeof payload.markdown === "string") return payload;
  const text = (payload.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) throw new Error("missing response text");
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
  if (!parsed || typeof parsed.markdown !== "string" || !Array.isArray(parsed.warnings)) throw new Error("response schema mismatch");
  return parsed;
}

function normalizeUsage(value = {}) {
  const inputUnits = nonNegativeNumber(value.promptTokenCount);
  const candidateUnits = nonNegativeNumber(value.candidatesTokenCount);
  const thinkingUnits = nonNegativeNumber(value.thoughtsTokenCount);
  return { inputUnits, outputUnits: candidateUnits + thinkingUnits };
}

async function readPageBytes(source = {}) {
  if (typeof source.readBytes !== "function") throw new Error("Gemini repair adapter requires source.readBytes");
  const bytes = await source.readBytes();
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buffer.length) throw new Error("Gemini repair adapter received an empty PDF page");
  return buffer;
}

function normalizeThinkingLevel(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!["MINIMAL", "LOW", "MEDIUM", "HIGH"].includes(normalized)) throw new Error("Gemini thinking level is invalid");
  return normalized;
}

function requiredSecret(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
