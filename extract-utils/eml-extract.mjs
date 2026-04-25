import { readFile } from "node:fs/promises";

export const EML_ENGINE_FINGERPRINT = "mailparser@3.9.8";
const SCHEMA_VERSION = "extraction-record/v1";

let mailparserModule = null;
async function loadMailparser() {
  if (!mailparserModule) {
    mailparserModule = await import("mailparser");
  }
  return mailparserModule;
}

export async function extractEml({ emlPath, fileId, sha256, sourcePath, extractedAt }) {
  const stamp = extractedAt || new Date().toISOString();
  let buffer;
  try {
    buffer = await readFile(emlPath);
  } catch (err) {
    return { record: null, flatText: "", failureReason: `read failed: ${err.message}` };
  }

  const { simpleParser } = await loadMailparser();
  let mail;
  try {
    mail = await simpleParser(buffer, { skipImageLinks: true, skipHtmlToText: false });
  } catch (err) {
    return { record: null, flatText: "", failureReason: `mailparser failed: ${err.message}` };
  }

  const blocks = [];
  let bIdx = 1;
  const push = (type, text) => {
    if (!text || !text.trim()) return;
    blocks.push({ id: `p1.b${bIdx}`, type, text: text.trim() });
    bIdx += 1;
  };

  const subject = (mail.subject || "").trim();
  if (subject) push("heading", `Subject: ${subject}`);

  const headerLines = [];
  if (mail.from?.text) headerLines.push(`From: ${mail.from.text}`);
  if (mail.to?.text) headerLines.push(`To: ${mail.to.text}`);
  if (mail.cc?.text) headerLines.push(`Cc: ${mail.cc.text}`);
  if (mail.bcc?.text) headerLines.push(`Bcc: ${mail.bcc.text}`);
  if (mail.date) headerLines.push(`Date: ${mail.date.toISOString()}`);
  if (mail.messageId) headerLines.push(`Message-ID: ${mail.messageId}`);
  if (headerLines.length) push("paragraph", headerLines.join("\n"));

  const bodyText = (mail.text || "").replace(/\r\n/g, "\n");
  for (const para of bodyText.split(/\n\s*\n+/)) {
    const cleaned = para.replace(/\s+/g, " ").trim();
    if (cleaned) push("paragraph", cleaned);
  }

  const attachments = mail.attachments || [];
  if (attachments.length) {
    const lines = attachments.map((a) => {
      const name = a.filename || a.cid || "(unnamed)";
      const size = typeof a.size === "number" ? ` (${a.size} bytes)` : "";
      const ct = a.contentType ? ` [${a.contentType}]` : "";
      return `- ${name}${size}${ct}`;
    });
    push("paragraph", `Attachments:\n${lines.join("\n")}`);
  }

  const allText = blocks.map((b) => b.text).join(" ");
  const languageDetected = detectLanguages(allText);

  const warnings = [];
  if (!subject) warnings.push("missing Subject header");
  if (!mail.from) warnings.push("missing From header");
  if (!bodyText.trim()) warnings.push("empty body");

  const record = {
    schema_version: SCHEMA_VERSION,
    file_id: fileId,
    sha256,
    source_path: sourcePath,
    engine: EML_ENGINE_FINGERPRINT,
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
