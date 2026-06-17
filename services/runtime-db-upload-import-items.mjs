import { normalizeRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";

export function runtimeUploadImportItemsFromFileRegisterRows(fileRegisterRows = []) {
  return (Array.isArray(fileRegisterRows) ? fileRegisterRows : [])
    .filter((row) => stringValue(row?.file_id) && stringValue(row?.source_path))
    .map((row) => ({
      relativePath: normalizeRuntimeObjectKey(row.source_path),
      originalPath: normalizeRuntimeObjectKey(row.original_path),
      workingCopyPath: normalizeRuntimeObjectKey(row.working_copy_path),
      originalRelativePath: sourceRelativePathForImport(row.source_path)
        || stringValue(row.original_name)
        || normalizeRuntimeObjectKey(row.source_path),
      fileNumber: fileNumberForFileId(row.file_id),
      fileId: stringValue(row.file_id).toUpperCase(),
      sha256: stringValue(row.sha256),
      duplicateOf: stringValue(row.duplicate_of).toUpperCase(),
    }))
    .filter((row) => row.fileNumber > 0 && /^FILE-\d{4}$/.test(row.fileId));
}

export function sourceRelativePathForImport(value) {
  const normalized = normalizeRuntimeObjectKey(value);
  const marker = "/Source Files/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index + marker.length) : "";
}

export function fileNumberForFileId(value) {
  const match = stringValue(value).match(/^FILE-(\d{4})$/i);
  if (!match) return 0;
  const number = Number.parseInt(match[1], 10);
  return Number.isFinite(number) ? number : 0;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
