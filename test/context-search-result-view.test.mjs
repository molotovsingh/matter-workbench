import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  contextSearchSummary,
  formatContextSearchReport,
  renderContextSearchResultHtml,
} from "../frontend/views/context-search-result.js";

test("context search renders source labels, citations, and bounded snippets", () => {
  const result = {
    searched_at: "2026-05-12T10:00:00.000Z",
    query: "payment",
    matter: {
      folder_name: "Mehta vs Skyline",
      matter_name: "Mehta vs Skyline",
    },
    counts: {
      searched_blocks: 120,
      matches: 2,
      omitted_matches: 1,
      sources: 2,
    },
    limits: {
      max_results: 25,
    },
    warnings: [],
    results: [
      {
        citation: "FILE-0002 p1.b3",
        source_short_label: "Bank statement, 12 Jan 2024",
        document_type: "bank_statement",
        snippet: "Payment of Rs. 12,25,000 was debited on 12 January 2024.",
      },
    ],
  };

  const summary = contextSearchSummary(result);
  assert.equal(summary.counts.matches, 2);

  const html = renderContextSearchResultHtml(result, escapeHtml);
  assert.match(html, /Context Search/);
  assert.match(html, /Mehta vs Skyline/);
  assert.match(html, /payment/);
  assert.match(html, /Bank statement, 12 Jan 2024/);
  assert.match(html, /FILE-0002 p1\.b3/);
  assert.match(html, /Provider calls disabled|does not read raw files|does not read raw files/i);
  assert.doesNotMatch(html, /OPENROUTER_API_KEY|MISTRAL_API_KEY|sk-/);

  const report = formatContextSearchReport(result);
  assert.match(report, /^# Matter Context Search Report/);
  assert.match(report, /- Query: `payment`/);
  assert.match(report, /- Provider calls: none/);
  assert.match(report, /Bank statement, 12 Jan 2024 \(FILE-0002 p1\.b3\)/);
  assert.doesNotMatch(report, /OPENROUTER_API_KEY|MISTRAL_API_KEY|sk-/);
});

test("context search copied report redacts secrets from query and snippets", () => {
  const report = formatContextSearchReport({
    query: "payment OPENAI_API_KEY=sk-query-secret",
    matter: {
      folder_name: "Matter sk-folder-secret",
    },
    warnings: ["OPENROUTER_API_KEY=sk-warning-secret"],
    results: [
      {
        citation: "FILE-0001 p1.b1",
        source_short_label: "Document sk-label-secret",
        snippet: "authorization: Bearer sk-snippet-secret",
      },
    ],
  });

  assert.doesNotMatch(report, /sk-query-secret|sk-folder-secret|sk-warning-secret|sk-label-secret|sk-snippet-secret/);
  assert.match(report, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(report, /Bearer \[redacted-secret\]/);
});

test("context search renders empty results without treating them as errors", () => {
  const html = renderContextSearchResultHtml({
    query: "nonexistent",
    matter: { folder_name: "Demo Matter" },
    counts: {
      searched_blocks: 3,
      matches: 0,
      omitted_matches: 0,
      sources: 0,
    },
    results: [],
    warnings: [],
  }, escapeHtml);

  assert.match(html, /No context matches found/);
  assert.match(html, /Demo Matter/);
});
