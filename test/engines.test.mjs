import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runExtract } from "../extract-engine.mjs";
import { PDF_ENGINE_FINGERPRINT } from "../extract-utils/pdf-extract.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { parseCsv } from "../shared/csv.mjs";

const execFileAsync = promisify(execFile);

async function makeMatterRoot(name = "matter") {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-workbench-test-"));
  const root = path.join(tmp, name);
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  return root;
}

async function writeSource(root, name, content) {
  const filePath = path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files", name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

async function writeSimplePdf(filePath) {
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
<< /Length 44 >>
stream
BT /F1 24 Tf 72 720 Td (Hello PDF) Tj ET
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
405
%%EOF
`);
}

async function writeBlankPdf(filePath) {
  await writeFile(filePath, `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer
<< /Size 4 /Root 1 0 R >>
startxref
190
%%EOF
`);
}

async function writeMixedPdf(filePath) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 56 >>\nstream\nBT /F1 18 Tf 72 720 Td (Text layer page one) Tj ET\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  await writeFile(filePath, pdf);
}

async function writeSimpleDocx(filePath) {
  await rm(filePath, { force: true });
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "matter-docx-"));
  await mkdir(path.join(buildDir, "_rels"), { recursive: true });
  await mkdir(path.join(buildDir, "word"), { recursive: true });
  await writeFile(path.join(buildDir, "[Content_Types].xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  await writeFile(path.join(buildDir, "_rels", ".rels"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  await writeFile(path.join(buildDir, "word", "document.xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>`);
  await execFileAsync("zip", ["-qr", filePath, "."], { cwd: buildDir });
}

function metadata() {
  return {
    clientName: "Client",
    matterName: "Client vs Opposite",
    oppositeParty: "Opposite",
    matterType: "Consumer",
    jurisdiction: "India",
    briefDescription: "",
  };
}

test("matter-init preserves originals, classifies working copies, and records duplicates", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "a-note.txt", "same text\n");
  await writeSource(root, "b-duplicate.txt", "same text\n");
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  const register = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), "utf8"));
  assert.equal(register.length, 2);
  assert.equal(register[0].status, "unique");
  assert.equal(register[1].status, "exact-duplicate");
  assert.equal(register[1].duplicate_of, "FILE-0001");
  assert.equal(register[0].category, "Text Notes");

  await stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "Originals", "a-note.txt"));
  await stat(path.join(root, register[0].working_copy_path));
  await stat(path.join(root, "10_Library"));
  await stat(path.join(root, "20_Workshop"));
  await stat(path.join(root, "30_Drafts"));
  await stat(path.join(root, "40_Dispatch"));
  const matterJson = JSON.parse(await readFile(path.join(root, "matter.json"), "utf8"));
  assert.equal(Array.isArray(matterJson.intakes), true);
  assert.equal(matterJson.intakes[0].intake_id, "INTAKE-01");
  assert.deepEqual(
    matterJson.workspace_lanes.map((lane) => lane.path),
    ["00_Inbox", "10_Library", "20_Workshop", "30_Drafts", "40_Dispatch"],
  );
});

test("matter-init ignores OS junk and Office lockfiles before file registration", async () => {
  const root = await makeMatterRoot();
  await writeFile(path.join(root, "Thumbs.db"), "root thumbnails");
  await writeFile(path.join(root, "~$root-lock.docx"), "root office lockfile");
  await writeFile(path.join(root, "loose-root-note.txt"), "Loose root note dated 21 April 2026.\n");
  await writeSource(root, ".DS_Store", "finder metadata");
  await writeSource(root, "Thumbs.db", "windows thumbnails");
  await writeSource(root, "~$agreement.docx", "office lockfile");
  await writeSource(root, "agreement.pdf", "%PDF-1.4\n");
  await writeSource(root, "notes.md", "Notes dated 20 April 2026.\n");

  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  const register = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), "utf8"));
  assert.deepEqual(register.map((row) => row.original_name), ["agreement.pdf", "loose-root-note.txt", "notes.md"]);
  assert.deepEqual(register.map((row) => row.category), ["PDFs", "Text Notes", "Text Notes"]);
  await assert.rejects(
    () => stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "Originals", "~$agreement.docx")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    () => stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files", "~$root-lock.docx")),
    { code: "ENOENT" },
  );
});

test("extract creates records for PDF, DOCX, RTF, spreadsheet, EML, and text while logging unsupported files", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "01-note.txt", "Plain text paragraph.\n\nSecond paragraph.");
  await writeSource(root, "02-data.csv", "Date,Event\n2026-04-20,Agreement signed\n");
  await writeSource(root, "03-mail.eml", "From: client@example.com\nTo: lawyer@example.com\nSubject: Facts\n\nEmail body.");
  await writeSimplePdf(await writeSource(root, "04-simple.pdf", ""));
  await writeSimpleDocx(await writeSource(root, "05-simple.docx", ""));
  await writeSource(root, "06-rich.rtf", "{\\rtf1\\ansi\\uc1\\b NOTICE\\b0\\par Possession delivered on \\u50?0 April 2026.\\par}");
  await writeSource(root, "07-script.py", "print('not evidence')\n");

  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  const result = await runExtract({ matterRoot: root, dryRun: false });

  assert.equal(result.counts.totalFiles, 7);
  assert.equal(result.counts.extracted, 6);
  assert.equal(result.counts.skippedUnsupported, 1);
  assert.equal(result.counts.failed, 0);

  const logRows = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Extraction Log.csv"), "utf8"));
  assert.deepEqual(logRows.map((row) => row.status), [
    "extracted",
    "extracted",
    "extracted",
    "extracted",
    "extracted",
    "extracted",
    "skipped-unsupported-format",
  ]);
  assert.ok(logRows.some((row) => row.engine === "text-extract@1.0.0"));
  assert.ok(logRows.some((row) => row.engine === "rtf-extract@1.0.0"));
  assert.ok(logRows.some((row) => row.engine.startsWith("xlsx@")));
  assert.ok(logRows.some((row) => row.engine.startsWith("mailparser@")));
  assert.ok(logRows.some((row) => row.engine.startsWith("pdfjs-dist@")));
  assert.ok(logRows.some((row) => row.engine.startsWith("mammoth@")));

  const firstRecord = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "utf8"));
  assert.equal(firstRecord.schema_version, "extraction-record/v1");
  const rtfRecord = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0006.json"), "utf8"));
  assert.equal(rtfRecord.engine, "rtf-extract@1.0.0");
  assert.match(rtfRecord.pages[0].blocks.map((block) => block.text).join("\n"), /Possession delivered on 20 April 2026/);

  const cached = await runExtract({ matterRoot: root, dryRun: false });
  assert.equal(cached.counts.cached, 6);
});

test("extraction cache is keyed on file register sha256", async () => {
  const root = await makeMatterRoot();
  const filePath = await writeSource(root, "note.txt", "Cache me");
  const expected = createHash("sha256").update(await readFile(filePath)).digest("hex");
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });
  const record = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "utf8"));
  assert.equal(record.sha256, expected);
  const cached = await runExtract({ matterRoot: root, dryRun: false });
  assert.equal(cached.counts.cached, 1);
});

test("extract can use injected OCR provider for scanned PDFs while preserving page block citations", async () => {
  const root = await makeMatterRoot();
  await writeBlankPdf(await writeSource(root, "scanned-notice.pdf", ""));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  const calls = [];
  const result = await runExtract({
    matterRoot: root,
    dryRun: false,
    ocrProvider: async (packet) => {
      calls.push(packet);
      return {
        engine: "fake-mistral-ocr@1.0.0",
        pages: [
          {
            page: 1,
            markdown: "# LEGAL NOTICE\n\n**Possession notice** issued on 20 April 2026.\n\n- Reply within seven days.",
            confidence: 0.7,
            needs_review: false,
            warnings: ["smudged stamp"],
          },
        ],
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fileId, "FILE-0001");
  assert.equal(calls[0].pageCount, 1);
  assert.equal(result.counts.extracted, 1);
  assert.equal(result.counts.ocrRequiredFiles, 0);

  const record = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "utf8"));
  assert.equal(record.engine, "fake-mistral-ocr@1.0.0");
  assert.equal(record.pages[0].ocr_required, true);
  assert.equal(record.pages[0].needs_review, true);
  assert.deepEqual(record.pages[0].blocks.map((block) => block.id), ["p1.b1", "p1.b2", "p1.b3"]);
  assert.deepEqual(record.pages[0].blocks.map((block) => block.type), ["heading", "paragraph", "list_item"]);
  assert.equal(record.pages[0].blocks[0].text, "LEGAL NOTICE");
  assert.equal(record.pages[0].blocks[1].text, "Possession notice issued on 20 April 2026.");
  assert.equal(record.pages[0].blocks[2].text, "Reply within seven days.");

  const logRows = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Extraction Log.csv"), "utf8"));
  assert.equal(logRows[0].status, "extracted");
  assert.equal(logRows[0].engine, "fake-mistral-ocr@1.0.0");
  assert.equal(logRows[0].ocr_applied, "yes");
  assert.equal(logRows[0].ocr_provider_model, "fake-mistral-ocr@1.0.0");
  assert.equal(logRows[0].ocr_required_pages, "1");
  assert.equal(logRows[0].low_confidence_pages, "1");
  assert.equal(logRows[0].needs_review_pages, "1");
  assert.equal(logRows[0].provider_warnings_count, "1");

  const flatText = await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.txt"), "utf8");
  assert.match(flatText, /LEGAL NOTICE/);
  assert.doesNotMatch(flatText, /[#*]/);
});

test("extract keeps OCR-required status when injected OCR provider returns no usable text", async () => {
  const root = await makeMatterRoot();
  await writeBlankPdf(await writeSource(root, "empty-scan.pdf", ""));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  const result = await runExtract({
    matterRoot: root,
    dryRun: false,
    ocrProvider: async () => ({
      engine: "fake-empty-ocr@1.0.0",
      pages: [{ page: 1, markdown: "", confidence: 0.99 }],
    }),
  });

  assert.equal(result.counts.extracted, 1);
  assert.equal(result.counts.ocrRequiredFiles, 1);

  const logRows = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Extraction Log.csv"), "utf8"));
  assert.equal(logRows[0].status, "ocr-required-all");
  assert.match(logRows[0].notes, /OCR provider failed: OCR provider returned no usable text/);

  const record = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "utf8"));
  assert.equal(record.engine, PDF_ENGINE_FINGERPRINT);
  assert.equal(record.pages[0].ocr_required, true);
  assert.equal(record.pages[0].blocks.length, 0);
  assert.ok(record.warnings.some((warning) => warning.includes("OCR provider returned no usable text")));
});

test("extract OCRs mixed PDFs when only some pages lack a text layer", async () => {
  const root = await makeMatterRoot();
  await writeMixedPdf(await writeSource(root, "mixed-scan.pdf", ""));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  const calls = [];
  const result = await runExtract({
    matterRoot: root,
    dryRun: false,
    ocrProvider: async (packet) => {
      calls.push(packet);
      return {
        engine: "fake-mixed-ocr@1.0.0",
        pages: [
          { page: 1, markdown: "Text layer page one", confidence: 0.98 },
          { page: 2, markdown: "Scanned page two dated 10.05.2024.", confidence: 0.98 },
        ],
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].pageCount, 2);
  assert.equal(result.counts.ocrRequiredFiles, 0);

  const record = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "utf8"));
  assert.equal(record.engine, "fake-mixed-ocr@1.0.0");
  assert.equal(record.page_count, 2);
  assert.equal(record.pages[1].blocks[0].text, "Scanned page two dated 10.05.2024.");
});

test("extract invalidates cached weak OCR when repair provider is enabled", async () => {
  const root = await makeMatterRoot();
  await writeBlankPdf(await writeSource(root, "weak-scan.pdf", ""));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  await runExtract({
    matterRoot: root,
    dryRun: false,
    ocrProvider: async () => ({
      engine: "weak-ocr@1.0.0",
      pages: [{ page: 1, markdown: "Weak scan text", confidence: 0.6 }],
    }),
  });

  const calls = [];
  const repairProvider = async () => {
    calls.push("repair");
    return {
      engine: "strong-repair-ocr@1.0.0",
      pages: [{ page: 1, markdown: "Strong repair text dated 11.05.2024.", confidence: 0.97 }],
    };
  };
  repairProvider.repairsWeakOcr = true;

  const result = await runExtract({
    matterRoot: root,
    dryRun: false,
    ocrProvider: repairProvider,
  });

  assert.equal(calls.length, 1);
  assert.equal(result.counts.cached, 0);
  assert.equal(result.counts.extracted, 1);

  const record = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "utf8"));
  assert.equal(record.engine, "strong-repair-ocr@1.0.0");
  assert.equal(record.pages[0].needs_review, false);
});

test("extract invalidates cached suspicious OCR even when confidence was high", async () => {
  const root = await makeMatterRoot();
  await writeBlankPdf(await writeSource(root, "suspicious-scan.pdf", ""));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  await runExtract({
    matterRoot: root,
    dryRun: false,
    ocrProvider: async () => ({
      engine: "suspicious-ocr@1.0.0",
      pages: [{ page: 1, markdown: "Payment was due by $1.8.14.", confidence: 0.99 }],
    }),
  });

  const calls = [];
  const repairProvider = async () => {
    calls.push("repair");
    return {
      engine: "strong-repair-ocr@1.0.0",
      pages: [{ page: 1, markdown: "Payment was due by 31.8.14.", confidence: 0.98 }],
    };
  };
  repairProvider.repairsWeakOcr = true;

  const result = await runExtract({
    matterRoot: root,
    dryRun: false,
    ocrProvider: repairProvider,
  });

  assert.equal(calls.length, 1);
  assert.equal(result.counts.cached, 0);
  const record = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "utf8"));
  assert.equal(record.engine, "strong-repair-ocr@1.0.0");
  assert.equal(record.pages[0].blocks[0].text, "Payment was due by 31.8.14.");
});

test("extract preserves Extraction Log.csv row order with bounded concurrency", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "01-note.txt", "First");
  await writeSource(root, "02-note.txt", "Second");
  await writeSource(root, "03-note.txt", "Third");
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  await runExtract({ matterRoot: root, dryRun: false, concurrency: 3 });

  const logRows = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Extraction Log.csv"), "utf8"));
  assert.deepEqual(logRows.map((row) => row.file_id), ["FILE-0001", "FILE-0002", "FILE-0003"]);
  assert.deepEqual(logRows.map((row) => path.basename(row.source_path)), ["01-note.txt", "02-note.txt", "03-note.txt"]);
});

test("extract wires Mistral OCR only when the explicit env gate is enabled", async () => {
  const root = await makeMatterRoot();
  await writeBlankPdf(await writeSource(root, "gated-scan.pdf", ""));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  const withoutGate = await runExtract({
    matterRoot: root,
    dryRun: false,
    env: { MISTRAL_API_KEY: "test-mistral-key" },
    fetchImpl: async () => {
      throw new Error("fetch should not be called without gate");
    },
  });
  assert.equal(withoutGate.counts.ocrRequiredFiles, 1);

  const fetchCalls = [];
  const withGate = await runExtract({
    matterRoot: root,
    dryRun: false,
    env: {
      MISTRAL_OCR_ENABLED: "1",
      MISTRAL_API_KEY: "test-mistral-key",
    },
    fetchImpl: async (endpoint, init) => {
      fetchCalls.push({ endpoint, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () => ({
          pages: [{ index: 0, markdown: "# NOTICE\n\nOCR text from Mistral.", confidence_scores: { average: 0.88 } }],
        }),
      };
    },
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.model, "mistral-ocr-latest");
  assert.match(fetchCalls[0].body.document.document_url, /^data:application\/pdf;base64,/);
  assert.equal(withGate.counts.ocrRequiredFiles, 0);

  const record = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "utf8"));
  assert.equal(record.engine, "mistral-ocr-latest");
  assert.equal(record.pages[0].blocks[0].text, "NOTICE");
  assert.equal(record.pages[0].blocks[1].text, "OCR text from Mistral.");

  const logRows = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Extraction Log.csv"), "utf8"));
  assert.equal(logRows[0].status, "extracted");
  assert.equal(logRows[0].engine, "mistral-ocr-latest");
  assert.equal(logRows[0].ocr_applied, "yes");
  assert.equal(logRows[0].ocr_provider_model, "mistral-ocr-latest");
  assert.equal(logRows[0].low_confidence_pages, "0");
  assert.equal(logRows[0].needs_review_pages, "0");
});

test("extract fails clearly when Mistral OCR gate is enabled without a key", async () => {
  const root = await makeMatterRoot();
  await writeBlankPdf(await writeSource(root, "gated-scan-no-key.pdf", ""));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });

  await assert.rejects(
    () => runExtract({
      matterRoot: root,
      dryRun: false,
      env: { MISTRAL_OCR_ENABLED: "1" },
    }),
    /MISTRAL_API_KEY is required for Mistral OCR/,
  );
});
