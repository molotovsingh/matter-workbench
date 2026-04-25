import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toPosix } from "./path-utils.mjs";
import { extractPdf, PDF_ENGINE_FINGERPRINT } from "./extract-utils/pdf-extract.mjs";
import { extractDocx, DOCX_ENGINE_FINGERPRINT } from "./extract-utils/docx-extract.mjs";
import { extractXlsx, XLSX_ENGINE_FINGERPRINT } from "./extract-utils/xlsx-extract.mjs";
import { extractEml, EML_ENGINE_FINGERPRINT } from "./extract-utils/eml-extract.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENGINE_VERSION = "extract-v1-deterministic";

function pickExtractor(row) {
  const lowerName = (row.original_name || "").toLowerCase();
  const ext = lowerName.includes(".") ? lowerName.slice(lowerName.lastIndexOf(".")) : "";
  if (row.category === "PDFs") {
    return { extractor: extractPdf, fingerprint: PDF_ENGINE_FINGERPRINT, pathField: "pdfPath" };
  }
  if (row.category === "Word Documents") {
    if (ext === ".doc") {
      return { skipReason: "legacy .doc binary not supported (only .docx)" };
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
  return { skipReason: `category not yet supported: ${row.category}` };
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ",") { row.push(field); field = ""; i += 1; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = []; i += 1; continue;
    }
    field += ch; i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, idx) => [h, r[idx] ?? ""])));
}

async function sha256Stream(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
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

export async function runExtract(options = {}) {
  const matterRoot = options.matterRoot
    ? path.resolve(options.matterRoot)
    : (process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null);
  if (!matterRoot) throw new Error("MATTER_ROOT is not set. Pass options.matterRoot or set the env var.");

  const dryRun = Boolean(options.dryRun);
  const intakeFilter = options.intakeFilter || null;

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
    return emptyResult(dryRun, matterRoot, "no intakes recorded in matter.json");
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
  const outputLines = [`> workbench.run /extract${dryRun ? " (dry-run)" : ""}`];
  const perIntake = [];

  for (const intake of targetIntakes) {
    const intakeDir = path.join(matterRoot, intake.intake_dir);
    const fileRegisterPath = path.join(intakeDir, "File Register.csv");
    if (!(await pathExists(fileRegisterPath))) {
      outputLines.push(`[extract] ${intake.intake_id}: File Register.csv missing — skipping`);
      continue;
    }

    const registerRows = parseCsv(await readFile(fileRegisterPath, "utf8"));
    const extractedDir = path.join(intakeDir, "_extracted");
    if (!dryRun) await mkdir(extractedDir, { recursive: true });

    const logRows = [];
    let intakeExtracted = 0;
    let intakeCached = 0;
    let intakeSkipped = 0;
    let intakeFailed = 0;

    for (const row of registerRows) {
      counts.totalFiles += 1;
      const baseLogRow = {
        file_id: row.file_id,
        intake_id: row.intake_id || intake.intake_id,
        source_path: row.source_path,
        sha256: row.sha256,
        engine: "",
        page_count: "",
        ocr_required_pages: "",
        multi_column_pages: "",
        time_taken_ms: "",
        extracted_at: "",
        notes: "",
      };

      if (row.status === "exact-duplicate" || row.status === "duplicate-of-prior-intake") {
        logRows.push({ ...baseLogRow, status: "skipped-duplicate", notes: `duplicate_of: ${row.duplicate_of || ""}` });
        counts.skippedDuplicate += 1;
        intakeSkipped += 1;
        continue;
      }

      const route = pickExtractor(row);
      if (route.skipReason) {
        logRows.push({ ...baseLogRow, status: "skipped-unsupported-format", notes: route.skipReason });
        counts.skippedUnsupported += 1;
        intakeSkipped += 1;
        continue;
      }

      const sourceAbsolute = path.join(matterRoot, row.working_copy_path);
      if (!(await pathExists(sourceAbsolute))) {
        logRows.push({ ...baseLogRow, status: "failed", engine: route.fingerprint, notes: `working copy missing: ${row.working_copy_path}` });
        counts.failed += 1;
        intakeFailed += 1;
        outputLines.push(`[extract] ${row.file_id}: missing on disk`);
        continue;
      }

      const recordPath = path.join(extractedDir, `${row.file_id}.json`);
      const cached = await readJsonIfExists(recordPath);
      if (cached && cached.sha256 === row.sha256) {
        logRows.push({
          ...baseLogRow,
          status: "cached",
          engine: cached.engine || route.fingerprint,
          page_count: cached.page_count ?? "",
          extracted_at: cached.extracted_at || "",
        });
        counts.cached += 1;
        intakeCached += 1;
        continue;
      }

      const t0 = Date.now();
      let extraction;
      try {
        extraction = await route.extractor({
          [route.pathField]: sourceAbsolute,
          fileId: row.file_id,
          sha256: row.sha256,
          sourcePath: row.working_copy_path,
        });
      } catch (err) {
        logRows.push({ ...baseLogRow, status: "failed", engine: route.fingerprint, notes: `unhandled: ${err.message}` });
        counts.failed += 1;
        intakeFailed += 1;
        outputLines.push(`[extract] ${row.file_id}: failed (${err.message})`);
        continue;
      }
      const elapsed = Date.now() - t0;
      baseLogRow.engine = route.fingerprint;

      if (extraction.failureReason) {
        logRows.push({ ...baseLogRow, status: "failed", time_taken_ms: elapsed, notes: extraction.failureReason });
        counts.failed += 1;
        intakeFailed += 1;
        outputLines.push(`[extract] ${row.file_id}: ${extraction.failureReason}`);
        continue;
      }

      const stats = extraction.stats;
      const allOcrRequired = stats.pageCount > 0 && stats.ocrRequiredPageCount === stats.pageCount;
      if (allOcrRequired) counts.ocrRequiredFiles += 1;

      if (!dryRun) {
        await writeFile(recordPath, `${JSON.stringify(extraction.record, null, 2)}\n`);
        await writeFile(path.join(extractedDir, `${row.file_id}.txt`), extraction.flatText);
      }

      logRows.push({
        ...baseLogRow,
        status: allOcrRequired ? "ocr-required-all" : "extracted",
        page_count: stats.pageCount,
        ocr_required_pages: stats.ocrRequiredPageCount,
        multi_column_pages: stats.multiColumnPageCount,
        time_taken_ms: elapsed,
        extracted_at: extraction.record.extracted_at,
      });
      counts.extracted += 1;
      intakeExtracted += 1;
    }

    if (!dryRun) {
      const logPath = path.join(intakeDir, "Extraction Log.csv");
      await writeFile(
        logPath,
        toCsv(logRows, [
          "file_id",
          "intake_id",
          "source_path",
          "sha256",
          "status",
          "engine",
          "page_count",
          "ocr_required_pages",
          "multi_column_pages",
          "time_taken_ms",
          "extracted_at",
          "notes",
        ]),
      );
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
    outputLines,
  };
}

function emptyResult(dryRun, matterRoot, reason) {
  return {
    dryRun,
    matterRoot,
    engineVersion: ENGINE_VERSION,
    counts: { totalFiles: 0, extracted: 0, cached: 0, skippedDuplicate: 0, skippedUnsupported: 0, ocrRequiredFiles: 0, failed: 0 },
    perIntake: [],
    outputLines: [`[extract] ${reason}`],
  };
}

if (process.argv[1] === __filename) {
  const dryRun = !process.argv.includes("--apply");
  const intakeIdx = process.argv.indexOf("--intake");
  const intakeFilter = intakeIdx > -1 ? process.argv[intakeIdx + 1] : null;
  runExtract({ dryRun, intakeFilter })
    .then((result) => {
      console.log(result.outputLines.join("\n"));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
