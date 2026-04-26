import { readFile } from "node:fs/promises";

export const TEXT_ENGINE_FINGERPRINT = "text-extract@1.0.0";
const SCHEMA_VERSION = "extraction-record/v1";

export async function extractText({ textPath, fileId, sha256, sourcePath, extractedAt }) {
  const stamp = extractedAt || new Date().toISOString();
  let text;
  try {
    text = await readFile(textPath, "utf8");
  } catch (err) {
    return { record: null, flatText: "", failureReason: `read failed: ${err.message}` };
  }

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((part) => part.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const blocks = paragraphs.length
    ? paragraphs.map((paragraph, index) => ({
      id: `p1.b${index + 1}`,
      type: inferBlockType(paragraph),
      text: paragraph,
    }))
    : [];

  const languageDetected = detectLanguages(blocks.map((b) => b.text).join(" "));
  const warnings = [];
  if (!blocks.length) warnings.push("text file has no extractable content");

  const record = {
    schema_version: SCHEMA_VERSION,
    file_id: fileId,
    sha256,
    source_path: sourcePath,
    engine: TEXT_ENGINE_FINGERPRINT,
    extracted_at: stamp,
    language_detected: languageDetected,
    page_count: 1,
    pages: [{
      page: 1,
      ocr_required: false,
      confidence_avg: 1.0,
      needs_review: false,
      blocks,
    }],
    warnings,
  };

  return {
    record,
    flatText: blocks.map((b) => b.text).join("\n\n"),
    failureReason: null,
    stats: {
      pageCount: 1,
      ocrRequiredPageCount: 0,
      multiColumnPageCount: 0,
    },
  };
}

function inferBlockType(text) {
  const trimmed = text.trim();
  const firstLine = trimmed.split("\n")[0] || trimmed;
  const wordCount = firstLine.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 10 && upperCaseRatio(firstLine) > 0.7 && firstLine.length >= 3) {
    return "heading";
  }
  if (/^\s*[-*]\s+/.test(trimmed)) return "list_item";
  return "paragraph";
}

function upperCaseRatio(text) {
  const letters = text.match(/[A-Za-z]/g) || [];
  if (!letters.length) return 0;
  const upper = letters.filter((c) => c >= "A" && c <= "Z").length;
  return upper / letters.length;
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
