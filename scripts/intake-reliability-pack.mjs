#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { runExtract } from "../extract-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { buildIntakeAttentionItems } from "../services/matter-attention-intake.mjs";
import { classifyWorkspacePreview } from "../shared/workspace-preview-policy.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "intake-reliability-pack/v1";

export function parseIntakeReliabilityPackArgs(argv = []) {
  const parsed = {
    outDir: path.resolve(".local", "intake-reliability-packs"),
    timestamp: "",
    keepFixture: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a value");
      parsed.outDir = path.resolve(value);
      i += 1;
    } else if (arg === "--timestamp") {
      const value = argv[i + 1];
      if (!value) throw new Error("--timestamp requires a value");
      parsed.timestamp = value;
      i += 1;
    } else if (arg === "--keep-fixture") {
      parsed.keepFixture = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runIntakeReliabilityPack({
  outDir = path.resolve(".local", "intake-reliability-packs"),
  timestamp = new Date().toISOString(),
  keepFixture = false,
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const packDir = path.join(outDir, `intake-reliability-pack-${slug}`);
  await mkdir(packDir, { recursive: true });

  const fixture = await createRepresentativeMatterFixture({ generatedAt });
  const extraction = await runExtract({
    matterRoot: fixture.matterRoot,
    dryRun: false,
    forceRefresh: true,
    ocrProvider: createFixtureOcrProvider(),
    concurrency: 1,
  });
  const attentionItems = await buildIntakeAttentionItems({
    root: fixture.matterRoot,
    matterStore: {
      listIntakeFolders: async (root) => listIntakeFolders(root),
    },
  });
  const supportMatrix = buildSupportMatrix({
    filesSeen: fixture.filesSeen,
    extraction,
    attentionItems,
  });

  const result = {
    schemaVersion: SCHEMA_VERSION,
    success: extraction.counts.failed === 0,
    generatedAt,
    fixtureRoot: keepFixture ? fixture.matterRoot : "",
    filesSeen: fixture.filesSeen,
    extraction: {
      counts: extraction.counts,
      perIntake: extraction.perIntake,
    },
    advisory: summarizeAdvisory(attentionItems),
    supportMatrix,
    runtimeDbCompatibility: {
      status: "covered_by_existing_runtime_db_tests",
      checkedBy: [
        "test/runtime-db-api.test.mjs",
        "test/runtime-db-storage-service.test.mjs",
        "npm run db:runtime:write-smoke",
      ],
      summary: "Runtime DB storage mode already covers upload, add-files, extraction, preparation, workspace reads, raw-file reads, and DB-native workflow persistence through dedicated tests and the runtime write smoke.",
    },
  };
  result.files = await writePackEvidence({ result, packDir });
  return result;
}

export function renderIntakeReliabilityPackResult(result = {}) {
  const lines = [
    "Matter Workbench intake reliability pack",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `files_seen: ${result.filesSeen?.length || 0}`,
    `extracted: ${result.extraction?.counts?.extracted || 0}`,
    `skipped_unsupported: ${result.extraction?.counts?.skippedUnsupported || 0}`,
    `failed: ${result.extraction?.counts?.failed || 0}`,
  ];
  for (const entry of result.supportMatrix || []) {
    lines.push(`${entry.key}: ${entry.status}`);
  }
  if (result.files?.markdown) lines.push(`evidence_md: ${result.files.markdown}`);
  if (result.files?.json) lines.push(`evidence_json: ${result.files.json}`);
  return lines;
}

export function renderSupportMatrixMarkdown(entries = []) {
  const lines = [
    "| Area | Status | Evidence | Action |",
    "|---|---|---|---|",
  ];
  for (const entry of entries) {
    lines.push(`| ${escapeTable(entry.label)} | ${escapeTable(entry.status)} | ${escapeTable(entry.evidence)} | ${escapeTable(entry.action)} |`);
  }
  return lines;
}

async function createRepresentativeMatterFixture({ generatedAt }) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-intake-reliability-fixture-"));
  const matterRoot = path.join(tmp, "Intake Reliability Fixture");
  const sourceDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files");
  await mkdir(sourceDir, { recursive: true });

  const files = [
    ["01-text-layer.pdf", async (target) => writeSimplePdf(target, "Notice dated 15 May 2026")],
    ["02-low-confidence-scan.pdf", async (target) => writeBlankPdf(target)],
    ["client-email.eml", async (target) => writeFile(target, buildFixtureEmail(), "utf8")],
    ["ledger.csv", async (target) => writeFile(target, "Date,Event,Amount\n2026-05-01,Demand notice,1000\n", "utf8")],
    ["calculation.xlsx", async (target) => writeFixtureXlsx(target)],
    ["whatsapp-export.txt", async (target) => writeFile(target, "01/05/2026, 10:10 - Client: Please send the possession letter.\n", "utf8")],
    ["chat-screenshot.png", async (target) => writeFile(target, Buffer.from("89504e470d0a1a0a", "hex"))],
    ["whatsapp-export.zip", async (target) => writeFile(target, Buffer.from("504b0304", "hex"))],
    ["outlook-message.msg", async (target) => writeFile(target, "fake msg payload", "utf8")],
  ];

  for (const [name, writer] of files) {
    await writer(path.join(sourceDir, name));
  }

  await runMatterInit({
    matterRoot,
    dryRun: false,
    metadata: {
      clientName: "Reliability Client",
      matterName: "Intake Reliability Fixture",
      oppositeParty: "Reliability Opposite",
      matterType: "Consumer Dispute",
      jurisdiction: "India",
      briefDescription: "Disposable fixture for Matter Workbench intake reliability checks.",
    },
    extractedAt: generatedAt,
  });

  return {
    matterRoot,
    filesSeen: await Promise.all(files.map(async ([name]) => ({
      name,
      sha256: sha256(await readFile(path.join(sourceDir, name))),
    }))),
  };
}

function createFixtureOcrProvider() {
  return async function fixtureOcrProvider({ sourcePath }) {
    const lowConfidence = /low-confidence/i.test(sourcePath);
    return {
      engine: lowConfidence ? "fixture-gemini-repair@quality-warning" : "fixture-mistral-primary@ocr-first",
      pipeline: {
        primary: "fixture-mistral-primary",
        repair: lowConfidence ? "fixture-gemini-repair" : "",
        repair_status: lowConfidence ? "used" : "not_needed",
        repair_reason: lowConfidence ? "low confidence fixture scan" : "",
      },
      pages: [{
        page: 1,
        confidence: lowConfidence ? 0.62 : 0.98,
        needs_review: lowConfidence,
        warnings: lowConfidence ? ["fixture low confidence scan"] : [],
        blocks: [{
          type: "paragraph",
          text: lowConfidence
            ? "OCR repair text from a weak scan requiring lawyer review."
            : "OCR-first text from a readable PDF source.",
        }],
      }],
    };
  };
}

function buildSupportMatrix({ filesSeen, extraction, attentionItems }) {
  const rows = extraction.fileResults || [];
  const find = (name) => rows.find((row) => row.original_name === name) || {};
  const hasAttention = (code) => attentionItems.some((item) => item.code === code);
  const preview = (name, sizeBytes = 1024) => classifyWorkspacePreview({ relativePath: `00_Inbox/Intake 01 - Initial/Originals/${name}`, sizeBytes });

  return [
    {
      key: "pdf_text_layer",
      label: "PDF with text layer",
      status: find("01-text-layer.pdf").status === "extracted" ? "supported" : "needs_review",
      evidence: `${find("01-text-layer.pdf").engine || "unknown"} via OCR-first PDF path; preview kind ${preview("01-text-layer.pdf").previewKind}.`,
      action: "Use normally, while preserving OCR/advisory warnings if they appear.",
    },
    {
      key: "pdf_low_confidence_scan",
      label: "Weak scanned PDF",
      status: hasAttention("ocr_low_confidence") ? "supported_needs_review" : "supported",
      evidence: hasAttention("ocr_low_confidence") ? "OCR output needs review advisory was produced." : "OCR completed without review advisory.",
      action: "Compare OCR against the scan or ask the client for cleaner copies before relying on source-backed outputs.",
    },
    {
      key: "eml_email",
      label: "EML email",
      status: find("client-email.eml").status === "extracted" ? "supported" : "needs_review",
      evidence: `${find("client-email.eml").engine || "unknown"} extracts headers and body; attachments are listed, not extracted as separate source files.`,
      action: "Use email body as source text; separately upload material attachments.",
    },
    {
      key: "csv_spreadsheet",
      label: "CSV spreadsheet",
      status: "supported_needs_review",
      evidence: `${find("ledger.csv").engine || "unknown"} flattens rows into table_row blocks and marks spreadsheet pages for review.`,
      action: "Use for simple date/amount rows; lawyer should inspect structure before relying on calculations.",
    },
    {
      key: "xlsx_spreadsheet",
      label: "XLSX spreadsheet",
      status: "supported_needs_review",
      evidence: `${find("calculation.xlsx").engine || "unknown"} reads sheets and rows, but does not yet understand formulas, hidden rows, or visual grouping.`,
      action: "Treat as an ingestion baseline; park deeper spreadsheet intelligence for a future slice.",
    },
    {
      key: "whatsapp_text_export",
      label: "WhatsApp text export",
      status: find("whatsapp-export.txt").status === "extracted" ? "supported_limited" : "needs_review",
      evidence: `${find("whatsapp-export.txt").engine || "unknown"} reads the export as plain text, not as a structured chat transcript.`,
      action: "Use for simple source text; do not treat sender/time parsing as confirmed structured evidence yet.",
    },
    {
      key: "image_screenshot",
      label: "Images and screenshots",
      status: "preserved_only",
      evidence: `Image preview kind is ${preview("chat-screenshot.png").previewKind}; extraction status is ${find("chat-screenshot.png").status || "not extracted"}.`,
      action: "Ask for text exports or better source documents; screenshot OCR/vision remains parked.",
    },
    {
      key: "whatsapp_zip_export",
      label: "WhatsApp zip export",
      status: "preserved_only",
      evidence: `Archive extraction status is ${find("whatsapp-export.zip").status || "not extracted"}.`,
      action: "Ask for an exported chat text file or manually unpack/upload material files.",
    },
    {
      key: "outlook_msg",
      label: "Outlook MSG email",
      status: "preserved_only",
      evidence: `MSG extraction status is ${find("outlook-message.msg").status || "not extracted"}.`,
      action: "Ask for EML export or upload the email body/attachments separately.",
    },
  ];
}

function summarizeAdvisory(items = []) {
  return {
    blockers: items.filter((item) => item.severity === "blocker").length,
    warnings: items.filter((item) => item.severity === "warning").length,
    codes: items.map((item) => item.code),
    titles: items.map((item) => item.title),
  };
}

async function writePackEvidence({ result, packDir }) {
  const jsonPath = path.join(packDir, "intake-reliability-pack.json");
  const markdownPath = path.join(packDir, "intake-reliability-pack.md");
  const evidence = {
    schemaVersion: result.schemaVersion,
    generatedAt: result.generatedAt,
    success: result.success,
    fixtureRoot: result.fixtureRoot,
    extraction: result.extraction,
    advisory: result.advisory,
    filesSeen: result.filesSeen,
    supportMatrix: result.supportMatrix,
    runtimeDbCompatibility: result.runtimeDbCompatibility,
  };
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderPackMarkdown(evidence).join("\n")}\n`, "utf8");
  return {
    json: jsonPath,
    markdown: markdownPath,
  };
}

function renderPackMarkdown(evidence = {}) {
  return [
    "# Matter Workbench Intake Reliability Pack",
    "",
    `Generated at: ${evidence.generatedAt || ""}`,
    `Success: ${evidence.success ? "yes" : "no"}`,
    "",
    "This pack runs a disposable representative intake and records what Matter Workbench can safely ingest today. It is not a product feature and does not mutate real matters.",
    "",
    "## Support Matrix",
    "",
    ...renderSupportMatrixMarkdown(evidence.supportMatrix || []),
    "",
    "## Preparation Advisory Expectations",
    "",
    `- Blockers: ${evidence.advisory?.blockers || 0}`,
    `- Warnings: ${evidence.advisory?.warnings || 0}`,
    `- Codes: ${(evidence.advisory?.codes || []).join(", ") || "(none)"}`,
    "",
    "## Runtime DB Compatibility",
    "",
    evidence.runtimeDbCompatibility?.summary || "",
    "",
    "Checked by:",
    ...((evidence.runtimeDbCompatibility?.checkedBy || []).map((item) => `- ${item}`)),
  ];
}

async function listIntakeFolders(root) {
  const inbox = path.join(root, "00_Inbox");
  const entries = await readdir(inbox, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && /^Intake \d+/i.test(entry.name))
    .map((entry) => ({ name: entry.name }));
}

async function writeFixtureXlsx(target) {
  const xlsx = await import("xlsx");
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([
    ["Date", "Event", "Amount"],
    ["2026-05-02", "Payment made", 2500],
    ["2026-05-03", "Possession delayed", ""],
  ]);
  xlsx.utils.book_append_sheet(workbook, sheet, "Calculation");
  await writeFile(target, xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

function buildFixtureEmail() {
  return [
    "From: Client <client@example.com>",
    "To: Lawyer <lawyer@example.com>",
    "Subject: Updated calculation sheets",
    "Date: Fri, 1 May 2026 10:00:00 +0530",
    "Message-ID: <fixture-email@example.com>",
    "",
    "Please see the updated calculation sheets and the demand notice chronology.",
    "",
  ].join("\n");
}

async function writeSimplePdf(filePath, text) {
  const escaped = String(text || "Hello PDF").replace(/[()\\]/g, " ");
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
<< /Length ${escaped.length + 33} >>
stream
BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET
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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

async function main() {
  const args = parseIntakeReliabilityPackArgs(process.argv.slice(2));
  const result = await runIntakeReliabilityPack(args);
  for (const line of renderIntakeReliabilityPackResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
