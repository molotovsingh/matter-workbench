import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { isInsideRoot, makeHttpError } from "../shared/safe-paths.mjs";
import { validateUploadRelativePath } from "../shared/upload-path-policy.mjs";

export {
  parseUploadJsonField,
  validateUploadPathList,
} from "./intake/browser-upload-adapter.mjs";

export async function writeUploadedFiles(files = [], relativePaths = [], destinationRoot, {
  escapeMessage = "Resolved destination escapes upload root",
} = {}) {
  await mkdir(destinationRoot, { recursive: true });
  for (const file of [...files].sort((a, b) => a.index - b.index)) {
    const safeRel = validateUploadRelativePath(relativePaths[file.index]);
    const destination = path.resolve(destinationRoot, safeRel);
    if (!isInsideRoot(destinationRoot, destination)) {
      throw makeHttpError(escapeMessage, 400, "upload.path_escapes_root");
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(file.tempPath, destination);
  }
}
