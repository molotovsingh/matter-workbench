import { readFile, stat } from "node:fs/promises";
import { parseCsv } from "../shared/csv.mjs";
import { SOURCE_INDEX_RELATIVE } from "../shared/matter-artifacts.mjs";

export async function readJsonFile(filePath) {
  try {
    const data = JSON.parse(await readFile(filePath, "utf8"));
    return { exists: true, valid: true, data };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, valid: false, data: null, error: "" };
    return { exists: true, valid: false, data: null, error: error?.message || "Invalid JSON" };
  }
}

export async function readCsvFile(filePath) {
  try {
    return {
      exists: true,
      valid: true,
      rows: parseCsv(await readFile(filePath, "utf8")),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, valid: false, rows: [], error: "" };
    return { exists: true, valid: false, rows: [], error: error?.message || "Invalid CSV" };
  }
}

export async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

export function evidence(relativePath, extra = {}) {
  return {
    path: normalizeText(relativePath),
    ...extra,
  };
}

export function sampleRowEvidence(relativePath, rows, key) {
  return rows.slice(0, 5).map((row) => ({
    path: relativePath,
    row: normalizeText(row[key] || row.file_id || row.status || ""),
    status: normalizeText(row.status),
    notes: normalizeText(row.notes, 240),
  }));
}

export function sampleSourceEvidence(sources) {
  return sources.slice(0, 5).map((source) => ({
    path: SOURCE_INDEX_RELATIVE,
    source_id: normalizeText(source?.source_id || source?.file_id),
    label_status: normalizeText(source?.label_status),
  }));
}

export function stageBySlash(status, slash) {
  if (!status || !Array.isArray(status.stages)) return null;
  return status.stages.find((stage) => stage.slash === slash) || null;
}

export function hasExtractionArtifacts(status) {
  return stageBySlash(status, "/extract")?.state === "present";
}

export function hasDeveloperNameLeak(values) {
  return values.some((value) => {
    const text = normalizeText(value);
    return /\bFILE-\d{3,}\b/i.test(text)
      || /[a-f0-9]{32,}/i.test(text)
      || /00_Inbox|10_Library|20_Workshop|30_Drafts|40_Dispatch/.test(text);
  });
}

export function joinDetailSentences(parts) {
  return parts
    .map((part) => sentenceWithTerminalPunctuation(part))
    .filter(Boolean)
    .join(" ");
}

export function normalizeText(value, maxLength = 800) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function sentenceWithTerminalPunctuation(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return /[.!?:;]$/.test(text) ? text : `${text}.`;
}
