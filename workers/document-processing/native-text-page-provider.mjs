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
      const { stdout } = await execFileImpl(
        pdfToTextCommand,
        ["-enc", "UTF-8", source.filePath, "-"],
        { encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      );
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
