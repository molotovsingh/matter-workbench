import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import busboy from "busboy";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const DEFAULT_MAX_UPLOAD_FILES = 5000;

export function createMultipartUploadHandler({
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  maxUploadFiles = DEFAULT_MAX_UPLOAD_FILES,
  tempPrefix = "matter-upload-",
} = {}) {
  return async function handleMultipartUpload(request) {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) {
      throw makeHttpError("Expected multipart/form-data", 400, "upload.multipart_required");
    }

    let tempDir = "";
    let earlyError = null;
    const cleanupTempDir = () => tempDir
      ? rm(tempDir, { recursive: true, force: true }).finally(() => {})
      : Promise.resolve();
    const rememberEarlyError = (error) => {
      if (earlyError) return;
      earlyError = error;
      cleanupTempDir();
    };
    const rememberEarlyAbort = () => rememberEarlyError(uploadInterruptedError());
    request.on("aborted", rememberEarlyAbort);
    request.on("error", rememberEarlyError);

    tempDir = await mkdtemp(path.join(os.tmpdir(), tempPrefix));
    if (earlyError) {
      request.off("aborted", rememberEarlyAbort);
      request.off("error", rememberEarlyError);
      await cleanupTempDir();
      throw earlyError;
    }

    return new Promise((resolve, reject) => {
      const bb = busboy({
        headers: request.headers,
        limits: { fileSize: maxUploadBytes, files: maxUploadFiles, fields: 20 },
      });

      const fields = {};
      const filePromises = [];
      let totalBytes = 0;
      let fileIndex = 0;
      let aborted = false;

      const removeRequestListeners = () => {
        request.off("aborted", failInterruptedUpload);
        request.off("error", fail);
      };
      const fail = (error) => {
        if (aborted) return;
        aborted = true;
        removeRequestListeners();
        request.unpipe(bb);
        if (typeof bb.destroy === "function") bb.destroy(error);
        cleanupTempDir();
        reject(error);
      };
      const failInterruptedUpload = () => fail(uploadInterruptedError());

      request.off("aborted", rememberEarlyAbort);
      request.off("error", rememberEarlyError);
      request.on("aborted", failInterruptedUpload);
      request.on("error", fail);

      bb.on("field", (name, value) => {
        fields[name] = value;
      });

      bb.on("file", (_fieldname, fileStream, info) => {
        if (aborted) {
          fileStream.resume();
          return;
        }
        const currentIndex = fileIndex;
        fileIndex += 1;
        const filePromise = new Promise((resolveFile, rejectFile) => {
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
              const error = uploadTooLargeError(maxUploadBytes);
              rejectOnce(error);
              fail(error);
            }
          });
          fileStream.on("limit", () => {
            const error = uploadTooLargeError(maxUploadBytes);
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
        });
        filePromise.catch(fail);
        filePromises.push(filePromise);
      });

      bb.on("filesLimit", () => fail(uploadTooManyFilesError(maxUploadFiles)));
      bb.on("error", fail);
      bb.on("finish", async () => {
        if (aborted) return;
        removeRequestListeners();
        try {
          resolve({ fields, files: await Promise.all(filePromises), tempDir });
        } catch (error) {
          await rm(tempDir, { recursive: true, force: true });
          reject(error);
        }
      });

      request.pipe(bb);
    });
  };
}

function uploadInterruptedError() {
  return makeHttpError(
    "Upload connection was interrupted before the files finished uploading. Please retry the upload.",
    499,
    "upload.interrupted",
  );
}

function uploadTooLargeError(maxUploadBytes) {
  const limit = formatBytes(maxUploadBytes);
  const suffix = limit ? ` Keep each upload under ${limit}.` : "";
  return makeHttpError(
    `This upload is too large for one batch. Upload fewer files and try again.${suffix}`,
    413,
    "upload.too_large",
  );
}

function uploadTooManyFilesError(maxUploadFiles) {
  const limit = formatWholeNumber(maxUploadFiles);
  const suffix = limit ? ` Keep each upload under ${limit} ${Number(maxUploadFiles) === 1 ? "file" : "files"}.` : "";
  return makeHttpError(
    `This upload has too many files for one batch. Split the folder into smaller batches and try again.${suffix}`,
    413,
    "upload.too_many_files",
  );
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  const mib = value / (1024 * 1024);
  if (mib >= 1) return `${Math.floor(mib)} MB`;
  const kib = value / 1024;
  if (kib >= 1) return `${Math.floor(kib)} KB`;
  return `${Math.floor(value)} bytes`;
}

function formatWholeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return Math.floor(number).toLocaleString("en-US");
}
