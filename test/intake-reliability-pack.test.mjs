import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const packPath = new URL("../scripts/intake-reliability-pack.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const docsPath = new URL("../docs/intake-reliability-pack.md", import.meta.url);

test("intake reliability pack runs representative fixtures and writes an honest support matrix", async () => {
  const { runIntakeReliabilityPack, renderIntakeReliabilityPackResult } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-intake-reliability-"));

  const result = await runIntakeReliabilityPack({
    outDir,
    timestamp: "2026-06-06T18:00:00.000Z",
  });

  assert.equal(result.success, true);
  assert.equal(result.schemaVersion, "intake-reliability-pack/v1");
  assert.equal(result.extraction.counts.failed, 0);
  assert.equal(result.filesSeen.length >= 9, true);
  assert.equal(existsSync(result.files.json), true);
  assert.equal(existsSync(result.files.markdown), true);

  const byKey = new Map(result.supportMatrix.map((entry) => [entry.key, entry]));
  assert.equal(byKey.get("pdf_text_layer").status, "supported");
  assert.match(byKey.get("pdf_text_layer").evidence, /ocr-first/i);
  assert.equal(byKey.get("pdf_low_confidence_scan").status, "supported_needs_review");
  assert.match(byKey.get("pdf_low_confidence_scan").evidence, /OCR output needs review/i);
  assert.equal(byKey.get("eml_email").status, "supported");
  assert.match(byKey.get("eml_email").evidence, /mailparser/i);
  assert.equal(byKey.get("csv_spreadsheet").status, "supported_needs_review");
  assert.equal(byKey.get("xlsx_spreadsheet").status, "supported_needs_review");
  assert.equal(byKey.get("whatsapp_text_export").status, "supported_limited");
  assert.equal(byKey.get("image_screenshot").status, "preserved_only");
  assert.equal(byKey.get("whatsapp_zip_export").status, "preserved_only");
  assert.equal(byKey.get("outlook_msg").status, "preserved_only");

  assert.deepEqual(result.runtimeDbCompatibility.checkedBy, [
    "test/runtime-db-api.test.mjs",
    "test/runtime-db-storage-service.test.mjs",
    "npm run db:runtime:write-smoke",
  ]);
  assert.match(result.runtimeDbCompatibility.summary, /runtime DB storage mode/i);

  const evidence = JSON.parse(await readFile(result.files.json, "utf8"));
  assert.equal(evidence.supportMatrix.length, result.supportMatrix.length);
  assert.match(JSON.stringify(evidence), /client-email\.eml/);

  const rendered = renderIntakeReliabilityPackResult(result).join("\n");
  assert.match(rendered, /Matter Workbench intake reliability pack/);
  assert.match(rendered, /pdf_low_confidence_scan: supported_needs_review/);
  assert.match(rendered, /image_screenshot: preserved_only/);
});

test("intake reliability pack renderer keeps unsupported media limitations visible", async () => {
  const { renderSupportMatrixMarkdown } = await import(packPath.href);
  const lines = renderSupportMatrixMarkdown([
    {
      key: "image_screenshot",
      label: "Images and screenshots",
      status: "preserved_only",
      evidence: "Images are previewable but not extracted.",
      action: "Ask for text exports or better source documents.",
    },
  ]);

  const markdown = lines.join("\n");
  assert.match(markdown, /Images and screenshots/);
  assert.match(markdown, /preserved_only/);
  assert.match(markdown, /Ask for text exports/);
});

test("package and docs expose the intake reliability pack command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["intake:reliability-pack"], "node scripts/intake-reliability-pack.mjs");

  const docs = await readFile(docsPath, "utf8");
  assert.match(docs, /intake:reliability-pack/);
  assert.match(docs, /PDF/i);
  assert.match(docs, /EML/i);
  assert.match(docs, /spreadsheets/i);
  assert.match(docs, /WhatsApp/i);
});
