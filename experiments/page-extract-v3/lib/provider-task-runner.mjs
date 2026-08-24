import { createGeminiOcrProvider } from "../../../extract-utils/gemini-ocr-provider.mjs";
import { createMistralOcrProvider, MISTRAL_OCR_MODEL } from "../../../extract-utils/mistral-ocr-provider.mjs";
import { createProviderMetrics } from "../../upload-extract-v2/lib/provider-metrics.mjs";
import { atomicWriteJson, readJsonIfExists, sha256 } from "./util.mjs";

const TASK_SCHEMA = "page-extract-v3/provider-task-v1";

export async function runPrimaryProviderTask({
  task,
  resultFile,
  env = process.env,
  fetchImpl = fetch,
  maxAttempts = 2,
  model = env.MISTRAL_OCR_MODEL || MISTRAL_OCR_MODEL,
  providerFactory = createMistralOcrProvider,
} = {}) {
  const pinnedModel = String(model || MISTRAL_OCR_MODEL);
  return runProviderTask({
    task,
    resultFile,
    env: withPricing(env, { mistralPages: rate(env.V3_MISTRAL_OCR_USD_PER_1000_PAGES, 4) }),
    fetchImpl,
    maxAttempts,
    providerName: "mistral",
    createProvider: ({ metrics, pricedEnv }) => providerFactory({
      apiKey: pricedEnv.MISTRAL_API_KEY,
      endpoint: pricedEnv.MISTRAL_OCR_ENDPOINT,
      model: pinnedModel,
      timeoutMs: pricedEnv.MISTRAL_OCR_TIMEOUT_MS,
      fetchImpl: metrics.fetchImpl,
    }),
    model: pinnedModel,
  });
}

export async function runRepairProviderTask({
  task,
  resultFile,
  model = "gemini-2.5-pro",
  thinkingLevel = "",
  env = process.env,
  fetchImpl = fetch,
  maxAttempts = 2,
  providerFactory = createGeminiOcrProvider,
} = {}) {
  const prices = repairPricing(model, env);
  return runProviderTask({
    task,
    resultFile,
    env: withPricing(env, prices),
    fetchImpl,
    maxAttempts,
    providerName: "gemini",
    createProvider: ({ metrics, pricedEnv }) => providerFactory({
      apiKey: pricedEnv.GEMINI_API_KEY || pricedEnv.GOOGLE_API_KEY,
      endpointBase: pricedEnv.GEMINI_OCR_ENDPOINT_BASE,
      model,
      timeoutMs: pricedEnv.GEMINI_OCR_TIMEOUT_MS,
      thinkingLevel,
      fetchImpl: metrics.fetchImpl,
    }),
    model,
    thinkingLevel,
  });
}

async function runProviderTask({
  task,
  resultFile,
  env,
  fetchImpl,
  maxAttempts,
  providerName,
  createProvider,
  model = "",
  thinkingLevel = "",
}) {
  const fingerprint = taskFingerprint(task, { providerName, model, thinkingLevel });
  const existing = await readJsonIfExists(resultFile);
  if (existing?.schemaVersion === TASK_SCHEMA && existing.taskFingerprint === fingerprint && existing.status === "succeeded") {
    return { ...existing, resumed: true };
  }

  const metrics = createProviderMetrics({ env, fetchImpl });
  const providerFn = createProvider({ metrics, pricedEnv: env });
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let providerResult = null;
  let error = "";
  let attempts = 0;
  const attemptLimit = Math.max(1, Math.min(3, Math.trunc(Number(maxAttempts) || 1)));
  while (attempts < attemptLimit) {
    attempts += 1;
    try {
      providerResult = await metrics.withFile(task.index, () => providerFn({
        pdfPath: task.pdfPath,
        pageCount: task.units.length,
      }));
      error = "";
      break;
    } catch (caught) {
      error = safeError(caught);
      if (attempts >= attemptLimit || !isTransientProviderError(error)) break;
      await delay(500 * (2 ** (attempts - 1)));
    }
  }

  const providerSummary = await metrics.summary();
  const result = {
    schemaVersion: TASK_SCHEMA,
    taskId: task.id,
    taskFingerprint: fingerprint,
    providerName,
    model,
    thinkingLevel,
    status: providerResult ? "succeeded" : "failed",
    attempts,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    units: task.units.map((unit) => ({ documentId: unit.documentId, page: unit.page })),
    pages: providerResult ? mapProviderPages(providerResult.pages, task.units) : [],
    engine: String(providerResult?.engine || ""),
    provider: providerSummary,
    providerEvents: metrics.events.map((event) => ({
      provider: event.provider,
      durationMs: event.durationMs,
      statusCode: event.statusCode,
      ok: event.ok,
      error: event.error,
    })),
    error,
    resumed: false,
  };
  await atomicWriteJson(resultFile, result);
  return result;
}

function mapProviderPages(pages, units) {
  const values = Array.isArray(pages) ? pages.slice().sort((left, right) => Number(left?.page) - Number(right?.page)) : [];
  return units.map((unit, index) => ({
    documentId: unit.documentId,
    page: unit.page,
    providerPage: values[index] || null,
  }));
}

function taskFingerprint(task, options) {
  return sha256(JSON.stringify({
    providerName: options.providerName,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    units: task.units.map((unit) => ({ documentId: unit.documentId, page: unit.page, sourceSha256: unit.sourceSha256 })),
  }));
}

function withPricing(env, prices) {
  return {
    ...env,
    V2_MISTRAL_OCR_USD_PER_1000_PAGES: String(prices.mistralPages || env.V2_MISTRAL_OCR_USD_PER_1000_PAGES || ""),
    V2_GEMINI_INPUT_USD_PER_MILLION_TOKENS: String(prices.geminiInput || env.V2_GEMINI_INPUT_USD_PER_MILLION_TOKENS || ""),
    V2_GEMINI_OUTPUT_USD_PER_MILLION_TOKENS: String(prices.geminiOutput || env.V2_GEMINI_OUTPUT_USD_PER_MILLION_TOKENS || ""),
  };
}

function repairPricing(model, env) {
  if (String(model) === "gemini-3.7-flash") {
    return {
      geminiInput: rate(env.V3_GEMINI_37_INPUT_USD_PER_MILLION_TOKENS, 0.75),
      geminiOutput: rate(env.V3_GEMINI_37_OUTPUT_USD_PER_MILLION_TOKENS, 3.75),
    };
  }
  return {
    geminiInput: rate(env.V3_GEMINI_25_PRO_INPUT_USD_PER_MILLION_TOKENS, 1.25),
    geminiOutput: rate(env.V3_GEMINI_25_PRO_OUTPUT_USD_PER_MILLION_TOKENS, 10),
  };
}

function rate(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTransientProviderError(error) {
  const value = String(error || "").toLowerCase();
  return /\b(429|500|502|503|504)\b/.test(value)
    || value.includes("timed out")
    || value.includes("timeout")
    || value.includes("fetch failed")
    || value.includes("temporarily unavailable");
}

function safeError(error) {
  return String(error?.message || error || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
