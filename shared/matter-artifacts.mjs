export const MATTER_LIBRARY_DIR = "10_Library";

export const SOURCE_INDEX_FILENAME = "Source Index.json";

// Canonical neutral chronology product term. The current storage filenames stay
// stable until the physical artifact migration is explicitly implemented.
export const CASE_TIMELINE_JSON_FILENAME = "List of Dates.json";
export const CASE_TIMELINE_CSV_FILENAME = "List of Dates.csv";
export const CASE_TIMELINE_MARKDOWN_FILENAME = "List of Dates.md";

export const SOURCE_INDEX_RELATIVE = `${MATTER_LIBRARY_DIR}/${SOURCE_INDEX_FILENAME}`;
export const CASE_TIMELINE_JSON_RELATIVE = `${MATTER_LIBRARY_DIR}/${CASE_TIMELINE_JSON_FILENAME}`;
export const CASE_TIMELINE_CSV_RELATIVE = `${MATTER_LIBRARY_DIR}/${CASE_TIMELINE_CSV_FILENAME}`;
export const CASE_TIMELINE_MARKDOWN_RELATIVE = `${MATTER_LIBRARY_DIR}/${CASE_TIMELINE_MARKDOWN_FILENAME}`;
export const CASE_TIMELINE_ARTIFACT_RELATIVES = Object.freeze([
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_CSV_RELATIVE,
]);
export const CASE_TIMELINE_READ_MODEL_RELATIVES = Object.freeze([
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  CASE_TIMELINE_JSON_RELATIVE,
]);

const CASE_TIMELINE_ARTIFACT_RELATIVE_SET = new Set(CASE_TIMELINE_ARTIFACT_RELATIVES);
const CASE_TIMELINE_READ_MODEL_RELATIVE_SET = new Set(CASE_TIMELINE_READ_MODEL_RELATIVES);

export function normalizeMatterArtifactRelativePath(value = "") {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

export function isCaseTimelineArtifactPath(value = "") {
  return CASE_TIMELINE_ARTIFACT_RELATIVE_SET.has(normalizeMatterArtifactRelativePath(value));
}

export function isCaseTimelineReadModelPath(value = "") {
  return CASE_TIMELINE_READ_MODEL_RELATIVE_SET.has(normalizeMatterArtifactRelativePath(value));
}

// Backward-compatible code aliases for modules still named after the old native
// skill. Prefer CASE_TIMELINE_* in new preparation, status, and analysis code.
export const LIST_OF_DATES_JSON_FILENAME = CASE_TIMELINE_JSON_FILENAME;
export const LIST_OF_DATES_CSV_FILENAME = CASE_TIMELINE_CSV_FILENAME;
export const LIST_OF_DATES_MARKDOWN_FILENAME = CASE_TIMELINE_MARKDOWN_FILENAME;
export const LIST_OF_DATES_JSON_RELATIVE = CASE_TIMELINE_JSON_RELATIVE;
export const LIST_OF_DATES_CSV_RELATIVE = CASE_TIMELINE_CSV_RELATIVE;
export const LIST_OF_DATES_MARKDOWN_RELATIVE = CASE_TIMELINE_MARKDOWN_RELATIVE;
