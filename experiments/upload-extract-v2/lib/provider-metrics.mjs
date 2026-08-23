import { AsyncLocalStorage } from "node:async_hooks";

import { summarizeNumbers } from "./util.mjs";

export function createProviderMetrics({ env = process.env, fetchImpl = fetch } = {}) {
  const context = new AsyncLocalStorage();
  const events = [];
  const pendingUsageReads = [];

  async function instrumentedFetch(url, init = {}) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const provider = providerForUrl(url);
    const fileIndex = Number(context.getStore()?.fileIndex);
    const event = {
      provider,
      fileIndex: Number.isFinite(fileIndex) ? fileIndex : null,
      startedAt,
      finishedAt: "",
      durationMs: 0,
      statusCode: 0,
      ok: false,
      usage: {},
      error: "",
    };
    events.push(event);
    try {
      const response = await fetchImpl(url, init);
      event.finishedAt = new Date().toISOString();
      event.durationMs = Math.round(performance.now() - started);
      event.statusCode = Number(response.status) || 0;
      event.ok = response.ok;
      try {
        const clone = response.clone();
        const pending = clone.json()
          .then((payload) => { event.usage = providerUsage(provider, payload); })
          .catch(() => {});
        pendingUsageReads.push(pending);
      } catch {
        // Usage capture must not affect the provider response.
      }
      return response;
    } catch (error) {
      event.finishedAt = new Date().toISOString();
      event.durationMs = Math.round(performance.now() - started);
      event.error = safeError(error);
      throw error;
    }
  }

  return {
    fetchImpl: instrumentedFetch,
    withFile(fileIndex, fn) {
      return context.run({ fileIndex }, fn);
    },
    callsForFile(fileIndex) {
      return events.filter((event) => event.fileIndex === Number(fileIndex)).length;
    },
    async summary() {
      await Promise.allSettled(pendingUsageReads);
      return summarizeProviderEvents(events, env);
    },
    events,
  };
}

export function summarizeProviderEvents(events = [], env = process.env) {
  const byProvider = {};
  for (const provider of ["mistral", "gemini", "other"]) {
    const matching = events.filter((event) => event.provider === provider);
    if (!matching.length) continue;
    const pages = matching.reduce((sum, event) => sum + numericUsage(event.usage, ["pagesProcessed", "pages"]), 0);
    const inputTokens = matching.reduce((sum, event) => sum + numericUsage(event.usage, ["inputTokens", "promptTokens"]), 0);
    const outputTokens = matching.reduce((sum, event) => sum + numericUsage(event.usage, ["outputTokens", "candidateTokens"]), 0);
    byProvider[provider] = {
      calls: matching.length,
      succeededCalls: matching.filter((event) => event.ok).length,
      failedCalls: matching.filter((event) => !event.ok).length,
      pagesProcessed: pages,
      inputTokens,
      outputTokens,
      latencyMs: summarizeNumbers(matching.map((event) => event.durationMs)),
      estimatedCostUsd: estimateProviderCost(provider, { pages, inputTokens, outputTokens }, env),
    };
  }
  return {
    totalCalls: events.length,
    successfulCalls: events.filter((event) => event.ok).length,
    failedCalls: events.filter((event) => !event.ok).length,
    byProvider,
  };
}

function providerForUrl(value) {
  const url = String(value || "").toLowerCase();
  if (url.includes("mistral")) return "mistral";
  if (url.includes("generativelanguage") || url.includes("gemini")) return "gemini";
  return "other";
}

function providerUsage(provider, payload = {}) {
  if (provider === "mistral") {
    const usage = payload?.usage_info || payload?.usage || {};
    return {
      pagesProcessed: number(usage.pages_processed ?? usage.pagesProcessed ?? payload?.pages?.length),
      documentBytes: number(usage.doc_size_bytes ?? usage.document_bytes),
    };
  }
  if (provider === "gemini") {
    const usage = payload?.usageMetadata || payload?.usage_metadata || {};
    const candidateTokens = number(usage.candidatesTokenCount ?? usage.outputTokenCount);
    const thinkingTokens = number(usage.thoughtsTokenCount ?? usage.thinkingTokenCount);
    return {
      inputTokens: number(usage.promptTokenCount ?? usage.inputTokenCount),
      outputTokens: candidateTokens + thinkingTokens,
      candidateTokens,
      thinkingTokens,
      totalTokens: number(usage.totalTokenCount),
    };
  }
  return {};
}

function estimateProviderCost(provider, usage, env) {
  if (provider === "mistral") {
    const rate = positiveRate(env.V2_MISTRAL_OCR_USD_PER_1000_PAGES);
    return rate ? roundUsd((usage.pages / 1000) * rate) : null;
  }
  if (provider === "gemini") {
    const inputRate = positiveRate(env.V2_GEMINI_INPUT_USD_PER_MILLION_TOKENS);
    const outputRate = positiveRate(env.V2_GEMINI_OUTPUT_USD_PER_MILLION_TOKENS);
    if (!inputRate && !outputRate) return null;
    return roundUsd((usage.inputTokens / 1_000_000) * inputRate + (usage.outputTokens / 1_000_000) * outputRate);
  }
  return null;
}

function numericUsage(usage, keys) {
  for (const key of keys) {
    const value = number(usage?.[key]);
    if (value) return value;
  }
  return 0;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function positiveRate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundUsd(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function safeError(error) {
  return String(error?.message || error || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 300);
}
