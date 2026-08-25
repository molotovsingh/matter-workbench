import { CONTRACT_VERSIONS, assertPinnedProviderCapability, normalizeProviderResult } from "../../../packages/extraction-contracts/index.mjs";
import { fetchProviderJson, providerError } from "./provider-http.mjs";

export const MISTRAL_OCR41_RANGE_CAPABILITY = Object.freeze({
  provider: "mistral",
  model: "mistral-ocr-4-1",
  adapterVersion: "mistral-ocr41-document-range-adapter/1.0.0",
});

export function createMistralOcr41RangeAdapter({
  apiKey,
  endpoint = "https://api.mistral.ai/v1/ocr",
  fetchImpl = fetch,
  timeoutMs = 120_000,
  usdPerThousandPages = 4,
  maximumPages = 32,
} = {}) {
  const secret = requiredSecret(apiKey, "Mistral API key");
  const capability = assertPinnedProviderCapability(MISTRAL_OCR41_RANGE_CAPABILITY);
  const pagePrice = positiveNumber(usdPerThousandPages, "usdPerThousandPages") / 1000;
  const pageLimit = boundedInteger(maximumPages, "maximumPages", 1, 32);
  return Object.freeze({
    capability,
    async extractPages({ pageNumbers, source } = {}) {
      const pagesRequested = normalizeContiguousPages(pageNumbers, pageLimit);
      const pdfBytes = await readBoundedRangeBytes(source);
      const { payload, requestId } = await fetchProviderJson({
        fetchImpl,
        url: endpoint,
        provider: "Mistral OCR",
        timeoutMs,
        apiKey: secret,
        init: {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: capability.model,
            document: { type: "document_url", document_url: `data:application/pdf;base64,${pdfBytes.toString("base64")}` },
            include_image_base64: false,
            confidence_scores_granularity: "page",
          }),
        },
      });
      const providerPages = Array.isArray(payload.pages) ? payload.pages : [];
      const pagesProcessed = Math.max(providerPages.length, nonNegativeNumber(payload.usage_info?.pages_processed, pagesRequested.length));
      const billedCostUsd = pagePrice * pagesProcessed;
      if (providerPages.length !== pagesRequested.length) {
        throw billableResponseError(`Mistral OCR returned ${providerPages.length} pages for a ${pagesRequested.length}-page range`, {
          requestId,
          inputUnits: pagesProcessed,
          billedCostUsd,
        });
      }
      const perPageCost = billedCostUsd / pagesRequested.length;
      const perPageInput = pagesProcessed / pagesRequested.length;
      return providerPages.map((providerPage, index) => {
        const diagnostics = [];
        const confidence = numberOrNull(providerPage?.confidence ?? providerPage?.confidence_avg ?? providerPage?.confidence_scores?.average);
        if (confidence !== null) diagnostics.push(`provider_confidence=${clamp(confidence, 0, 1).toFixed(4)}`);
        if (Array.isArray(providerPage?.warnings)) diagnostics.push(...providerPage.warnings.map(String));
        return normalizeProviderResult({
          schemaVersion: CONTRACT_VERSIONS.providerResult,
          pageNumber: pagesRequested[index],
          text: typeof providerPage?.markdown === "string" ? providerPage.markdown : "",
          finishReason: "complete",
          requestId,
          usage: { inputUnits: perPageInput, outputUnits: 0 },
          billedCostUsd: perPageCost,
          diagnostics,
        }, { pageNumber: pagesRequested[index] });
      });
    },
  });
}

function normalizeContiguousPages(value, maximum) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new Error(`pageNumbers must contain 1 to ${maximum} pages`);
  const pages = value.map((page, index) => boundedInteger(page, `pageNumbers[${index}]`, 1, 10_000));
  if (pages.some((page, index) => index > 0 && page !== pages[index - 1] + 1)) throw new Error("pageNumbers must be ordered and contiguous");
  return pages;
}

async function readBoundedRangeBytes(source = {}) {
  if (typeof source.readBytes !== "function") throw new Error("Mistral range adapter requires source.readBytes");
  const bytes = await source.readBytes();
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buffer.length) throw new Error("Mistral range adapter received an empty PDF range");
  return buffer;
}

function billableResponseError(message, { requestId, inputUnits, billedCostUsd }) {
  return providerError(message, "provider.invalid_response", {
    retryable: false,
    billingKnown: true,
    requestId,
    usage: { inputUnits, outputUnits: 0 },
    billedCostUsd,
  });
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

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
