import { execFile as execFileCallback } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export class PdfPageMaterializer {
  constructor({ pdfSeparateCommand = "pdfseparate", timeoutMs = 120_000, maximumPageBytes = 128 * 1024 * 1024, execFileImpl = execFile } = {}) {
    this.pdfSeparateCommand = String(pdfSeparateCommand);
    this.timeoutMs = positiveInteger(timeoutMs, "timeoutMs");
    this.maximumPageBytes = positiveInteger(maximumPageBytes, "maximumPageBytes");
    this.execFileImpl = execFileImpl;
  }

  async materializePage({ sourceFilePath, pageNumber, allocation } = {}) {
    if (!sourceFilePath) throw new Error("sourceFilePath is required");
    const page = positiveInteger(pageNumber, "pageNumber");
    if (!allocation?.pathFor) throw new Error("scratch allocation is required");
    const target = allocation.pathFor(`pages/page-${String(page).padStart(5, "0")}.pdf`);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await rm(target, { force: true });
    try {
      await this.execFileImpl(this.pdfSeparateCommand, ["-f", String(page), "-l", String(page), sourceFilePath, target], {
        encoding: "utf8",
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      const details = await stat(target);
      if (details.size < 1 || details.size > this.maximumPageBytes) {
        const error = new Error(`materialized page size ${details.size} is outside worker bounds`);
        error.code = "worker.page_size_invalid";
        throw error;
      }
      return { filePath: target, bytes: details.size, pageNumber: page };
    } catch (error) {
      await rm(target, { force: true });
      if (String(error?.code || "").startsWith("worker.")) throw error;
      const wrapped = new Error(`PDF page materialization failed: ${String(error?.message || error).slice(0, 300)}`);
      wrapped.code = "worker.page_materialization_failed";
      throw wrapped;
    }
  }
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}
