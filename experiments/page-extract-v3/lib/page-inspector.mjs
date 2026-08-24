import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(require.resolve("pdfjs-dist/package.json"));
const STANDARD_FONT_DATA_URL = pathToFileURL(path.join(PDFJS_ROOT, "standard_fonts") + path.sep).href;
const CMAP_URL = pathToFileURL(path.join(PDFJS_ROOT, "cmaps") + path.sep).href;

const SAME_LINE_Y_TOLERANCE = 2;
const COLUMN_CLUSTER_TOLERANCE = 50;
const COLUMN_CLUSTER_MIN_GAP = 100;
const COLUMN_CLUSTER_MIN_LINES = 3;

let pdfjsModule;

export async function inspectPdfPages({ pdfPath, policy = {} } = {}) {
  if (!pdfPath) throw new Error("pdf path is required");
  const bytes = await readFile(pdfPath);
  const pdfjs = await loadPdfjs();
  let document;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableWorker: true,
      isEvalSupported: false,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
    }).promise;
  } catch (error) {
    throw new Error(`pdfjs open failed: ${error?.name || "Error"}: ${error?.message || error}`);
  }

  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      pages.push(await inspectPage(document, pageNumber, policy, pdfjs.OPS));
    }
  } finally {
    await document.destroy().catch(() => {});
  }
  return { pageCount: document.numPages, bytes: bytes.length, pages };
}

export function classifyNativePage({ text = "", lines = [], multiColumn = false, images = {}, extractionError = "" } = {}, policy = {}) {
  const minimumCharacters = positiveNumber(policy.minimumCharacters, 120);
  const minimumWords = positiveNumber(policy.minimumWords, 8);
  const minimumCharactersForShortPage = positiveNumber(policy.minimumCharactersForShortPage, 240);
  const maximumReplacementRatio = nonNegativeNumber(policy.maximumReplacementRatio, 0.005);
  const maximumDuplicateLineRatio = nonNegativeNumber(policy.maximumDuplicateLineRatio, 0.35);
  const normalized = normalizeText(text);
  const visibleCharacters = normalized.replace(/\s/g, "").length;
  const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
  const replacementCharacters = (normalized.match(/\uFFFD/g) || []).length;
  const suspiciousControls = [...normalized].filter((character) => {
    const code = character.codePointAt(0);
    return code < 32 && character !== "\n" && character !== "\t";
  }).length;
  const replacementRatio = visibleCharacters ? replacementCharacters / visibleCharacters : 0;
  const duplicateLineRatio = calculateDuplicateLineRatio(lines);
  const reasons = [];

  if (extractionError) reasons.push("native_text_extraction_failed");
  if (!visibleCharacters) reasons.push("no_embedded_text");
  if (visibleCharacters > 0 && visibleCharacters < minimumCharacters) reasons.push("thin_embedded_text");
  if (visibleCharacters < minimumCharactersForShortPage && words < minimumWords) reasons.push("too_few_words");
  if (multiColumn) reasons.push("layout_or_reading_order_risk");
  if (Number(images.largeImageCount) > 0) reasons.push("large_raster_image_risk");
  if (replacementRatio > maximumReplacementRatio || suspiciousControls > 0) reasons.push("invalid_unicode_risk");
  if (duplicateLineRatio > maximumDuplicateLineRatio) reasons.push("duplicate_text_layer_risk");

  return {
    route: reasons.length ? "primary_ocr" : "native",
    reasons,
    diagnostics: {
      characters: visibleCharacters,
      words,
      lines: lines.length,
      multiColumn: Boolean(multiColumn),
      replacementCharacters,
      suspiciousControls,
      replacementRatio,
      duplicateLineRatio,
      imageCount: Number(images.imageCount) || 0,
      largeImageCount: Number(images.largeImageCount) || 0,
      maximumImagePixels: Number(images.maximumImagePixels) || 0,
    },
  };
}

async function inspectPage(document, pageNumber, policy, OPS) {
  let page;
  try {
    page = await document.getPage(pageNumber);
  } catch (error) {
    const classification = classifyNativePage({ extractionError: error?.message || String(error) }, policy);
    return pageResult({ pageNumber, text: "", lines: [], blocks: [], classification });
  }

  let textContent;
  try {
    textContent = await page.getTextContent();
  } catch (error) {
    const classification = classifyNativePage({ extractionError: error?.message || String(error) }, policy);
    return pageResult({ pageNumber, text: "", lines: [], blocks: [], classification });
  }

  const items = (textContent.items || []).filter((item) => typeof item.str === "string" && item.str.length > 0);
  const sorted = sortItemsForReading(items);
  const lines = groupIntoLines(sorted);
  const multiColumn = detectMultiColumn(lines);
  const blocks = groupIntoBlocks(lines, pageNumber);
  const text = blocks.map((block) => block.text).join("\n\n");
  const images = await inspectImages(page, OPS, policy);
  const classification = classifyNativePage({ text, lines, multiColumn, images }, policy);
  return pageResult({ pageNumber, text, lines, blocks, classification });
}

function pageResult({ pageNumber, text, lines, blocks, classification }) {
  return {
    page: pageNumber,
    nativeText: normalizeText(text),
    nativeBlocks: blocks,
    route: classification.route,
    reasons: classification.reasons,
    diagnostics: classification.diagnostics,
    lineCount: lines.length,
  };
}

function sortItemsForReading(items) {
  return items.slice().sort((left, right) => {
    const leftY = left.transform?.[5] ?? 0;
    const rightY = right.transform?.[5] ?? 0;
    if (Math.abs(leftY - rightY) >= SAME_LINE_Y_TOLERANCE) return rightY - leftY;
    return (left.transform?.[4] ?? 0) - (right.transform?.[4] ?? 0);
  });
}

function groupIntoLines(items) {
  const lines = [];
  let current;
  for (const item of items) {
    const y = Number(item.transform?.[5]) || 0;
    const x = Number(item.transform?.[4]) || 0;
    const width = Math.max(0, Number(item.width) || 0);
    if (!current || Math.abs(current.y - y) >= SAME_LINE_Y_TOLERANCE) {
      current = { y, minX: x, maxX: x + width, text: String(item.str), items: [item] };
      lines.push(current);
      continue;
    }
    const gap = x - current.maxX;
    const fontHeight = Math.abs(Number(item.height) || Number(item.transform?.[0]) || 10);
    if (gap > Math.max(1, fontHeight * 0.15) && !/\s$/.test(current.text) && !/^\s/.test(item.str)) current.text += " ";
    current.text += item.str;
    current.items.push(item);
    current.minX = Math.min(current.minX, x);
    current.maxX = Math.max(current.maxX, x + width);
  }
  return lines.filter((line) => line.text.trim());
}

function groupIntoBlocks(lines, pageNumber) {
  if (!lines.length) return [];
  const gaps = [];
  for (let index = 1; index < lines.length; index += 1) gaps.push(Math.abs(lines[index - 1].y - lines[index].y));
  const medianGap = median(gaps) || 12;
  const blocks = [];
  let current = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && Math.abs(lines[index - 1].y - lines[index].y) > medianGap * 1.5 && current.length) {
      blocks.push(blockFromLines(current, pageNumber, blocks.length));
      current = [];
    }
    current.push(lines[index]);
  }
  if (current.length) blocks.push(blockFromLines(current, pageNumber, blocks.length));
  return blocks;
}

function blockFromLines(lines, pageNumber, index) {
  return {
    id: `p${pageNumber}-b${index + 1}`,
    page: pageNumber,
    text: lines.map((line) => line.text.trim()).filter(Boolean).join("\n"),
  };
}

function detectMultiColumn(lines) {
  if (lines.length < COLUMN_CLUSTER_MIN_LINES * 2) return false;
  const starts = lines.map((line) => line.minX).sort((left, right) => left - right);
  const clusters = [];
  for (const start of starts) {
    const cluster = clusters.find((candidate) => Math.abs(candidate.mean - start) <= COLUMN_CLUSTER_TOLERANCE);
    if (cluster) {
      cluster.values.push(start);
      cluster.mean = cluster.values.reduce((sum, value) => sum + value, 0) / cluster.values.length;
    } else {
      clusters.push({ mean: start, values: [start] });
    }
  }
  const substantial = clusters.filter((cluster) => cluster.values.length >= COLUMN_CLUSTER_MIN_LINES).sort((left, right) => left.mean - right.mean);
  return substantial.some((cluster, index) => index > 0 && cluster.mean - substantial[index - 1].mean >= COLUMN_CLUSTER_MIN_GAP);
}

async function inspectImages(page, OPS, policy) {
  const minimumLargeImagePixels = positiveNumber(policy.minimumLargeImagePixels, 250_000);
  let operatorList;
  try {
    operatorList = await page.getOperatorList();
  } catch {
    return { imageCount: 0, largeImageCount: 0, maximumImagePixels: 0 };
  }
  let imageCount = 0;
  let largeImageCount = 0;
  let maximumImagePixels = 0;
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    if (![OPS?.paintImageXObject, OPS?.paintInlineImageXObject, OPS?.paintJpegXObject].includes(fn)) continue;
    imageCount += 1;
    const args = operatorList.argsArray[index] || [];
    const inline = args[0] && typeof args[0] === "object" ? args[0] : null;
    const width = Number(inline?.width ?? args[1]) || 0;
    const height = Number(inline?.height ?? args[2]) || 0;
    const pixels = Math.max(0, width * height);
    maximumImagePixels = Math.max(maximumImagePixels, pixels);
    if (pixels >= minimumLargeImagePixels) largeImageCount += 1;
  }
  return { imageCount, largeImageCount, maximumImagePixels };
}

function calculateDuplicateLineRatio(lines) {
  const values = lines.map((line) => normalizeText(line.text).toLowerCase()).filter(Boolean);
  if (values.length < 3) return 0;
  return (values.length - new Set(values).size) / values.length;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function loadPdfjs() {
  if (!pdfjsModule) pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsModule;
}
