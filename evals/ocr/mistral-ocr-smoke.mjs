import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMistralOcrProvider } from "../../extract-utils/mistral-ocr-provider.mjs";
import { markdownToBlocks } from "../../extract-utils/ocr-normalize.mjs";
import { loadLocalEnv } from "../../shared/local-env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

if (process.env.RUN_MISTRAL_OCR_SMOKE !== "1") {
  console.log("[mistral-ocr-smoke] skipped; set RUN_MISTRAL_OCR_SMOKE=1 to run the live OCR call");
  process.exit(0);
}

await loadLocalEnv({ appDir: REPO_ROOT, override: false });

if (!process.env.MISTRAL_API_KEY) {
  throw new Error("MISTRAL_API_KEY is required for live Mistral OCR smoke");
}

const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-mistral-ocr-smoke-"));
await mkdir(tmp, { recursive: true });
const pdfPath = path.join(tmp, "mistral-ocr-smoke.pdf");
await writeSmokePdf(pdfPath);

const provider = createMistralOcrProvider();
const result = await provider({ pdfPath, pageCount: 1 });
const firstPage = result.pages[0];
const blocks = markdownToBlocks(firstPage?.markdown || "", 1);
const combined = blocks.map((block) => block.text).join(" ");

if (!combined.match(/Mistral OCR smoke/i) || !combined.match(/20 April 2026/i)) {
  throw new Error(`Mistral OCR smoke did not recover expected text. Got: ${combined.slice(0, 300)}`);
}

console.log(`[mistral-ocr-smoke] ok engine=${result.engine} pages=${result.pages.length} blocks=${blocks.length}`);

async function writeSmokePdf(filePath) {
  await writeFile(filePath, `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 82 >>
stream
BT /F1 20 Tf 72 720 Td (Mistral OCR smoke notice dated 20 April 2026) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000241 00000 n
0000000311 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
444
%%EOF
`);
}
