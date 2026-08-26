import assert from "node:assert/strict";
import test from "node:test";

import { PdfNativeTextInspector } from "../workers/document-processing/pdf-native-text-inspector.mjs";
import { NATIVE_TEXT_CAPABILITY, createNativeTextPageProvider } from "../workers/document-processing/native-text-page-provider.mjs";

const LONG_TEXT = "IN THE HIGH COURT OF JUDICATURE. Writ Petition number 4312 of 2026. The petitioner submits that the assessment order dated 12 March 2026 was passed without jurisdiction and in violation of the principles of natural justice, and prays for interim protection. ".repeat(2);

function fakeScratch() {
  return {
    async withTaskScratch(_options, operation) {
      return operation({ directory: "/scratch", pathFor: (name) => `/scratch/${name}`, maximumBytes: 1024 * 1024, cleanup: async () => {} });
    },
    async materializeBlob() {
      return { filePath: "/scratch/source/source.pdf", bytes: 100, sha256: "a".repeat(64) };
    },
  };
}

// The classifier must fail toward OCR on every ambiguity: only substantial,
// cleanly-encoded text NOT sitting on a page-covering image rides free.
test("native-text inspector trusts born-digital pages and distrusts scans, OCR-overlay layers, and short pages", async () => {
  const inspector = new PdfNativeTextInspector({
    objectStore: { openBlobStream: async () => ({}) },
    scratchSpace: fakeScratch(),
    execFileImpl: async (command) => {
      if (command === "pdfinfo") return { stdout: "Pages:          3\nPage size:      612 x 792 pts (letter)\n" };
      if (command === "pdftotext") return { stdout: `${LONG_TEXT}\ftiny scan残\f${LONG_TEXT}` };
      if (command === "pdfimages") {
        return { stdout: [
          "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio",
          "--------------------------------------------------------------------------------------------",
          "   3     0 image    1224  1584  gray    1   8  jpeg   no        12  0   144   144  180K  9%",
        ].join("\n") };
      }
      throw new Error(`unexpected command ${command}`);
    },
  });
  const inspection = await inspector.inspect({ blobReference: { sha256: "a".repeat(64) }, sourceBytes: 100 });
  assert.equal(inspection.pageCount, 3);
  assert.equal(inspection.pages[0].nativeText.trusted, true, "long clean text with no covering image is native");
  assert.equal(inspection.pages[1].nativeText.trusted, false);
  assert.ok(inspection.pages[1].nativeText.reasons.includes("insufficient_text"));
  assert.equal(inspection.pages[2].nativeText.trusted, false, "text over a page-covering image is an OCR overlay, never native");
  assert.ok(inspection.pages[2].nativeText.reasons.includes("image_dominated"));
});

test("native-text inspector fails toward OCR when the image layout cannot be read", async () => {
  const inspector = new PdfNativeTextInspector({
    objectStore: { openBlobStream: async () => ({}) },
    scratchSpace: fakeScratch(),
    execFileImpl: async (command) => {
      if (command === "pdfinfo") return { stdout: "Pages: 1\nPage size: 612 x 792 pts\n" };
      if (command === "pdftotext") return { stdout: LONG_TEXT };
      throw Object.assign(new Error("pdfimages unavailable"), { code: "ENOENT" });
    },
  });
  const inspection = await inspector.inspect({ blobReference: { sha256: "a".repeat(64) }, sourceBytes: 100 });
  assert.equal(inspection.pages[0].nativeText.trusted, false);
  assert.ok(inspection.pages[0].nativeText.reasons.includes("image_layout_unknown"));
});

test("native text page provider extracts locally at zero cost under a pinned capability", async () => {
  const provider = createNativeTextPageProvider({
    execFileImpl: async (command, args) => {
      assert.equal(command, "pdftotext");
      assert.equal(args.at(-2), "/scratch/pages/page-7.pdf");
      return { stdout: "Section 42 order text.\f" };
    },
  });
  assert.deepEqual(provider.capability, NATIVE_TEXT_CAPABILITY);
  const output = await provider.extractPage({ pageNumber: 7, source: { filePath: "/scratch/pages/page-7.pdf" } });
  assert.equal(output.text, "Section 42 order text.");
  assert.equal(output.billedCostUsd, 0);
  assert.deepEqual(output.usage, { inputUnits: 0, outputUnits: 0 });
  assert.ok(output.diagnostics.includes("native_text_extraction"));
});
