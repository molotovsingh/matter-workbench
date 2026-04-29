import { readFile } from "node:fs/promises";

export const MISTRAL_OCR_ENDPOINT = "https://api.mistral.ai/v1/ocr";
export const MISTRAL_OCR_MODEL = "mistral-ocr-latest";
export const MISTRAL_OCR_ENGINE = "mistral-ocr-latest";

const DEFAULT_TIMEOUT_MS = 120000;

export function createMistralOcrProvider({
  apiKey = process.env.MISTRAL_API_KEY,
  endpoint = process.env.MISTRAL_OCR_ENDPOINT || MISTRAL_OCR_ENDPOINT,
  model = process.env.MISTRAL_OCR_MODEL || MISTRAL_OCR_MODEL,
  fetchImpl = fetch,
  timeoutMs = parsePositiveInteger(process.env.MISTRAL_OCR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is required for Mistral OCR");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl is required for Mistral OCR");
  }
  const effectiveTimeoutMs = parsePositiveInteger(timeoutMs) || DEFAULT_TIMEOUT_MS;

  return async function mistralOcrProvider({ pdfPath, pageCount }) {
    const pdfBytes = await readFile(pdfPath);
    const body = {
      model,
      document: {
        type: "document_url",
        document_url: `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
      },
      include_image_base64: false,
      confidence_scores_granularity: "page",
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    let payload;
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await safeResponseText(response);
        throw new Error(`Mistral OCR request failed (${response.status}): ${text || response.statusText || "unknown error"}`);
      }

      try {
        payload = await response.json();
      } catch (err) {
        throw new Error(`Mistral OCR response did not include valid JSON: ${err.message}`);
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`Mistral OCR request timed out after ${effectiveTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    return normalizeMistralOcrResponse(payload, { pageCount, model });
  };
}

export function normalizeMistralOcrResponse(payload, { pageCount, model = MISTRAL_OCR_MODEL } = {}) {
  if (!payload || !Array.isArray(payload.pages)) {
    throw new Error("Mistral OCR response missing pages[]");
  }

  return {
    engine: model || MISTRAL_OCR_ENGINE,
    pages: payload.pages.map((page, index) => ({
      page: normalizePageNumber(page, index, pageCount),
      markdown: typeof page.markdown === "string" ? page.markdown : "",
      confidence: extractPageConfidence(page),
      warnings: extractPageWarnings(page),
    })),
  };
}

function normalizePageNumber(page, index, pageCount) {
  const pageNumber = Number(page?.page ?? page?.page_number);
  if (Number.isInteger(pageNumber) && pageNumber >= 1 && (!pageCount || pageNumber <= pageCount)) {
    return pageNumber;
  }
  return index + 1;
}

function extractPageConfidence(page) {
  const direct = Number(page?.confidence ?? page?.confidence_avg);
  if (Number.isFinite(direct)) return clampConfidence(direct);
  const scores = page?.confidence_scores || page?.confidenceScore || page?.confidence_scores_stats;
  const average = Number(scores?.average ?? scores?.avg ?? scores?.mean);
  return Number.isFinite(average) ? clampConfidence(average) : undefined;
}

function extractPageWarnings(page) {
  const warnings = [];
  if (Array.isArray(page?.warnings)) warnings.push(...page.warnings.filter(Boolean).map(String));
  if (Array.isArray(page?.images) && page.images.length) {
    warnings.push(`page contains ${page.images.length} extracted image placeholder(s)`);
  }
  return warnings;
}

function clampConfidence(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 100) / 100;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
