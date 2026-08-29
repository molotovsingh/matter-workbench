import { parseCsv, toCsv } from "../shared/csv.mjs";
import { EXTRACTION_LOG_HEADERS } from "../shared/matter-contract.mjs";
import { createFilesystemMatterRecordStore } from "./matter-record-store/filesystem-matter-record-store.mjs";

// Imports V4 fast-extraction results into a matter's legacy extract-stage
// output, so the ordinary preparation pipeline treats the pages as already
// extracted and skips its own slow OCR. This module is the LEGACY side of the
// V4 bridge: it knows matter folders, File Registers, and extraction-record/v1
// — and deliberately imports nothing from services/document-intake-extraction
// (V4-ISO-001). Plain JSON data crosses the seam in server.mjs.
//
// Storage access goes through a matter record store, so the same rules apply
// whichever arrangement holds the matter. Everything below is expressed in
// matter-relative paths; the store owns what those mean. See
// specs/001-v4-record-parity/contracts/matter-record-store.md.
//
// Design rules (from the extract-stage contract):
// - Never allocate FILE-NNNN ids: V4 documents are matched to EXISTING File
//   Register rows by sha256. Files the user never registered through the
//   normal Add Files flow are skipped, not invented.
// - Records must satisfy the extract engine's cache-reuse gates
//   (extraction_strategy "ocr-first", a non-pdfjs engine, every ocr_required
//   page carrying non-empty blocks with confidence >= 0.75, needs_review
//   false) or a later /extract would silently re-extract and overwrite.
// - Documents with any review_required page — or any accepted page with no
//   text at all — are left for legacy extraction on purpose. Legacy's own
//   convention marks blank pages needs_review and re-tries them on the next
//   run; importing a record with a blank page would poison that behavior, and
//   fabricating placeholder text into a legal record is not an option.
// - An existing valid record for the same bytes is never overwritten: legacy
//   output wins ties so citations stay stable.
// - The intake's Extraction Log.csv is MERGED by file_id, never clobbered.

export const V4_IMPORT_ENGINE = "mwb-v4-document-intake-extraction/1.0.0";

export function createV4ExtractionImportService({
  mattersHome,
  store,
  engine = V4_IMPORT_ENGINE,
  clock = () => new Date(),
  log = () => {},
} = {}) {
  const recordStore = store || (String(mattersHome || "").trim()
    ? createFilesystemMatterRecordStore({ mattersHome })
    : null);
  if (!recordStore) throw new Error("V4 extraction import requires mattersHome or a matter record store");

  return {
    /**
     * documents: the V4 extraction result's documents array (plain JSON):
     * [{ sha256|sourceSha256, originalName, pages: [{ pageNumber, text,
     *    outcome, provenance?: { provider, model } }] }]
     */
    async importExtractionResult({ matterFolderName, matterIdSlug, intakeId, resultId, documents } = {}) {
      const matter = await recordStore.resolveMatter({ folderName: matterFolderName, slug: matterIdSlug });
      if (!matter) {
        const error = new Error(`no matter folder matches "${matterFolderName || matterIdSlug}" under the matters home`);
        error.code = "v4_import.matter_not_found";
        error.retryable = false;
        throw error;
      }
      const registers = await loadRegisters(recordStore, matter);
      const summary = {
        matterRoot: matter,
        imported: [],
        skippedNoRegisterMatch: [],
        leftForLegacyExtraction: [],
        skippedExistingRecord: [],
      };
      for (const document of Array.isArray(documents) ? documents : []) {
        const sha256 = String(document?.sourceSha256 || document?.sha256 || "").toLowerCase();
        const name = String(document?.originalName || sha256.slice(0, 12));
        const match = registers.bySha.get(sha256);
        if (!match) {
          summary.skippedNoRegisterMatch.push(name);
          continue;
        }
        const pages = Array.isArray(document?.pages) ? document.pages : [];
        const fullyReadable = pages.length > 0
          && pages.every((page) => page?.outcome === "accepted" && String(page?.text || "").trim());
        if (!fullyReadable) {
          summary.leftForLegacyExtraction.push(match.row.file_id);
          continue;
        }
        const recordPath = `${match.intakeDir}/_extracted/${match.row.file_id}.json`;
        if (await hasValidExistingRecord(recordStore, matter, recordPath, sha256)) {
          summary.skippedExistingRecord.push(match.row.file_id);
          continue;
        }
        const record = buildExtractionRecord({ row: match.row, sha256, pages, engine, now: clock() });
        await recordStore.writeText(matter, recordPath, `${JSON.stringify(record, null, 2)}\n`, {
          role: "matter_artifact",
          mimeType: "application/json",
        });
        await recordStore.writeText(matter, `${match.intakeDir}/_extracted/${match.row.file_id}.txt`, flatText(record), {
          role: "matter_artifact",
          mimeType: "text/plain",
        });
        await mergeExtractionLog({
          store: recordStore,
          matter,
          intakeDir: match.intakeDir,
          logRow: buildLogRow({ row: match.row, record, pages, intakeId, resultId }),
        });
        summary.imported.push(match.row.file_id);
      }
      log(`V4 import into ${describeMatter(matter)}: ${summary.imported.length} record(s) written`
        + (summary.skippedNoRegisterMatch.length ? `, ${summary.skippedNoRegisterMatch.length} not in register` : "")
        + (summary.leftForLegacyExtraction.length ? `, ${summary.leftForLegacyExtraction.length} left for legacy extraction` : "")
        + (summary.skippedExistingRecord.length ? `, ${summary.skippedExistingRecord.length} already extracted` : ""));
      return summary;
    },
  };
}

// A handle is opaque to this service. Only the log line needs a human label,
// and it must not assume the handle is a path.
function describeMatter(matter) {
  const text = typeof matter === "string" ? matter : String(matter?.name || matter?.folderName || "matter");
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
}

async function loadRegisters(store, matter) {
  const manifest = await store.readText(matter, "matter.json");
  const parsed = manifest ? JSON.parse(manifest) : {};
  const bySha = new Map();
  for (const intake of Array.isArray(parsed.intakes) ? parsed.intakes : []) {
    const intakeDir = String(intake.intake_dir || "").replaceAll("\\", "/").replace(/\/+$/, "");
    if (!intakeDir) continue;
    let rows = [];
    try {
      const csv = await store.readText(matter, `${intakeDir}/File Register.csv`);
      if (!csv) continue;
      rows = parseCsv(csv);
    } catch {
      continue;
    }
    for (const row of rows) {
      const sha = String(row.sha256 || "").toLowerCase();
      // Duplicate rows never extract on the legacy path either; first
      // registration of the bytes owns the record.
      if (!sha || !row.file_id || String(row.status || "").includes("duplicate")) continue;
      if (!bySha.has(sha)) bySha.set(sha, { row, intakeDir });
    }
  }
  return { bySha };
}

async function hasValidExistingRecord(store, matter, recordPath, sha256) {
  try {
    const raw = await store.readText(matter, recordPath);
    if (!raw) return false;
    const existing = JSON.parse(raw);
    return existing?.schema_version === "extraction-record/v1" && String(existing?.sha256 || "").toLowerCase() === sha256;
  } catch {
    return false;
  }
}

function buildExtractionRecord({ row, sha256, pages, engine, now }) {
  const providers = [...new Set(pages.map((page) => providerLabel(page)).filter(Boolean))];
  return {
    schema_version: "extraction-record/v1",
    file_id: row.file_id,
    sha256,
    source_path: row.working_copy_path || row.source_path || "",
    engine,
    extracted_at: now.toISOString(),
    language_detected: [],
    page_count: pages.length,
    extraction_strategy: "ocr-first",
    ocr_pipeline: { mode: "v4-provider-ladder", providers },
    // Every page here is accepted with non-empty text (blank or flagged pages
    // keep the whole document on the legacy path), so the record passes the
    // extract engine's weak-OCR scorer: no empty pages, no missing confidence.
    pages: pages.map((page) => ({
      page: page.pageNumber,
      ocr_required: true,
      confidence_avg: 0.99,
      needs_review: false,
      blocks: textToBlocks(page.pageNumber, page.text),
    })),
    warnings: [
      "imported from the V4 intake pipeline: page confidence is synthesized (validator outcome: accepted)",
    ],
  };
}

function textToBlocks(pageNumber, text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => ({ id: `p${pageNumber}.b${index + 1}`, type: "paragraph", text: part }));
}

function flatText(record) {
  return record.pages
    .map((page) => page.blocks.map((block) => block.text).join("\n\n"))
    .filter(Boolean)
    .join("\n\n");
}

function providerLabel(page) {
  const provider = String(page?.provenance?.provider || "").trim();
  const model = String(page?.provenance?.model || "").trim();
  return provider && model ? `${provider}/${model}` : provider || model;
}

function buildLogRow({ row, record, pages, intakeId, resultId }) {
  const providers = [...new Set(pages.map((page) => providerLabel(page)).filter(Boolean))];
  const primary = providers[0] || "";
  const repairs = providers.slice(1).join(" ");
  return {
    file_id: row.file_id,
    intake_id: row.intake_id || "",
    source_path: record.source_path,
    sha256: record.sha256,
    status: "extracted",
    engine: record.engine,
    page_count: record.page_count,
    ocr_applied: "yes",
    ocr_provider_model: primary,
    ocr_primary_model: primary,
    ocr_repair_model: repairs,
    ocr_repair_status: repairs ? "applied" : "not-needed",
    ocr_repair_reason: "",
    ocr_required_pages: record.pages.filter((page) => page.ocr_required).length,
    low_confidence_pages: 0,
    needs_review_pages: 0,
    confidence_status: "ok",
    provider_warnings_count: 0,
    multi_column_pages: "",
    time_taken_ms: "",
    extracted_at: record.extracted_at,
    notes: `imported from V4 intake ${intakeId || ""} result ${resultId || ""}`.trim(),
  };
}

async function mergeExtractionLog({ store, matter, intakeDir, logRow }) {
  const logPath = `${intakeDir}/Extraction Log.csv`;
  let rows = [];
  try {
    const existing = await store.readText(matter, logPath);
    rows = existing ? parseCsv(existing) : [];
  } catch {
    rows = [];
  }
  const merged = rows.filter((row) => row.file_id !== logRow.file_id);
  merged.push(logRow);
  merged.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id)));
  await store.writeText(matter, logPath, toCsv(merged, EXTRACTION_LOG_HEADERS), {
    role: "matter_artifact",
    mimeType: "text/csv",
  });
}
