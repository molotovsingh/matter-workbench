import { readFile } from "node:fs/promises";

export const GEMINI_OCR_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_OCR_MODEL = "gemini-3.5-flash";
export const GEMINI_OCR_ENGINE_PREFIX = "gemini-ocr";

const DEFAULT_TIMEOUT_MS = 180000;

const GEMINI_OCR_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          markdown: { type: "string" },
          confidence: { type: "number" },
          warnings: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["page", "markdown"],
      },
    },
  },
  required: ["pages"],
};

export function createGeminiOcrProvider({
  apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  endpointBase = process.env.GEMINI_OCR_ENDPOINT_BASE || GEMINI_OCR_ENDPOINT_BASE,
  model = process.env.GEMINI_OCR_MODEL || DEFAULT_GEMINI_OCR_MODEL,
  fetchImpl = fetch,
  timeoutMs = parsePositiveInteger(process.env.GEMINI_OCR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  thinkingLevel = process.env.GEMINI_OCR_THINKING_LEVEL || "",
} = {}) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required for Gemini OCR");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl is required for Gemini OCR");
  }

  const effectiveTimeoutMs = parsePositiveInteger(timeoutMs) || DEFAULT_TIMEOUT_MS;
  const cleanEndpointBase = String(endpointBase || GEMINI_OCR_ENDPOINT_BASE).replace(/\/+$/, "");
  const cleanModel = String(model || DEFAULT_GEMINI_OCR_MODEL).trim();

  return async function geminiOcrProvider({ pdfPath, pageCount }) {
    const pdfBytes = await readFile(pdfPath);
    const body = buildGeminiOcrRequestBody({
      pdfBase64: pdfBytes.toString("base64"),
      pageCount,
      thinkingLevel,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    let payload;
    try {
      const response = await fetchImpl(`${cleanEndpointBase}/models/${encodeURIComponent(cleanModel)}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await safeResponseText(response);
        throw new Error(`Gemini OCR request failed (${response.status}): ${text || response.statusText || "unknown error"}`);
      }

      try {
        payload = await response.json();
      } catch (err) {
        throw new Error(`Gemini OCR response did not include valid JSON: ${err.message}`);
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`Gemini OCR request timed out after ${effectiveTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    return normalizeGeminiOcrResponse(payload, { pageCount, model: cleanModel });
  };
}

export function buildGeminiOcrRequestBody({ pdfBase64, pageCount, thinkingLevel = "" } = {}) {
  if (!pdfBase64) throw new Error("pdfBase64 is required for Gemini OCR");

  const generationConfig = {
    responseMimeType: "application/json",
    responseJsonSchema: GEMINI_OCR_RESPONSE_SCHEMA,
  };
  const normalizedThinkingLevel = normalizeThinkingLevel(thinkingLevel);
  if (normalizedThinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel: normalizedThinkingLevel };
  }

  return {
    contents: [{
      role: "user",
      parts: [
        { text: buildGeminiOcrPrompt({ pageCount }) },
        {
          inlineData: {
            mimeType: "application/pdf",
            data: pdfBase64,
          },
        },
      ],
    }],
    generationConfig,
  };
}

export function normalizeGeminiOcrResponse(payload, { pageCount, model = DEFAULT_GEMINI_OCR_MODEL } = {}) {
  const parsed = parseGeminiJsonPayload(payload);
  if (!parsed || !Array.isArray(parsed.pages)) {
    throw new Error("Gemini OCR response missing pages[]");
  }

  return {
    engine: `${GEMINI_OCR_ENGINE_PREFIX}:${model || DEFAULT_GEMINI_OCR_MODEL}`,
    pages: parsed.pages.map((page, index) => ({
      page: normalizePageNumber(page, index, pageCount),
      markdown: typeof page.markdown === "string" ? page.markdown : "",
      confidence: normalizeConfidence(page.confidence),
      warnings: Array.isArray(page.warnings) ? page.warnings.filter(Boolean).map(String) : [],
    })),
  };
}

function buildGeminiOcrPrompt({ pageCount } = {}) {
  const expectedPages = Number.isInteger(pageCount) && pageCount > 0
    ? `The PDF has ${pageCount} page(s). Return one pages[] item for each visible page.`
    : "Return one pages[] item for each visible page.";

  return [
    "OCR this legal PDF for Matter Workbench.",
    expectedPages,
    "Transcribe visible text only. Do not summarize, infer missing words, or add legal analysis.",
    "Preserve reading order and useful line breaks. Use Markdown tables only where a table is visually present.",
    "If text is illegible, leave it out and add a warning for that page instead of guessing.",
    "Return strict JSON matching the provided schema.",
  ].join(" ");
}

function parseGeminiJsonPayload(payload) {
  if (payload && Array.isArray(payload.pages)) return payload;
  const text = extractGeminiText(payload);
  if (!text) {
    const finishReason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || "unknown";
    throw new Error(`Gemini OCR response did not include text content; finishReason=${finishReason}`);
  }
  try {
    return JSON.parse(stripJsonFence(text));
  } catch (err) {
    throw new Error(`Gemini OCR response text was not valid JSON: ${err.message}`);
  }
}

function extractGeminiText(payload) {
  if (typeof payload?.text === "string") return payload.text;
  const parts = payload?.candidates?.flatMap((candidate) => candidate?.content?.parts || []) || [];
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizePageNumber(page, index, pageCount) {
  const pageNumber = Number(page?.page ?? page?.page_number);
  if (Number.isInteger(pageNumber) && pageNumber >= 1 && (!pageCount || pageNumber <= pageCount)) {
    return pageNumber;
  }
  return index + 1;
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return undefined;
  if (confidence < 0) return 0;
  if (confidence > 1) return 1;
  return Math.round(confidence * 100) / 100;
}

function normalizeThinkingLevel(value) {
  const level = String(value || "").trim().toUpperCase();
  return ["MINIMAL", "LOW", "MEDIUM", "HIGH"].includes(level) ? level : "";
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
