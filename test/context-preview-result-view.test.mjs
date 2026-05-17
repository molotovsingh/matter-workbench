import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  contextPreviewSummary,
  formatContextReport,
  renderContextPreviewResultHtml,
} from "../frontend/views/context-preview-result.js";

test("context preview renders packet stats without raw block text", () => {
  const result = {
    generated_at: "2026-05-12T10:00:00.000Z",
    matter: {
      folder_name: "Mehta vs Skyline",
      matter_name: "Mehta vs Skyline",
    },
    counts: {
      sources: 2,
      evidence_blocks_included: 120,
      evidence_blocks_omitted: 137,
      library_artifacts: 2,
    },
    limits: {
      max_blocks: 120,
    },
    source_index_present: true,
    warnings: ["Omitted 137 evidence block(s) due to maxBlocks=120"],
    top_sources: [
      {
        file_id: "FILE-0001",
        source_short_label: "Legal notice, 20 Apr 2026",
        document_type: "legal_notice",
        sample_citations: ["FILE-0001 p1.b1", "FILE-0001 p1.b2"],
      },
    ],
    library_artifacts: [
      {
        path: "10_Library/List of Dates.json",
        kind: "list_of_dates",
        summary: "33 accepted chronology entries with preserved raw citations",
      },
    ],
  };

  const summary = contextPreviewSummary(result);
  assert.equal(summary.counts.sources, 2);

  const html = renderContextPreviewResultHtml(result, escapeHtml);
  assert.match(html, /Context Preview/);
  assert.match(html, /Mehta vs Skyline/);
  assert.match(html, /120 included, 137 omitted/);
  assert.match(html, /Legal notice, 20 Apr 2026/);
  assert.match(html, /FILE-0001 p1\.b1/);
  assert.match(html, /10_Library\/List of Dates\.json/);
  assert.doesNotMatch(html, /full extracted paragraph text/i);

  const report = formatContextReport(result);
  assert.match(report, /^# Matter Context Report/);
  assert.match(report, /Evidence blocks: 120 included, 137 omitted/);
  assert.match(report, /FILE-0001: Legal notice, 20 Apr 2026/);
  assert.doesNotMatch(report, /full extracted paragraph text/i);
});

test("context preview copied report redacts secrets from diagnostic fields", () => {
  const report = formatContextReport({
    matter: {
      folder_name: "Matter sk-folder-secret",
    },
    warnings: ["OPENROUTER_API_KEY=sk-warning-secret"],
    top_sources: [
      {
        file_id: "FILE-0001",
        source_short_label: "Document sk-label-secret",
        sample_citations: ["FILE-0001 p1.b1"],
      },
    ],
    library_artifacts: [
      {
        path: "10_Library/sk-path-secret.json",
        summary: "provider rejected Bearer sk-summary-secret",
      },
    ],
  });

  assert.doesNotMatch(report, /sk-folder-secret|sk-warning-secret|sk-label-secret|sk-path-secret|sk-summary-secret/);
  assert.match(report, /OPENROUTER_API_KEY=\[redacted-secret\]/);
  assert.match(report, /Bearer \[redacted-secret\]/);
});

test("context preview surfaces missing source labels warning", () => {
  const result = {
    matter: {
      folder_name: "No Source Index Matter",
    },
    counts: {
      sources: 1,
      evidence_blocks_included: 3,
      evidence_blocks_omitted: 0,
      library_artifacts: 0,
    },
    source_index_present: false,
    warnings: ["10_Library/Source Index.json not found; source labels may be blank."],
    top_sources: [],
    library_artifacts: [],
  };

  const html = renderContextPreviewResultHtml(result, escapeHtml);
  assert.match(html, /Source Labels/);
  assert.match(html, /Missing/);
  assert.match(html, /source labels may be blank/);
});
