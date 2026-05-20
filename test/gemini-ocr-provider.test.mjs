import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildGeminiOcrRequestBody,
  createGeminiOcrProvider,
  DEFAULT_GEMINI_OCR_MODEL,
  GEMINI_OCR_ENDPOINT_BASE,
  normalizeGeminiOcrResponse,
} from "../extract-utils/gemini-ocr-provider.mjs";

test("Gemini OCR provider sends base64 PDF request and returns OCR provider shape", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-gemini-ocr-test-"));
  const pdfPath = path.join(tmp, "scan.pdf");
  await writeFile(pdfPath, "%PDF-1.4\n% fake pdf bytes\n");

  const requests = [];
  const provider = createGeminiOcrProvider({
    apiKey: "test-gemini-key",
    model: "gemini-3.5-flash",
    fetchImpl: async (endpoint, init) => {
      requests.push({ endpoint, init, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  pages: [{
                    page: 1,
                    markdown: "# Notice\n\nScanned notice dated 20 April 2026.",
                    confidence: 0.91,
                    warnings: ["faint stamp"],
                  }],
                }),
              }],
            },
          }],
        }),
      };
    },
  });

  const result = await provider({ pdfPath, pageCount: 1 });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, `${GEMINI_OCR_ENDPOINT_BASE}/models/gemini-3.5-flash:generateContent`);
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers["x-goog-api-key"], "test-gemini-key");
  assert.equal(requests[0].body.generationConfig.responseMimeType, "application/json");
  assert.ok(requests[0].body.generationConfig.responseJsonSchema);
  assert.equal(requests[0].body.contents[0].parts[1].inlineData.mimeType, "application/pdf");
  assert.match(requests[0].body.contents[0].parts[1].inlineData.data, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(result.engine, "gemini-ocr:gemini-3.5-flash");
  assert.deepEqual(result.pages, [
    {
      page: 1,
      markdown: "# Notice\n\nScanned notice dated 20 April 2026.",
      confidence: 0.91,
      warnings: ["faint stamp"],
    },
  ]);
});

test("Gemini OCR provider requires GEMINI_API_KEY or GOOGLE_API_KEY", () => {
  assert.throws(
    () => createGeminiOcrProvider({ apiKey: "" }),
    /GEMINI_API_KEY or GOOGLE_API_KEY is required for Gemini OCR/,
  );
});

test("Gemini OCR provider maps HTTP failures clearly", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-gemini-ocr-test-"));
  const pdfPath = path.join(tmp, "scan.pdf");
  await writeFile(pdfPath, "%PDF-1.4\n% fake pdf bytes\n");

  const provider = createGeminiOcrProvider({
    apiKey: "test-gemini-key",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "quota exceeded",
    }),
  });

  await assert.rejects(
    () => provider({ pdfPath, pageCount: 1 }),
    /Gemini OCR request failed \(429\): quota exceeded/,
  );
});

test("Gemini OCR response normalizer strips fenced JSON and uses page order fallback", () => {
  const result = normalizeGeminiOcrResponse({
    candidates: [{
      content: {
        parts: [{
          text: "```json\n{\"pages\":[{\"markdown\":\"Page one\"},{\"page\":2,\"markdown\":\"Page two\",\"confidence\":1.4}]}\n```",
        }],
      },
    }],
  }, { pageCount: 2, model: DEFAULT_GEMINI_OCR_MODEL });

  assert.deepEqual(result.pages.map((page) => page.page), [1, 2]);
  assert.equal(result.pages[1].confidence, 1);
});

test("Gemini OCR request body can include thinking level for candidate testing", () => {
  const body = buildGeminiOcrRequestBody({
    pdfBase64: "JVBERi0xLjQ=",
    pageCount: 3,
    thinkingLevel: "high",
  });

  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "HIGH");
  assert.match(body.contents[0].parts[0].text, /3 page\(s\)/);
});
