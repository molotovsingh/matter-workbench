import { SERVICE_LIMITS } from "../../../packages/extraction-contracts/index.mjs";

export const PDFJS_INSPECTOR_VERSION = "pdfjs-document-inspector/pdfjs-dist@4.10.38/v1";

let pdfjsModule;

export class PdfjsDocumentInspector {
  constructor({ objectStore } = {}) {
    if (!objectStore?.readBlob) throw new Error("PdfjsDocumentInspector requires an object store");
    this.objectStore = objectStore;
    this.version = PDFJS_INSPECTOR_VERSION;
  }

  async inspect({ blobReference } = {}) {
    if (!pdfjsModule) pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = await this.objectStore.readBlob(blobReference);
    let document;
    try {
      document = await pdfjsModule.getDocument({
        data: new Uint8Array(bytes),
        disableWorker: true,
        isEvalSupported: false,
      }).promise;
      if (document.numPages < 1 || document.numPages > SERVICE_LIMITS.maximumPages) {
        const error = new Error(`document page count ${document.numPages} is outside the service envelope`);
        error.code = "inspection.page_limit_exceeded";
        throw error;
      }
      return {
        inspectorVersion: this.version,
        pageCount: document.numPages,
        pages: Array.from({ length: document.numPages }, (_, index) => ({ pageNumber: index + 1 })),
      };
    } catch (error) {
      if (error?.code) throw error;
      const wrapped = new Error(`PDF inspection failed: ${error?.name || "Error"}: ${error?.message || error}`);
      wrapped.code = "inspection.pdf_invalid";
      throw wrapped;
    } finally {
      await document?.destroy?.();
    }
  }
}
