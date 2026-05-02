import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import { renderListOfDatesResultHtml } from "../frontend/views/listofdates-result.js";

test("list-of-dates result view renders lawyer-facing chronology columns", () => {
  const html = renderListOfDatesResultHtml({
    counts: {
      recordsRead: 2,
      blocksSent: 12,
      blocksFiltered: 3,
      aiRequests: 1,
      candidateEntries: 4,
      acceptedEntries: 3,
      clusteredEntries: 1,
      entries: 2,
      rejectedEntries: 1,
    },
    outputPaths: {
      json: "10_Library/List of Dates.json",
      csv: "10_Library/List of Dates.csv",
      markdown: "10_Library/List of Dates.md",
    },
    entries: [
      {
        date_iso: "2023-09-12",
        date_text: "12 September 2023",
        event: "Payment discrepancy: sources record inconsistent amounts",
        event_type: "contradiction",
        legal_relevance: "Flags a payment-record inconsistency for lawyer review.",
        cluster_type: "payment_discrepancy",
        supporting_sources: [
          {
            source_label: "Bank Statement for Skyline Developers Pvt Ltd, September 2023",
            citation: "FILE-0001 p1.b11",
          },
          {
            source_label: "Payment Receipt issued by Skyline Developers Pvt Ltd, 12 September 2023",
            citation: "FILE-0002 p1.b4",
          },
        ],
      },
    ],
  }, escapeHtml);

  assert.match(html, /Legal Relevance/);
  assert.match(html, /Flags a payment-record inconsistency/);
  assert.match(html, /Bank Statement for Skyline Developers/);
  assert.match(html, /FILE-0001 p1\.b11/);
  assert.match(html, /payment discrepancy/);
  assert.match(html, /Accepted events/);
  assert.match(html, /Rendered rows/);
  assert.doesNotMatch(html, /<th>Confidence<\/th>/);
});
