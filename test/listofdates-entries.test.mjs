import assert from "node:assert/strict";
import test from "node:test";

import {
  compareEntries,
  matterSummary,
  validateAndHydrateCandidates,
  validateAndHydrateEntries,
} from "../listofdates/entries.mjs";
import { LAWYER_FACING_PERSPECTIVE } from "../listofdates/providers.mjs";

const sourceBlocks = [
  {
    citation: "FILE-0001 p1.b1",
    file_id: "FILE-0001",
    source_path: "00_Inbox/Originals/Notice.pdf",
    original_name: "Notice.pdf",
    page: 1,
    block_id: "p1.b1",
    block_type: "paragraph",
    needs_review: false,
    text: "The notice records a payment deadline and alleged non-delivery by the builder.",
  },
  {
    citation: "FILE-0002 p1.b1",
    file_id: "FILE-0002",
    source_path: "00_Inbox/Originals/Receipt.pdf",
    original_name: "Receipt.pdf",
    page: 1,
    block_id: "p1.b1",
    block_type: "paragraph",
    needs_review: true,
    text: "The receipt records a payment made by the client.",
  },
];

test("List of Dates entries hydrate valid model rows and apply safety normalization", () => {
  const sourceIndex = new Map([
    ["FILE-0001", {
      source_id: "src_1",
      content_hash: "hash-1",
      source_label: "Demand Notice",
      source_short_label: "Notice",
    }],
  ]);
  const entries = validateAndHydrateEntries([
    {
      date_iso: "2026-05-01",
      date_text: "1 May 2026",
      event: "This event proves breach of agreement FILE-0001 p1.b1",
      event_type: "notice",
      legal_relevance: "This event is relevant because it proves breach of agreement",
      issue_tags: ["Payment Default", "payment-default", "Client Loss", "x", "y", "z", "a", "b", "c"],
      perspective: LAWYER_FACING_PERSPECTIVE,
      citation: "FILE-0001 p1.b1",
      needs_review: true,
      confidence: 2,
    },
    {
      date_iso: "2026-05-02",
      date_text: "2 May 2026",
      event: "Fraud by builder",
      event_type: "notice",
      legal_relevance: "Supports fraud allegation",
      issue_tags: ["fraud"],
      perspective: LAWYER_FACING_PERSPECTIVE,
      citation: "FILE-0001 p1.b1",
      confidence: 0.7,
    },
    {
      date_iso: "2026-05-03",
      date_text: "3 May 2026",
      event: "Opposing party event",
      event_type: "notice",
      legal_relevance: "Supports opposing party",
      issue_tags: ["opponent"],
      perspective: "opponent",
      citation: "FILE-0001 p1.b1",
      confidence: 0.7,
    },
  ], sourceBlocks, sourceIndex);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].citation, "FILE-0001 p1.b1");
  assert.equal(entries[0].event, "This event supports contractual default issue");
  assert.equal(entries[0].legal_relevance, "Supports the client's chronology because it supports contractual default issue");
  assert.deepEqual(entries[0].issue_tags, [
    "payment_default",
    "client_loss",
    "x",
    "y",
    "z",
    "a",
    "b",
    "c",
  ]);
  assert.equal(entries[0].confidence, 1);
  assert.equal(entries[0].needs_review, true);
  assert.equal(entries[0].source_label, "Demand Notice");
  assert.equal(entries[0].source_short_label, "Notice");
  assert.equal(entries[0].source_excerpt, sourceBlocks[0].text);
  assert.doesNotMatch(entries[0].event, /FILE-0001/);
});

test("List of Dates candidates hydrate model rows with defaults and stable sorting", () => {
  const candidates = validateAndHydrateCandidates([
    {
      date_iso: "2026-05-03",
      date_text: "3 May 2026",
      event_candidate: "Payment receipt",
      legal_materiality: "May support payment proof",
      citation: "FILE-0002 p1.b1",
      candidate_type: "unknown-type",
      party_posture: "unknown-posture",
      confidence: "not-a-number",
    },
    {
      date_iso: "2026-05-01",
      date_text: "1 May 2026",
      event_candidate: "Notice sent",
      legal_materiality: "Supports notice chronology",
      citation: "FILE-0001 p1.b1",
      source_excerpt: "Notice excerpt",
      candidate_type: "notice",
      party_posture: "helps_client",
      confidence: -1,
    },
  ], sourceBlocks);

  assert.deepEqual(candidates.map((candidate) => candidate.date_iso), ["2026-05-01", "2026-05-03"]);
  assert.deepEqual(candidates.map((candidate) => candidate.candidate_id), ["cand_0002", "cand_0001"]);
  assert.equal(candidates[0].candidate_type, "notice");
  assert.equal(candidates[0].party_posture, "helps_client");
  assert.equal(candidates[0].confidence, 0);
  assert.equal(candidates[1].candidate_type, "other");
  assert.equal(candidates[1].party_posture, "unclear");
  assert.equal(candidates[1].confidence, 0.5);
  assert.equal(candidates[1].needs_review, true);
  assert.equal(candidates[1].source_excerpt, sourceBlocks[1].text);
});

test("List of Dates comparison and matter summaries stay deterministic", () => {
  const sorted = [
    { date_iso: "2026-05-02", file_id: "FILE-0001", block_id: "p1.b1", date_text: "2 May" },
    { date_iso: "2026-05-01", file_id: "FILE-0002", block_id: "p1.b1", date_text: "1 May" },
  ].sort(compareEntries);

  assert.deepEqual(sorted.map((entry) => entry.file_id), ["FILE-0002", "FILE-0001"]);
  assert.deepEqual(matterSummary({
    matter_name: "Matter",
    client_name: "Client",
    opposite_party: "Builder",
  }), {
    matter_name: "Matter",
    client_name: "Client",
    opposite_party: "Builder",
    matter_type: "",
    jurisdiction: "",
    brief_description: "",
  });
});
