import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { runMatterInit } from "../matter-init-engine.mjs";
import { matterStorageCollisionKey } from "../shared/matter-identity-policy.mjs";
import { planAddFilesIntake } from "../shared/upload-intake-planner.mjs";
import { isInsideRoot, makeHttpError } from "../shared/safe-paths.mjs";
import {
  planBrowserAddFilesUpload,
  planBrowserNewMatterUpload,
} from "./intake/browser-upload-adapter.mjs";
import { writeUploadedFiles } from "./upload-file-intake.mjs";
import {
  createMultipartUploadHandler,
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_MAX_UPLOAD_FILES,
} from "./multipart-upload.mjs";

export function createUploadService({
  matterStore,
  runtimeDbStorageService = null,
  workspaceService,
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  maxUploadFiles = DEFAULT_MAX_UPLOAD_FILES,
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!workspaceService) throw new Error("workspaceService is required");

  const handleMultipartUpload = createMultipartUploadHandler({ maxUploadBytes, maxUploadFiles });
  const matterWriteQueues = new Map();
  async function createMatter(request) {
    const upload = await handleMultipartUpload(request);
    const { fields, files, tempDir } = upload;
    try {
      const useRuntimeDbStorage = matterStore.hasRuntimeDbStorageMode?.()
        && typeof runtimeDbStorageService?.createMatterFromUploadedFiles === "function";
      const mattersHome = useRuntimeDbStorage ? null : matterStore.ensureMattersHome();
      const browserPlan = planBrowserNewMatterUpload({ fields, files });
      const { identityPlan } = browserPlan;
      const { name, matterPath } = useRuntimeDbStorage
        ? { name: identityPlan.storageName, matterPath: null }
        : matterStore.matterPathForName(identityPlan.storageName);

      const siblings = await matterStore.listMattersHomeChildren();
      const collision = siblings.find((entry) => matterStorageCollisionKey(entry.name) === identityPlan.identity.collisionKey);
      if (collision) {
        throw makeHttpError(`A matter named "${collision.name}" already exists`, 409, "upload.matter_exists");
      }

      const metadata = browserPlan.metadata;
      const relativePaths = browserPlan.relativePaths;
      const intakeSizingReport = browserPlan.batch.sizingReport;

      if (useRuntimeDbStorage) {
        const matter = await runtimeDbStorageService.createMatterFromUploadedFiles({
          name,
          metadata,
          files,
          relativePaths,
          intakeSizingReport,
        });
        await matterStore.switchMatter(name);
        return {
          ...await runtimeDbStorageService.readWorkspace(matter),
          intakeSizingReport,
        };
      }

      try {
        await stat(matterPath);
        throw makeHttpError("A matter with this name already exists", 409, "upload.matter_exists");
      } catch (cause) {
        if (cause.statusCode) throw cause;
        if (cause.code !== "ENOENT") throw cause;
      }

      const evidenceDir = path.join(matterPath, "00_Inbox", "Intake 01 - Initial", "Source Files");
      if (!isInsideRoot(mattersHome, evidenceDir)) {
        throw makeHttpError("Invalid matter path", 400, "upload.invalid_matter_path");
      }
      await writeUploadedFiles(files, relativePaths, evidenceDir, {
        escapeMessage: "Resolved destination escapes matter root",
      });
      matterStore.setMatterRoot(matterPath);
      await runMatterInit({ matterRoot: matterPath, metadata, dryRun: false });
      return {
        ...await workspaceService.readWorkspace(),
        intakeSizingReport,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async function addFilesToMatter(request) {
    const { fields, files, tempDir } = await handleMultipartUpload(request);
    try {
      const browserPlan = planBrowserAddFilesUpload({ fields, files });
      const { label, relativePaths } = browserPlan;
      const intakeSizingReport = browserPlan.batch.sizingReport;

      if (matterStore.hasRuntimeDbStorageMode?.() && typeof runtimeDbStorageService?.addUploadedFilesToMatter === "function") {
        const matter = await resolveMatterRecordForFields(fields);
        const intakeAdded = await runtimeDbStorageService.addUploadedFilesToMatter({
          matter,
          label,
          files,
          relativePaths,
          intakeSizingReport,
        });
        await matterStore.switchMatter(matter.name);
        return {
          ...await runtimeDbStorageService.readWorkspace(matter),
          intakeAdded: {
            ...intakeAdded,
            sizingReport: intakeSizingReport,
          },
        };
      }

      const root = await resolveMatterRootForFields(fields);
      return await withMatterWriteQueue(root, async () => {
        const intakeNumber = await matterStore.nextIntakeNumber(root);
        const fileIdStart = await matterStore.nextFileIdStart(root);
        const priorHashes = await matterStore.priorHashIndex(root);
        const intakePlan = planAddFilesIntake({
          label,
          files,
          relativePaths,
          intakeNumber,
          fileIdStart,
        });
        const { receivedDate, intakeDirName, intakeId } = intakePlan;
        const sourceFilesDir = path.join(root, "00_Inbox", intakeDirName, "Source Files");
        if (!isInsideRoot(root, sourceFilesDir)) {
          throw makeHttpError("Resolved intake path escapes matter root", 400, "upload.intake_path_escapes_root");
        }
        await writeUploadedFiles(files, intakePlan.relativePaths, sourceFilesDir, {
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
            sizingReport: intakeSizingReport,
          },
        };
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async function withMatterWriteQueue(root, operation) {
    const key = path.resolve(root);
    const previous = matterWriteQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    matterWriteQueues.set(key, current);
    try {
      return await current;
    } finally {
      if (matterWriteQueues.get(key) === current) matterWriteQueues.delete(key);
    }
  }

  async function resolveMatterRootForFields(fields = {}) {
    const matterName = String(fields.matterName || fields.matter || "").trim();
    if (!matterName) return matterStore.ensureMatterRoot();
    const { matterPath } = await matterStore.resolveExistingMatter(matterName);
    return matterPath;
  }

  async function resolveMatterRecordForFields(fields = {}) {
    const matterName = String(fields.matterName || fields.matter || "").trim();
    const target = matterName || matterStore.activeMatterNameWithinHome?.();
    if (!target) {
      throw makeHttpError(
        "No matter is active — pick one before adding files.",
        409,
        "upload.matter_required",
      );
    }
    return matterStore.resolveExistingMatter(target);
  }

  return {
    addFilesToMatter,
    createMatter,
    handleMultipartUpload,
  };
}
