import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSourceBlocks,
  chunkBlocks,
  createSourceSnapshot,
  filterChronologyCandidateBlocks,
  getIntakes,
  readSourceIndex,
  withSourceLabels,
} from "../listofdates/source-records.mjs";

test("List of Dates source records normalize intakes and AI-safe source blocks", () => {
  const intakes = getIntakes({
    phase_1_intake: {
      intake_dir: "00_Inbox/Intake 01 - Initial",
    },
  });
  assert.deepEqual(intakes, [
    {
      intake_id: "INTAKE-01",
      intake_dir: "00_Inbox/Intake 01 - Initial",
    },
  ]);

  const longText = "A".repeat(2900);
  const blocks = buildSourceBlocks(
    [
      {
        file_id: "FILE-0001",
        source_path: "00_Inbox/Originals/Notice.pdf",
        engine: "mistral-ocr",
        sha256: "hash-1",
        pages: [
          {
            page: 1,
            confidence_avg: 0.71,
            needs_review: true,
            blocks: [
              { id: "p1.b1", type: "paragraph", text: longText },
              { id: "p1.b2", text: "   " },
            ],
          },
        ],
      },
    ],
    new Map([["FILE-0001", { original_name: "Client Notice.pdf", category: "notice" }]]),
  );

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].citation, "FILE-0001 p1.b1");
  assert.equal(blocks[0].original_name, "Client Notice.pdf");
  assert.equal(blocks[0].category, "notice");
  assert.equal(blocks[0].confidence, 0.71);
  assert.equal(blocks[0].needs_review, true);
  assert.match(blocks[0].text, /\[block truncated for AI input\]$/);
});

test("List of Dates source records chunk source blocks by input size", () => {
  const chunks = chunkBlocks([
    { citation: "FILE-0001 p1.b1", text: "A".repeat(17900) },
    { citation: "FILE-0002 p1.b1", text: "B".repeat(200) },
  ]);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0][0].citation, "FILE-0001 p1.b1");
  assert.equal(chunks[1][0].citation, "FILE-0002 p1.b1");
});

test("List of Dates source records read current Source Index labels and reject stale rows", async () => {
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "mwb-lod-source-"));
  await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });
  await writeFile(path.join(matterRoot, "10_Library", "Source Index.json"), `${JSON.stringify({
    schema_version: "source-index/v1",
    sources: [
      {
        file_id: "FILE-0001",
        source_id: "src_1",
        sha256: "hash-1",
        source_path: "00_Inbox/Originals/Notice.pdf",
        display_label: "Draft label",
        short_label: "Notice",
        confirmed_label: "Confirmed Notice",
        label_status: "confirmed",
        content_hash: "content-1",
        document_type: "notice",
        document_date: "2026-05-01",
        label_revision: 3,
      },
      {
        file_id: "FILE-0002",
        source_id: "src_2",
        sha256: "old-hash",
        source_path: "00_Inbox/Originals/Stale.pdf",
        display_label: "Stale Source",
      },
    ],
  })}\n`);

  const sourceIndex = await readSourceIndex(matterRoot, [
    {
      file_id: "FILE-0001",
      sha256: "hash-1",
      source_path: "00_Inbox/Originals/Notice.pdf",
    },
    {
      file_id: "FILE-0002",
      sha256: "new-hash",
      source_path: "00_Inbox/Originals/Stale.pdf",
    },
  ]);

  assert.equal(sourceIndex.size, 1);
  assert.deepEqual(sourceIndex.get("FILE-0001"), {
    source_id: "src_1",
    content_hash: "content-1",
    document_type: "notice",
    document_date: "2026-05-01",
    needs_review: false,
    label_status: "confirmed",
    label_revision: 3,
    display_label: "Confirmed Notice",
    short_label: "Confirmed Notice",
    source_label: "Confirmed Notice",
    source_short_label: "Confirmed Notice",
  });
});

test("List of Dates source records filter meta sources and build stable source snapshots", () => {
  const sourceIndex = new Map([
    ["FILE-0002", {
      source_id: "src_2",
      content_hash: "hash-2",
      source_label: "Bundle Index",
      source_short_label: "Index",
      document_type: "manifest",
      label_revision: 2,
    }],
    ["FILE-0001", {
      source_id: "src_1",
      content_hash: "hash-1",
      source_label: "Demand Notice",
      source_short_label: "Notice",
      document_type: "notice",
      needs_review: true,
      label_status: "needs_review",
    }],
  ]);

  const labeled = withSourceLabels([
    { file_id: "FILE-0001", citation: "FILE-0001 p1.b1", original_name: "Demand.pdf" },
    { file_id: "FILE-0002", citation: "FILE-0002 p1.b1", original_name: "Index.pdf" },
  ], sourceIndex);
  const chronologyBlocks = filterChronologyCandidateBlocks(labeled, sourceIndex);

  assert.equal(labeled[0].source_label, "Demand Notice");
  assert.deepEqual(chronologyBlocks.map((block) => block.file_id), ["FILE-0001"]);
  assert.deepEqual(createSourceSnapshot(sourceIndex).map((source) => source.file_id), ["FILE-0001", "FILE-0002"]);
});
