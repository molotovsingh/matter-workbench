import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runExtract } from "../extract-engine.mjs";
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
  const matterJson = JSON.parse(await readFile(path.join(root, "matter.json"), "utf8"));
  assert.equal(Array.isArray(matterJson.intakes), true);
  assert.equal(matterJson.intakes[0].intake_id, "INTAKE-01");
});

test("extract creates records for PDF, DOCX, spreadsheet, EML, and text while logging unsupported files", async () => {
  const root = await makeMatterRoot();
  await writeSource(root, "01-note.txt", "Plain text paragraph.\n\nSecond paragraph.");
  await writeSource(root, "02-data.csv", "Date,Event\n2026-04-20,Agreement signed\n");
  await writeSource(root, "03-mail.eml", "From: client@example.com\nTo: lawyer@example.com\nSubject: Facts\n\nEmail body.");
  await writeSimplePdf(await writeSource(root, "04-simple.pdf", ""));
  await writeSimpleDocx(await writeSource(root, "05-simple.docx", ""));
  await writeSource(root, "06-script.py", "print('not evidence')\n");

  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  const result = await runExtract({ matterRoot: root, dryRun: false });

  assert.equal(result.counts.totalFiles, 6);
  assert.equal(result.counts.extracted, 5);
  assert.equal(result.counts.skippedUnsupported, 1);
  assert.equal(result.counts.failed, 0);

  const logRows = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Extraction Log.csv"), "utf8"));
  assert.deepEqual(logRows.map((row) => row.status), [
    "extracted",
    "extracted",
    "extracted",
    "extracted",
    "extracted",
    "skipped-unsupported-format",
  ]);
  assert.ok(logRows.some((row) => row.engine === "text-extract@1.0.0"));
  assert.ok(logRows.some((row) => row.engine.startsWith("xlsx@")));
  assert.ok(logRows.some((row) => row.engine.startsWith("mailparser@")));
  assert.ok(logRows.some((row) => row.engine.startsWith("pdfjs-dist@")));
  assert.ok(logRows.some((row) => row.engine.startsWith("mammoth@")));

  const firstRecord = JSON.parse(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "utf8"));
  assert.equal(firstRecord.schema_version, "extraction-record/v1");

  const cached = await runExtract({ matterRoot: root, dryRun: false });
  assert.equal(cached.counts.cached, 5);
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
