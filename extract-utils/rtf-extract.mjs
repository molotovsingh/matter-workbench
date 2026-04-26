import { readFile } from "node:fs/promises";

export const RTF_ENGINE_FINGERPRINT = "rtf-extract@1.0.0";
const SCHEMA_VERSION = "extraction-record/v1";

const DESTINATIONS_TO_SKIP = new Set([
  "annotation",
  "author",
  "colortbl",
  "comment",
  "creatim",
  "datafield",
  "doccomm",
  "fonttbl",
  "footer",
  "footerf",
  "footerl",
  "footerr",
  "generator",
  "header",
  "headerf",
  "headerl",
  "headerr",
  "info",
  "listoverridetable",
  "listtable",
  "object",
  "pict",
  "revtim",
  "stylesheet",
  "subject",
  "title",
  "xmlnstbl",
]);

const BYTE_1252 = new Map([
  [0x80, "\u20ac"], [0x82, "\u201a"], [0x83, "\u0192"], [0x84, "\u201e"],
  [0x85, "\u2026"], [0x86, "\u2020"], [0x87, "\u2021"], [0x88, "\u02c6"],
  [0x89, "\u2030"], [0x8a, "\u0160"], [0x8b, "\u2039"], [0x8c, "\u0152"],
  [0x8e, "\u017d"], [0x91, "\u2018"], [0x92, "\u2019"], [0x93, "\u201c"],
  [0x94, "\u201d"], [0x95, "\u2022"], [0x96, "\u2013"], [0x97, "\u2014"],
  [0x98, "\u02dc"], [0x99, "\u2122"], [0x9a, "\u0161"], [0x9b, "\u203a"],
  [0x9c, "\u0153"], [0x9e, "\u017e"], [0x9f, "\u0178"],
]);

export async function extractRtf({ rtfPath, fileId, sha256, sourcePath, extractedAt }) {
  const stamp = extractedAt || new Date().toISOString();
  let rtf;
  try {
    rtf = (await readFile(rtfPath)).toString("latin1");
  } catch (err) {
    return { record: null, flatText: "", failureReason: `read failed: ${err.message}` };
  }

  const extracted = rtfToText(rtf);
  const paragraphs = extracted.text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n\s*\n+/)
    .map((part) => part.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const blocks = paragraphs.map((paragraph, index) => ({
    id: `p1.b${index + 1}`,
    type: inferBlockType(paragraph),
    text: paragraph,
  }));

  const warnings = [...extracted.warnings];
  if (!blocks.length) warnings.push("RTF file has no extractable content");

  const record = {
    schema_version: SCHEMA_VERSION,
    file_id: fileId,
    sha256,
    source_path: sourcePath,
    engine: RTF_ENGINE_FINGERPRINT,
    extracted_at: stamp,
    language_detected: detectLanguages(blocks.map((b) => b.text).join(" ")),
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

export function rtfToText(rtf) {
  const output = [];
  const warnings = [];
  let state = { skip: false, uc: 1 };
  const stack = [];
  let ignorableDestination = false;

  const append = (text) => {
    if (!state.skip) output.push(text);
  };

  for (let i = 0; i < rtf.length; i += 1) {
    const ch = rtf[i];

    if (ch === "{") {
      stack.push({ ...state });
      ignorableDestination = false;
      continue;
    }

    if (ch === "}") {
      state = stack.pop() || { skip: false, uc: 1 };
      ignorableDestination = false;
      continue;
    }

    if (ch !== "\\") {
      if (ch === "\r" || ch === "\n") continue;
      append(ch);
      ignorableDestination = false;
      continue;
    }

    const next = rtf[i + 1];
    if (next === "*" && !state.skip) {
      ignorableDestination = true;
      i += 1;
      continue;
    }
    if (next === "{" || next === "}" || next === "\\") {
      append(next);
      i += 1;
      ignorableDestination = false;
      continue;
    }
    if (next === "'") {
      const hex = rtf.slice(i + 2, i + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        append(decodeByte(parseInt(hex, 16)));
        i += 3;
      } else {
        warnings.push("malformed hex escape encountered");
        i += 1;
      }
      ignorableDestination = false;
      continue;
    }
    if (next === "~") {
      append(" ");
      i += 1;
      ignorableDestination = false;
      continue;
    }
    if (next === "_") {
      append("-");
      i += 1;
      ignorableDestination = false;
      continue;
    }
    if (next === "-") {
      i += 1;
      ignorableDestination = false;
      continue;
    }
    if (next === "\n" || next === "\r") {
      i += 1;
      ignorableDestination = false;
      continue;
    }

    const match = rtf.slice(i + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
    if (!match) {
      if (!state.skip && next) append(next);
      i += 1;
      ignorableDestination = false;
      continue;
    }

    const word = match[1];
    const parameter = match[2] === undefined ? null : Number.parseInt(match[2], 10);
    i += match[0].length;

    if (ignorableDestination || DESTINATIONS_TO_SKIP.has(word)) {
      state.skip = true;
      ignorableDestination = false;
      continue;
    }

    if (word === "uc" && Number.isFinite(parameter)) {
      state.uc = Math.max(0, parameter);
      continue;
    }
    if (word === "u" && Number.isFinite(parameter)) {
      append(String.fromCodePoint(parameter < 0 ? parameter + 65536 : parameter));
      i += state.uc;
      continue;
    }

    if (word === "par" || word === "line" || word === "page" || word === "sect") {
      append("\n\n");
      continue;
    }
    if (word === "tab") {
      append("\t");
      continue;
    }
    if (word === "emdash") {
      append("\u2014");
      continue;
    }
    if (word === "endash") {
      append("\u2013");
      continue;
    }
    if (word === "bullet") {
      append("\u2022 ");
    }
  }

  return {
    text: normalizeExtractedText(output.join("")),
    warnings,
  };
}

function decodeByte(byte) {
  if (BYTE_1252.has(byte)) return BYTE_1252.get(byte);
  return String.fromCharCode(byte);
}

function normalizeExtractedText(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferBlockType(text) {
  const trimmed = text.trim();
  const firstLine = trimmed.split("\n")[0] || trimmed;
  const wordCount = firstLine.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 10 && upperCaseRatio(firstLine) > 0.7 && firstLine.length >= 3) {
    return "heading";
  }
  if (/^\s*(?:[-*]|\u2022)\s+/.test(trimmed)) return "list_item";
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
