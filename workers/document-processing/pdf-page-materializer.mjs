import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export class PdfPageMaterializer {
  constructor({
    pdfSeparateCommand = "pdfseparate",
    pdfUniteCommand = "pdfunite",
    timeoutMs = 120_000,
    maximumPageBytes = 128 * 1024 * 1024,
    maximumRangePages = 32,
    maximumRangeBytes = 256 * 1024 * 1024,
    execFileImpl = execFile,
  } = {}) {
    this.pdfSeparateCommand = String(pdfSeparateCommand);
    this.pdfUniteCommand = String(pdfUniteCommand);
    this.timeoutMs = positiveInteger(timeoutMs, "timeoutMs");
    this.maximumPageBytes = positiveInteger(maximumPageBytes, "maximumPageBytes");
    this.maximumRangePages = positiveInteger(maximumRangePages, "maximumRangePages");
    this.maximumRangeBytes = positiveInteger(maximumRangeBytes, "maximumRangeBytes");
    this.execFileImpl = execFileImpl;
  }

  async materializePage({ sourceFilePath, pageNumber, allocation } = {}) {
    const range = await this.materializePageRange({ sourceFilePath, firstPage: pageNumber, lastPage: pageNumber, allocation });
    return { filePath: range.filePath, bytes: range.bytes, pageNumber: range.firstPage };
  }

  async materializePageRange({ sourceFilePath, firstPage, lastPage, allocation } = {}) {
    if (!sourceFilePath) throw new Error("sourceFilePath is required");
    const first = positiveInteger(firstPage, "firstPage");
    const last = positiveInteger(lastPage, "lastPage");
    if (last < first) throw new Error("lastPage must be at least firstPage");
    const pageCount = last - first + 1;
    if (pageCount > this.maximumRangePages) throw workerError("materialized page range exceeds worker bounds", "worker.page_range_too_large");
    if (!allocation?.pathFor) throw new Error("scratch allocation is required");
    const splitDirectory = allocation.pathFor(`pages/split-${first}-${last}`);
    const splitPattern = path.join(splitDirectory, "page-%d.pdf");
    const target = allocation.pathFor(`pages/range-${String(first).padStart(5, "0")}-${String(last).padStart(5, "0")}.pdf`);
    await mkdir(splitDirectory, { recursive: true, mode: 0o700 });
    await rm(target, { force: true });
    try {
      await this.execFileImpl(this.pdfSeparateCommand, ["-f", String(first), "-l", String(last), sourceFilePath, splitPattern], commandOptions(this.timeoutMs));
      const splitFiles = Array.from({ length: pageCount }, (_, index) => splitPattern.replace("%d", String(first + index)));
      if (pageCount === 1) {
        const { rename } = await import("node:fs/promises");
        await rename(splitFiles[0], target);
      } else {
        await this.execFileImpl(this.pdfUniteCommand, [...splitFiles, target], commandOptions(this.timeoutMs));
      }
      const details = await stat(target);
      const maximumBytes = pageCount === 1 ? this.maximumPageBytes : this.maximumRangeBytes;
      if (details.size < 1 || details.size > maximumBytes) {
        throw workerError(`materialized page range size ${details.size} is outside worker bounds`, "worker.page_size_invalid");
      }
      return { filePath: target, bytes: details.size, firstPage: first, lastPage: last, pageCount };
    } catch (error) {
      await rm(target, { force: true });
      if (String(error?.code || "").startsWith("worker.")) throw error;
      const wrapped = new Error(`PDF page materialization failed: ${String(error?.message || error).replace(/[\r\n\t]+/g, " ").slice(0, 300)}`);
      wrapped.code = "worker.page_materialization_failed";
      throw wrapped;
    } finally {
      await rm(splitDirectory, { recursive: true, force: true });
    }
  }
}

function commandOptions(timeout) {
  return { encoding: "utf8", timeout, maxBuffer: 1024 * 1024 };
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}

function workerError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
