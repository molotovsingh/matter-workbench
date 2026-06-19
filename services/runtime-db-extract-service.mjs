import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EXTRACT_ENGINE_VERSION,
  canUseCachedExtraction,
  emptyExtractResult,
  pickExtractor,
  resolveOcrProvider,
} from "../extract-engine.mjs";
import { parseCsv, toCsv } from "../shared/csv.mjs";
import { EXTRACTION_LOG_HEADERS } from "../shared/matter-contract.mjs";
import { buildExtractionOcrObservability } from "../extract-utils/ocr-policy.mjs";
import { runtimeWorkspaceFilePaths } from "./runtime-db-preparation-read-model.mjs";

export async function runRuntimeDbExtract({
  matter = {},
  workspace = {},
  matterJson = {},
  readPayloadRow,
  persistTextArtifacts,
  tempRoot = os.tmpdir(),
  options = {},
} = {}) {
  if (!matter?.name) throw new Error("runtime DB matter is required");
  if (typeof readPayloadRow !== "function") throw new Error("runtime DB payload reader is required");
  if (typeof persistTextArtifacts !== "function") throw new Error("runtime DB artifact writer is required");

  const dryRun = Boolean(options.dryRun);
  const forceRefresh = Boolean(options.forceRefresh);
  const intakeFilter = options.intakeFilter || null;
  const ocrProvider = resolveOcrProvider(options);
  const intakes = runtimeDbIntakes(matterJson);
  const matterRoot = `postgres:${matter.name}`;
  if (!intakes.length) return { operationResult: emptyExtractResult(dryRun, matterRoot, "no intakes recorded in matter.json"), persisted: [] };

  const targetIntakes = intakeFilter
    ? intakes.filter((intake) => intake.intake_id === intakeFilter)
    : intakes;
  if (!targetIntakes.length) {
    throw new Error(`Intake ${intakeFilter} not found in matter.json (have: ${intakes.map((intake) => intake.intake_id).join(", ")})`);
  }

  const paths = runtimeWorkspaceFilePaths(workspace.tree || workspace.root || {});
  const pathSet = new Set(paths.map((item) => item.path));
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
  const perIntake = [];
  const fileResults = [];
  const filesToPersist = [];

  for (const intake of targetIntakes) {
    const registerPath = `${intake.intake_dir}/File Register.csv`;
    if (!pathSet.has(registerPath)) {
      throw new Error(`File Register.csv missing for ${intake.intake_id || intake.intake_dir}. Run /matter-init before /extract.`);
    }
    const registerRows = parseCsv(readPayloadText({ matter, relativePath: registerPath, readPayloadRow }));
    const extractedDir = `${intake.intake_dir}/_extracted`;
    const logRows = [];
    let intakeExtracted = 0;
    let intakeCached = 0;
    let intakeSkipped = 0;
    let intakeFailed = 0;

    for (const row of registerRows) {
      const processed = await processRuntimeDbRegisterRow({
        row,
        intake,
        matter,
        extractedDir,
        dryRun,
        forceRefresh,
        ocrProvider,
        readPayloadRow,
        tempRoot,
      });
      counts.totalFiles += 1;
      logRows.push(processed.logRow);
      filesToPersist.push(...processed.files);

      if (processed.disposition === "skippedDuplicate") {
        counts.skippedDuplicate += 1;
        intakeSkipped += 1;
      } else if (processed.disposition === "skippedUnsupported") {
        counts.skippedUnsupported += 1;
        intakeSkipped += 1;
      } else if (processed.disposition === "failed") {
        counts.failed += 1;
        intakeFailed += 1;
      } else if (processed.disposition === "cached") {
        counts.cached += 1;
        intakeCached += 1;
      } else {
        if (processed.disposition === "ocrRequired") counts.ocrRequiredFiles += 1;
        counts.extracted += 1;
        intakeExtracted += 1;
      }
    }

    if (!dryRun) {
      filesToPersist.push({
        relativePath: `${intake.intake_dir}/Extraction Log.csv`,
        text: toCsv(logRows, EXTRACTION_LOG_HEADERS),
      });
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

    for (const row of logRows.filter(needsExtractAttention)) {
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
    outputLines.push(`[extract] ${intake.intake_id}: extracted ${intakeExtracted}, cached ${intakeCached}, skipped ${intakeSkipped}, failed ${intakeFailed}`);
  }

  outputLines.push(`[extract] totals: ${counts.extracted} extracted, ${counts.cached} cached, ${counts.skippedUnsupported + counts.skippedDuplicate} skipped (${counts.skippedUnsupported} unsupported-format, ${counts.skippedDuplicate} duplicate), ${counts.ocrRequiredFiles} ocr-required-all, ${counts.failed} failed`);
  if (dryRun) outputLines.push("[extract] dry run only. Re-run with --apply to write records.");

  const operationResult = {
    dryRun,
    matterRoot,
    engineVersion: EXTRACT_ENGINE_VERSION,
    counts,
    perIntake,
    fileResults,
    outputLines,
  };
  const persisted = dryRun || !filesToPersist.length ? [] : await persistTextArtifacts(matter, filesToPersist);
  return { operationResult, persisted };
}

async function processRuntimeDbRegisterRow({
  row,
  intake,
  matter,
  extractedDir,
  dryRun,
  forceRefresh,
  ocrProvider,
  readPayloadRow,
  tempRoot,
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
      files: [],
    };
  }

  const route = pickExtractor(row);
  if (route.skipReason) {
    return {
      disposition: "skippedUnsupported",
      logRow: { ...baseLogRow, status: "skipped-unsupported-format", notes: route.skipReason },
      files: [],
    };
  }

  let sourcePayload;
  try {
    sourcePayload = readPayloadRow({ matter, relativePath: row.working_copy_path });
  } catch {
    return {
      disposition: "failed",
      logRow: { ...baseLogRow, status: "failed", engine: route.fingerprint, notes: `working copy missing: ${row.working_copy_path}` },
      files: [],
    };
  }

  const recordPath = `${extractedDir}/${row.file_id}.json`;
  const cached = readCachedExtraction({ matter, relativePath: recordPath, readPayloadRow });
  if (cached && canUseCachedExtraction(cached, row, route, { ocrProvider, forceRefresh })) {
    return {
      disposition: "cached",
      logRow: {
        ...baseLogRow,
        status: "cached",
        ...buildExtractionOcrObservability(cached),
        extracted_at: cached.extracted_at || "",
      },
      files: [],
    };
  }

  const workDir = await mkdtemp(path.join(tempRoot || os.tmpdir(), "mwb-runtime-db-extract-"));
  try {
    const sourcePath = path.join(workDir, safeTempFilename(row.working_copy_path || row.original_name || row.file_id));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, sourcePayload.bytes);
    const t0 = Date.now();
    let extraction;
    try {
      extraction = await route.extractor({
        [route.pathField]: sourcePath,
        fileId: row.file_id,
        sha256: row.sha256,
        sourcePath: row.working_copy_path,
        ocrProvider,
      });
    } catch (error) {
      return {
        disposition: "failed",
        logRow: { ...baseLogRow, status: "failed", engine: route.fingerprint, notes: `unhandled: ${error.message}` },
        files: [],
      };
    }
    const elapsed = Date.now() - t0;

    if (extraction.failureReason) {
      return {
        disposition: "failed",
        logRow: { ...baseLogRow, status: "failed", engine: route.fingerprint, time_taken_ms: elapsed, notes: extraction.failureReason },
        files: [],
      };
    }

    const stats = extraction.stats;
    const allOcrRequired = stats.pageCount > 0 && stats.ocrRequiredPageCount === stats.pageCount && !stats.ocrApplied;
    const files = dryRun ? [] : [
      { relativePath: recordPath, text: `${JSON.stringify(extraction.record, null, 2)}\n` },
      { relativePath: `${extractedDir}/${row.file_id}.txt`, text: extraction.flatText },
    ];
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
      files,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function runtimeDbIntakes(matterJson = {}) {
  const intakes = Array.isArray(matterJson.intakes) ? [...matterJson.intakes] : [];
  if (!intakes.length && matterJson.phase_1_intake) {
    intakes.push({
      intake_id: matterJson.phase_1_intake.intake_id || "INTAKE-01",
      intake_dir: matterJson.phase_1_intake.intake_dir || "00_Inbox/Intake 01 - Initial",
    });
  }
  return intakes.filter((intake) => intake && intake.intake_dir);
}

function readPayloadText({ matter, relativePath, readPayloadRow }) {
  const payload = readPayloadRow({ matter, relativePath });
  return payload.bytes.toString("utf8");
}

function readCachedExtraction({ matter, relativePath, readPayloadRow }) {
  try {
    const payload = readPayloadRow({ matter, relativePath });
    return JSON.parse(payload.bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function needsExtractAttention(row = {}) {
  return row.status === "failed" || row.status === "ocr-required-all" || String(row.status || "").startsWith("skipped-");
}

function safeTempFilename(value = "") {
  const base = path.basename(String(value || "source.bin")).replace(/[\\/:\0]/g, "_");
  return base || "source.bin";
}
