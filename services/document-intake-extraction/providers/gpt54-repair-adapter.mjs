import { CONTRACT_VERSIONS, assertPinnedProviderCapability, normalizeProviderResult } from "../../../packages/extraction-contracts/index.mjs";
import { fetchProviderJson, providerError, resolveAttemptTimeoutMs } from "./provider-http.mjs";

// Apex repair rung: a frontier LLM reading the page image after the dedicated
// OCR lanes have failed. Validated 2026-08-25 on 51 provider-stubborn matter
// pages: every page with legible ink was transcribed; blank pages were
// explicitly identified rather than hallucinated.
export const GPT54_REPAIR_CAPABILITY = Object.freeze({
  provider: "openai",
  model: "gpt-5.4",
  adapterVersion: "gpt54-legal-page-repair-adapter/1.0.0",
});

const PROMPT = [
  "Transcribe the visible text of this legal-document page exactly.",
  "Preserve reading order, useful line breaks, dates, amounts, party names, section references, and stamps.",
  "Do not summarize, infer missing words, or add commentary.",
  "If a region is illegible, write [illegible] rather than guessing.",
  "If the page is blank or has no legible text at all, output exactly: [BLANK PAGE]",
  "Output the transcription only.",
].join(" ");

export function createGpt54RepairPageAdapter({
  apiKey,
  endpoint = "https://api.openai.com/v1/chat/completions",
  fetchImpl = fetch,
  timeoutMs = 180_000,
  firstAttemptTimeoutMs = 90_000,
  inputUsdPerMillionTokens,
  outputUsdPerMillionTokens,
  maximumOutputTokens = 4_000,
  rasterize,
} = {}) {
  const secret = requiredSecret(apiKey, "OpenAI API key");
  const capability = assertPinnedProviderCapability(GPT54_REPAIR_CAPABILITY);
  // Prices are mandatory: the cost ledger must never carry silently invented
  // numbers, so the composition owns stating what this rung costs.
  const inputPrice = positiveNumber(inputUsdPerMillionTokens, "inputUsdPerMillionTokens");
  const outputPrice = positiveNumber(outputUsdPerMillionTokens, "outputUsdPerMillionTokens");
  if (typeof rasterize !== "function") throw new Error("GPT repair adapter requires a rasterize(source) -> PNG bytes dependency");
  const firstTimeout = positiveNumber(firstAttemptTimeoutMs, "firstAttemptTimeoutMs");
  return Object.freeze({
    capability,
    async extractPage({ pageNumber, source, attemptNumber } = {}) {
      const pngBytes = await rasterize(source);
      if (!Buffer.isBuffer(pngBytes) || !pngBytes.length) throw new Error("rasterize must return PNG bytes");
      const { payload, requestId } = await fetchProviderJson({
        fetchImpl,
        url: endpoint,
        provider: "GPT repair",
        timeoutMs: resolveAttemptTimeoutMs({ attemptNumber, firstAttemptTimeoutMs: firstTimeout, timeoutMs }),
        apiKey: secret,
        init: {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: capability.model,
            max_completion_tokens: maximumOutputTokens,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: PROMPT },
                { type: "image_url", image_url: { url: `data:image/png;base64,${pngBytes.toString("base64")}` } },
              ],
            }],
          }),
        },
      });
      const usage = {
        inputUnits: nonNegativeNumber(payload.usage?.prompt_tokens, 0),
        outputUnits: nonNegativeNumber(payload.usage?.completion_tokens, 0),
      };
      const billedCostUsd = usage.inputUnits * inputPrice / 1_000_000 + usage.outputUnits * outputPrice / 1_000_000;
      const choice = payload.choices?.[0];
      const text = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
      if (!text) {
        throw providerError("GPT repair returned no transcription text", "provider.invalid_response", {
          retryable: false,
          billingKnown: true,
          requestId,
          usage,
          billedCostUsd,
          finishReason: String(choice?.finish_reason || "unknown"),
        });
      }
      // Report the provider's own stop reason (only OpenAI's "stop" means a
      // clean finish). Collapsing everything to "complete" would hide
      // content_filter and other truncations from the page validator, and the
      // apex rung is the last chance to catch them.
      const rawFinishReason = String(choice?.finish_reason || "stop").toLowerCase();
      return normalizeProviderResult({
        schemaVersion: CONTRACT_VERSIONS.providerResult,
        pageNumber,
        text,
        finishReason: rawFinishReason === "stop" ? "complete" : rawFinishReason,
        requestId,
        usage,
        billedCostUsd,
        diagnostics: [],
      }, { pageNumber });
    },
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
