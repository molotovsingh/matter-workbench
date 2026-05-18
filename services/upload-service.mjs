import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { runMatterInit } from "../matter-init-engine.mjs";
import { composeIntakeDirName, validateIntakeLabel } from "../shared/matter-contract.mjs";
import { isInsideRoot, makeHttpError } from "../shared/safe-paths.mjs";
import {
  parseUploadJsonField,
  validateUploadPathList,
  writeUploadedFiles,
} from "./upload-file-intake.mjs";
import {
  createMultipartUploadHandler,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "./multipart-upload.mjs";

export function createUploadService({ matterStore, workspaceService, maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES } = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!workspaceService) throw new Error("workspaceService is required");

  const handleMultipartUpload = createMultipartUploadHandler({ maxUploadBytes });

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

      const metadata = parseUploadJsonField(fields, "metadata", {});
      const relativePaths = validateUploadPathList(fields, files);
      const evidenceDir = path.join(matterPath, "00_Inbox", "Intake 01 - Initial", "Source Files");
      if (!isInsideRoot(mattersHome, evidenceDir)) throw makeHttpError("Invalid matter path", 400);
      await writeUploadedFiles(files, relativePaths, evidenceDir, {
        escapeMessage: "Resolved destination escapes matter root",
      });
      matterStore.setMatterRoot(matterPath);
      await runMatterInit({ matterRoot: matterPath, metadata, dryRun: false });
      return await workspaceService.readWorkspace();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async function addFilesToMatter(request) {
    const { fields, files, tempDir } = await handleMultipartUpload(request);
    try {
      const root = await resolveMatterRootForFields(fields);
      const label = validateIntakeLabel(fields.label);
      const relativePaths = validateUploadPathList(fields, files);
      if (!files.length) throw makeHttpError("No files attached", 400);

      const intakeNumber = await matterStore.nextIntakeNumber(root);
      const fileIdStart = await matterStore.nextFileIdStart(root);
      const priorHashes = await matterStore.priorHashIndex(root);
      const receivedDate = new Date().toISOString().slice(0, 10);
      const intakeDirName = composeIntakeDirName(intakeNumber, label, receivedDate);
      const intakeId = `INTAKE-${String(intakeNumber).padStart(2, "0")}`;
      const sourceFilesDir = path.join(root, "00_Inbox", intakeDirName, "Source Files");
      if (!isInsideRoot(root, sourceFilesDir)) throw makeHttpError("Resolved intake path escapes matter root", 400);
      await writeUploadedFiles(files, relativePaths, sourceFilesDir, {
        escapeMessage: "Resolved destination escapes intake root",
      });

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

      const workspace = await workspaceService.readWorkspace(root);
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

  async function resolveMatterRootForFields(fields = {}) {
    const matterName = String(fields.matterName || fields.matter || "").trim();
    if (!matterName) return matterStore.ensureMatterRoot();
    const { matterPath } = await matterStore.resolveExistingMatter(matterName);
    return matterPath;
  }

  return {
    addFilesToMatter,
    createMatter,
    handleMultipartUpload,
  };
}
