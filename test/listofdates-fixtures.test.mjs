import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseCsv } from "../shared/csv.mjs";
import {
  fileIdForOriginalName,
  lawyerFields,
  prepareExtractedMatter,
  readExtractionRecord,
  writeSourceIndex,
} from "../test-support/listofdates-fixtures.mjs";

test("List of Dates fixture helper prepares a minimal extracted matter", async () => {
  const root = await prepareExtractedMatter();

  await stat(path.join(root, "matter.json"));
  await stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"));

  const fileId = await fileIdForOriginalName(root, "facts.txt");
  assert.equal(fileId, "FILE-0001");

  const record = await readExtractionRecord(root, fileId);
  assert.equal(record.file_id, "FILE-0001");
  assert.match(record.source_path, /facts\.txt$/);
  assert.ok(record.pages.some((page) => page.blocks.some((block) => /Agreement was signed/.test(block.text))));
});

test("List of Dates fixture helper writes source indexes and lawyer defaults", async () => {
  const root = await prepareExtractedMatter();
  const record = await readExtractionRecord(root);

  await writeSourceIndex(root, [
    {
      file_id: record.file_id,
      sha256: record.sha256,
      source_path: record.source_path,
      display_label: "Agreement note",
      short_label: "Agreement",
    },
  ]);

  const sourceIndex = JSON.parse(await readFile(path.join(root, "10_Library", "Source Index.json"), "utf8"));
  assert.equal(sourceIndex.schema_version, "source-index/v1");
  assert.equal(sourceIndex.sources[0].display_label, "Agreement note");

  const csvRows = parseCsv(await readFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), "utf8"));
  assert.equal(csvRows.length, 1);

  assert.deepEqual(lawyerFields({ event_type: "agreement", issue_tags: ["agreement"] }), {
    event_type: "agreement",
    legal_relevance: "Supports the client's chronology because the cited source records the event.",
    issue_tags: ["agreement"],
    perspective: "client_favourable",
  });
});
