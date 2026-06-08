import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseCsv } from "../shared/csv.mjs";
import {
  fileIdForOriginalName,
  lawyerFields,
  listOfDatesCandidate,
  listOfDatesEntry,
  prepareExtractedMatter,
  readExtractionRecord,
  sourceIndexSource,
  writeSourceIndex,
} from "../test-support/listofdates-fixtures.mjs";

test("List of Dates fixture helper prepares a minimal extracted matter", async () => {
  const root = await prepareExtractedMatter();

  await stat(path.join(root, "matter.json"));
  await stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"));

  const fileId = await fileIdForOriginalName(root, "facts.txt");
  assert.equal(fileId, "FILE-0001");

  const record = await readExtractionRecord(root, fileId);
  assert.equal(record.file_id, "FILE-0001");
  assert.match(record.source_path, /facts\.txt$/);
  assert.ok(record.pages.some((page) => page.blocks.some((block) => /Agreement was signed/.test(block.text))));
});

test("List of Dates fixture helper writes source indexes and lawyer defaults", async () => {
  const root = await prepareExtractedMatter();
  const record = await readExtractionRecord(root);

  await writeSourceIndex(root, [
    {
      file_id: record.file_id,
      sha256: record.sha256,
      source_path: record.source_path,
      display_label: "Agreement note",
      short_label: "Agreement",
    },
  ]);

  const sourceIndex = JSON.parse(await readFile(path.join(root, "10_Library", "Source Index.json"), "utf8"));
  assert.equal(sourceIndex.schema_version, "source-index/v1");
  assert.equal(sourceIndex.sources[0].display_label, "Agreement note");

  const csvRows = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), "utf8"));
  assert.equal(csvRows.length, 1);

  assert.deepEqual(lawyerFields({ event_type: "agreement", issue_tags: ["agreement"] }), {
    event_type: "agreement",
    legal_relevance: "Supports the client's chronology because the cited source records the event.",
    issue_tags: ["agreement"],
    perspective: "client_favourable",
  });
});

test("List of Dates fixture helper builds source rows and model payload rows", async () => {
  const root = await prepareExtractedMatter();
  const record = await readExtractionRecord(root);

  assert.deepEqual(sourceIndexSource(record, {
    display_label: "Agreement note",
    short_label: "Agreement",
    document_type: "agreement",
  }), {
    file_id: "FILE-0001",
    sha256: record.sha256,
    source_path: record.source_path,
    display_label: "Agreement note",
    short_label: "Agreement",
    document_type: "agreement",
  });

  assert.deepEqual(listOfDatesEntry({
    citation: "FILE-0001 p1.b2",
    event_type: "notice",
    issue_tags: ["notice"],
  }), {
    date_iso: "2026-04-20",
    date_text: "20 April 2026",
    event: "Agreement was signed by Mehta and Skyline.",
    citation: "FILE-0001 p1.b2",
    needs_review: false,
    confidence: 0.94,
    event_type: "notice",
    legal_relevance: "Supports the client's contract chronology because the cited block records the agreement date.",
    issue_tags: ["notice"],
    perspective: "client_favourable",
  });

  assert.deepEqual(listOfDatesCandidate({
    citation: "FILE-0001 p1.b2",
    candidate_type: "notice",
    confidence: 0.9,
  }), {
    date_iso: "2026-04-20",
    date_text: "20 April 2026",
    event_candidate: "Agreement was signed by Mehta and Skyline.",
    legal_materiality: "Potential foundation date for the client's contract chronology.",
    citation: "FILE-0001 p1.b2",
    source_excerpt: "Agreement was signed on 20 April 2026 by Mehta and Skyline.",
    candidate_type: "notice",
    party_posture: "helps_client",
    same_fact_hint: "",
    date_uncertainty: "",
    ocr_suspicion: "",
    needs_review: false,
    confidence: 0.9,
  });
});
