import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canUseCachedPdfOcrExtraction } from "../extract-utils/ocr-policy.mjs";
import { createV4ExtractionImportService } from "../services/v4-extraction-import-service.mjs";
import { toCsv } from "../shared/csv.mjs";
import { EXTRACTION_LOG_HEADERS, FILE_REGISTER_HEADERS } from "../shared/matter-contract.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);

async function buildMatterFixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-import-"));
  const matterRoot = path.join(home, "Iyer v State");
  const intakeDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
  await mkdir(intakeDir, { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({
    matter_name: "Iyer v State",
    intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
  }, null, 2));
  const registerRows = [
    { file_id: "FILE-0001", intake_id: "INTAKE-01", source_path: "in/order.pdf", working_copy_path: "00_Inbox/Intake 01 - Initial/FILE-0001 order.pdf", sha256: SHA_A, status: "copied" },
    // Duplicate-content row: legacy extraction skips these, so the bridge
    // must bind the sha to the first registration, not this one.
    { file_id: "FILE-0002", intake_id: "INTAKE-01", source_path: "in/order copy.pdf", working_copy_path: "00_Inbox/Intake 01 - Initial/FILE-0002 order copy.pdf", sha256: SHA_A, status: "exact-duplicate", duplicate_of: "FILE-0001" },
    { file_id: "FILE-0003", intake_id: "INTAKE-01", source_path: "in/notice.pdf", working_copy_path: "00_Inbox/Intake 01 - Initial/FILE-0003 notice.pdf", sha256: SHA_B, status: "copied" },
    { file_id: "FILE-0004", intake_id: "INTAKE-01", source_path: "in/annex.pdf", working_copy_path: "00_Inbox/Intake 01 - Initial/FILE-0004 annex.pdf", sha256: SHA_D, status: "copied" },
  ];
  await writeFile(path.join(intakeDir, "File Register.csv"), toCsv(registerRows, FILE_REGISTER_HEADERS));
  // A pre-existing log row from a legacy run that the merge must preserve.
  await writeFile(path.join(intakeDir, "Extraction Log.csv"), toCsv([
    { file_id: "FILE-0009", intake_id: "INTAKE-01", status: "extracted", engine: "docx-mammoth", extracted_at: "2026-08-01T00:00:00.000Z" },
  ], EXTRACTION_LOG_HEADERS));
  return { home, matterRoot, intakeDir };
}

function resultDocuments() {
  const provenance = { provider: "gemini", model: "gemini-3.7-flash" };
  return [
    {
      sourceSha256: SHA_A,
      originalName: "order.pdf",
      pages: [
        { pageNumber: 1, outcome: "accepted", text: "IN THE COURT OF THE LEARNED DISTRICT JUDGE\n\nORDER: The application dated 12.03.2024 is allowed and interim relief is granted.", provenance },
        { pageNumber: 2, outcome: "accepted", text: "Heard both parties at length. Counsel for the respondent sought time to file a reply within four weeks of today.", provenance },
        { pageNumber: 3, outcome: "accepted", text: "List the matter on 09.05.2024 for further consideration. So ordered.", provenance: { provider: "openai", model: "gpt-5.4" } },
      ],
    },
    // One review page: the whole document is left for legacy extraction.
    {
      sourceSha256: SHA_B,
      originalName: "notice.pdf",
      pages: [
        { pageNumber: 1, outcome: "review_required", text: "", provenance },
      ],
    },
    // Accepted-but-blank page: also left for legacy, whose own convention is
    // to mark blank pages needs_review and retry them on the next run.
    {
      sourceSha256: SHA_D,
      originalName: "annex.pdf",
      pages: [
        { pageNumber: 1, outcome: "accepted", text: "Annexure A", provenance },
        { pageNumber: 2, outcome: "accepted", text: "   ", provenance },
      ],
    },
    // Never registered through Add Files: skipped, never invented.
    {
      sourceSha256: SHA_C,
      originalName: "stray.pdf",
      pages: [{ pageNumber: 1, outcome: "accepted", text: "stray", provenance }],
    },
  ];
}

test("V4 import writes cache-valid extraction records only for registered, fully accepted documents", async () => {
  const { home, intakeDir } = await buildMatterFixture();
  try {
    const service = createV4ExtractionImportService({
      mattersHome: home,
      clock: () => new Date("2026-08-27T10:00:00.000Z"),
    });
    const summary = await service.importExtractionResult({
      matterFolderName: "Iyer v State",
      matterIdSlug: "Iyer-v-State",
      intakeId: "intake-x",
      resultId: "result-x",
      documents: resultDocuments(),
    });
    assert.deepEqual(summary.imported, ["FILE-0001"]);
    assert.deepEqual(summary.leftForLegacyExtraction, ["FILE-0003", "FILE-0004"]);
    assert.deepEqual(summary.skippedNoRegisterMatch, ["stray.pdf"]);

    const record = JSON.parse(await readFile(path.join(intakeDir, "_extracted", "FILE-0001.json"), "utf8"));
    assert.equal(record.schema_version, "extraction-record/v1");
    assert.equal(record.file_id, "FILE-0001");
    assert.equal(record.sha256, SHA_A);
    assert.equal(record.source_path, "00_Inbox/Intake 01 - Initial/FILE-0001 order.pdf");
    assert.equal(record.page_count, 3);
    assert.deepEqual(record.pages[0].blocks.map((block) => block.id), ["p1.b1", "p1.b2"]);
    assert.match(record.pages[0].blocks[1].text, /^ORDER: The application dated/);
    assert.equal(record.pages[1].blocks[0].id, "p2.b1");
    assert.ok(record.pages.every((page) => page.ocr_required === true && page.confidence_avg >= 0.75));
    // The record must satisfy the REAL extract-engine cache gate, or a later
    // /extract silently re-runs OCR and overwrites the imported text.
    assert.equal(canUseCachedPdfOcrExtraction(record, {
      ocrProviderAvailable: true,
      pdfEngineFingerprint: "pdfjs-dist@4.10.38",
    }), true);

    const flat = await readFile(path.join(intakeDir, "_extracted", "FILE-0001.txt"), "utf8");
    assert.match(flat, /IN THE COURT OF THE LEARNED DISTRICT JUDGE\n\nORDER: The application dated[\s\S]*Heard both parties[\s\S]*So ordered\./);

    const log = await readFile(path.join(intakeDir, "Extraction Log.csv"), "utf8");
    assert.match(log, /FILE-0009/, "legacy log rows survive the merge");
    assert.match(log, /FILE-0001,INTAKE-01,.*,extracted,mwb-v4-document-intake-extraction/);
    assert.match(log, /gemini\/gemini-3\.7-flash/);
    assert.match(log, /openai\/gpt-5\.4/, "repair rung appears in observability");

    // Idempotent replay: the existing record wins, nothing is rewritten.
    const replay = await service.importExtractionResult({
      matterFolderName: "Iyer v State",
      matterIdSlug: "Iyer-v-State",
      documents: resultDocuments(),
    });
    assert.deepEqual(replay.imported, []);
    assert.deepEqual(replay.skippedExistingRecord, ["FILE-0001"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("V4 import resolves matters by slug fallback and dead-letters unknown matters", async () => {
  const { home, intakeDir } = await buildMatterFixture();
  try {
    const service = createV4ExtractionImportService({ mattersHome: home });
    // Folder name lost (e.g. non-ASCII trimmed out of the header): the slug
    // of "Iyer v State" still finds the folder.
    const summary = await service.importExtractionResult({
      matterFolderName: "",
      matterIdSlug: "Iyer-v-State",
      documents: [resultDocuments()[0]],
    });
    assert.deepEqual(summary.imported, ["FILE-0001"]);
    assert.ok(summary.matterRoot.endsWith("Iyer v State"));
    assert.match(await readFile(path.join(intakeDir, "_extracted", "FILE-0001.json"), "utf8"), /extraction-record\/v1/);

    await assert.rejects(
      () => service.importExtractionResult({ matterFolderName: "No Such Matter", matterIdSlug: "No-Such-Matter", documents: [] }),
      (error) => error.code === "v4_import.matter_not_found" && error.retryable === false,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
