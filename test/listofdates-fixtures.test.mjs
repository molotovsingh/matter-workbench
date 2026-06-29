import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseCsv } from "../shared/csv.mjs";
import {
  bankDiscrepancyPaymentEntry,
  bankPaymentEntry,
  bookingPaymentEntry,
  fileIdForOriginalName,
  invalidCitationListOfDatesCandidate,
  invalidCitationListOfDatesEntry,
  interviewDeadlineEntry,
  lawyerFields,
  listOfDatesCandidate,
  listOfDatesEntry,
  maintenanceDepositEntry,
  meritsReplyEntry,
  nonMeritsEmailExportEntry,
  nonMeritsTranscriptEntry,
  nonMeritsVakalatnamaEntry,
  noticeListOfDatesCandidate,
  noticeListOfDatesEntry,
  possessionDeadlineEntry,
  prepareExtractedMatter,
  readExtractionRecord,
  receiptDiscrepancyPaymentEntry,
  receiptPaymentEntry,
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
    perspective: "record_neutral",
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
    perspective: "record_neutral",
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
    perspective: "record_neutral",
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
    perspective: "record_neutral",
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

test("List of Dates fixture helper builds payment and deadline scenario rows", () => {
  assert.deepEqual(bankPaymentEntry({ citation: "FILE-0007 p1.b1" }), {
    date_iso: "2023-04-30",
    date_text: "30 April 2023",
    event: "Mehta paid Rs.10,00,000 to Skyline.",
    citation: "FILE-0007 p1.b1",
    needs_review: false,
    confidence: 0.94,
    event_type: "payment",
    legal_relevance: "Supports the client's payment chronology because the bank statement records Rs.10,00,000.",
    issue_tags: ["payment"],
    perspective: "record_neutral",
  });

  assert.deepEqual(receiptPaymentEntry({ citation: "FILE-0008 p1.b1" }), {
    date_iso: "2023-04-30",
    date_text: "30 April 2023",
    event: "Receipt acknowledged Rs.10,00,000 from Mehta.",
    citation: "FILE-0008 p1.b1",
    needs_review: false,
    confidence: 0.91,
    event_type: "payment",
    legal_relevance: "Corroborates the client's payment chronology because the receipt records Rs.10,00,000.",
    issue_tags: ["payment", "receipt"],
    perspective: "record_neutral",
  });

  assert.deepEqual(bankDiscrepancyPaymentEntry({ citation: "FILE-0007 p1.b2" }), {
    date_iso: "2023-09-12",
    date_text: "12 September 2023",
    event: "Mehta paid Rs.15,70,000 to Skyline.",
    citation: "FILE-0007 p1.b2",
    needs_review: false,
    confidence: 0.94,
    event_type: "payment",
    legal_relevance: "Supports the client's payment discrepancy issue because the bank statement records Rs.15,70,000.",
    issue_tags: ["payment", "contradiction"],
    perspective: "record_neutral",
  });

  assert.deepEqual(receiptDiscrepancyPaymentEntry({ citation: "FILE-0008 p1.b2" }), {
    date_iso: "2023-09-12",
    date_text: "12 September 2023",
    event: "Receipt acknowledged Rs.12,25,000 from Mehta.",
    citation: "FILE-0008 p1.b2",
    needs_review: false,
    confidence: 0.91,
    event_type: "payment",
    legal_relevance: "Supports the client's payment discrepancy issue because the receipt records Rs.12,25,000, with a discrepancy of Rs.3,45,000.",
    issue_tags: ["payment", "contradiction"],
    perspective: "record_neutral",
  });

  assert.deepEqual(possessionDeadlineEntry({ citation: "FILE-0009 p1.b1" }), {
    date_iso: "2024-09-30",
    date_text: "30 September 2024",
    event: "Possession deadline was 30 September 2024.",
    citation: "FILE-0009 p1.b1",
    needs_review: false,
    confidence: 0.9,
    event_type: "deadline",
    legal_relevance: "Supports the client's possession delay issue because the agreement records the possession deadline.",
    issue_tags: ["possession", "deadline"],
    perspective: "record_neutral",
  });

  assert.deepEqual(interviewDeadlineEntry({ citation: "FILE-0010 p1.b1" }), {
    date_iso: "2024-09-30",
    date_text: "30 September 2024",
    event: "Client interview confirms possession deadline was 30 September 2024.",
    citation: "FILE-0010 p1.b1",
    needs_review: false,
    confidence: 0.86,
    event_type: "deadline",
    legal_relevance: "Corroborates the client's possession delay issue because the interview records the same possession deadline.",
    issue_tags: ["possession", "deadline"],
    perspective: "record_neutral",
  });
});

test("List of Dates fixture helper builds separate-payment and non-merits scenario rows", () => {
  assert.deepEqual(bookingPaymentEntry({ citation: "FILE-0011 p1.b1" }), {
    date_iso: "2023-04-30",
    date_text: "30 April 2023",
    event: "Mehta paid Rs.10,00,000 as booking amount to Skyline.",
    citation: "FILE-0011 p1.b1",
    needs_review: false,
    confidence: 0.94,
    event_type: "payment",
    legal_relevance: "Supports the client's payment chronology because the source records a Rs.10,00,000 booking amount.",
    issue_tags: ["payment"],
    perspective: "record_neutral",
  });

  assert.deepEqual(maintenanceDepositEntry({ citation: "FILE-0012 p1.b1" }), {
    date_iso: "2023-04-30",
    date_text: "30 April 2023",
    event: "Mehta paid Rs.2,50,000 as maintenance deposit to Skyline.",
    citation: "FILE-0012 p1.b1",
    needs_review: false,
    confidence: 0.91,
    event_type: "payment",
    legal_relevance: "Supports the client's payment chronology because the source records a Rs.2,50,000 maintenance deposit.",
    issue_tags: ["payment"],
    perspective: "record_neutral",
  });

  assert.equal(nonMeritsTranscriptEntry().citation, "FILE-0001 p1.b1");
  assert.equal(nonMeritsTranscriptEntry().event, "Client interview transcript recorded.");
  assert.equal(nonMeritsEmailExportEntry().citation, "FILE-0001 p1.b2");
  assert.equal(nonMeritsVakalatnamaEntry().event_type, "filing");
  assert.equal(meritsReplyEntry().date_iso, "2024-03-14");
  assert.match(meritsReplyEntry().legal_relevance, /willingness to resolve/);
});
