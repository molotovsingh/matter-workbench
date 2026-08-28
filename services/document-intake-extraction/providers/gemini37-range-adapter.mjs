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
  // SLO budget, not patience: every successful range call across the Gold30,
  // GST, and full-corpus runs finished under 41s (median ~9-12s), while the
  // observed latency-tail failure mode is a single hung call consuming the
  // whole timeout and pushing its retry past the 120s post-custody P99. With
  // maximum_attempts=3, these ceilings bound the rung at 45+60+60=165s worst
  // case (single hang ~55s) instead of 60+180+180=420s. Overridable per run
  // via the suite (MWB_V4_RANGE_TIMEOUT_MS / MWB_V4_RANGE_FIRST_TIMEOUT_MS).
  timeoutMs = 60_000,
  firstAttemptTimeoutMs = 45_000,
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
      // position, so a reordered response cannot publish one page's text under
      // a neighbour's number. The worker hands the model a freshly split
      // sub-PDF, so two labellings are both legitimate: the absolute range the
      // prompt asks for (first..last) or the physical 1..N of the sub-PDF.
      // Reorder by whichever set the labels form; keep provider order for
      // absent/non-numeric labels (unorderable, and in order in practice); and
      // only fail billably when every label is an integer yet matches neither
      // set — the genuine "mislabelled and unmappable" corruption.
      const physicalPages = pagesRequested.map((_unused, index) => index + 1);
      const labels = providerPages.map((providerPage) => providerPage.page);
      const allInteger = labels.every((label) => typeof label === "number" && Number.isSafeInteger(label));
      const isExactSet = (target) => {
        if (!allInteger) return false;
        const seen = new Set(labels);
        return seen.size === target.length && target.every((value) => seen.has(value));
      };
      let orderedPages;
      let labelBinding;
      if (isExactSet(pagesRequested)) {
        const byLabel = new Map(providerPages.map((providerPage) => [providerPage.page, providerPage]));
        orderedPages = pagesRequested.map((pageNumber) => byLabel.get(pageNumber));
        labelBinding = "absolute";
      } else if (isExactSet(physicalPages)) {
        const byLabel = new Map(providerPages.map((providerPage) => [providerPage.page, providerPage]));
        orderedPages = physicalPages.map((pageNumber) => byLabel.get(pageNumber));
        labelBinding = "physical";
      } else if (allInteger) {
        throw providerError("Gemini range labelled pages that match neither the requested nor the physical range", "provider.invalid_response", {
          retryable: false,
          billingKnown: true,
          requestId,
          usage,
          billedCostUsd,
          finishReason,
        });
      } else {
        orderedPages = providerPages;
        labelBinding = "position";
      }
      const perPageCost = billedCostUsd / pagesRequested.length;
      const perPageInput = usage.inputUnits / pagesRequested.length;
      const perPageOutput = usage.outputUnits / pagesRequested.length;
      return orderedPages.map((providerPage, index) => {
        const diagnostics = Array.isArray(providerPage.warnings) ? providerPage.warnings.map((warning) => String(warning).slice(0, 300)) : [];
        if (labelBinding === "position") diagnostics.push("provider_page_labels_absent_position_mapped");
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
