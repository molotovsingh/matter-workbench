import assert from "node:assert/strict";
import test from "node:test";
import { clusterChronologyEntries } from "../listofdates/clustering.mjs";

function entry(overrides = {}) {
  return {
    date_iso: "2023-04-30",
    date_text: "30 April 2023",
    event: "Mehta paid Rs.10,00,000 to Skyline.",
    event_type: "payment",
    legal_relevance: "Supports the client's payment chronology because the cited source records the payment.",
    issue_tags: ["payment"],
    perspective: "client_favourable",
    citation: "FILE-0001 p1.b1",
    source_file_id: "FILE-0001",
    source_label: "Bank statement",
    source_short_label: "Bank statement",
    source_path: "bank.txt",
    original_name: "bank.txt",
    file_id: "FILE-0001",
    block_id: "b1",
    needs_review: false,
    confidence: 0.9,
    ...overrides,
  };
}

test("clusterChronologyEntries keeps separate same-day payments separate", () => {
  const entries = [
    entry({
      event: "Mehta paid Rs.10,00,000 as booking amount to Skyline.",
      legal_relevance: "Supports the client's payment chronology because the source records a Rs.10,00,000 booking amount.",
      citation: "FILE-0001 p1.b1",
      source_file_id: "FILE-0001",
      file_id: "FILE-0001",
    }),
    entry({
      event: "Mehta paid Rs.2,50,000 as maintenance deposit to Skyline.",
      legal_relevance: "Supports the client's payment chronology because the source records a Rs.2,50,000 maintenance deposit.",
      citation: "FILE-0002 p1.b1",
      source_file_id: "FILE-0002",
      file_id: "FILE-0002",
    }),
  ];

  const clustered = clusterChronologyEntries(entries);

  assert.equal(clustered.length, 2);
  assert.deepEqual(clustered.map((candidate) => candidate.cluster_type), ["single_event", "single_event"]);
  assert.deepEqual(clustered.map((candidate) => candidate.citation), ["FILE-0001 p1.b1", "FILE-0002 p1.b1"]);
});

test("clusterChronologyEntries classifies explicit same-day payment discrepancies", () => {
  const clustered = clusterChronologyEntries([
    entry({
      date_iso: "2023-09-12",
      date_text: "12 September 2023",
      event: "Mehta paid Rs.15,70,000 to Skyline.",
      legal_relevance: "Supports the client's payment discrepancy issue because the bank statement records Rs.15,70,000.",
      issue_tags: ["payment", "contradiction"],
      citation: "FILE-0001 p1.b2",
    }),
    entry({
      date_iso: "2023-09-12",
      date_text: "12 September 2023",
      event: "Receipt acknowledged Rs.12,25,000 from Mehta.",
      legal_relevance: "Supports the client's payment discrepancy issue because the receipt records Rs.12,25,000.",
      issue_tags: ["payment", "contradiction"],
      citation: "FILE-0002 p1.b2",
      source_file_id: "FILE-0002",
      file_id: "FILE-0002",
    }),
  ]);

  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].cluster_type, "payment_discrepancy");
  assert.equal(clustered[0].event_type, "contradiction");
  assert.match(clustered[0].event, /Rs\.12,25,000 vs Rs\.15,70,000/);
  assert.deepEqual(clustered[0].supporting_sources.map((source) => source.citation), [
    "FILE-0001 p1.b2",
    "FILE-0002 p1.b2",
  ]);
});

test("clusterChronologyEntries collapses exact source duplicates", () => {
  const clustered = clusterChronologyEntries([
    entry({
      date_iso: "2026-05-01",
      date_text: "01 May 2026",
      event: "Legal notice was issued.",
      event_type: "notice",
      legal_relevance: "Supports the client's notice chronology because the source records the notice date.",
      issue_tags: ["notice"],
      citation: "FILE-0003 p1.b1",
      source_file_id: "FILE-0003",
      file_id: "FILE-0003",
    }),
    entry({
      date_iso: "2026-05-01",
      date_text: "01 May 2026",
      event: "Legal notice was issued.",
      event_type: "notice",
      legal_relevance: "Supports the client's notice chronology because the source records the notice date.",
      issue_tags: ["notice"],
      citation: "FILE-0003 p1.b1",
      source_file_id: "FILE-0003",
      file_id: "FILE-0003",
    }),
  ]);

  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].cluster_type, "true_duplicate");
  assert.deepEqual(clustered[0].supporting_sources.map((source) => source.citation), ["FILE-0003 p1.b1"]);
});
