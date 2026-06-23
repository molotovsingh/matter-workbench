import assert from "node:assert/strict";
import test from "node:test";

import {
  INTAKE_SIZING_REPORT_SCHEMA_VERSION,
  buildIntakeSizingReport,
} from "../services/intake/intake-sizing-report.mjs";

function candidate(relativePath, sizeBytes) {
  return {
    relativePath,
    originalName: relativePath.split("/").at(-1),
    sizeBytes,
  };
}

test("intake sizing report classifies small browser batches as immediate", () => {
  const report = buildIntakeSizingReport({
    candidates: [
      candidate("notice.pdf", 4 * 1024 * 1024),
      candidate("email.eml", 512 * 1024),
    ],
  });

  assert.equal(report.schema_version, INTAKE_SIZING_REPORT_SCHEMA_VERSION);
  assert.equal(report.sizeClass, "small");
  assert.equal(report.recommendedPreparationMode, "immediate");
  assert.equal(report.candidateCount, 2);
  assert.equal(report.totalBytes, 4718592);
  assert.equal(report.typeMix.pdf, 1);
  assert.equal(report.typeMix.email, 1);
  assert.deepEqual(report.signals, []);
});

test("intake sizing report recommends batching for medium mixed payloads", () => {
  const candidates = Array.from({ length: 30 }, (_, index) => (
    candidate(`docs/file-${index + 1}.pdf`, 2 * 1024 * 1024)
  ));

  const report = buildIntakeSizingReport({ candidates });

  assert.equal(report.sizeClass, "medium");
  assert.equal(report.recommendedPreparationMode, "batched");
  assert.equal(report.typeMix.pdf, 30);
  assert.ok(report.signals.includes("intake.many_files"));
});

test("intake sizing report marks large PDF-heavy payloads for background processing", () => {
  const candidates = Array.from({ length: 140 }, (_, index) => (
    candidate(`briefs/page-set-${index + 1}.pdf`, 1 * 1024 * 1024)
  ));

  const report = buildIntakeSizingReport({ candidates });

  assert.equal(report.sizeClass, "large");
  assert.equal(report.recommendedPreparationMode, "background");
  assert.ok(report.signals.includes("intake.many_pdfs"));
  assert.ok(report.signals.includes("intake.large_file_count"));
});

test("intake sizing report flags risky archive and very large selections for review", () => {
  const report = buildIntakeSizingReport({
    candidates: [
      candidate("client-export.zip", 700 * 1024 * 1024),
      candidate("scan.pdf", 20 * 1024 * 1024),
    ],
  });

  assert.equal(report.sizeClass, "huge");
  assert.equal(report.recommendedPreparationMode, "needs_review_before_processing");
  assert.equal(report.typeMix.archive, 1);
  assert.ok(report.signals.includes("intake.contains_archive"));
  assert.ok(report.signals.includes("intake.large_single_file"));
});

test("intake sizing report is defensive around malformed candidates", () => {
  const report = buildIntakeSizingReport({
    candidates: [
      { relativePath: "", originalName: "unknown", sizeBytes: -1 },
      null,
      candidate("data.csv", 10),
    ],
  });

  assert.equal(report.candidateCount, 3);
  assert.equal(report.totalBytes, 10);
  assert.equal(report.typeMix.spreadsheet, 1);
  assert.equal(report.typeMix.other, 2);
});
