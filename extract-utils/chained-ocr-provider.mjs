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
    const packetDoubt = qualityHintsNeedRepair(packet?.qualityHints);
    try {
      primaryResult = await primary(packet);
      primaryScore = scoreOcrProviderResult(primaryResult, { pageCount: packet.pageCount });
    } catch (primaryError) {
      if (!repair) throw primaryError;
      try {
        const repairResult = await repair(packet);
        const repairScore = scoreOcrProviderResult(repairResult, { pageCount: packet.pageCount });
        const repairCoverage = summarizePageCoverage(repairResult, packet.pageCount);
        if (!repairScore.usable || !repairCoverage.valid) {
          throw new Error(invalidRepairReason(repairScore, repairCoverage));
        }
        return withPipeline(repairResult, {
          primary_model: "mistral",
          repair_model: repairResult.engine || "gemini",
          repair_status: "fallback_used",
          repair_reason: `primary OCR failed: ${primaryError.message}`,
          final_model: repairResult.engine || "gemini",
        });
      } catch (repairError) {
        throw new Error(`Primary OCR failed (${primaryError.message}); Gemini repair also failed (${repairError.message})`);
      }
    }

    const primaryDoubtReasons = [
      ...primaryScore.reasons,
      ...(packetDoubt ? normalizeHintReasons(packet.qualityHints) : []),
    ];
    const primaryNeedsRepair = primaryScore.needsRepair || packetDoubt;
    if (!primaryNeedsRepair || !repair) {
      if (primaryNeedsRepair && !repair) {
        return withPipeline(
          withProviderWarning(primaryResult, `OCR repair skipped: ${primaryDoubtReasons.join(", ") || "primary OCR needs review"}`),
          {
            primary_model: primaryResult.engine || "mistral",
            repair_model: "",
            repair_status: "skipped_unavailable",
            repair_reason: primaryDoubtReasons.join("; "),
            final_model: primaryResult.engine || "mistral",
          },
        );
      }
      return withPipeline(primaryResult, {
        primary_model: primaryResult.engine || "mistral",
        repair_model: repair ? "gemini" : "",
        repair_status: "not_needed",
        repair_reason: "",
        final_model: primaryResult.engine || "mistral",
      });
    }

    let repairResult;
    let repairCoverage;
    try {
      repairResult = await repair(packet);
      repairCoverage = summarizePageCoverage(repairResult, packet.pageCount);
    } catch (repairError) {
      return withPipeline(
        withProviderWarning(primaryResult, `Gemini OCR repair failed; keeping primary OCR (${repairError.message})`),
        {
          primary_model: primaryResult.engine || "mistral",
          repair_model: "gemini",
          repair_status: "failed",
          repair_reason: repairError.message,
          final_model: primaryResult.engine || "mistral",
        },
      );
    }

    const repairScore = scoreOcrProviderResult(repairResult, { pageCount: packet.pageCount });
    if (repairScore.usable && repairCoverage.valid) {
      return withPipeline(repairResult, {
        primary_model: primaryResult.engine || "mistral",
        repair_model: repairResult.engine || "gemini",
        repair_status: "used",
        repair_reason: primaryDoubtReasons.join("; ") || "primary OCR needed review",
        final_model: repairResult.engine || "gemini",
      });
    }

    return withPipeline(
      withProviderWarning(
        primaryResult,
        `Gemini OCR repair rejected; keeping primary OCR (${invalidRepairReason(repairScore, repairCoverage)})`,
      ),
      {
        primary_model: primaryResult.engine || "mistral",
        repair_model: repairResult.engine || "gemini",
        repair_status: "rejected_invalid",
        repair_reason: invalidRepairReason(repairScore, repairCoverage),
        final_model: primaryResult.engine || "mistral",
      },
    );
  };

  provider.repairsWeakOcr = Boolean(repair);
  provider.repairTextLayer = false;
  provider.primaryProvider = "mistral";
  provider.repairProvider = repair ? "gemini" : "";
  return provider;
}

function qualityHintsNeedRepair(qualityHints = {}) {
  return Boolean(qualityHints?.needsRepair || normalizeHintReasons(qualityHints).length);
}

function normalizeHintReasons(qualityHints = {}) {
  if (Array.isArray(qualityHints?.reasons)) {
    return qualityHints.reasons.filter(Boolean).map(String);
  }
  return [];
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

function withPipeline(providerResult, pipeline) {
  return {
    ...providerResult,
    pipeline,
  };
}

function invalidRepairReason(score, coverage) {
  const reasons = [];
  if (!coverage.valid) reasons.push("repair output did not cover every page exactly once");
  if (!score.usable) reasons.push("repair output had no usable OCR text");
  if (!reasons.length) reasons.push("repair output failed hard validity checks");
  return reasons.join("; ");
}
