export const DOCX_ENGINE_FINGERPRINT = "mammoth@1.12.0";
const SCHEMA_VERSION = "extraction-record/v1";

let mammothModule = null;
async function loadMammoth() {
  if (!mammothModule) {
    mammothModule = (await import("mammoth")).default;
  }
  return mammothModule;
}

export async function extractDocx({ docxPath, fileId, sha256, sourcePath, extractedAt }) {
  const stamp = extractedAt || new Date().toISOString();
  const mammoth = await loadMammoth();

  let result;
  try {
    result = await mammoth.convertToHtml({ path: docxPath });
  } catch (err) {
    return { record: null, flatText: "", failureReason: `mammoth open failed: ${err.message}` };
  }

  const blocks = parseHtmlToBlocks(result.value || "");
  const allText = blocks.map((b) => b.text).join(" ");
  const languageDetected = detectLanguages(allText);

  const page = {
    page: 1,
    ocr_required: false,
    confidence_avg: 1.0,
    needs_review: false,
    blocks: blocks.map((b, i) => ({
      id: `p1.b${i + 1}`,
      type: b.type,
      text: b.text,
    })),
  };

  // Mammoth's "Unrecognised paragraph/run style" warnings are noise — they
  // mean Word used a style mammoth has no CSS rule for, but the underlying
  // text comes through fine. Drop those; surface only real problems.
  const warnings = (result.messages || [])
    .filter((m) => m.type === "error" || (m.type === "warning" && !/Unrecognised (paragraph|run) style/.test(m.message)))
    .map((m) => `mammoth ${m.type}: ${m.message}`);

  const record = {
    schema_version: SCHEMA_VERSION,
    file_id: fileId,
    sha256,
    source_path: sourcePath,
    engine: DOCX_ENGINE_FINGERPRINT,
    extracted_at: stamp,
    language_detected: languageDetected,
    page_count: 1,
    pages: [page],
    warnings,
  };

  const flatText = blocks.map((b) => b.text).join("\n\n");

  return {
    record,
    flatText,
    failureReason: null,
    stats: {
      pageCount: 1,
      ocrRequiredPageCount: 0,
      multiColumnPageCount: 0,
    },
  };
}

function parseHtmlToBlocks(html) {
  const blocks = [];
  const re = /<(h[1-6]|p|li|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const text = stripHtml(match[2]);
    if (!text) continue;
    blocks.push({ type: tagToType(tag), text });
  }
  return blocks;
}

function tagToType(tag) {
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "li") return "list_item";
  if (tag === "tr") return "table_row";
  return "paragraph";
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
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
