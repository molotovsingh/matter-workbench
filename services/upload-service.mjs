import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { runMatterInit } from "../matter-init-engine.mjs";
import { composeIntakeDirName, validateIntakeLabel } from "../shared/matter-contract.mjs";
import { isInsideRoot, makeHttpError, validateRelativePath } from "../shared/safe-paths.mjs";
import {
  createMultipartUploadHandler,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "./multipart-upload.mjs";

export function createUploadService({ matterStore, workspaceService, maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES } = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!workspaceService) throw new Error("workspaceService is required");

  const handleMultipartUpload = createMultipartUploadHandler({ maxUploadBytes });

  function parseJsonField(fields, name, fallback) {
    if (!fields[name]) return fallback;
    try {
      return JSON.parse(fields[name]);
    } catch {
      throw makeHttpError(`Invalid ${name} JSON`, 400);
    }
  }

  function validatePathList(fields, files) {
    const relativePaths = parseJsonField(fields, "paths", []);
    if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
      throw makeHttpError("paths array must match file count", 400);
    }
    return relativePaths;
  }

  async function writeUploadedFiles(files, relativePaths, destinationRoot, escapeMessage) {
    await mkdir(destinationRoot, { recursive: true });
    for (const file of files.sort((a, b) => a.index - b.index)) {
      const safeRel = validateRelativePath(relativePaths[file.index]);
      const destination = path.resolve(destinationRoot, safeRel);
      if (!isInsideRoot(destinationRoot, destination)) {
        throw makeHttpError(escapeMessage, 400);
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(file.tempPath, destination);
    }
  }

  async function createMatter(request) {
    const mattersHome = matterStore.ensureMattersHome();
    const upload = await handleMultipartUpload(request);
    const { fields, files, tempDir } = upload;
    try {
      const { name, matterPath } = matterStore.matterPathForName(fields.name);

      const siblings = await matterStore.listMattersHomeChildren();
      const collision = siblings.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
      if (collision) throw makeHttpError(`A matter named "${collision.name}" already exists`, 409);

      try {
        await stat(matterPath);
        throw makeHttpError("A matter with this name already exists", 409);
      } catch (cause) {
        if (cause.statusCode) throw cause;
        if (cause.code !== "ENOENT") throw cause;
      }

      const metadata = parseJsonField(fields, "metadata", {});
      const relativePaths = validatePathList(fields, files);
      const evidenceDir = path.join(matterPath, "00_Inbox", "Intake 01 - Initial", "Source Files");
      if (!isInsideRoot(mattersHome, evidenceDir)) throw makeHttpError("Invalid matter path", 400);
      await writeUploadedFiles(files, relativePaths, evidenceDir, "Resolved destination escapes matter root");
      matterStore.setMatterRoot(matterPath);
      await runMatterInit({ matterRoot: matterPath, metadata, dryRun: false });
      return await workspaceService.readWorkspace();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async function addFilesToMatter(request) {
    const root = matterStore.ensureMatterRoot();
    const { fields, files, tempDir } = await handleMultipartUpload(request);
    try {
      const label = validateIntakeLabel(fields.label);
      const relativePaths = validatePathList(fields, files);
      if (!files.length) throw makeHttpError("No files attached", 400);

      const intakeNumber = await matterStore.nextIntakeNumber(root);
      const fileIdStart = await matterStore.nextFileIdStart(root);
      const priorHashes = await matterStore.priorHashIndex(root);
      const receivedDate = new Date().toISOString().slice(0, 10);
      const intakeDirName = composeIntakeDirName(intakeNumber, label, receivedDate);
      const intakeId = `INTAKE-${String(intakeNumber).padStart(2, "0")}`;
      const sourceFilesDir = path.join(root, "00_Inbox", intakeDirName, "Source Files");
      if (!isInsideRoot(root, sourceFilesDir)) throw makeHttpError("Resolved intake path escapes matter root", 400);
      await writeUploadedFiles(files, relativePaths, sourceFilesDir, "Resolved destination escapes intake root");

      const existing = await matterStore.readExistingMatterMetadata(root);
      const result = await runMatterInit({
        matterRoot: root,
        metadata: existing,
        dryRun: false,
        intakeId,
        intakeDirName,
        intakeLabel: label,
        receivedDate,
        fileIdStart,
        priorHashes,
      });

      const workspace = await workspaceService.readWorkspace();
      return {
        ...workspace,
        intakeAdded: {
          intakeId,
          intakeDirName,
          receivedDate,
          label,
          scanned: result.counts.scannedFiles,
          unique: result.counts.uniqueFiles,
          duplicatesInBatch: result.counts.duplicatesInBatch,
          duplicatesOfPrior: result.counts.duplicatesOfPrior,
        },
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  return {
    addFilesToMatter,
    createMatter,
    handleMultipartUpload,
  };
}
