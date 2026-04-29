import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createMistralOcrProvider,
  MISTRAL_OCR_ENDPOINT,
  MISTRAL_OCR_MODEL,
  normalizeMistralOcrResponse,
} from "../extract-utils/mistral-ocr-provider.mjs";

test("Mistral OCR provider sends base64 PDF request and returns OCR provider shape", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-mistral-ocr-test-"));
  const pdfPath = path.join(tmp, "scan.pdf");
  await writeFile(pdfPath, "%PDF-1.4\n% fake pdf bytes\n");

  const requests = [];
  const provider = createMistralOcrProvider({
    apiKey: "test-mistral-key",
    fetchImpl: async (endpoint, init) => {
      requests.push({ endpoint, init, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () => ({
          pages: [
            {
              index: 0,
              markdown: "# Notice\n\nScanned notice dated 20 April 2026.",
              confidence_scores: { average: 0.87 },
            },
          ],
        }),
      };
    },
  });

  const result = await provider({ pdfPath, pageCount: 1 });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, MISTRAL_OCR_ENDPOINT);
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-mistral-key");
  assert.equal(requests[0].body.model, MISTRAL_OCR_MODEL);
  assert.deepEqual(requests[0].body.document.type, "document_url");
  assert.match(requests[0].body.document.document_url, /^data:application\/pdf;base64,/);
  assert.equal(requests[0].body.include_image_base64, false);
  assert.equal(requests[0].body.confidence_scores_granularity, "page");
  assert.equal(result.engine, MISTRAL_OCR_MODEL);
  assert.deepEqual(result.pages, [
    {
      page: 1,
      markdown: "# Notice\n\nScanned notice dated 20 April 2026.",
      confidence: 0.87,
      warnings: [],
    },
  ]);
});

test("Mistral OCR provider requires MISTRAL_API_KEY", () => {
  assert.throws(
    () => createMistralOcrProvider({ apiKey: "" }),
    /MISTRAL_API_KEY is required for Mistral OCR/,
  );
});

test("Mistral OCR provider maps HTTP failures clearly", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-mistral-ocr-test-"));
  const pdfPath = path.join(tmp, "scan.pdf");
  await writeFile(pdfPath, "%PDF-1.4\n% fake pdf bytes\n");

  const provider = createMistralOcrProvider({
    apiKey: "test-mistral-key",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limited",
    }),
  });

  await assert.rejects(
    () => provider({ pdfPath, pageCount: 1 }),
    /Mistral OCR request failed \(429\): rate limited/,
  );
});

test("Mistral OCR response normalizer uses response order for page numbers", () => {
  const result = normalizeMistralOcrResponse({
    pages: [
      { index: 0, markdown: "Page one" },
      { index: 1, markdown: "Page two", images: [{ id: "img-1" }] },
    ],
  }, { pageCount: 2 });

  assert.deepEqual(result.pages.map((page) => page.page), [1, 2]);
  assert.deepEqual(result.pages[1].warnings, ["page contains 1 extracted image placeholder(s)"]);
});
