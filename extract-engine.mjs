import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPdf, PDF_ENGINE_FINGERPRINT } from "./extract-utils/pdf-extract.mjs";
import { extractDocx, DOCX_ENGINE_FINGERPRINT } from "./extract-utils/docx-extract.mjs";
import { extractXlsx, XLSX_ENGINE_FINGERPRINT } from "./extract-utils/xlsx-extract.mjs";
import { extractEml, EML_ENGINE_FINGERPRINT } from "./extract-utils/eml-extract.mjs";
import { extractText, TEXT_ENGINE_FINGERPRINT } from "./extract-utils/text-extract.mjs";
import { extractRtf, RTF_ENGINE_FINGERPRINT } from "./extract-utils/rtf-extract.mjs";
import { createChainedOcrProvider } from "./extract-utils/chained-ocr-provider.mjs";
import {
  buildExtractionOcrObservability,
  canUseCachedPdfOcrExtraction,
} from "./extract-utils/ocr-policy.mjs";
import { parseCsv, toCsv } from "./shared/csv.mjs";
import { writeFileAtomic } from "./shared/atomic-file.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { EXTRACTION_LOG_HEADERS } from "./shared/matter-contract.mjs";
import {
  isInactiveSourceStatus,
  readSourceSuppressionIndex,
  sourceSuppressionEntryFor,
} from "./services/active-source-set-service.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const EXTRACT_ENGINE_VERSION = "extract-v1-deterministic";
const ENGINE_VERSION = EXTRACT_ENGINE_VERSION;

function shouldExtractRegisterRow(row, sourceSuppressionIndex, outputLines) {
  if (isInactiveSourceStatus(row.status)) {
    outputLines.push(`[extract] ${row.file_id || "source"}: skipped-suppressed (${row.status})`);
    return false;
  }
  const suppression = sourceSuppressionEntryFor(row, sourceSuppressionIndex);
  if (suppression) {
    outputLines.push(`[extract] ${row.file_id || "source"}: skipped-suppressed (${suppression.status || "removed_from_active_record"})`);
    return false;
  }
  return true;
}

export function pickExtractor(row) {
  const lowerName = (row.original_name || "").toLowerCase();
  const ext = lowerName.includes(".") ? lowerName.slice(lowerName.lastIndexOf(".")) : "";
  if (ext === ".rtf") {
    return { extractor: extractRtf, fingerprint: RTF_ENGINE_FINGERPRINT, pathField: "rtfPath" };
  }
  if (row.category === "PDFs") {
    return { extractor: extractPdf, fingerprint: PDF_ENGINE_FINGERPRINT, pathField: "pdfPath" };
  }
  if (row.category === "Word Documents") {
    if (ext === ".doc") {
      return { skipReason: "legacy .doc binary not supported (only .docx)" };
    }
    if (ext !== ".docx") {
      return { skipReason: `word document extension not supported: ${ext || "(none)"}` };
    }
    return { extractor: extractDocx, fingerprint: DOCX_ENGINE_FINGERPRINT, pathField: "docxPath" };
  }
  if (row.category === "Spreadsheets") {
    if (ext === ".xls") {
      return { skipReason: "legacy .xls binary not supported (only .xlsx/.csv)" };
    }
    return { extractor: extractXlsx, fingerprint: XLSX_ENGINE_FINGERPRINT, pathField: "xlsxPath" };
  }
  if (row.category === "Emails") {
    if (ext === ".msg") {
      return { skipReason: "Outlook .msg not yet supported (only .eml)" };
    }
    return { extractor: extractEml, fingerprint: EML_ENGINE_FINGERPRINT, pathField: "emlPath" };
  }
  if (row.category === "Text Notes") {
    if (ext !== ".txt" && ext !== ".md") {
      return { skipReason: `text note extension not supported: ${ext || "(none)"}` };
    }
    return { extractor: extractText, fingerprint: TEXT_ENGINE_FINGERPRINT, pathField: "textPath" };
  }
  return { skipReason: `category not yet supported: ${row.category}` };
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function canUseCachedExtraction(cached, row, route, options) {
  if (options.forceRefresh) return false;
  if (!cached || cached.sha256 !== row.sha256) return false;
  if (route.fingerprint === PDF_ENGINE_FINGERPRINT && typeof options.ocrProvider === "function") {
    return canUseCachedPdfOcrExtraction(cached, {
      ocrProviderAvailable: true,
      pdfEngineFingerprint: PDF_ENGINE_FINGERPRINT,
    });
  }
  return true;
}

export function resolveOcrProvider(options) {
  if (Object.hasOwn(options, "ocrProvider")) return options.ocrProvider;
  const env = options.env || process.env;
  if (!env.MISTRAL_API_KEY) return null;
  return createChainedOcrProvider({
    env,
    fetchImpl: options.fetchImpl,
  });
}

export async function runExtract(options = {}) {
  const matterRoot = options.matterRoot
    ? path.resolve(options.matterRoot)
    : (process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null);
  if (!matterRoot) throw new Error("MATTER_ROOT is not set. Pass options.matterRoot or set the env var.");

  const dryRun = Boolean(options.dryRun);
  const intakeFilter = options.intakeFilter || null;
  const forceRefresh = Boolean(options.forceRefresh);
  const ocrProvider = resolveOcrProvider(options);

  const matterJsonPath = path.join(matterRoot, "matter.json");
  const matterJson = await readJsonIfExists(matterJsonPath);
  if (!matterJson) {
    throw new Error(`matter.json not found at ${matterJsonPath}. Run /matter-init first.`);
  }

  const intakes = Array.isArray(matterJson.intakes) ? matterJson.intakes : [];
  if (!intakes.length && matterJson.phase_1_intake) {
    intakes.push({
      intake_id: matterJson.phase_1_intake.intake_id || "INTAKE-01",
      intake_dir: matterJson.phase_1_intake.intake_dir || "00_Inbox/Intake 01 - Initial",
    });
  }
  if (!intakes.length) {
    return emptyExtractResult(dryRun, matterRoot, "no intakes recorded in matter.json");
  }

  const targetIntakes = intakeFilter
    ? intakes.filter((it) => it.intake_id === intakeFilter)
    : intakes;
  if (!targetIntakes.length) {
    throw new Error(`Intake ${intakeFilter} not found in matter.json (have: ${intakes.map((i) => i.intake_id).join(", ")})`);
  }

  const counts = {
    totalFiles: 0,
    extracted: 0,
    cached: 0,
    skippedDuplicate: 0,
    skippedUnsupported: 0,
    ocrRequiredFiles: 0,
    failed: 0,
  };
  const outputLines = [`> workbench.run /extract${forceRefresh ? " --force-refresh" : ""}${dryRun ? " (dry-run)" : ""}`];
  const suppressionWarnings = [];
  const sourceSuppressionIndex = await readSourceSuppressionIndex(matterRoot, { warnings: suppressionWarnings });
  outputLines.push(...suppressionWarnings.map((warning) => `[extract] ${warning}`));
  const perIntake = [];
  const fileResults = [];

  for (const intake of targetIntakes) {
    const intakeDir = path.join(matterRoot, intake.intake_dir);
    const fileRegisterPath = path.join(intakeDir, "File Register.csv");
    if (!(await pathExists(fileRegisterPath))) {
      throw new Error(`File Register.csv missing for ${intake.intake_id || intake.intake_dir}. Run /matter-init before /extract.`);
    }

    const registerRows = parseCsv(await readFile(fileRegisterPath, "utf8"))
      .filter((row) => shouldExtractRegisterRow(row, sourceSuppressionIndex, outputLines));
    const extractedDir = path.join(intakeDir, "_extracted");
    if (!dryRun) await mkdir(extractedDir, { recursive: true });

    const logRows = [];
    let intakeExtracted = 0;
    let intakeCached = 0;
    let intakeSkipped = 0;
    let intakeFailed = 0;

    const processedRows = await mapWithConcurrency(
      registerRows,
      resolveExtractConcurrency(options),
      (row) => processRegisterRow({
        row,
        intake,
        matterRoot,
        extractedDir,
        dryRun,
        forceRefresh,
        ocrProvider,
      }),
    );

    for (const processed of processedRows) {
      counts.totalFiles += 1;
      logRows.push(processed.logRow);

      if (processed.disposition === "skippedDuplicate") {
        counts.skippedDuplicate += 1;
        intakeSkipped += 1;
        continue;
      }
      if (processed.disposition === "skippedUnsupported") {
        counts.skippedUnsupported += 1;
        intakeSkipped += 1;
        continue;
      }
      if (processed.disposition === "failed") {
        counts.failed += 1;
        intakeFailed += 1;
        continue;
      }
      if (processed.disposition === "cached") {
        counts.cached += 1;
        intakeCached += 1;
        continue;
      }
      if (processed.disposition === "ocrRequired") counts.ocrRequiredFiles += 1;
      counts.extracted += 1;
      intakeExtracted += 1;
    }

    if (!dryRun) {
      const logPath = path.join(intakeDir, "Extraction Log.csv");
      await writeFileAtomic(
        logPath,
        toCsv(logRows, EXTRACTION_LOG_HEADERS),
      );
    }

    fileResults.push(...logRows.map((row) => ({
      file_id: row.file_id,
      intake_id: row.intake_id,
      source_path: row.source_path,
      original_name: row.original_name || "",
      category: row.category || "",
      status: row.status,
      engine: row.engine,
      notes: row.notes,
    })));

    const attentionRows = logRows.filter((row) => (
      row.status === "failed"
      || row.status === "ocr-required-all"
      || row.status.startsWith("skipped-")
    ));
    for (const row of attentionRows) {
      const note = row.notes ? ` (${row.notes})` : "";
      outputLines.push(`[extract] ${row.file_id}: ${row.status}${note}`);
    }

    perIntake.push({
      intake_id: intake.intake_id,
      extracted: intakeExtracted,
      cached: intakeCached,
      skipped: intakeSkipped,
      failed: intakeFailed,
    });
    outputLines.push(
      `[extract] ${intake.intake_id}: extracted ${intakeExtracted}, cached ${intakeCached}, skipped ${intakeSkipped}, failed ${intakeFailed}`,
    );
  }

  outputLines.push(
    `[extract] totals: ${counts.extracted} extracted, ${counts.cached} cached, ${counts.skippedUnsupported + counts.skippedDuplicate} skipped (${counts.skippedUnsupported} unsupported-format, ${counts.skippedDuplicate} duplicate), ${counts.ocrRequiredFiles} ocr-required-all, ${counts.failed} failed`,
  );
  if (dryRun) outputLines.push("[extract] dry run only. Re-run with --apply to write records.");

  return {
    dryRun,
    matterRoot,
    engineVersion: ENGINE_VERSION,
    counts,
    perIntake,
    fileResults,
    outputLines,
  };
}

async function processRegisterRow({
  row,
  intake,
  matterRoot,
  extractedDir,
  dryRun,
  forceRefresh,
  ocrProvider,
}) {
  const baseLogRow = {
    file_id: row.file_id,
    intake_id: row.intake_id || intake.intake_id,
    source_path: row.source_path,
    original_name: row.original_name,
    category: row.category,
    sha256: row.sha256,
    engine: "",
    page_count: "",
    ocr_applied: "",
    ocr_provider_model: "",
    ocr_primary_model: "",
    ocr_repair_model: "",
    ocr_repair_status: "",
    ocr_repair_reason: "",
    ocr_required_pages: "",
    low_confidence_pages: "",
    needs_review_pages: "",
    confidence_status: "",
    provider_warnings_count: "",
    multi_column_pages: "",
    time_taken_ms: "",
    extracted_at: "",
    notes: "",
  };

  if (row.status === "exact-duplicate" || row.status === "duplicate-of-prior-intake") {
    return {
      disposition: "skippedDuplicate",
      logRow: { ...baseLogRow, status: "skipped-duplicate", notes: `duplicate_of: ${row.duplicate_of || ""}` },
    };
  }

  const route = pickExtractor(row);
  if (route.skipReason) {
    return {
      disposition: "skippedUnsupported",
      logRow: { ...baseLogRow, status: "skipped-unsupported-format", notes: route.skipReason },
    };
  }

  const sourceAbsolute = path.join(matterRoot, row.working_copy_path);
  if (!(await pathExists(sourceAbsolute))) {
    return {
      disposition: "failed",
      logRow: { ...baseLogRow, status: "failed", engine: route.fingerprint, notes: `working copy missing: ${row.working_copy_path}` },
    };
  }

  const recordPath = path.join(extractedDir, `${row.file_id}.json`);
  const cached = await readJsonIfExists(recordPath);
  if (cached && canUseCachedExtraction(cached, row, route, { ocrProvider, forceRefresh })) {
    return {
      disposition: "cached",
      logRow: {
        ...baseLogRow,
        status: "cached",
        ...buildExtractionOcrObservability(cached),
        extracted_at: cached.extracted_at || "",
      },
    };
  }

  const t0 = Date.now();
  let extraction;
  try {
    extraction = await route.extractor({
      [route.pathField]: sourceAbsolute,
      fileId: row.file_id,
      sha256: row.sha256,
      sourcePath: row.working_copy_path,
      ocrProvider,
    });
  } catch (err) {
    return {
      disposition: "failed",
      logRow: { ...baseLogRow, status: "failed", engine: route.fingerprint, notes: `unhandled: ${err.message}` },
    };
  }
  const elapsed = Date.now() - t0;

  if (extraction.failureReason) {
    return {
      disposition: "failed",
      logRow: { ...baseLogRow, status: "failed", engine: route.fingerprint, time_taken_ms: elapsed, notes: extraction.failureReason },
    };
  }

  const stats = extraction.stats;
  const allOcrRequired = stats.pageCount > 0 && stats.ocrRequiredPageCount === stats.pageCount && !stats.ocrApplied;

  if (!dryRun) {
    await writeFileAtomic(recordPath, `${JSON.stringify(extraction.record, null, 2)}\n`);
    await writeFileAtomic(path.join(extractedDir, `${row.file_id}.txt`), extraction.flatText);
  }

  return {
    disposition: allOcrRequired ? "ocrRequired" : "extracted",
    logRow: {
      ...baseLogRow,
      status: allOcrRequired ? "ocr-required-all" : "extracted",
      ...buildExtractionOcrObservability(extraction.record, stats),
      multi_column_pages: stats.multiColumnPageCount,
      time_taken_ms: elapsed,
      extracted_at: extraction.record.extracted_at,
      notes: allOcrRequired && Array.isArray(extraction.record.warnings)
        ? extraction.record.warnings.join("; ")
        : "",
    },
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function resolveExtractConcurrency(options = {}) {
  const env = options.env || process.env;
  const explicit = parsePositiveInteger(options.concurrency);
  if (explicit) return explicit;
  return parsePositiveInteger(env.EXTRACT_CONCURRENCY) || 3;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function emptyExtractResult(dryRun, matterRoot, reason) {
  return {
    dryRun,
    matterRoot,
    engineVersion: ENGINE_VERSION,
    counts: { totalFiles: 0, extracted: 0, cached: 0, skippedDuplicate: 0, skippedUnsupported: 0, ocrRequiredFiles: 0, failed: 0 },
    perIntake: [],
    fileResults: [],
    outputLines: [`[extract] ${reason}`],
  };
}

if (process.argv[1] === __filename) {
  const dryRun = !process.argv.includes("--apply");
  const intakeIdx = process.argv.indexOf("--intake");
  const intakeFilter = intakeIdx > -1 ? process.argv[intakeIdx + 1] : null;
  await loadLocalEnv({ appDir: __dirname, override: false });
  runExtract({ dryRun, intakeFilter })
    .then((result) => {
      console.log(result.outputLines.join("\n"));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
