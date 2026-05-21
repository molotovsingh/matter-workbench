import { createGeminiOcrProvider } from "./gemini-ocr-provider.mjs";
import { createMistralOcrProvider } from "./mistral-ocr-provider.mjs";
import { scoreOcrProviderResult } from "./ocr-quality.mjs";
import {
  analyzeOcrRepairNeed,
  evaluateOcrRepairResult,
  invalidRepairReason,
  withOcrPipeline,
  withProviderWarning,
} from "./ocr-policy.mjs";

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
    const primaryAttempt = await runPrimaryOcr({ primary, repair, packet });
    if (primaryAttempt.fallbackResult) return primaryAttempt.fallbackResult;

    const repairNeed = analyzeOcrRepairNeed(primaryAttempt.score, packet?.qualityHints);
    if (!repairNeed.needsRepair || !repair) return keepPrimaryOcrResult({
      primaryResult: primaryAttempt.result,
      repairAvailable: Boolean(repair),
      repairNeed,
    });

    return await runRepairOcr({
      repair,
      packet,
      primaryResult: primaryAttempt.result,
      repairNeed,
    });
  };

  provider.repairsWeakOcr = Boolean(repair);
  provider.repairTextLayer = false;
  provider.primaryProvider = "mistral";
  provider.repairProvider = repair ? "gemini" : "";
  return provider;
}

async function runPrimaryOcr({ primary, repair, packet }) {
  try {
    const result = await primary(packet);
    return {
      result,
      score: scoreOcrProviderResult(result, { pageCount: packet.pageCount }),
    };
  } catch (primaryError) {
    if (!repair) throw primaryError;
    return {
      fallbackResult: await runRepairFallbackOcr({ repair, packet, primaryError }),
    };
  }
}

async function runRepairFallbackOcr({ repair, packet, primaryError }) {
  try {
    const repairResult = await repair(packet);
    const repairEvaluation = evaluateOcrRepairResult(repairResult, { pageCount: packet.pageCount });
    if (!repairEvaluation.valid) {
      throw new Error(repairEvaluation.reason);
    }
    return withOcrPipeline(repairResult, {
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

function keepPrimaryOcrResult({ primaryResult, repairAvailable, repairNeed }) {
  if (repairNeed.needsRepair && !repairAvailable) {
    return withOcrPipeline(
      withProviderWarning(primaryResult, `OCR repair skipped: ${repairNeed.reasons.join(", ") || "primary OCR needs review"}`),
      {
        primary_model: primaryResult.engine || "mistral",
        repair_model: "",
        repair_status: "skipped_unavailable",
        repair_reason: repairNeed.reasons.join("; "),
        final_model: primaryResult.engine || "mistral",
      },
    );
  }
  return withOcrPipeline(primaryResult, {
    primary_model: primaryResult.engine || "mistral",
    repair_model: repairAvailable ? "gemini" : "",
    repair_status: "not_needed",
    repair_reason: "",
    final_model: primaryResult.engine || "mistral",
  });
}

async function runRepairOcr({ repair, packet, primaryResult, repairNeed }) {
  let repairResult;
  let repairEvaluation;
  try {
    repairResult = await repair(packet);
    repairEvaluation = evaluateOcrRepairResult(repairResult, { pageCount: packet.pageCount });
  } catch (repairError) {
    return withOcrPipeline(
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

  if (repairEvaluation.valid) {
    return withOcrPipeline(repairResult, {
      primary_model: primaryResult.engine || "mistral",
      repair_model: repairResult.engine || "gemini",
      repair_status: "used",
      repair_reason: repairNeed.reasons.join("; ") || "primary OCR needed review",
      final_model: repairResult.engine || "gemini",
    });
  }

  return withOcrPipeline(
    withProviderWarning(
      primaryResult,
      `Gemini OCR repair rejected; keeping primary OCR (${invalidRepairReason(repairEvaluation.score, repairEvaluation.coverage)})`,
    ),
    {
      primary_model: primaryResult.engine || "mistral",
      repair_model: repairResult.engine || "gemini",
      repair_status: "rejected_invalid",
      repair_reason: invalidRepairReason(repairEvaluation.score, repairEvaluation.coverage),
      final_model: primaryResult.engine || "mistral",
    },
  );
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
