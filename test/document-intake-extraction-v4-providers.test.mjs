import assert from "node:assert/strict";
import test from "node:test";

import { createGemini37RepairPageAdapter } from "../services/document-intake-extraction/providers/gemini37-repair-adapter.mjs";
import { createMistralOcr41PageAdapter } from "../services/document-intake-extraction/providers/mistral-ocr41-adapter.mjs";
import { createMistralOcr41RangeAdapter } from "../services/document-intake-extraction/providers/mistral-ocr41-range-adapter.mjs";

const PAGE_PDF = Buffer.from("%PDF-1.4 isolated page bytes");

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

function jsonResponse(value, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
}
