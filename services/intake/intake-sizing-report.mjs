export const INTAKE_SIZING_REPORT_SCHEMA_VERSION = "intake-sizing-report/v1";

const MB = 1024 * 1024;

const EMPTY_TYPE_MIX = Object.freeze({
  pdf: 0,
  image: 0,
  email: 0,
  spreadsheet: 0,
  document: 0,
  text: 0,
  archive: 0,
  other: 0,
});

export function buildIntakeSizingReport({ candidates = [] } = {}) {
  const items = Array.isArray(candidates) ? candidates : [];
  const typeMix = { ...EMPTY_TYPE_MIX };
  let totalBytes = 0;
  let largestFileBytes = 0;

  for (const candidate of items) {
    const sizeBytes = normalizedBytes(candidate?.sizeBytes);
    totalBytes += sizeBytes;
    largestFileBytes = Math.max(largestFileBytes, sizeBytes);
    typeMix[classifyCandidateType(candidate)] += 1;
  }

  const signals = deriveSizingSignals({ candidateCount: items.length, totalBytes, largestFileBytes, typeMix });
  const sizeClass = classifyIntakeSize({ candidateCount: items.length, totalBytes, largestFileBytes, typeMix });
  return {
    schema_version: INTAKE_SIZING_REPORT_SCHEMA_VERSION,
    candidateCount: items.length,
    totalBytes,
    largestFileBytes,
    typeMix,
    sizeClass,
    recommendedPreparationMode: preparationModeForSizeClass(sizeClass),
    signals,
  };
}

function deriveSizingSignals({ candidateCount, totalBytes, largestFileBytes, typeMix }) {
  const signals = [];
  if (candidateCount > 20) signals.push("intake.many_files");
  if (candidateCount > 100) signals.push("intake.large_file_count");
  if (typeMix.pdf > 100) signals.push("intake.many_pdfs");
  if (typeMix.archive > 0) signals.push("intake.contains_archive");
  if (largestFileBytes > 512 * MB) signals.push("intake.large_single_file");
  if (totalBytes > 512 * MB) signals.push("intake.large_total_size");
  if (totalBytes > 2 * 1024 * MB) signals.push("intake.huge_total_size");
  return signals;
}

function classifyIntakeSize({ candidateCount, totalBytes, largestFileBytes, typeMix }) {
  if (
    candidateCount > 500
    || totalBytes > 2 * 1024 * MB
    || largestFileBytes > 512 * MB
    || typeMix.archive > 0
  ) {
    return "huge";
  }
  if (candidateCount > 100 || totalBytes > 512 * MB || typeMix.pdf > 100) return "large";
  if (candidateCount > 20 || totalBytes > 96 * MB) return "medium";
  return "small";
}

function preparationModeForSizeClass(sizeClass) {
  if (sizeClass === "huge") return "needs_review_before_processing";
  if (sizeClass === "large") return "background";
  if (sizeClass === "medium") return "batched";
  return "immediate";
}

function classifyCandidateType(candidate) {
  const name = `${stringValue(candidate?.relativePath)} ${stringValue(candidate?.originalName)}`.toLowerCase();
  const extension = name.match(/\.([a-z0-9]+)(?:\s|$)/)?.[1] || "";
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp"].includes(extension)) return "image";
  if (["eml", "msg", "mbox"].includes(extension)) return "email";
  if (["csv", "tsv", "xls", "xlsx", "ods"].includes(extension)) return "spreadsheet";
  if (["doc", "docx", "rtf", "odt"].includes(extension)) return "document";
  if (["txt", "md", "json", "xml", "html", "htm"].includes(extension)) return "text";
  if (["zip", "7z", "rar", "tar", "gz", "tgz"].includes(extension)) return "archive";
  return "other";
}

function normalizedBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.trunc(number);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
