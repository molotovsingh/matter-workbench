import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseCsv } from "../shared/csv.mjs";
import {
  fileIdForOriginalName,
  invalidCitationListOfDatesCandidate,
  invalidCitationListOfDatesEntry,
  lawyerFields,
  listOfDatesCandidate,
  listOfDatesEntry,
  noticeListOfDatesCandidate,
  noticeListOfDatesEntry,
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

test("List of Dates fixture helper builds named notice and invalid citation payloads", () => {
  assert.deepEqual(noticeListOfDatesEntry(), {
    date_iso: "2026-05-01",
    date_text: "01 May 2026",
    event: "Notice was issued after the inspection.",
    citation: "FILE-0001 p1.b2",
    needs_review: false,
    confidence: 0.89,
    event_type: "notice",
    legal_relevance: "Supports the client's notice timeline because the cited block records that notice followed inspection.",
    issue_tags: ["notice", "inspection"],
    perspective: "client_favourable",
  });

  assert.deepEqual(invalidCitationListOfDatesEntry(), {
    date_iso: "2026-06-01",
    date_text: "01 June 2026",
    event: "This candidate has no supplied source citation.",
    citation: "FILE-9999 p1.b1",
    needs_review: true,
    confidence: 0.2,
    event_type: "other",
    legal_relevance: "Should be rejected because the citation is not supplied.",
    issue_tags: ["evidence_gap"],
    perspective: "client_favourable",
  });

  assert.deepEqual(noticeListOfDatesCandidate({ confidence: 0.9 }), {
    date_iso: "2026-05-01",
    date_text: "01 May 2026",
    event_candidate: "Notice was issued after the inspection.",
    legal_materiality: "Potential notice date for the client's chronology.",
    citation: "FILE-0001 p1.b2",
    source_excerpt: "Notice was issued on 01 May 2026 after the inspection.",
    candidate_type: "notice",
    party_posture: "helps_client",
    same_fact_hint: "",
    date_uncertainty: "",
    ocr_suspicion: "",
    needs_review: false,
    confidence: 0.9,
  });

  assert.deepEqual(invalidCitationListOfDatesCandidate(), {
    date_iso: "2026-06-01",
    date_text: "01 June 2026",
    event_candidate: "Invalid candidate should be dropped.",
    legal_materiality: "Invalid citation.",
    citation: "FILE-9999 p1.b1",
    source_excerpt: "Invalid.",
    candidate_type: "other",
    party_posture: "unclear",
    same_fact_hint: "",
    date_uncertainty: "",
    ocr_suspicion: "",
    needs_review: true,
    confidence: 0.1,
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
