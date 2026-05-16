import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildMatterContextPacket,
  MATTER_CONTEXT_PACKET_SCHEMA_VERSION,
  MATTER_CONTEXT_SEARCH_SCHEMA_VERSION,
  searchMatterContextPacket,
  summarizeMatterContextPacket,
} from "../services/matter-context-service.mjs";
import { toCsv } from "../shared/csv.mjs";

const HASH_ONE = "1".repeat(64);
const HASH_TWO = "2".repeat(64);

async function makeMatterRoot(name = "Mehta vs Skyline") {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-context-test-"));
  const root = path.join(tmp, name);
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), `${JSON.stringify({
    matter_name: "Mehta vs Skyline",
    client_name: "Rohan Mehta",
    opposite_party: "Skyline Developers Pvt Ltd",
    matter_type: "consumer dispute",
    jurisdiction: "India",
    brief_description: "Context packet fixture",
    intakes: [
      {
        intake_id: "INTAKE-01",
        intake_dir: "00_Inbox/Intake 01 - Initial",
      },
    ],
  }, null, 2)}\n`);
  return root;
}

async function writeRegister(root, rows) {
  await writeFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
    toCsv(rows, [
      "file_id",
      "intake_id",
      "source_path",
      "original_path",
      "working_copy_path",
      "category",
      "original_name",
      "sha256",
      "size_bytes",
      "duplicate_of",
      "status",
    ]),
  );
}

async function writeExtractionRecord(root, record) {
  await writeFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", `${record.file_id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

function extractionRecord({
  fileId = "FILE-0001",
  sha256 = HASH_ONE,
  sourcePath = "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__notice.pdf",
  blocks = [
    "Agreement was signed on 20 April 2026.",
    "Skyline acknowledged the complaint on 14 March 2024.",
  ],
} = {}) {
  return {
    schema_version: "extraction-record/v1",
    file_id: fileId,
    sha256,
    source_path: sourcePath,
    engine: "pdfjs-dist@4.10.38",
    extracted_at: "2026-05-11T10:00:00.000Z",
    language_detected: ["en"],
    page_count: 1,
    pages: [
      {
        page: 1,
        ocr_required: false,
        confidence_avg: 0.98,
        needs_review: false,
        blocks: blocks.map((text, index) => ({
          id: `p1.b${index + 1}`,
          type: "paragraph",
          text,
        })),
      },
    ],
    warnings: [],
  };
}

async function writeSourceIndex(root, sources) {
  await writeFile(
    path.join(root, "10_Library", "Source Index.json"),
    `${JSON.stringify({
      schema_version: "source-index/v1",
      generated_at: "2026-05-11T11:00:00.000Z",
      sources,
      ai_run: {
        provider: "openrouter",
        model: "meta-llama/llama-3.3-70b-instruct",
        returnedProvider: "akashml/fp8",
      },
    }, null, 2)}\n`,
  );
}

async function writeListOfDates(root) {
  await writeFile(
    path.join(root, "10_Library", "List of Dates.json"),
    `${JSON.stringify({
      schema_version: "list-of-dates/v1",
      generated_at: "2026-05-11T12:00:00.000Z",
      entries: [
        {
          date_iso: "2026-04-20",
          event: "Agreement was signed.",
          citation: "FILE-0001 p1.b1",
        },
      ],
      ai_run: {
        provider: "openrouter",
        model: "openai/gpt-4.1",
        returnedProvider: "Friendli",
        usage: {
          totalTokens: 1200,
          cost: 0.012,
        },
      },
    }, null, 2)}\n`,
  );
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# List of Dates\n\n| Date | Event |\n");
}

test("matter context packet includes source-labeled extraction blocks and selected library summaries", async () => {
  const root = await makeMatterRoot();
  const sourcePath = "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__notice.pdf";
  await writeRegister(root, [
    {
      file_id: "FILE-0001",
      intake_id: "INTAKE-01",
      source_path: "00_Inbox/Intake 01 - Initial/Source Files/notice.pdf",
      original_path: "00_Inbox/Intake 01 - Initial/Originals/FILE-0001__notice.pdf",
      working_copy_path: sourcePath,
      category: "PDFs",
      original_name: "notice.pdf",
      sha256: HASH_ONE,
      size_bytes: "128",
      duplicate_of: "",
      status: "unique",
    },
  ]);
  await writeExtractionRecord(root, extractionRecord({ sourcePath }));
  await writeSourceIndex(root, [
    {
      file_id: "FILE-0001",
      sha256: HASH_ONE,
      source_id: "FILE-0001",
      content_hash: HASH_ONE,
      source_path: sourcePath,
      display_label: "Legal Notice from Mehta to Skyline, 20 April 2026",
      short_label: "Legal notice, 20 Apr 2026",
      suggested_label: "Legal Notice from Mehta to Skyline, 20 April 2026",
      confirmed_label: "Confirmed Legal Notice dated 20 April 2026",
      label_status: "confirmed",
      document_type: "legal_notice",
      document_date: "2026-04-20",
      needs_review: false,
    },
  ]);
  await writeListOfDates(root);

  const packet = await buildMatterContextPacket(root, {
    generatedAt: "2026-05-12T00:00:00.000Z",
  });

  assert.equal(packet.schema_version, MATTER_CONTEXT_PACKET_SCHEMA_VERSION);
  assert.equal(packet.generated_at, "2026-05-12T00:00:00.000Z");
  assert.equal(packet.matter.client_name, "Rohan Mehta");
  assert.equal(packet.file_registers.length, 1);
  assert.equal(packet.file_registers[0].rows[0].file_id, "FILE-0001");
  assert.equal(packet.sources.length, 1);
  assert.equal(packet.sources[0].source_id, "FILE-0001");
  assert.equal(packet.sources[0].content_hash, HASH_ONE);
  assert.equal(packet.sources[0].source_label, "Confirmed Legal Notice dated 20 April 2026");
  assert.equal(packet.sources[0].source_short_label, "Confirmed Legal Notice dated 20 April 2026");
  assert.equal(packet.sources[0].document_type, "legal_notice");
  assert.deepEqual(packet.sources[0].sample_citations, ["FILE-0001 p1.b1", "FILE-0001 p1.b2"]);
  assert.equal(packet.evidence_blocks.length, 2);
  assert.deepEqual(packet.evidence_blocks.map((block) => block.citation), [
    "FILE-0001 p1.b1",
    "FILE-0001 p1.b2",
  ]);
  assert.equal(packet.evidence_blocks[0].source_label, "Confirmed Legal Notice dated 20 April 2026");
  assert.ok(packet.library_artifacts.some((artifact) => artifact.path === "10_Library/List of Dates.json"));
  assert.ok(packet.library_artifacts.some((artifact) => artifact.path === "10_Library/List of Dates.md"));
  assert.equal(packet.library_artifacts.find((artifact) => artifact.kind === "list_of_dates").ai_run.model, "openai/gpt-4.1");

  const summary = summarizeMatterContextPacket(packet);
  assert.equal(summary.schema_version, "matter-context-preview/v1");
  assert.equal(summary.counts.sources, 1);
  assert.equal(summary.counts.evidence_blocks_included, 2);
  assert.equal(summary.top_sources[0].source_short_label, "Confirmed Legal Notice dated 20 April 2026");
  assert.deepEqual(summary.top_sources[0].sample_citations, ["FILE-0001 p1.b1", "FILE-0001 p1.b2"]);
  assert.doesNotMatch(JSON.stringify(summary), /Agreement was signed on 20 April 2026/);
});

test("matter context search returns source labels, snippets, and raw citations from bounded packet", async () => {
  const root = await makeMatterRoot();
  const sourcePath = "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__notice.pdf";
  await writeRegister(root, [
    {
      file_id: "FILE-0001",
      intake_id: "INTAKE-01",
      source_path: "00_Inbox/Intake 01 - Initial/Source Files/notice.pdf",
      original_path: "00_Inbox/Intake 01 - Initial/Originals/FILE-0001__notice.pdf",
      working_copy_path: sourcePath,
      category: "PDFs",
      original_name: "notice.pdf",
      sha256: HASH_ONE,
      size_bytes: "128",
      duplicate_of: "",
      status: "unique",
    },
  ]);
  await writeExtractionRecord(root, extractionRecord({
    sourcePath,
    blocks: [
      "Agreement was signed on 20 April 2026.",
      "Skyline acknowledged the complaint on 14 March 2024 after receiving the legal notice.",
    ],
  }));
  await writeSourceIndex(root, [
    {
      file_id: "FILE-0001",
      sha256: HASH_ONE,
      source_path: sourcePath,
      display_label: "Legal Notice from Mehta to Skyline, 20 April 2026",
      short_label: "Legal notice, 20 Apr 2026",
      document_type: "legal_notice",
      document_date: "2026-04-20",
      needs_review: false,
    },
  ]);

  const packet = await buildMatterContextPacket(root);
  const result = searchMatterContextPacket(packet, "legal notice", {
    searchedAt: "2026-05-12T10:00:00.000Z",
    snippetChars: 80,
  });

  assert.equal(result.schema_version, MATTER_CONTEXT_SEARCH_SCHEMA_VERSION);
  assert.equal(result.searched_at, "2026-05-12T10:00:00.000Z");
  assert.equal(result.query, "legal notice");
  assert.equal(result.counts.searched_blocks, 2);
  assert.equal(result.counts.matches, 2);
  assert.equal(result.counts.sources, 1);
  assert.deepEqual(result.results.map((match) => match.citation), ["FILE-0001 p1.b1", "FILE-0001 p1.b2"]);
  assert.equal(result.results[0].source_short_label, "Legal notice, 20 Apr 2026");
  assert.equal(result.results[0].document_type, "legal_notice");
  assert.match(result.results[1].snippet, /legal notice/i);
  assert.ok(result.results.every((match) => match.snippet.length <= 85));
});

test("matter context search rejects empty queries clearly", async () => {
  assert.throws(
    () => searchMatterContextPacket({ evidence_blocks: [] }, "   "),
    /Search query is required/,
  );
});

test("matter context packet does not read excluded secrets, raw files, logs, binaries, or prior chat", async () => {
  const root = await makeMatterRoot();
  await writeRegister(root, []);
  await writeFile(path.join(root, ".env"), "OPENROUTER_API_KEY=secret-context-key\n");
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files", "raw.pdf"), "raw pdf bytes that should not be read");
  await writeFile(path.join(root, "10_Library", "provider.log"), "provider log secret");
  await mkdir(path.join(root, "20_Workshop"), { recursive: true });
  await writeFile(path.join(root, "20_Workshop", "prior-chat.md"), "previous chat transcript");
  await writeFile(path.join(root, "archive.zip"), "binary archive content");

  const packet = await buildMatterContextPacket(root, {
    generatedAt: "2026-05-12T00:00:00.000Z",
  });
  const serialized = JSON.stringify(packet);

  assert.doesNotMatch(serialized, /secret-context-key/);
  assert.doesNotMatch(serialized, /raw pdf bytes/);
  assert.doesNotMatch(serialized, /provider log secret/);
  assert.doesNotMatch(serialized, /previous chat transcript/);
  assert.doesNotMatch(serialized, /binary archive content/);
  assert.deepEqual(packet.sources, []);
  assert.deepEqual(packet.evidence_blocks, []);
});

test("matter context packet handles missing Source Index without dropping raw citations", async () => {
  const root = await makeMatterRoot();
  const sourcePath = "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt";
  await writeRegister(root, [
    {
      file_id: "FILE-0001",
      intake_id: "INTAKE-01",
      source_path: sourcePath,
      original_path: sourcePath,
      working_copy_path: sourcePath,
      category: "Text Notes",
      original_name: "facts.txt",
      sha256: HASH_ONE,
      size_bytes: "64",
      duplicate_of: "",
      status: "unique",
    },
  ]);
  await writeExtractionRecord(root, extractionRecord({ sourcePath }));

  const packet = await buildMatterContextPacket(root);

  assert.equal(packet.sources[0].source_label, "");
  assert.equal(packet.sources[0].source_short_label, "");
  assert.equal(packet.evidence_blocks[0].citation, "FILE-0001 p1.b1");
  assert.equal(packet.evidence_blocks[0].source_label, "");
  const summary = summarizeMatterContextPacket(packet);
  assert.equal(summary.source_index_present, false);
  assert.ok(summary.warnings.some((warning) => warning.includes("Source Index.json not found")));
});

test("matter context packet bounds source and block counts deterministically", async () => {
  const root = await makeMatterRoot();
  const firstPath = "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__first.txt";
  const secondPath = "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0002__second.txt";
  await writeRegister(root, [
    {
      file_id: "FILE-0001",
      intake_id: "INTAKE-01",
      source_path: firstPath,
      original_path: firstPath,
      working_copy_path: firstPath,
      category: "Text Notes",
      original_name: "first.txt",
      sha256: HASH_ONE,
      size_bytes: "64",
      duplicate_of: "",
      status: "unique",
    },
    {
      file_id: "FILE-0002",
      intake_id: "INTAKE-01",
      source_path: secondPath,
      original_path: secondPath,
      working_copy_path: secondPath,
      category: "Text Notes",
      original_name: "second.txt",
      sha256: HASH_TWO,
      size_bytes: "64",
      duplicate_of: "",
      status: "unique",
    },
  ]);
  await writeExtractionRecord(root, extractionRecord({
    sourcePath: firstPath,
    blocks: [
      "First long block should be truncated predictably.",
      "Second long block should be truncated predictably.",
      "Third long block should be omitted by the block limit.",
    ],
  }));
  await writeExtractionRecord(root, extractionRecord({
    fileId: "FILE-0002",
    sha256: HASH_TWO,
    sourcePath: secondPath,
    blocks: ["This source should be omitted by the source limit."],
  }));

  const packet = await buildMatterContextPacket(root, {
    maxSources: 1,
    maxBlocks: 2,
    maxCharsPerBlock: 10,
  });

  assert.deepEqual(packet.sources.map((source) => source.file_id), ["FILE-0001"]);
  assert.deepEqual(packet.evidence_blocks.map((block) => block.citation), [
    "FILE-0001 p1.b1",
    "FILE-0001 p1.b2",
  ]);
  assert.equal(packet.evidence_blocks[0].text, "First long");
  assert.equal(packet.limits.omitted_sources, 1);
  assert.equal(packet.limits.omitted_blocks, 1);
  assert.ok(packet.warnings.some((warning) => warning.includes("Omitted 1 source record")));
  assert.ok(packet.warnings.some((warning) => warning.includes("Omitted 1 evidence block")));
  assert.ok(packet.warnings.some((warning) => warning.includes("Truncated 2 evidence block")));
});
