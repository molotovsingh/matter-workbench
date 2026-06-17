import { makeHttpError, validateRelativePath } from "../shared/safe-paths.mjs";

export function normalizeRuntimeObjectKey(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

export function relativePathFromRuntimeObjectKey(objectKey, matterName) {
  const key = normalizeRuntimeObjectKey(objectKey);
  const prefix = `${normalizeRuntimeObjectKey(matterName)}/`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export function validatedRelativePathFromRuntimeObjectKey(objectKey, matterName) {
  const relativePath = relativePathFromRuntimeObjectKey(objectKey, matterName);
  if (!relativePath) return "";
  try {
    return validateRelativePath(relativePath);
  } catch {
    throw makeHttpError(
      "Stored object path is outside the matter root",
      409,
      "runtime_db.read.stored_path_outside_matter",
    );
  }
}

export function runtimeObjectKeyCandidates({ matter = {}, relativePath = "" } = {}) {
  const names = [
    matter.name,
    matter.folderName,
    matter.matterName,
  ].map(normalizeRuntimeObjectKey).filter(Boolean);
  const uniqueNames = [...new Set(names)];
  const normalizedRelativePath = normalizeRuntimeObjectKey(relativePath);
  return uniqueNames.map((name) => `${name}/${normalizedRelativePath}`);
}

export function runtimeObjectKeyForMatterPath({ matter = {}, relativePath = "" } = {}) {
  return `${normalizeRuntimeObjectKey(matter.name)}/${normalizeRuntimeObjectKey(relativePath)}`;
}
