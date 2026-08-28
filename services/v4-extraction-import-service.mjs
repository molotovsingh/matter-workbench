import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { parseCsv, toCsv } from "../shared/csv.mjs";
import { EXTRACTION_LOG_HEADERS } from "../shared/matter-contract.mjs";

// Imports V4 fast-extraction results into a matter's legacy extract-stage
// output, so the ordinary preparation pipeline treats the pages as already
// extracted and skips its own slow OCR. This module is the LEGACY side of the
// V4 bridge: it knows matter folders, File Registers, and extraction-record/v1
// — and deliberately imports nothing from services/document-intake-extraction
// (V4-ISO-001). Plain JSON data crosses the seam in server.mjs.
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
  engine = V4_IMPORT_ENGINE,
  clock = () => new Date(),
  log = () => {},
} = {}) {
  if (!String(mattersHome || "").trim()) throw new Error("V4 extraction import requires mattersHome");
  const home = path.resolve(mattersHome);

  return {
    /**
     * documents: the V4 extraction result's documents array (plain JSON):
     * [{ sha256|sourceSha256, originalName, pages: [{ pageNumber, text,
     *    outcome, provenance?: { provider, model } }] }]
     */
    async importExtractionResult({ matterFolderName, matterIdSlug, intakeId, resultId, documents } = {}) {
      const matterRoot = await resolveMatterRoot(home, matterFolderName, matterIdSlug);
      if (!matterRoot) {
        const error = new Error(`no matter folder matches "${matterFolderName || matterIdSlug}" under the matters home`);
        error.code = "v4_import.matter_not_found";
        error.retryable = false;
        throw error;
      }
      const registers = await loadRegisters(matterRoot);
      const summary = {
        matterRoot,
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
        const extractedDir = path.join(match.intakeDir, "_extracted");
        const recordPath = path.join(extractedDir, `${match.row.file_id}.json`);
        if (await hasValidExistingRecord(recordPath, sha256)) {
          summary.skippedExistingRecord.push(match.row.file_id);
          continue;
        }
        const record = buildExtractionRecord({ row: match.row, sha256, pages, engine, now: clock() });
        await mkdir(extractedDir, { recursive: true });
        await writeFileAtomic(recordPath, `${JSON.stringify(record, null, 2)}\n`);
        await writeFileAtomic(path.join(extractedDir, `${match.row.file_id}.txt`), flatText(record));
        await mergeExtractionLog({
          intakeDir: match.intakeDir,
          logRow: buildLogRow({ row: match.row, record, pages, intakeId, resultId }),
        });
        summary.imported.push(match.row.file_id);
      }
      log(`V4 import into ${path.basename(matterRoot)}: ${summary.imported.length} record(s) written`
        + (summary.skippedNoRegisterMatch.length ? `, ${summary.skippedNoRegisterMatch.length} not in register` : "")
        + (summary.leftForLegacyExtraction.length ? `, ${summary.leftForLegacyExtraction.length} left for legacy extraction` : "")
        + (summary.skippedExistingRecord.length ? `, ${summary.skippedExistingRecord.length} already extracted` : ""));
      return summary;
    },
  };
}

/**
 * Matter identity: prefer the exact folder name (the workbench's identity for
 * a matter). Fall back to reversing the V4 matterId slug by scanning the
 * matters home — the slug function must stay in sync with
 * react-ui/src/api/v4Intake.ts v4MatterIdFromName.
 */
async function resolveMatterRoot(home, folderName, slug) {
  const exact = String(folderName || "").trim();
  if (exact && !exact.includes("/") && !exact.includes("..")) {
    const candidate = path.join(home, exact);
    if (await isMatterRoot(candidate)) return candidate;
  }
  const wanted = String(slug || "").trim();
  if (!wanted) return null;
  let entries = [];
  try {
    entries = await readdir(home, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (slugifyMatterName(entry.name) !== wanted) continue;
    const candidate = path.join(home, entry.name);
    if (await isMatterRoot(candidate)) return candidate;
  }
  return null;
}

function slugifyMatterName(matterName) {
  const sanitized = String(matterName)
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 240);
  return sanitized || "matter";
}

async function isMatterRoot(candidate) {
  try {
    await stat(path.join(candidate, "matter.json"));
    return true;
  } catch {
    return false;
  }
}

async function loadRegisters(matterRoot) {
  const matter = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  const bySha = new Map();
  for (const intake of Array.isArray(matter.intakes) ? matter.intakes : []) {
    const intakeDir = path.join(matterRoot, String(intake.intake_dir || ""));
    let rows = [];
    try {
      rows = parseCsv(await readFile(path.join(intakeDir, "File Register.csv"), "utf8"));
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

async function hasValidExistingRecord(recordPath, sha256) {
  try {
    const existing = JSON.parse(await readFile(recordPath, "utf8"));
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

async function mergeExtractionLog({ intakeDir, logRow }) {
  const logPath = path.join(intakeDir, "Extraction Log.csv");
  let rows = [];
  try {
    rows = parseCsv(await readFile(logPath, "utf8"));
  } catch {
    rows = [];
  }
  const merged = rows.filter((row) => row.file_id !== logRow.file_id);
  merged.push(logRow);
  merged.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id)));
  await writeFileAtomic(logPath, toCsv(merged, EXTRACTION_LOG_HEADERS));
}
