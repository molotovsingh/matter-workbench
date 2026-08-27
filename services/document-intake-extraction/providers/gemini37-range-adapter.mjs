import { CONTRACT_VERSIONS, assertPinnedProviderCapability, normalizeProviderResult } from "../../../packages/extraction-contracts/index.mjs";
import { fetchProviderJson, providerError, resolveAttemptTimeoutMs } from "./provider-http.mjs";

export const GEMINI37_RANGE_CAPABILITY = Object.freeze({
  provider: "gemini",
  model: "gemini-3.7-flash",
  adapterVersion: "gemini37-document-range-adapter/1.0.0-thinking-low",
});

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          markdown: { type: "string" },
          warnings: { type: "array", items: { type: "string" } },
        },
        required: ["page", "markdown", "warnings"],
      },
    },
  },
  required: ["pages"],
};

export function createGemini37RangeAdapter({
  apiKey,
  endpointBase = "https://generativelanguage.googleapis.com/v1beta",
  fetchImpl = fetch,
  timeoutMs = 180_000,
  firstAttemptTimeoutMs = 60_000,
  thinkingLevel = "LOW",
  inputUsdPerMillionTokens = 0.75,
  outputUsdPerMillionTokens = 3.75,
  maximumPages = 32,
} = {}) {
  const secret = requiredSecret(apiKey, "Gemini API key");
  const capability = assertPinnedProviderCapability(GEMINI37_RANGE_CAPABILITY);
  const normalizedThinking = String(thinkingLevel || "").trim().toUpperCase();
  if (normalizedThinking !== "LOW") throw new Error("controlled Gemini 3.7 range evidence is pinned to LOW thinking");
  const inputPrice = positiveNumber(inputUsdPerMillionTokens, "inputUsdPerMillionTokens");
  const outputPrice = positiveNumber(outputUsdPerMillionTokens, "outputUsdPerMillionTokens");
  const pageLimit = boundedInteger(maximumPages, "maximumPages", 1, 32);
  const firstTimeout = positiveNumber(firstAttemptTimeoutMs, "firstAttemptTimeoutMs");
  const endpoint = `${String(endpointBase).replace(/\/+$/, "")}/models/${encodeURIComponent(GEMINI37_RANGE_CAPABILITY.model)}:generateContent`;
  return Object.freeze({
    capability,
    async extractPages({ pageNumbers, source, attemptNumber } = {}) {
      const pagesRequested = normalizeContiguousPages(pageNumbers, pageLimit);
      const pdfBytes = await readBoundedRangeBytes(source);
      const { payload, requestId } = await fetchProviderJson({
        fetchImpl,
        url: endpoint,
        provider: "Gemini range",
        timeoutMs: resolveAttemptTimeoutMs({ attemptNumber, firstAttemptTimeoutMs: firstTimeout, timeoutMs }),
        apiKey: secret,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": secret },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: rangePrompt(pagesRequested) },
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
      let providerPages;
      try {
        providerPages = parseGeminiRangeJson(payload);
      } catch (error) {
        throw providerError("Gemini range returned an invalid structured page set", "provider.invalid_response", {
          retryable: false,
          billingKnown: true,
          requestId,
          usage,
          billedCostUsd,
          finishReason,
          cause: error,
        });
      }
      if (providerPages.length !== pagesRequested.length) {
        throw providerError(`Gemini range returned ${providerPages.length} pages for a ${pagesRequested.length}-page range`, "provider.invalid_response", {
          retryable: false,
          billingKnown: true,
          requestId,
          usage,
          billedCostUsd,
          finishReason,
        });
      }
      // Bind results to pages by the provider's own page labels, not by array
      // position: a reordered response with the right count would otherwise
      // publish each page's text under a neighbouring page number. Labels
      // that do not form exactly the requested set are unusable, so fail
      // billably rather than guess.
      const byLabel = new Map(providerPages.map((providerPage) => [Number(providerPage.page), providerPage]));
      const labelled = byLabel.size === pagesRequested.length && pagesRequested.every((pageNumber) => byLabel.has(pageNumber));
      if (!labelled && providerPages.some((providerPage) => Number.isSafeInteger(Number(providerPage.page)))) {
        throw providerError("Gemini range labelled pages that do not match the requested range", "provider.invalid_response", {
          retryable: false,
          billingKnown: true,
          requestId,
          usage,
          billedCostUsd,
          finishReason,
        });
      }
      const orderedPages = labelled ? pagesRequested.map((pageNumber) => byLabel.get(pageNumber)) : providerPages;
      const perPageCost = billedCostUsd / pagesRequested.length;
      const perPageInput = usage.inputUnits / pagesRequested.length;
      const perPageOutput = usage.outputUnits / pagesRequested.length;
      return orderedPages.map((providerPage, index) => {
        const diagnostics = Array.isArray(providerPage.warnings) ? providerPage.warnings.map((warning) => String(warning).slice(0, 300)) : [];
        if (!labelled) diagnostics.push("provider_page_labels_absent_position_mapped");
        return normalizeProviderResult({
          schemaVersion: CONTRACT_VERSIONS.providerResult,
          pageNumber: pagesRequested[index],
          text: typeof providerPage.markdown === "string" ? providerPage.markdown : "",
          finishReason,
          requestId,
          usage: { inputUnits: perPageInput, outputUnits: perPageOutput },
          billedCostUsd: perPageCost,
          diagnostics,
        }, { pageNumber: pagesRequested[index] });
      });
    },
  });
}

function rangePrompt(pagesRequested) {
  const first = pagesRequested[0];
  const last = pagesRequested.at(-1);
  return [
    `This PDF contains ${pagesRequested.length} page(s), which are pages ${first} to ${last} of a larger legal document.`,
    "Transcribe the visible text of every page, one entry per page, in order.",
    "Return the visible text only; do not summarize, infer missing words, normalize legal meaning, or add analysis.",
    "Preserve reading order, useful line breaks, dates, amounts, party names, section references, and exhibit marks exactly.",
    "If text is illegible, omit it and add a short warning for that page rather than guessing.",
    `Return strict JSON with a pages array of exactly ${pagesRequested.length} entries; each entry has page (numbered ${first} to ${last}), markdown, and warnings.`,
  ].join(" ");
}

function parseGeminiRangeJson(payload) {
  const direct = payload && Array.isArray(payload.pages) ? payload : null;
  const parsed = direct || (() => {
    const text = (payload.candidates || [])
      .flatMap((candidate) => candidate?.content?.parts || [])
      .map((part) => typeof part?.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) throw new Error("missing response text");
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
  })();
  if (!parsed || !Array.isArray(parsed.pages)) throw new Error("response schema mismatch");
  for (const entry of parsed.pages) {
    if (!entry || typeof entry.markdown !== "string" || !Array.isArray(entry.warnings)) throw new Error("page entry schema mismatch");
  }
  return parsed.pages;
}

function normalizeUsage(value = {}) {
  const inputUnits = nonNegativeNumber(value.promptTokenCount, 0);
  const candidateUnits = nonNegativeNumber(value.candidatesTokenCount, 0);
  const thinkingUnits = nonNegativeNumber(value.thoughtsTokenCount, 0);
  return { inputUnits, outputUnits: candidateUnits + thinkingUnits };
}

function normalizeContiguousPages(value, maximum) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new Error(`pageNumbers must contain 1 to ${maximum} pages`);
  const pages = value.map((page, index) => boundedInteger(page, `pageNumbers[${index}]`, 1, 10_000));
  if (pages.some((page, index) => index > 0 && page !== pages[index - 1] + 1)) throw new Error("pageNumbers must be ordered and contiguous");
  return pages;
}

async function readBoundedRangeBytes(source = {}) {
  if (typeof source.readBytes !== "function") throw new Error("Gemini range adapter requires source.readBytes");
  const bytes = await source.readBytes();
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buffer.length) throw new Error("Gemini range adapter received an empty PDF range");
  return buffer;
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

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}
