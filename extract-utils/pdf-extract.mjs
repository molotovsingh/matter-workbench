import { readFile } from "node:fs/promises";

export const PDF_ENGINE_FINGERPRINT = "pdfjs-dist@4.10.38";
const SCHEMA_VERSION = "extraction-record/v1";

const SAME_LINE_Y_TOLERANCE = 2;
const COLUMN_CLUSTER_TOLERANCE = 50;
const COLUMN_CLUSTER_MIN_GAP = 100;
const COLUMN_CLUSTER_MIN_LINES = 3;
const PARAGRAPH_BREAK_FACTOR = 1.4;
const ROLLING_WINDOW = 5;

let pdfjsModule = null;
async function loadPdfjs() {
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsModule;
}

export async function extractPdf({ pdfPath, fileId, sha256, sourcePath, extractedAt }) {
  const stamp = extractedAt || new Date().toISOString();
  let buffer;
  try {
    buffer = await readFile(pdfPath);
  } catch (err) {
    return { record: null, flatText: "", failureReason: `read failed: ${err.message}` };
  }

  const { getDocument } = await loadPdfjs();
  let doc;
  try {
    doc = await getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      isEvalSupported: false,
    }).promise;
  } catch (err) {
    return { record: null, flatText: "", failureReason: `pdfjs open failed: ${err.name}: ${err.message}` };
  }

  const pages = [];
  const fileWarnings = [];
  let multiColumnPageCount = 0;
  let ocrRequiredPageCount = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    let page;
    try {
      page = await doc.getPage(n);
    } catch (err) {
      pages.push(emptyPage(n, true));
      ocrRequiredPageCount += 1;
      fileWarnings.push(`page ${n}: failed to open (${err.message})`);
      continue;
    }

    let textContent;
    try {
      textContent = await page.getTextContent();
    } catch (err) {
      pages.push(emptyPage(n, true));
      ocrRequiredPageCount += 1;
      fileWarnings.push(`page ${n}: text extraction failed (${err.message})`);
      continue;
    }

    const items = (textContent.items || []).filter((it) => typeof it.str === "string" && it.str.length > 0);
    const hasInk = items.some((it) => it.str.trim().length > 0);
    if (!hasInk) {
      pages.push(emptyPage(n, true));
      ocrRequiredPageCount += 1;
      fileWarnings.push(`page ${n}: no text layer; OCR required`);
      continue;
    }

    const sorted = sortItemsForReading(items);
    const lines = groupIntoLines(sorted);
    const isMultiColumn = detectMultiColumn(lines);
    if (isMultiColumn) {
      multiColumnPageCount += 1;
      fileWarnings.push(`page ${n}: tabular or multi-column layout detected; reading order may be wrong`);
    }
    const blocks = groupIntoBlocks(lines, n, isMultiColumn);
    pages.push({
      page: n,
      ocr_required: false,
      confidence_avg: 1.0,
      needs_review: isMultiColumn,
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
    engine: PDF_ENGINE_FINGERPRINT,
    extracted_at: stamp,
    language_detected: languageDetected,
    page_count: doc.numPages,
    pages,
    warnings: fileWarnings,
  };

  const flatText = pages
    .map((p) => p.blocks.map((b) => b.text).join("\n\n"))
    .join("\n");

  return {
    record,
    flatText,
    failureReason: null,
    stats: {
      pageCount: doc.numPages,
      ocrRequiredPageCount,
      multiColumnPageCount,
    },
  };
}

function emptyPage(pageNumber, ocrRequired) {
  return {
    page: pageNumber,
    ocr_required: ocrRequired,
    confidence_avg: 0.0,
    needs_review: ocrRequired,
    blocks: [],
  };
}

function sortItemsForReading(items) {
  return items.slice().sort((a, b) => {
    const ay = a.transform?.[5] ?? 0;
    const by = b.transform?.[5] ?? 0;
    if (Math.abs(ay - by) >= SAME_LINE_Y_TOLERANCE) return by - ay;
    const ax = a.transform?.[4] ?? 0;
    const bx = b.transform?.[4] ?? 0;
    return ax - bx;
  });
}

function groupIntoLines(sortedItems) {
  const lines = [];
  let current = null;
  for (const it of sortedItems) {
    const y = it.transform?.[5] ?? 0;
    const x = it.transform?.[4] ?? 0;
    if (current && Math.abs(current.y - y) < SAME_LINE_Y_TOLERANCE) {
      current.text += it.str;
      current.items.push(it);
      current.maxY = Math.max(current.maxY, y);
      current.minX = Math.min(current.minX, x);
    } else {
      current = { y, minX: x, maxY: y, text: it.str, items: [it] };
      lines.push(current);
    }
  }
  return lines.filter((l) => l.text.trim().length > 0);
}

function groupIntoBlocks(lines, pageNumber, isMultiColumn) {
  if (lines.length === 0) return [];

  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push(Math.abs(lines[i - 1].y - lines[i].y));
  }
  const initialMedian = median(gaps.slice(0, ROLLING_WINDOW));

  const groups = [];
  let currentGroup = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    const recentGaps = gaps.slice(Math.max(0, i - 1 - ROLLING_WINDOW), i - 1);
    const rolling = recentGaps.length >= ROLLING_WINDOW ? median(recentGaps) : initialMedian;
    const threshold = (rolling || gap) * PARAGRAPH_BREAK_FACTOR;
    if (gap > threshold) {
      groups.push(currentGroup);
      currentGroup = [];
    }
    currentGroup.push(lines[i]);
  }
  if (currentGroup.length) groups.push(currentGroup);

  return groups.map((groupLines, idx) => {
    const text = groupLines.map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
    const blockItems = groupLines.flatMap((l) => l.items);
    const bbox = computeBbox(blockItems);
    const type = inferBlockType(text, isMultiColumn);
    const block = {
      id: `p${pageNumber}.b${idx + 1}`,
      type,
      text,
    };
    if (bbox) block.bbox = bbox;
    return block;
  });
}

function detectMultiColumn(lines) {
  if (lines.length < COLUMN_CLUSTER_MIN_LINES) return false;
  const ys = lines.map((l) => l.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yRange = yMax - yMin;
  if (yRange <= 0) return false;
  // Trim header/footer lines (top 10% and bottom 10% of page extent)
  // so a one-line header at a different x doesn't masquerade as a column.
  const cutoffTop = yMax - yRange * 0.1;
  const cutoffBottom = yMin + yRange * 0.1;
  const bodyLines = lines.filter((l) => l.y < cutoffTop && l.y > cutoffBottom);
  if (bodyLines.length < COLUMN_CLUSTER_MIN_LINES) return false;

  const clusters = [];
  for (const line of bodyLines) {
    let assigned = false;
    for (const cluster of clusters) {
      if (Math.abs(cluster.center - line.minX) < COLUMN_CLUSTER_TOLERANCE) {
        cluster.count += 1;
        cluster.center = (cluster.center * (cluster.count - 1) + line.minX) / cluster.count;
        cluster.yMin = Math.min(cluster.yMin, line.y);
        cluster.yMax = Math.max(cluster.yMax, line.y);
        assigned = true;
        break;
      }
    }
    if (!assigned) clusters.push({ center: line.minX, count: 1, yMin: line.y, yMax: line.y });
  }
  // A column has to (a) gather several lines, and (b) span a meaningful
  // vertical range — otherwise it's a stray indented heading, not a column.
  const bodyYRange = Math.max(...bodyLines.map((l) => l.y)) - Math.min(...bodyLines.map((l) => l.y));
  const minSpan = bodyYRange * 0.3;
  const significant = clusters
    .filter((c) => c.count >= 3 && (c.yMax - c.yMin) >= minSpan)
    .sort((a, b) => a.center - b.center);
  if (significant.length < 2) return false;
  for (let i = 1; i < significant.length; i++) {
    if (Math.abs(significant[i].center - significant[i - 1].center) > COLUMN_CLUSTER_MIN_GAP) {
      return true;
    }
  }
  return false;
}

function inferBlockType(text, isMultiColumn) {
  if (isMultiColumn) return "table_row";
  const stripped = text.trim();
  if (!stripped) return "paragraph";
  const wordCount = stripped.split(/\s+/).length;
  const upperRatio = upperCaseRatio(stripped);
  if (wordCount <= 8 && upperRatio > 0.7 && stripped.length >= 3) {
    return "heading";
  }
  return "paragraph";
}

function upperCaseRatio(text) {
  const letters = text.match(/[A-Za-z]/g) || [];
  if (!letters.length) return 0;
  const upper = letters.filter((c) => c >= "A" && c <= "Z").length;
  return upper / letters.length;
}

function computeBbox(items) {
  if (!items.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const it of items) {
    const x = it.transform?.[4] ?? 0;
    const y = it.transform?.[5] ?? 0;
    const w = it.width ?? 0;
    const h = it.height ?? 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + w > x1) x1 = x + w;
    if (y + h > y1) y1 = y + h;
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
  return [round1(x0), round1(y0), round1(x1), round1(y1)];
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
