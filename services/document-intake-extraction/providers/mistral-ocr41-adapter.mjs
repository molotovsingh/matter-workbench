import { createPinnedProviderAdapter } from "./pinned-provider-adapter.mjs";
import { fetchProviderJson, providerError } from "./provider-http.mjs";

export const MISTRAL_OCR41_CAPABILITY = Object.freeze({
  provider: "mistral",
  model: "mistral-ocr-4-1",
  adapterVersion: "mistral-ocr41-page-adapter/1.0.0",
});

export function createMistralOcr41PageAdapter({
  apiKey,
  endpoint = "https://api.mistral.ai/v1/ocr",
  fetchImpl = fetch,
  timeoutMs = 120_000,
  usdPerThousandPages = 4,
} = {}) {
  const secret = requiredSecret(apiKey, "Mistral API key");
  const pagePrice = positiveNumber(usdPerThousandPages, "usdPerThousandPages") / 1000;
  return createPinnedProviderAdapter({
    ...MISTRAL_OCR41_CAPABILITY,
    async extractPage({ pageNumber, source }) {
      const pdfBytes = await readBoundedPageBytes(source);
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
            model: MISTRAL_OCR41_CAPABILITY.model,
            document: {
              type: "document_url",
              document_url: `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
            },
            include_image_base64: false,
            confidence_scores_granularity: "page",
          }),
        },
      });
      const pages = Array.isArray(payload.pages) ? payload.pages : null;
      if (!pages?.length) {
        throw billableResponseError("Mistral OCR response did not contain a page", {
          requestId,
          inputUnits: numberOr(payload.usage_info?.pages_processed, 1),
          billedCostUsd: pagePrice,
        });
      }
      const providerPage = pages[0] || {};
      const text = typeof providerPage.markdown === "string" ? providerPage.markdown : "";
      const diagnostics = [];
      const confidence = numberOrNull(providerPage.confidence ?? providerPage.confidence_avg ?? providerPage.confidence_scores?.average);
      if (confidence !== null) diagnostics.push(`provider_confidence=${clamp(confidence, 0, 1).toFixed(4)}`);
      if (Array.isArray(providerPage.warnings)) diagnostics.push(...providerPage.warnings.map(String));
      const pagesProcessed = Math.max(1, numberOr(payload.usage_info?.pages_processed, 1));
      return {
        pageNumber,
        text,
        finishReason: "complete",
        requestId,
        usage: { inputUnits: pagesProcessed, outputUnits: 0 },
        billedCostUsd: pagePrice * pagesProcessed,
        diagnostics,
      };
    },
  });
}

async function readBoundedPageBytes(source = {}) {
  if (typeof source.readBytes !== "function") throw new Error("Mistral page adapter requires source.readBytes");
  const bytes = await source.readBytes();
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buffer.length) throw new Error("Mistral page adapter received an empty PDF page");
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

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
