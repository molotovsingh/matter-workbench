import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canUseCachedExtraction } from "../extract-engine.mjs";
import { createFilesystemMatterRecordStore } from "../services/matter-record-store/filesystem-matter-record-store.mjs";
import { createRuntimeDbMatterRecordStore } from "../services/matter-record-store/runtime-db-matter-record-store.mjs";
import { runtimeObjectKeyCandidates, runtimeObjectKeyForMatterPath } from "../services/runtime-db-object-key-policy.mjs";
import { createV4ExtractionImportService } from "../services/v4-extraction-import-service.mjs";
import { toCsv } from "../shared/csv.mjs";
import { EXTRACTION_LOG_HEADERS, FILE_REGISTER_HEADERS } from "../shared/matter-contract.mjs";

// Parity between storage arrangements.
//
// Every scenario runs through BOTH adapters and the two results are compared to
// each other, rather than each being checked against a hand-written expectation.
// That is deliberate: a scenario cannot exist for one arrangement and be quietly
// absent for the other, and adding a case here automatically covers both.
// Obligations P1-P5 in specs/001-v4-record-parity/contracts/matter-record-store.md.
//
// One test at the bottom breaks this pattern on purpose. See its comment.

const MATTER = "Iyer v State";
const INTAKE_DIR = "00_Inbox/Intake 01";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const FIXED_CLOCK = () => new Date("2026-08-29T00:00:00.000Z");

function registerRows() {
  return [
    { file_id: "FILE-0001", intake_id: "INTAKE-01", source_path: "in/order.pdf", working_copy_path: `${INTAKE_DIR}/FILE-0001 order.pdf`, sha256: SHA_A, status: "copied" },
    // Duplicate-content registration: the first row owns the bytes.
    { file_id: "FILE-0002", intake_id: "INTAKE-01", source_path: "in/order copy.pdf", working_copy_path: `${INTAKE_DIR}/FILE-0002 order copy.pdf`, sha256: SHA_A, status: "exact-duplicate", duplicate_of: "FILE-0001" },
    { file_id: "FILE-0003", intake_id: "INTAKE-01", source_path: "in/notice.pdf", working_copy_path: `${INTAKE_DIR}/FILE-0003 notice.pdf`, sha256: SHA_B, status: "copied" },
  ];
}

function page(number, text, outcome = "accepted") {
  return { pageNumber: number, outcome, text, provenance: { provider: "gemini", model: "gemini-3.7-flash" } };
}

// --- adapters -------------------------------------------------------------

async function filesystemFixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), "mwb-parity-fs-"));
  const root = path.join(home, MATTER);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "matter.json"), JSON.stringify({
    matter_name: MATTER,
    intakes: [{ intake_id: "INTAKE-01", intake_dir: INTAKE_DIR }],
  }, null, 2));
  const store = createFilesystemMatterRecordStore({ mattersHome: home });
  return {
    name: "filesystem",
    store,
    async snapshot() {
      const out = new Map();
      async function walk(dir, prefix) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const next = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(next, rel);
          else out.set(rel, await readFile(next, "utf8"));
        }
      }
      await walk(root, "");
      return out;
    },
    async cleanup() { await rm(home, { recursive: true, force: true }); },
  };
}

async function runtimeDbFixture() {
  const rows = new Map();
  const storage = {
    async readMatterText(matter, relativePath) {
      for (const key of runtimeObjectKeyCandidates({ matter, relativePath })) {
        if (rows.has(key)) return rows.get(key);
      }
      return null;
    },
    async persistTextArtifacts(matter, files = []) {
      assert.equal(files.length, 1, "the adapter must write one file per call (research R4)");
      for (const file of files) {
        rows.set(runtimeObjectKeyForMatterPath({ matter, relativePath: file.relativePath }), String(file.text ?? ""));
      }
      return files;
    },
  };
  const matter = { id: "matter-id-1", name: MATTER, folderName: MATTER, matterName: MATTER };
  const matterIndex = { async findMatterFolder(name) { return String(name) === MATTER ? matter : null; } };
  rows.set(runtimeObjectKeyForMatterPath({ matter, relativePath: "matter.json" }), JSON.stringify({
    matter_name: MATTER,
    intakes: [{ intake_id: "INTAKE-01", intake_dir: INTAKE_DIR }],
  }, null, 2));
  return {
    name: "runtime-db",
    store: createRuntimeDbMatterRecordStore({ storage, matterIndex }),
    async snapshot() {
      const prefix = `${runtimeObjectKeyForMatterPath({ matter, relativePath: "x" })}`.replace(/x$/, "");
      return new Map([...rows].map(([key, text]) => [key.startsWith(prefix) ? key.slice(prefix.length) : key, text]));
    },
    async cleanup() { rows.clear(); },
  };
}

const FIXTURES = [filesystemFixture, runtimeDbFixture];

/** Run one scenario through every arrangement and return their results. */
async function runEverywhere(seed, invoke) {
  const results = [];
  for (const makeFixture of FIXTURES) {
    const fixture = await makeFixture();
    try {
      const handle = await fixture.store.resolveMatter({ folderName: MATTER });
      await seed(fixture.store, handle);
      const service = createV4ExtractionImportService({ store: fixture.store, clock: FIXED_CLOCK });
      let summary = null;
      let failure = null;
      try {
        summary = await invoke(service);
      } catch (error) {
        failure = { code: error?.code ?? null };
      }
      // matterRoot is the opaque handle and is inherently adapter-shaped, so it
      // is excluded from comparison. Everything else must match exactly.
      if (summary) delete summary.matterRoot;
      results.push({ name: fixture.name, summary, failure, files: await fixture.snapshot() });
    } finally {
      await fixture.cleanup();
    }
  }
  return results;
}

function assertParity(results, label) {
  const [first, ...rest] = results;
  for (const other of rest) {
    assert.deepEqual(other.summary, first.summary, `${label}: outcomes differ (${first.name} vs ${other.name})`);
    assert.deepEqual(other.failure, first.failure, `${label}: failure differs (${first.name} vs ${other.name})`);
    assert.deepEqual(
      [...other.files.keys()].sort(),
      [...first.files.keys()].sort(),
      `${label}: written paths differ (${first.name} vs ${other.name})`,
    );
    for (const [relativePath, content] of first.files) {
      assert.equal(other.files.get(relativePath), content, `${label}: content differs at ${relativePath}`);
    }
  }
  return first;
}

const seedRegister = (extra = []) => async (store, handle) => {
  await store.writeText(handle, `${INTAKE_DIR}/File Register.csv`, toCsv(registerRows(), FILE_REGISTER_HEADERS));
  for (const [relativePath, text] of extra) await store.writeText(handle, relativePath, text);
};

const fileDocuments = (documents) => (service) => service.importExtractionResult({
  matterFolderName: MATTER,
  intakeId: "INTAKE-V4",
  resultId: "RESULT-1",
  documents,
});

// --- scenarios ------------------------------------------------------------

test("parity: a fully readable registered document is filed identically", async () => {
  const results = await runEverywhere(seedRegister(), fileDocuments([
    { sha256: SHA_A, originalName: "order.pdf", pages: [page(1, "IN THE COURT\n\nORDER: allowed."), page(2, "Heard both parties.")] },
  ]));
  const first = assertParity(results, "filed document");
  assert.deepEqual(first.summary.imported, ["FILE-0001"]);
});

test("parity: unregistered content is skipped, never invented into the record", async () => {
  const results = await runEverywhere(seedRegister(), fileDocuments([
    { sha256: "c".repeat(64), originalName: "stray.pdf", pages: [page(1, "Not in this matter.")] },
  ]));
  const first = assertParity(results, "unregistered");
  assert.deepEqual(first.summary.skippedNoRegisterMatch, ["stray.pdf"]);
  assert.deepEqual(first.summary.imported, []);
});

test("parity: duplicate registrations bind to the first row only", async () => {
  const results = await runEverywhere(seedRegister(), fileDocuments([
    { sha256: SHA_A, originalName: "order.pdf", pages: [page(1, "ORDER: allowed.")] },
  ]));
  const first = assertParity(results, "duplicate registration");
  assert.deepEqual(first.summary.imported, ["FILE-0001"], "the duplicate row must not also be filed");
});

test("parity: a document with one unreadable page is left for legacy extraction", async () => {
  const results = await runEverywhere(seedRegister(), fileDocuments([
    { sha256: SHA_B, originalName: "notice.pdf", pages: [page(1, "Readable."), page(2, "", "review_required")] },
  ]));
  const first = assertParity(results, "partial document");
  assert.deepEqual(first.summary.leftForLegacyExtraction, ["FILE-0003"]);
  assert.deepEqual(first.summary.imported, [], "no partial record, and no substituted text");
});

test("parity: an existing valid record is never replaced", async () => {
  const existing = `${JSON.stringify({ schema_version: "extraction-record/v1", sha256: SHA_A, file_id: "FILE-0001", pages: [] }, null, 2)}\n`;
  const results = await runEverywhere(
    seedRegister([[`${INTAKE_DIR}/_extracted/FILE-0001.json`, existing]]),
    fileDocuments([{ sha256: SHA_A, originalName: "order.pdf", pages: [page(1, "Replacement text.")] }]),
  );
  const first = assertParity(results, "existing record");
  assert.deepEqual(first.summary.skippedExistingRecord, ["FILE-0001"]);
  assert.equal(first.files.get(`${INTAKE_DIR}/_extracted/FILE-0001.json`), existing, "the original record survives");
});

test("parity: the activity log is merged by file id, not clobbered", async () => {
  const legacyLog = toCsv([
    { file_id: "FILE-0009", intake_id: "INTAKE-01", status: "extracted", engine: "docx-mammoth", extracted_at: "2026-08-01T00:00:00.000Z" },
  ], EXTRACTION_LOG_HEADERS);
  const results = await runEverywhere(
    seedRegister([[`${INTAKE_DIR}/Extraction Log.csv`, legacyLog]]),
    fileDocuments([{ sha256: SHA_A, originalName: "order.pdf", pages: [page(1, "ORDER: allowed.")] }]),
  );
  const first = assertParity(results, "log merge");
  const log = first.files.get(`${INTAKE_DIR}/Extraction Log.csv`);
  assert.match(log, /FILE-0009/, "the unrelated legacy row survives");
  assert.match(log, /FILE-0001/, "the new row is present");
});

test("parity: identity is content, not filename", async () => {
  const results = await runEverywhere(seedRegister(), fileDocuments([
    { sha256: SHA_A, originalName: "completely-different-name.pdf", pages: [page(1, "ORDER: allowed.")] },
  ]));
  const first = assertParity(results, "filename mismatch");
  assert.deepEqual(first.summary.imported, ["FILE-0001"], "a different upload name must not prevent the match");
});

test("parity: an unresolvable matter declines to write under either arrangement", async () => {
  const results = await runEverywhere(seedRegister(), (service) => service.importExtractionResult({
    matterFolderName: "No Such Matter",
    matterIdSlug: "No-Such-Matter",
    documents: [{ sha256: SHA_A, originalName: "order.pdf", pages: [page(1, "text")] }],
  }));
  const first = assertParity(results, "unresolvable matter");
  assert.equal(first.failure?.code, "v4_import.matter_not_found", "must fail closed rather than choose a matter");
});

// --- the one assertion that is NOT a comparison ---------------------------
//
// Everything above proves the arrangements agree. Nothing above proves either
// is CORRECT: if a change made both adapters write records the extract engine
// refuses to reuse, every comparison would still pass, the suite would be green,
// and preparation would silently re-read every document this feature exists to
// skip. So this asserts the property absolutely, against the real gate.
// FR-008, SC-003. Do not rewrite it in the comparison style of its neighbours.
test("both arrangements produce records the extract engine will actually reuse", async () => {
  const results = await runEverywhere(seedRegister(), fileDocuments([
    { sha256: SHA_A, originalName: "order.pdf", pages: [page(1, "IN THE COURT\n\nORDER: allowed."), page(2, "Heard both parties.")] },
  ]));
  const row = registerRows()[0];
  for (const result of results) {
    const record = JSON.parse(result.files.get(`${INTAKE_DIR}/_extracted/FILE-0001.json`));
    assert.equal(
      canUseCachedExtraction(record, row, { fingerprint: "pdf-ocr-v1" }, { ocrProvider: () => {}, forceRefresh: false }),
      true,
      `${result.name}: preparation must reuse this record instead of silently re-reading the document`,
    );
  }
});
