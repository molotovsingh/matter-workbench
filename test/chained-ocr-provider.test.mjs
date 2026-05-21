import assert from "node:assert/strict";
import test from "node:test";
import { createChainedOcrProvider } from "../extract-utils/chained-ocr-provider.mjs";
import { scoreOcrProviderResult } from "../extract-utils/ocr-quality.mjs";

const PACKET = {
  pdfPath: "/tmp/fake.pdf",
  fileId: "FILE-0001",
  sha256: "abc",
  sourcePath: "00_Inbox/Intake 01 - Initial/Source Files/fake.pdf",
  pageCount: 1,
};

test("chained OCR keeps good Mistral output and skips Gemini repair", async () => {
  let geminiCalls = 0;
  const provider = createChainedOcrProvider({
    repairEnabled: true,
    mistralProvider: async () => ocrResult("mistral-ocr-latest", "Agreement dated 20 April 2026 records payment of Rs. 10,00,000 and delivery obligations for the flat."),
    geminiProvider: async () => {
      geminiCalls += 1;
      return ocrResult("gemini-ocr:gemini-2.5-pro", "Gemini text");
    },
  });

  const result = await provider(PACKET);

  assert.equal(result.engine, "mistral-ocr-latest");
  assert.equal(geminiCalls, 0);
});

test("chained OCR repairs suspicious Mistral date tokens with Gemini", async () => {
  let geminiCalls = 0;
  const provider = createChainedOcrProvider({
    repairEnabled: true,
    mistralProvider: async () => ocrResult("mistral-ocr-latest", "Payment was due up to $1.8.14 under the builder letter."),
    geminiProvider: async () => {
      geminiCalls += 1;
      return ocrResult("gemini-ocr:gemini-2.5-pro", "Payment was due up to 31.8.14 under the builder letter dated 20.07.2014 for Rs. 55,00,000.");
    },
  });

  const result = await provider(PACKET);

  assert.equal(result.engine, "gemini-ocr:gemini-2.5-pro");
  assert.equal(geminiCalls, 1);
});

test("chained OCR falls back to Gemini when Mistral fails", async () => {
  const provider = createChainedOcrProvider({
    repairEnabled: true,
    mistralProvider: async () => {
      throw new Error("quota exhausted");
    },
    geminiProvider: async () => ocrResult("gemini-ocr:gemini-2.5-pro", "Notice dated 12.03.2024 demanding Rs. 1,00,000."),
  });

  const result = await provider(PACKET);

  assert.equal(result.engine, "gemini-ocr:gemini-2.5-pro");
});

test("chained OCR rejects invalid Gemini fallback when Mistral fails", async () => {
  const provider = createChainedOcrProvider({
    repairEnabled: true,
    mistralProvider: async () => {
      throw new Error("quota exhausted");
    },
    geminiProvider: async () => ({
      engine: "gemini-ocr:gemini-2.5-pro",
      pages: [],
    }),
  });

  await assert.rejects(
    () => provider(PACKET),
    /Gemini repair also failed.*repair output did not cover every page exactly once/,
  );
});

test("chained OCR prefers structurally valid Gemini repair even when heuristic score is lower", async () => {
  const provider = createChainedOcrProvider({
    repairEnabled: true,
    mistralProvider: async () => ({
      ...ocrResult("mistral-ocr-latest", "Agreement dated 20 April 2026 records payment of Rs. 10,00,000 and handover of Flat 1202."),
      pages: [{
        page: 1,
        markdown: "Agreement dated 20 April 2026 records payment of Rs. 10,00,000 and handover of Flat 1202.",
        confidence: 0.72,
      }],
    }),
    geminiProvider: async () => ocrResult("gemini-ocr:gemini-2.5-pro", "Agreement."),
  });

  const result = await provider(PACKET);

  assert.equal(result.engine, "gemini-ocr:gemini-2.5-pro");
  assert.equal(result.pipeline.repair_status, "used");
});

test("chained OCR repairs Mistral output with unknown confidence", async () => {
  let geminiCalls = 0;
  const provider = createChainedOcrProvider({
    repairEnabled: true,
    mistralProvider: async () => ({
      engine: "mistral-ocr-latest",
      pages: [{ page: 1, markdown: "Agreement dated 20 April 2026 records payment of Rs. 10,00,000." }],
    }),
    geminiProvider: async () => {
      geminiCalls += 1;
      return ocrResult("gemini-ocr:gemini-2.5-pro", "Agreement dated 20 April 2026 records payment of Rs. 10,00,000 with complete surrounding terms.");
    },
  });

  const result = await provider(PACKET);

  assert.equal(geminiCalls, 1);
  assert.equal(result.engine, "gemini-ocr:gemini-2.5-pro");
  assert.match(result.pipeline.repair_reason, /unknown confidence/);
});

test("chained OCR repairs when text-layer diagnostics report layout risk", async () => {
  let geminiCalls = 0;
  const provider = createChainedOcrProvider({
    repairEnabled: true,
    mistralProvider: async () => ocrResult("mistral-ocr-latest", "Agreement dated 20 April 2026 records payment of Rs. 10,00,000."),
    geminiProvider: async () => {
      geminiCalls += 1;
      return ocrResult("gemini-ocr:gemini-2.5-pro", "Agreement dated 20 April 2026 records payment of Rs. 10,00,000 with repaired reading order.");
    },
  });

  const result = await provider({
    ...PACKET,
    qualityHints: {
      needsRepair: true,
      reasons: ["2 page(s) had layout/read-order risk in embedded text"],
    },
  });

  assert.equal(geminiCalls, 1);
  assert.equal(result.engine, "gemini-ocr:gemini-2.5-pro");
  assert.match(result.pipeline.repair_reason, /layout\/read-order risk/);
});

test("chained OCR rejects Gemini repair that drops pages covered by Mistral", async () => {
  const provider = createChainedOcrProvider({
    repairEnabled: true,
    mistralProvider: async () => ({
      engine: "mistral-ocr-latest",
      pages: [
        {
          page: 1,
          markdown: "Agreement dated 20.04.2026 records payment of Rs. 10,00,000.",
          confidence: 0.95,
        },
        {
          page: 2,
          markdown: "Possession letter states handover by $1.8.14.",
          confidence: 0.95,
        },
      ],
    }),
    geminiProvider: async () => ({
      engine: "gemini-ocr:gemini-2.5-pro",
      pages: [{
        page: 1,
        markdown: "Agreement dated 20.04.2026 records payment of Rs. 10,00,000 with more surrounding text, more context, and more blocks.",
        confidence: 0.99,
      }],
    }),
  });

  const result = await provider({ ...PACKET, pageCount: 2 });

  assert.equal(result.engine, "mistral-ocr-latest");
  assert.equal(result.pages.length, 2);
  assert.match(result.pages[0].warnings[0], /Gemini OCR repair rejected/);
});

test("chained OCR rejects Gemini repair with duplicate page numbers", async () => {
  const provider = createChainedOcrProvider({
    repairEnabled: true,
    mistralProvider: async () => ({
      engine: "mistral-ocr-latest",
      pages: [
        {
          page: 1,
          markdown: "Agreement dated 20.04.2026 records payment of Rs. 10,00,000.",
          confidence: 0.95,
        },
        {
          page: 2,
          markdown: "Possession letter states handover by $1.8.14.",
          confidence: 0.95,
        },
      ],
    }),
    geminiProvider: async () => ({
      engine: "gemini-ocr:gemini-2.5-pro",
      pages: [
        {
          page: 1,
          markdown: "Agreement dated 20.04.2026 records payment of Rs. 10,00,000 with more surrounding text.",
          confidence: 0.99,
        },
        {
          page: 1,
          markdown: "Possession letter states handover by 31.8.14 with more surrounding text.",
          confidence: 0.99,
        },
      ],
    }),
  });

  const result = await provider({ ...PACKET, pageCount: 2 });

  assert.equal(result.engine, "mistral-ocr-latest");
  assert.equal(result.pages.length, 2);
  assert.match(result.pages[0].warnings[0], /Gemini OCR repair rejected/);
});

test("OCR quality scorer flags suspicious date substitutions", () => {
  const score = scoreOcrProviderResult(
    ocrResult("mistral-ocr-latest", "The amount was payable up to $1.8.14."),
    { pageCount: 1 },
  );

  assert.equal(score.needsRepair, true);
  assert.equal(score.suspiciousHits > 0, true);
});

test("OCR quality scorer treats missing confidence as repair signal, not low confidence", () => {
  const score = scoreOcrProviderResult(
    {
      engine: "mistral-ocr-latest",
      pages: [{ page: 1, markdown: "Agreement dated 20 April 2026 records payment of Rs. 10,00,000." }],
    },
    { pageCount: 1 },
  );

  assert.equal(score.needsRepair, true);
  assert.equal(score.missingConfidencePages, 1);
  assert.equal(score.lowConfidencePages, 0);
});

function ocrResult(engine, markdown) {
  return {
    engine,
    pages: [{
      page: 1,
      markdown,
      confidence: 0.95,
    }],
  };
}
