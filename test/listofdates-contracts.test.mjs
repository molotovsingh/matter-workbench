import assert from "node:assert/strict";
import test from "node:test";
import {
  CANDIDATE_SCHEMA,
  CSV_HEADERS,
  OUTPUT_SCHEMA,
} from "../listofdates/contracts.mjs";
import {
  EVENT_TYPES,
  LAWYER_FACING_PERSPECTIVE,
} from "../listofdates/providers.mjs";

test("List of Dates output schema preserves the lawyer-facing entry contract", () => {
  const entrySchema = OUTPUT_SCHEMA.properties.entries.items;

  assert.deepEqual(OUTPUT_SCHEMA.required, ["entries"]);
  assert.equal(entrySchema.additionalProperties, false);
  assert.ok(entrySchema.required.includes("date_iso"));
  assert.ok(entrySchema.required.includes("legal_relevance"));
  assert.ok(entrySchema.required.includes("citation"));
  assert.deepEqual(entrySchema.properties.event_type.enum, EVENT_TYPES);
  assert.deepEqual(entrySchema.properties.perspective.enum, [LAWYER_FACING_PERSPECTIVE]);
  assert.equal(entrySchema.properties.citation.pattern, "^FILE-\\d{4,} p\\d+\\.b\\d+$");
  assert.equal(entrySchema.properties.issue_tags.maxItems, 8);
  assert.equal(entrySchema.properties.confidence.minimum, 0);
  assert.equal(entrySchema.properties.confidence.maximum, 1);
});

test("List of Dates candidate schema preserves the two-pass ledger contract", () => {
  const candidateSchema = CANDIDATE_SCHEMA.properties.candidates.items;

  assert.deepEqual(CANDIDATE_SCHEMA.required, ["candidates"]);
  assert.equal(candidateSchema.additionalProperties, false);
  assert.ok(candidateSchema.required.includes("event_candidate"));
  assert.ok(candidateSchema.required.includes("legal_materiality"));
  assert.ok(candidateSchema.required.includes("source_excerpt"));
  assert.deepEqual(candidateSchema.properties.candidate_type.enum, [
    "agreement",
    "payment",
    "notice",
    "pleading",
    "order",
    "filing",
    "inspection",
    "correspondence",
    "other",
  ]);
  assert.deepEqual(candidateSchema.properties.party_posture.enum, ["helps_client", "hurts_client", "neutral", "unclear"]);
  assert.equal(candidateSchema.properties.confidence.maximum, 1);
});

test("List of Dates CSV headers preserve source identity and display fields", () => {
  assert.deepEqual(CSV_HEADERS.slice(0, 6), [
    "date_iso",
    "date_text",
    "event",
    "event_type",
    "legal_relevance",
    "issue_tags",
  ]);
  assert.ok(CSV_HEADERS.includes("supporting_citations"));
  assert.ok(CSV_HEADERS.includes("source_id"));
  assert.ok(CSV_HEADERS.includes("content_hash"));
  assert.ok(CSV_HEADERS.includes("source_label"));
  assert.ok(CSV_HEADERS.includes("source_short_label"));
  assert.deepEqual(CSV_HEADERS.slice(-2), ["needs_review", "confidence"]);
});
