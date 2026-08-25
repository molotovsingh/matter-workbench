import assert from "node:assert/strict";
import test from "node:test";

import { createGpt54RepairPageAdapter } from "../services/document-intake-extraction/providers/gpt54-repair-adapter.mjs";
import { createGemini37RangeAdapter } from "../services/document-intake-extraction/providers/gemini37-range-adapter.mjs";
import { createGemini37RepairPageAdapter } from "../services/document-intake-extraction/providers/gemini37-repair-adapter.mjs";
import { createMistralOcr41PageAdapter } from "../services/document-intake-extraction/providers/mistral-ocr41-adapter.mjs";
import { createMistralOcr41RangeAdapter, resolveAttemptTimeoutMs } from "../services/document-intake-extraction/providers/mistral-ocr41-range-adapter.mjs";
import { fetchProviderJson } from "../services/document-intake-extraction/providers/provider-http.mjs";

const PAGE_PDF = Buffer.from("%PDF-1.4 isolated page bytes");

// V4-PROVIDER-001 Gemini document-range adapter evidence
test("pinned Gemini 3.7 range adapter maps ordered pages, splits token cost, and flags label drift", async () => {
  let calls = 0;
  const adapter = createGemini37RangeAdapter({
    apiKey: "gemini-secret-test",
    fetchImpl: async (url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "LOW");
      assert.equal(body.contents[0].parts[1].inlineData.data, PAGE_PDF.toString("base64"));
      return jsonResponse({
        candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify({ pages: [
            { page: 11, markdown: "Page eleven text.", warnings: [] },
            { page: 12, markdown: "Page twelve text.", warnings: ["stamp partially illegible"] },
            { page: 99, markdown: "Page thirteen text.", warnings: [] },
          ] }) }] },
        }],
        usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 500, thoughtsTokenCount: 100 },
      }, { headers: { "x-request-id": "gemini-range-1" } });
    },
  });
  assert.deepEqual(adapter.capability, {
    provider: "gemini",
    model: "gemini-3.7-flash",
    adapterVersion: "gemini37-document-range-adapter/1.0.0-thinking-low",
  });
  const outputs = await adapter.extractPages({ pageNumbers: [11, 12, 13], source: { readBytes: async () => PAGE_PDF } });
  assert.equal(calls, 1);
  assert.deepEqual(outputs.map((output) => output.pageNumber), [11, 12, 13]);
  assert.deepEqual(outputs.map((output) => output.text), ["Page eleven text.", "Page twelve text.", "Page thirteen text."]);
  const expectedTotal = 900 * 0.75 / 1_000_000 + 600 * 3.75 / 1_000_000;
  assert.ok(Math.abs(outputs.reduce((sum, output) => sum + output.billedCostUsd, 0) - expectedTotal) < 1e-12);
  assert.ok(outputs[1].diagnostics.includes("stamp partially illegible"));
  assert.ok(outputs[2].diagnostics.some((entry) => entry.includes("provider_page_label_mismatch expected=13 received=99")));

  const short = createGemini37RangeAdapter({
    apiKey: "gemini-secret-test",
    fetchImpl: async () => jsonResponse({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ pages: [{ page: 1, markdown: "only one", warnings: [] }] }) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    }),
  });
  await assert.rejects(
    () => short.extractPages({ pageNumbers: [1, 2, 3], source: { readBytes: async () => PAGE_PDF } }),
    (error) => error.code === "provider.invalid_response" && error.billingKnown === true,
  );
  const malformed = createGemini37RangeAdapter({
    apiKey: "gemini-secret-test",
    fetchImpl: async () => jsonResponse({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not json at all" }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
    }),
  });
  await assert.rejects(
    () => malformed.extractPages({ pageNumbers: [1], source: { readBytes: async () => PAGE_PDF } }),
    (error) => error.code === "provider.invalid_response",
  );
});

// V4-PROVIDER-001 controlled HTTP adapter evidence
test("pinned Mistral OCR 4.1 adapter preserves page output and attributes page-billed cost", async () => {
  const requests = [];
  const adapter = createMistralOcr41PageAdapter({
    apiKey: "mistral-secret-test",
    usdPerThousandPages: 4,
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({
        pages: [{ markdown: "Order under Section 42.", confidence: 0.97, warnings: [] }],
        usage_info: { pages_processed: 1 },
      }, { headers: { "x-request-id": "mistral-request-1" } });
    },
  });
  const output = await adapter.extractPage({ pageNumber: 7, source: { readBytes: async () => PAGE_PDF } });
  assert.deepEqual(adapter.capability, {
    provider: "mistral",
    model: "mistral-ocr-4-1",
    adapterVersion: "mistral-ocr41-page-adapter/1.0.0",
  });
  assert.equal(requests[0].body.model, "mistral-ocr-4-1");
  assert.equal(requests[0].body.document.document_url, `data:application/pdf;base64,${PAGE_PDF.toString("base64")}`);
  assert.equal(output.pageNumber, 7);
  assert.equal(output.text, "Order under Section 42.");
  assert.equal(output.requestId, "mistral-request-1");
  assert.equal(output.usage.inputUnits, 1);
  assert.equal(output.billedCostUsd, 0.004);
  assert.ok(output.diagnostics.includes("provider_confidence=0.9700"));
});

test("document-local Mistral OCR 4.1 range adapter preserves page order and allocates one provider call exactly", async () => {
  let calls = 0;
  const adapter = createMistralOcr41RangeAdapter({
    apiKey: "mistral-secret-test",
    usdPerThousandPages: 4,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        pages: [
          { markdown: "Page eleven", confidence: 0.9 },
          { markdown: "Page twelve", confidence: 0.8 },
          { markdown: "Page thirteen", confidence: 0.7 },
        ],
        usage_info: { pages_processed: 3 },
      }, { headers: { "x-request-id": "mistral-range-1" } });
    },
  });
  const outputs = await adapter.extractPages({ pageNumbers: [11, 12, 13], source: { readBytes: async () => PAGE_PDF } });
  assert.equal(calls, 1);
  assert.equal(resolveAttemptTimeoutMs({ attemptNumber: 1, firstAttemptTimeoutMs: 45_000, timeoutMs: 120_000 }), 45_000, "first attempts fail fast");
  assert.equal(resolveAttemptTimeoutMs({ attemptNumber: 2, firstAttemptTimeoutMs: 45_000, timeoutMs: 120_000 }), 120_000, "retries keep the generous timeout");
  assert.equal(resolveAttemptTimeoutMs({ firstAttemptTimeoutMs: 45_000, timeoutMs: 120_000 }), 120_000, "unknown attempt behaves like a retry");
  assert.equal(resolveAttemptTimeoutMs({ attemptNumber: 1, firstAttemptTimeoutMs: 300_000, timeoutMs: 120_000 }), 120_000, "first-attempt timeout never exceeds the overall timeout");
  assert.deepEqual(outputs.map((output) => output.pageNumber), [11, 12, 13]);
  assert.deepEqual(outputs.map((output) => output.text), ["Page eleven", "Page twelve", "Page thirteen"]);
  assert.ok(Math.abs(outputs.reduce((sum, output) => sum + output.billedCostUsd, 0) - 0.012) < 1e-12);
  assert.deepEqual(outputs.map((output) => output.requestId), ["mistral-range-1", "mistral-range-1", "mistral-range-1"]);
  await assert.rejects(() => adapter.extractPages({ pageNumbers: [1, 3], source: { readBytes: async () => PAGE_PDF } }), /ordered and contiguous/);

  const incomplete = createMistralOcr41RangeAdapter({
    apiKey: "mistral-secret-test",
    usdPerThousandPages: 4,
    fetchImpl: async () => jsonResponse({ pages: [{ markdown: "only one" }], usage_info: { pages_processed: 3 } }),
  });
  await assert.rejects(async () => {
    try {
      await incomplete.extractPages({ pageNumbers: [1, 2, 3], source: { readBytes: async () => PAGE_PDF } });
    } catch (error) {
      assert.equal(error.billingKnown, true);
      assert.equal(error.usage.inputUnits, 3);
      assert.equal(error.billedCostUsd, 0.012);
      throw error;
    }
  }, { code: "provider.invalid_response" });
});

test("pinned Gemini 3.7 LOW repair adapter measures input, output, and thinking-token cost", async () => {
  const requests = [];
  const adapter = createGemini37RepairPageAdapter({
    apiKey: "gemini-secret-test",
    thinkingLevel: "LOW",
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({
        candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify({ page: 3, markdown: "Rs. 1,00,000 on 20/04/2026.", warnings: [] }) }] },
        }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 },
      }, { headers: { "x-goog-request-id": "gemini-request-1" } });
    },
  });
  const output = await adapter.extractPage({ pageNumber: 3, source: { readBytes: async () => PAGE_PDF } });
  assert.equal(requests[0].url.endsWith("/models/gemini-3.7-flash:generateContent"), true);
  assert.equal(requests[0].body.generationConfig.thinkingConfig.thinkingLevel, "LOW");
  assert.equal(requests[0].body.contents[0].parts[1].inlineData.data, PAGE_PDF.toString("base64"));
  assert.equal(output.text, "Rs. 1,00,000 on 20/04/2026.");
  assert.equal(output.finishReason, "stop");
  assert.deepEqual(output.usage, { inputUnits: 1000, outputUnits: 500 });
  assert.ok(Math.abs(output.billedCostUsd - 0.002625) < 1e-12);
  assert.throws(() => createGemini37RepairPageAdapter({ apiKey: "secret", thinkingLevel: "HIGH" }), /pinned to LOW/);
});

test("provider adapters preserve billable invalid-response evidence and redact provider secrets from HTTP errors", async () => {
  const gemini = createGemini37RepairPageAdapter({
    apiKey: "gemini-secret-test",
    fetchImpl: async () => jsonResponse({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not-json" }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 3 },
    }),
  });
  await assert.rejects(async () => {
    try {
      await gemini.extractPage({ pageNumber: 1, source: { readBytes: async () => PAGE_PDF } });
    } catch (error) {
      assert.equal(error.code, "provider.invalid_response");
      assert.equal(error.billingKnown, true);
      assert.deepEqual(error.usage, { inputUnits: 10, outputUnits: 5 });
      assert.ok(error.billedCostUsd > 0);
      throw error;
    }
  }, { code: "provider.invalid_response" });

  const mistral = createMistralOcr41PageAdapter({
    apiKey: "mistral-secret-test",
    fetchImpl: async () => new Response("api_key=mistral-secret-test temporarily unavailable", { status: 503 }),
  });
  await assert.rejects(async () => {
    try {
      await mistral.extractPage({ pageNumber: 1, source: { readBytes: async () => PAGE_PDF } });
    } catch (error) {
      assert.equal(error.code, "provider.http_503");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /mistral-secret-test/);
      assert.match(error.message, /REDACTED/);
      throw error;
    }
  }, { code: "provider.http_503" });
});

test("provider HTTP boundary bounds response bytes and preserves Retry-After for adaptive admission", async () => {
  await assert.rejects(async () => {
    try {
      await fetchProviderJson({
        url: "https://provider.invalid", provider: "Provider", timeoutMs: 1000, maximumResponseBytes: 16,
        fetchImpl: async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "7" } }),
      });
    } catch (error) {
      assert.equal(error.code, "provider.http_429");
      assert.equal(error.retryAfterMs, 7000);
      throw error;
    }
  }, { code: "provider.http_429" });

  await assert.rejects(() => fetchProviderJson({
    url: "https://provider.invalid", provider: "Provider", timeoutMs: 1000, maximumResponseBytes: 8,
    fetchImpl: async () => new Response(JSON.stringify({ text: "response is too large" }), { status: 200 }),
  }), { code: "provider.response_too_large" });
});

function jsonResponse(value, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
}

// V4-PROVIDER-001 apex repair adapter evidence
test("pinned GPT-5.4 apex repair adapter reads a rasterized page and attributes token cost", async () => {
  const calls = [];
  const adapter = createGpt54RepairPageAdapter({
    apiKey: "openai-secret-test",
    inputUsdPerMillionTokens: 1.25,
    outputUsdPerMillionTokens: 10,
    rasterize: async () => Buffer.from("png-bytes"),
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return jsonResponse({
        choices: [{ message: { content: "Recovered stamp text." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      });
    },
  });
  const output = await adapter.extractPage({ pageNumber: 9, source: {} });
  assert.equal(output.text, "Recovered stamp text.");
  assert.equal(output.pageNumber, 9);
  assert.ok(Math.abs(output.billedCostUsd - (1000 * 1.25 / 1e6 + 200 * 10 / 1e6)) < 1e-12);
  assert.equal(calls[0].model, "gpt-5.4");
  assert.match(calls[0].messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  const empty = createGpt54RepairPageAdapter({
    apiKey: "k", inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10,
    rasterize: async () => Buffer.from("x"),
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: {} }),
  });
  await assert.rejects(() => empty.extractPage({ pageNumber: 1, source: {} }), (error) => error.code === "provider.invalid_response" && error.billingKnown === true);
});
