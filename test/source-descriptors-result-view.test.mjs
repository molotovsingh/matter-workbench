import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  renderSourceDescriptorsResultHtml,
  sourceDescriptorsSummary,
} from "../frontend/views/source-descriptors-result.js";

test("source descriptors result view renders provider and warning summary", () => {
  const result = {
    counts: {
      recordsRead: 2,
      sourcePackets: 2,
      descriptors: 2,
    },
    outputPaths: {
      json: "10_Library/Source Index.json",
    },
    aiRun: {
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct",
      returnedModel: "meta-llama/llama-3.3-70b-instruct",
      returnedProvider: "akashml/fp8",
    },
    sources: [
      {
        file_id: "FILE-0001",
        short_label: "Legal Notice from Mehta Legal LLP, 20 April 2026",
        document_type: "legal_notice",
        needs_review: false,
        warnings: [],
      },
      {
        file_id: "FILE-0002",
        short_label: "Unclear scanned receipt",
        document_type: "receipt",
        needs_review: true,
        warnings: ["Low OCR confidence", "Date unclear"],
      },
    ],
  };

  const summary = sourceDescriptorsSummary(result);
  assert.equal(summary.warningsCount, 2);
  assert.equal(summary.needsReviewCount, 1);

  const html = renderSourceDescriptorsResultHtml(result, escapeHtml);
  assert.match(html, /Sources described/);
  assert.match(html, /10_Library\/Source Index\.json/);
  assert.match(html, /openrouter/);
  assert.match(html, /akashml\/fp8/);
  assert.match(html, /meta-llama\/llama-3\.3-70b-instruct/);
  assert.match(html, /Legal Notice from Mehta Legal LLP/);
  assert.match(html, /Unclear scanned receipt/);
  assert.match(html, /Warnings/);
});
