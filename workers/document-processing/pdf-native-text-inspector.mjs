import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { SERVICE_LIMITS } from "../../packages/extraction-contracts/index.mjs";

const execFile = promisify(execFileCallback);
export const PDF_NATIVE_TEXT_INSPECTOR_VERSION = "pdf-native-text-inspector/poppler/v1";

// Inspection with a conservative born-digital classifier. A page is offered
// the free local native-text lane only when its embedded text layer is
// substantial, cleanly encoded, and NOT sitting on top of a page-covering
// image (the signature of scanner/OCR-injected text layers, which must not be
// trusted). Every ambiguity fails toward OCR: the cost of a false OCR is
// money; the cost of a false native is quality.
export class PdfNativeTextInspector {
  constructor({
    objectStore,
    scratchSpace,
    pdfInfoCommand = "pdfinfo",
    pdfToTextCommand = "pdftotext",
    pdfImagesCommand = "pdfimages",
    timeoutMs = 120_000,
    minimumNativeCharacters = 150,
    minimumPrintableRatio = 0.95,
    maximumImageCoverage = 0.55,
    execFileImpl = execFile,
  } = {}) {
    if (!objectStore?.openBlobStream) throw new Error("native-text inspector requires a streaming object store");
    if (!scratchSpace?.withTaskScratch || !scratchSpace?.materializeBlob) throw new Error("native-text inspector requires bounded scratch");
    this.objectStore = objectStore;
    this.scratchSpace = scratchSpace;
    this.pdfInfoCommand = String(pdfInfoCommand);
    this.pdfToTextCommand = String(pdfToTextCommand);
    this.pdfImagesCommand = String(pdfImagesCommand);
    this.timeoutMs = positiveInteger(timeoutMs, "timeoutMs");
    this.minimumNativeCharacters = positiveInteger(minimumNativeCharacters, "minimumNativeCharacters");
    this.minimumPrintableRatio = boundedRatio(minimumPrintableRatio, "minimumPrintableRatio");
    this.maximumImageCoverage = boundedRatio(maximumImageCoverage, "maximumImageCoverage");
    this.execFileImpl = execFileImpl;
    this.version = PDF_NATIVE_TEXT_INSPECTOR_VERSION;
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
      const { pageCount, pageAreaPts } = await this.readDocumentInfo(source.filePath);
      const pageTexts = await this.readPageTexts(source.filePath, pageCount);
      const imageCoverage = await this.readImageCoverage(source.filePath, pageCount, pageAreaPts);
      const pages = Array.from({ length: pageCount }, (_, index) => {
        const text = pageTexts[index] ?? "";
        const classification = classifyPage({
          text,
          imageCoverage: imageCoverage ? imageCoverage[index + 1] || 0 : null,
          minimumCharacters: this.minimumNativeCharacters,
          minimumPrintableRatio: this.minimumPrintableRatio,
          maximumImageCoverage: this.maximumImageCoverage,
        });
        return { pageNumber: index + 1, nativeText: classification };
      });
      return { inspectorVersion: this.version, pageCount, pages };
    });
  }

  async readDocumentInfo(filePath) {
    let stdout;
    try {
      stdout = (await this.execFileImpl(this.pdfInfoCommand, [filePath], commandOptions(this.timeoutMs))).stdout;
    } catch (error) {
      const wrapped = new Error(`PDF preflight failed: ${trim(error)}`);
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
    const sizeMatch = String(stdout || "").match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/mi);
    const pageAreaPts = sizeMatch ? Number(sizeMatch[1]) * Number(sizeMatch[2]) : null;
    return { pageCount, pageAreaPts };
  }

  async readPageTexts(filePath, pageCount) {
    try {
      const { stdout } = await this.execFileImpl(
        this.pdfToTextCommand,
        ["-enc", "UTF-8", filePath, "-"],
        commandOptions(this.timeoutMs, 64 * 1024 * 1024),
      );
      // pdftotext separates pages with form feeds; the final page has no
      // trailing separator.
      const parts = String(stdout || "").split("\f");
      return Array.from({ length: pageCount }, (_, index) => parts[index] ?? "");
    } catch {
      // No text layer readable at all: every page classifies to OCR.
      return Array.from({ length: pageCount }, () => "");
    }
  }

  async readImageCoverage(filePath, pageCount, pageAreaPts) {
    if (!Number.isFinite(pageAreaPts) || pageAreaPts <= 0) return null;
    let stdout;
    try {
      stdout = (await this.execFileImpl(this.pdfImagesCommand, ["-list", filePath], commandOptions(this.timeoutMs, 16 * 1024 * 1024))).stdout;
    } catch {
      // Unknown image layout: fail toward OCR by reporting full coverage.
      return null;
    }
    const coverage = {};
    for (const line of String(stdout || "").split("\n").slice(2)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 14) continue;
      const page = Number(columns[0]);
      const width = Number(columns[3]);
      const height = Number(columns[4]);
      const xPpi = Number(columns[12]);
      const yPpi = Number(columns[13]);
      if (!Number.isInteger(page) || page < 1 || page > pageCount) continue;
      if (![width, height, xPpi, yPpi].every((value) => Number.isFinite(value) && value > 0)) continue;
      const displayAreaPts = (width / xPpi * 72) * (height / yPpi * 72);
      coverage[page] = Math.max(coverage[page] || 0, displayAreaPts / pageAreaPts);
    }
    return coverage;
  }
}

function classifyPage({ text, imageCoverage, minimumCharacters, minimumPrintableRatio, maximumImageCoverage }) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const characters = normalized.length;
  const reasons = [];
  if (characters < minimumCharacters) reasons.push("insufficient_text");
  const printable = normalized.length
    ? Array.from(normalized).filter((ch) => ch !== "�" && ch.codePointAt(0) >= 32).length / normalized.length
    : 0;
  if (normalized.length && printable < minimumPrintableRatio) reasons.push("suspect_encoding");
  if (imageCoverage === null) reasons.push("image_layout_unknown");
  else if (imageCoverage > maximumImageCoverage) reasons.push("image_dominated");
  return {
    trusted: reasons.length === 0,
    characters,
    printableRatio: Math.round(printable * 1000) / 1000,
    imageCoverage: imageCoverage === null ? null : Math.round(imageCoverage * 1000) / 1000,
    reasons,
  };
}

function commandOptions(timeout, maxBuffer = 1024 * 1024) {
  return { encoding: "utf8", timeout, maxBuffer };
}

function trim(error) {
  return String(error?.message || error).replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}

function boundedRatio(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1) throw new Error(`${field} must be a ratio in (0, 1]`);
  return number;
}
