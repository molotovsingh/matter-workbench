import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import busboy from "busboy";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export function createMultipartUploadHandler({
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  tempPrefix = "matter-upload-",
} = {}) {
  return async function handleMultipartUpload(request) {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) {
      throw makeHttpError("Expected multipart/form-data", 400, "upload.multipart_required");
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), tempPrefix));
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

      bb.on("filesLimit", () => fail(makeHttpError("Too many files", 413, "upload.too_many_files")));
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
  };
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

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  const mib = value / (1024 * 1024);
  if (mib >= 1) return `${Math.floor(mib)} MB`;
  const kib = value / 1024;
  if (kib >= 1) return `${Math.floor(kib)} KB`;
  return `${Math.floor(value)} bytes`;
}
