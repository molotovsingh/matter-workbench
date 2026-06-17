import { makeHttpError, validateRelativePath } from "./safe-paths.mjs";

export function validateUploadRelativePath(rawPath) {
  return validateRelativePath(typeof rawPath === "string" ? rawPath.trim() : rawPath);
}

export function uploadPathCollisionKey(relativePath) {
  return validateUploadRelativePath(relativePath).toLowerCase();
}

export function duplicateUploadPathErrorMessage(safePath, firstPath) {
  return firstPath === safePath
    ? `Duplicate uploaded file path "${safePath}"`
    : `Duplicate uploaded file path "${safePath}" conflicts with "${firstPath}"`;
}

export function validateUploadRelativePaths(relativePaths = []) {
  if (!Array.isArray(relativePaths)) {
    throw makeHttpError("paths array must be an array", 400, "upload.paths_not_array");
  }

  const seen = new Map();
  return relativePaths.map((rawPath) => {
    const safePath = validateUploadRelativePath(rawPath);
    const key = uploadPathCollisionKey(safePath);
    const firstPath = seen.get(key);
    if (firstPath) {
      throw makeHttpError(
        duplicateUploadPathErrorMessage(safePath, firstPath),
        400,
        "upload.duplicate_paths",
      );
    }
    seen.set(key, safePath);
    return safePath;
  });
}
