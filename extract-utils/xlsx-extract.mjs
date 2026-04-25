import { readFile } from "node:fs/promises";

export const XLSX_ENGINE_FINGERPRINT = "xlsx@0.18.5";
const SCHEMA_VERSION = "extraction-record/v1";

let xlsxModule = null;
async function loadXlsx() {
  if (!xlsxModule) {
    xlsxModule = await import("xlsx");
  }
  return xlsxModule;
}

export async function extractXlsx({ xlsxPath, fileId, sha256, sourcePath, extractedAt }) {
  const stamp = extractedAt || new Date().toISOString();
  let buffer;
  try {
    buffer = await readFile(xlsxPath);
  } catch (err) {
    return { record: null, flatText: "", failureReason: `read failed: ${err.message}` };
  }

  const xlsx = await loadXlsx();
  let workbook;
  try {
    workbook = xlsx.read(buffer, { type: "buffer", cellDates: true, cellNF: false, cellText: false });
  } catch (err) {
    return { record: null, flatText: "", failureReason: `xlsx open failed: ${err.message}` };
  }

  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    return { record: null, flatText: "", failureReason: "workbook has no sheets" };
  }

  const pages = [];
  const warnings = [];

  for (let s = 0; s < sheetNames.length; s++) {
    const pageNumber = s + 1;
    const sheetName = sheetNames[s];
    const sheet = workbook.Sheets[sheetName];
    const rows = sheet ? xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "", raw: false }) : [];

    const blocks = [];
    blocks.push({ id: `p${pageNumber}.b1`, type: "heading", text: `Sheet: ${sheetName}` });

    let blockIdx = 2;
    for (const row of rows) {
      const cells = (row || []).map((c) => formatCell(c));
      const text = cells.join(" | ").trim();
      if (!text) continue;
      blocks.push({ id: `p${pageNumber}.b${blockIdx}`, type: "table_row", text });
      blockIdx += 1;
    }

    if (blocks.length === 1 && rows.length === 0) {
      warnings.push(`page ${pageNumber}: sheet '${sheetName}' is empty`);
    }

    pages.push({
      page: pageNumber,
      ocr_required: false,
      confidence_avg: 1.0,
      needs_review: true,
      blocks,
    });
  }

  const allText = pages.flatMap((p) => p.blocks.map((b) => b.text)).join(" ");
  const languageDetected = detectLanguages(allText);

  const record = {
    schema_version: SCHEMA_VERSION,
    file_id: fileId,
    sha256,
    source_path: sourcePath,
    engine: XLSX_ENGINE_FINGERPRINT,
    extracted_at: stamp,
    language_detected: languageDetected,
    page_count: pages.length,
    pages,
    warnings,
  };

  const flatText = pages
    .map((p) => p.blocks.map((b) => b.text).join("\n"))
    .join("\n\n");

  return {
    record,
    flatText,
    failureReason: null,
    stats: {
      pageCount: pages.length,
      ocrRequiredPageCount: 0,
      multiColumnPageCount: pages.length,
    },
  };
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toString();
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function detectLanguages(text) {
  if (!text || !text.trim()) return [];
  const langs = ["en"];
  if (/[ऀ-ॿ]/.test(text)) langs.push("hi");
  if (/[ঀ-৿]/.test(text)) langs.push("bn");
  if (/[਀-੿]/.test(text)) langs.push("pa");
  if (/[઀-૿]/.test(text)) langs.push("gu");
  if (/[஀-௿]/.test(text)) langs.push("ta");
  if (/[؀-ۿ]/.test(text)) langs.push("ur");
  return langs;
}
