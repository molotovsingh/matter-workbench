import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { isInsideRoot, makeHttpError, validateRelativePath } from "../shared/safe-paths.mjs";

export function parseUploadJsonField(fields = {}, name, fallback) {
  if (!fields[name]) return fallback;
  try {
    return JSON.parse(fields[name]);
  } catch {
    throw makeHttpError(`Invalid ${name} JSON`, 400);
  }
}

export function validateUploadPathList(fields = {}, files = []) {
  const relativePaths = parseUploadJsonField(fields, "paths", []);
  if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
    throw makeHttpError("paths array must match file count", 400);
  }
  return relativePaths;
}

export async function writeUploadedFiles(files = [], relativePaths = [], destinationRoot, {
  escapeMessage = "Resolved destination escapes upload root",
} = {}) {
  await mkdir(destinationRoot, { recursive: true });
  for (const file of [...files].sort((a, b) => a.index - b.index)) {
    const safeRel = validateRelativePath(relativePaths[file.index]);
    const destination = path.resolve(destinationRoot, safeRel);
    if (!isInsideRoot(destinationRoot, destination)) {
      throw makeHttpError(escapeMessage, 400);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(file.tempPath, destination);
  }
}
