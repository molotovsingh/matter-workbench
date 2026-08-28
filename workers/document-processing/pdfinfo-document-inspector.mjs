import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { SERVICE_LIMITS } from "../../packages/extraction-contracts/index.mjs";

const execFile = promisify(execFileCallback);
export const PDFINFO_INSPECTOR_VERSION = "pdfinfo-document-inspector/poppler/v1";

export class PdfInfoDocumentInspector {
  constructor({ objectStore, scratchSpace, pdfInfoCommand = "pdfinfo", timeoutMs = 120_000, execFileImpl = execFile } = {}) {
    if (!objectStore?.openBlobStream) throw new Error("PDF info inspector requires a streaming object store");
    if (!scratchSpace?.withTaskScratch || !scratchSpace?.materializeBlob) throw new Error("PDF info inspector requires bounded scratch");
    this.objectStore = objectStore;
    this.scratchSpace = scratchSpace;
    this.pdfInfoCommand = String(pdfInfoCommand);
    this.timeoutMs = positiveInteger(timeoutMs, "timeoutMs");
    this.execFileImpl = execFileImpl;
    this.version = PDFINFO_INSPECTOR_VERSION;
  }

  async inspect({ blobReference, sourceBytes } = {}) {
    return this.scratchSpace.withTaskScratch({
      taskId: `inspect-${String(blobReference?.sha256 || "").slice(0, 24)}`,
      expectedBytes: sourceBytes,
    }, async (allocation) => {
      const source = await this.scratchSpace.materializeBlob({
        allocation,
        objectStore: this.objectStore,
        blobReference,
        fileName: "source/source.pdf",
      });
      let stdout;
      try {
        const result = await this.execFileImpl(this.pdfInfoCommand, [source.filePath], {
          encoding: "utf8",
          timeout: this.timeoutMs,
          maxBuffer: 1024 * 1024,
        });
        stdout = result.stdout;
      } catch (error) {
        const wrapped = new Error(`PDF preflight failed: ${String(error?.message || error).replace(/[\r\n\t]+/g, " ").slice(0, 300)}`);
        wrapped.code = /password|encrypted/i.test(String(error?.stderr || error?.message || ""))
          ? "inspection.pdf_password_protected"
          : "inspection.pdf_invalid";
        throw wrapped;
      }
      const pageMatch = String(stdout || "").match(/^Pages:\s+(\d+)\s*$/mi);
      const pageCount = Number(pageMatch?.[1]);
      if (!Number.isInteger(pageCount) || pageCount < 1) {
        const error = new Error("PDF preflight did not report a page count");
        error.code = "inspection.page_count_missing";
        throw error;
      }
      if (pageCount > SERVICE_LIMITS.maximumPages) {
        const error = new Error(`document page count ${pageCount} exceeds service envelope`);
        error.code = "inspection.page_limit_exceeded";
        throw error;
      }
      return {
        inspectorVersion: this.version,
        pageCount,
        pages: Array.from({ length: pageCount }, (_, index) => ({ pageNumber: index + 1 })),
      };
    });
  }
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}
