import { createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import busboy from "busboy";
import { runMatterInit } from "../matter-init-engine.mjs";
import { composeIntakeDirName, validateIntakeLabel } from "../shared/matter-contract.mjs";
import { isInsideRoot, makeHttpError, validateRelativePath } from "../shared/safe-paths.mjs";

const defaultMaxUploadBytes = 500 * 1024 * 1024;

export function createUploadService({ matterStore, workspaceService, maxUploadBytes = defaultMaxUploadBytes } = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!workspaceService) throw new Error("workspaceService is required");

  async function handleMultipartUpload(request) {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) {
      throw makeHttpError("Expected multipart/form-data", 400);
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "matter-upload-"));
    return new Promise((resolve, reject) => {
      const bb = busboy({
        headers: request.headers,
        limits: { fileSize: maxUploadBytes, files: 5000, fields: 20 },
      });

      const fields = {};
      const filePromises = [];
      let totalBytes = 0;
      let fileIndex = 0;
      let aborted = false;

      const fail = (error) => {
        if (aborted) return;
        aborted = true;
        request.unpipe(bb);
        rm(tempDir, { recursive: true, force: true }).finally(() => {});
        reject(error);
      };

      bb.on("field", (name, value) => {
        fields[name] = value;
      });

      bb.on("file", (fieldname, fileStream, info) => {
        if (aborted) {
          fileStream.resume();
          return;
        }
        const currentIndex = fileIndex;
        fileIndex += 1;
        filePromises.push(new Promise((resolveFile, rejectFile) => {
          const tempPath = path.join(tempDir, `upload-${String(currentIndex).padStart(5, "0")}`);
          const out = createWriteStream(tempPath);
          let streamBytes = 0;
          let settled = false;
          const rejectOnce = (error) => {
            if (settled) return;
            settled = true;
            rejectFile(error);
          };
          fileStream.on("data", (chunk) => {
            streamBytes += chunk.length;
            totalBytes += chunk.length;
            if (totalBytes > maxUploadBytes) {
              const error = makeHttpError("Upload too large", 413);
              rejectOnce(error);
              fail(error);
              return;
            }
          });
          fileStream.on("limit", () => {
            const error = makeHttpError("Upload too large", 413);
            rejectOnce(error);
            fail(error);
          });
          fileStream.on("error", rejectOnce);
          out.on("error", rejectOnce);
          out.on("finish", () => {
            if (settled) return;
            settled = true;
            resolveFile({
              index: currentIndex,
              filename: info.filename,
              tempPath,
              bytes: streamBytes,
            });
          });
          fileStream.pipe(out);
        }));
      });

      bb.on("filesLimit", () => fail(makeHttpError("Too many files", 413)));
      bb.on("error", fail);
      bb.on("finish", async () => {
        if (aborted) return;
        try {
          resolve({ fields, files: await Promise.all(filePromises), tempDir });
        } catch (error) {
          await rm(tempDir, { recursive: true, force: true });
          reject(error);
        }
      });

      request.pipe(bb);
    });
  }

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
