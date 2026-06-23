import { validateUploadInputs } from "../../shared/upload-intake-planner.mjs";

export const INTAKE_CANDIDATE_SCHEMA_VERSION = "intake-candidate/v1";
export const INTAKE_BATCH_SCHEMA_VERSION = "intake-batch/v1";
export const INTAKE_SOURCE_BROWSER_UPLOAD = "browser_upload";

export function browserUploadCandidatesFromFiles({
  files = [],
  relativePaths = [],
  action = "uploading files",
} = {}) {
  const normalizedPaths = validateUploadInputs({ files, relativePaths, action });
  return files.map((file, fallbackIndex) => {
    const index = normalizedIndex(file?.index, fallbackIndex);
    return {
      schema_version: INTAKE_CANDIDATE_SCHEMA_VERSION,
      sourceKind: INTAKE_SOURCE_BROWSER_UPLOAD,
      index,
      originalName: stringValue(file?.filename),
      relativePath: normalizedPaths[index],
      tempPath: stringValue(file?.tempPath),
      sizeBytes: normalizedBytes(file?.bytes),
    };
  });
}

export function browserUploadBatchFromFiles({
  action = "uploading files",
  files = [],
  relativePaths = [],
} = {}) {
  const candidates = browserUploadCandidatesFromFiles({ files, relativePaths, action });
  return {
    schema_version: INTAKE_BATCH_SCHEMA_VERSION,
    sourceKind: INTAKE_SOURCE_BROWSER_UPLOAD,
    action,
    candidateCount: candidates.length,
    candidates,
  };
}

function normalizedIndex(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return fallback;
  return number;
}

function normalizedBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.trunc(number);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
