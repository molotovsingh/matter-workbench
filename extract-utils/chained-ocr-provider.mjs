import { createGeminiOcrProvider } from "./gemini-ocr-provider.mjs";
import { createMistralOcrProvider } from "./mistral-ocr-provider.mjs";
import { scoreOcrProviderResult } from "./ocr-quality.mjs";

const DEFAULT_REPAIR_MODEL = "gemini-2.5-pro";
const DEFAULT_FAST_REPAIR_MODEL = "gemini-2.5-flash-lite";

export function createChainedOcrProvider({
  env = process.env,
  fetchImpl = fetch,
  mistralProvider,
  geminiProvider,
  repairEnabled = env.GEMINI_OCR_REPAIR_ENABLED === "1",
  repairMode = env.OCR_REPAIR_MODE || "accuracy",
} = {}) {
  const primary = mistralProvider || createMistralOcrProvider({
    apiKey: env.MISTRAL_API_KEY || "",
    endpoint: env.MISTRAL_OCR_ENDPOINT,
    model: env.MISTRAL_OCR_MODEL,
    fetchImpl,
    timeoutMs: env.MISTRAL_OCR_TIMEOUT_MS,
  });

  const repair = geminiProvider || maybeCreateGeminiRepairProvider({
    env,
    fetchImpl,
    repairEnabled,
    repairMode,
  });

  const provider = async function chainedOcrProvider(packet) {
    let primaryResult;
    let primaryScore;
    let primaryCoverage;
    try {
      primaryResult = await primary(packet);
      primaryScore = scoreOcrProviderResult(primaryResult, { pageCount: packet.pageCount });
      primaryCoverage = summarizePageCoverage(primaryResult, packet.pageCount);
    } catch (primaryError) {
      if (!repair) throw primaryError;
      try {
        return await repair(packet);
      } catch (repairError) {
        throw new Error(`Primary OCR failed (${primaryError.message}); Gemini repair also failed (${repairError.message})`);
      }
    }

    if (!primaryScore.needsRepair || !repair) {
      if (primaryScore.needsRepair && !repair) {
        return withProviderWarning(primaryResult, `OCR repair skipped: ${primaryScore.reasons.join(", ") || "primary OCR needs review"}`);
      }
      return primaryResult;
    }

    let repairResult;
    let repairScore;
    let repairCoverage;
    try {
      repairResult = await repair(packet);
      repairScore = scoreOcrProviderResult(repairResult, { pageCount: packet.pageCount });
      repairCoverage = summarizePageCoverage(repairResult, packet.pageCount);
    } catch (repairError) {
      return withProviderWarning(primaryResult, `Gemini OCR repair failed; keeping primary OCR (${repairError.message})`);
    }

    if (repairScore.usable
      && repairCoverage.valid
      && repairCoverage.textPages >= primaryCoverage.textPages
      && repairScore.emptyPages <= primaryScore.emptyPages
      && repairScore.score >= primaryScore.score) {
      return repairResult;
    }

    return withProviderWarning(
      primaryResult,
      `Gemini OCR repair rejected; keeping primary OCR (primary score ${primaryScore.score}, Gemini score ${repairScore.score})`,
    );
  };

  provider.repairsWeakOcr = Boolean(repair);
  provider.repairTextLayer = false;
  provider.primaryProvider = "mistral";
  provider.repairProvider = repair ? "gemini" : "";
  return provider;
}

function maybeCreateGeminiRepairProvider({ env, fetchImpl, repairEnabled, repairMode }) {
  if (!repairEnabled) return null;
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  if (!apiKey) return null;
  const mode = String(repairMode || "accuracy").trim().toLowerCase();
  const model = mode === "fast"
    ? (env.GEMINI_OCR_REPAIR_FAST_MODEL || DEFAULT_FAST_REPAIR_MODEL)
    : (env.GEMINI_OCR_REPAIR_MODEL || DEFAULT_REPAIR_MODEL);
  return createGeminiOcrProvider({
    apiKey,
    endpointBase: env.GEMINI_OCR_ENDPOINT_BASE,
    model,
    fetchImpl,
    timeoutMs: env.GEMINI_OCR_TIMEOUT_MS,
    thinkingLevel: env.GEMINI_OCR_THINKING_LEVEL,
  });
}

function summarizePageCoverage(providerResult, pageCount) {
  const pages = Array.isArray(providerResult?.pages) ? providerResult.pages : [];
  const expectedPages = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : pages.length;
  const seen = new Set();
  let textPages = 0;
  let valid = true;

  for (const page of pages) {
    const pageNumber = Number(page?.page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || (expectedPages > 0 && pageNumber > expectedPages) || seen.has(pageNumber)) {
      valid = false;
      continue;
    }
    seen.add(pageNumber);
    if (pageHasText(page)) textPages += 1;
  }

  if (expectedPages > 0 && seen.size < expectedPages) valid = false;
  return { valid, textPages, expectedPages };
}

function pageHasText(page) {
  if (Array.isArray(page?.blocks)) {
    return page.blocks.some((block) => String(block?.text ?? block?.markdown ?? "").trim());
  }
  return String(page?.markdown ?? page?.text ?? "").trim().length > 0;
}

function withProviderWarning(providerResult, warning) {
  const pages = Array.isArray(providerResult?.pages) ? providerResult.pages : [];
  if (!pages.length) return providerResult;
  const firstPage = pages[0] || {};
  return {
    ...providerResult,
    pages: [
      {
        ...firstPage,
        warnings: [...(Array.isArray(firstPage.warnings) ? firstPage.warnings : []), warning],
      },
      ...pages.slice(1),
    ],
  };
}
