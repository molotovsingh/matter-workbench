import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { CONTRACT_VERSIONS, assertPinnedProviderCapability, normalizeProviderResult } from "../../packages/extraction-contracts/index.mjs";

const execFile = promisify(execFileCallback);

// The free lane: pages the inspector classified as trustworthy born-digital
// text are read locally with poppler in milliseconds — no provider, no
// latency, no cost. A page that turns out to extract poorly fails validation
// and climbs the ordinary repair ladder into real OCR.
export const NATIVE_TEXT_CAPABILITY = Object.freeze({
  provider: "native",
  model: "poppler-pdftotext",
  adapterVersion: "native-text-page-provider/1.0.0",
});

export function createNativeTextPageProvider({
  pdfToTextCommand = "pdftotext",
  timeoutMs = 60_000,
  execFileImpl = execFile,
} = {}) {
  const capability = assertPinnedProviderCapability(NATIVE_TEXT_CAPABILITY);
  return Object.freeze({
    capability,
    async extractPage({ pageNumber, source } = {}) {
      if (!source?.filePath) throw new Error("native text provider requires source.filePath");
      let stdout;
      try {
        ({ stdout } = await execFileImpl(
          pdfToTextCommand,
          ["-enc", "UTF-8", source.filePath, "-"],
          { encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        ));
      } catch (caught) {
        // This lane's "local" tool IS its provider, so an extraction failure
        // here must escalate like any other provider failure — the next rung
        // reads the same page over HTTP and does not share the fault. A bare
        // execFile error code would be classified as a worker fault and sent
        // straight to review instead.
        const error = new Error(`native text extraction failed: ${String(caught?.message || caught).replace(/[\r\n\t]+/g, " ").slice(0, 300)}`);
        error.code = "provider.native_extraction_failed";
        error.retryable = false;
        error.billingKnown = true;
        error.billedCostUsd = 0;
        error.usage = { inputUnits: 0, outputUnits: 0 };
        throw error;
      }
      return normalizeProviderResult({
        schemaVersion: CONTRACT_VERSIONS.providerResult,
        pageNumber,
        text: String(stdout || "").replace(/\f/g, "\n").trim(),
        finishReason: "complete",
        requestId: "",
        usage: { inputUnits: 0, outputUnits: 0 },
        billedCostUsd: 0,
        diagnostics: ["native_text_extraction"],
      }, { pageNumber });
    },
  });
}
