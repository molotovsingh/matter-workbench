import path from "node:path";

export const INITIAL_INTAKE_ID = "INTAKE-01";
export const INITIAL_INTAKE_DIR_NAME = "Intake 01 - Initial";
export const MATTER_INIT_ENGINE_VERSION = "phase1-deterministic-v1";

export const REQUIRED_METADATA = [
  { key: "clientName", label: "Client name" },
  { key: "matterName", label: "Matter name" },
  { key: "oppositeParty", label: "Opposite party" },
  { key: "matterType", label: "Matter type" },
  { key: "jurisdiction", label: "Jurisdiction" },
];

export const CATEGORY_BY_EXTENSION = new Map([
  [".pdf", "PDFs"],
  [".doc", "Word Documents"],
  [".docx", "Word Documents"],
  [".xls", "Spreadsheets"],
  [".xlsx", "Spreadsheets"],
  [".csv", "Spreadsheets"],
  [".jpg", "Images"],
  [".jpeg", "Images"],
  [".png", "Images"],
  [".heic", "Images"],
  [".eml", "Emails"],
  [".msg", "Emails"],
  [".zip", "Archives"],
  [".md", "Text Notes"],
  [".txt", "Text Notes"],
]);

export const INTAKE_LOG_HEADERS = [
  "intake_id",
  "intake_dir",
  "received_date",
  "label",
  "source_dir",
  "originals_dir",
  "by_type_dir",
  "scanned_files",
  "unique_files",
  "duplicates_in_batch",
  "duplicates_of_prior",
  "originals_copied",
  "working_copies_copied",
  "loose_root_files_seen",
  "loose_root_files_staged",
  "engine_version",
  "notes",
];

export const FILE_REGISTER_HEADERS = [
  "file_id",
  "intake_id",
  "source_path",
  "original_path",
  "working_copy_path",
  "category",
  "original_name",
  "sha256",
  "size_bytes",
  "duplicate_of",
  "status",
  "engine_version",
  "notes",
];

export const EXTRACTION_LOG_HEADERS = [
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
];

export function classifyFile(filePath) {
  return CATEGORY_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) || "Needs Review";
}

export function normalizeWorkingCopyName(name) {
  const parsed = path.parse(name);
  const stem = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "unnamed";
  return `${stem}${parsed.ext.toLowerCase()}`;
}

export function normalizeMatterMetadata(rawMatter = {}, fallbackName = "") {
  return {
    clientName: rawMatter.client_name || "",
    matterName: rawMatter.matter_name || fallbackName,
    oppositeParty: rawMatter.opposite_party || "",
    matterType: rawMatter.matter_type || "",
    jurisdiction: rawMatter.jurisdiction || "",
    briefDescription: rawMatter.brief_description || "",
  };
}

export function metadataToMatterJsonFields(metadata = {}) {
  return {
    matter_name: metadata.matterName || "",
    matter_type: metadata.matterType || "",
    client_name: metadata.clientName || "",
    opposite_party: metadata.oppositeParty || "",
    jurisdiction: metadata.jurisdiction || "",
    brief_description: metadata.briefDescription || "",
  };
}

export function composeIntakeDirName(number, label, dateIso) {
  const padded = String(number).padStart(2, "0");
  if (number === 1 && !label) return INITIAL_INTAKE_DIR_NAME;
  const suffix = label ? `${dateIso} ${label}` : dateIso;
  return `Intake ${padded} - ${suffix}`;
}

export function validateIntakeLabel(rawLabel) {
  const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
  if (!label) return "";
  if (label.length > 80) {
    const error = new Error("Label too long (max 80 chars)");
    error.statusCode = 400;
    throw error;
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(label)) {
    const error = new Error("Label may contain only letters, numbers, spaces, hyphens, underscores");
    error.statusCode = 400;
    throw error;
  }
  return label;
}
