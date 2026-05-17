import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evidence,
  fileExists,
  hasDeveloperNameLeak,
  joinDetailSentences,
  normalizeText,
  readCsvFile,
  readJsonFile,
  sampleRowEvidence,
  sampleSourceEvidence,
} from "../services/matter-attention-helpers.mjs";

test("matter attention helpers read JSON and CSV files with missing/invalid states", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-helpers-"));
  const jsonPath = path.join(root, "valid.json");
  const csvPath = path.join(root, "valid.csv");
  const invalidJsonPath = path.join(root, "invalid.json");
  await writeFile(jsonPath, "{\"ok\":true}\n");
  await writeFile(csvPath, "file_id,status\nFILE-0001,failed\n");
  await writeFile(invalidJsonPath, "{not json");

  assert.deepEqual(await readJsonFile(jsonPath), {
    exists: true,
    valid: true,
    data: { ok: true },
  });
  assert.deepEqual(await readCsvFile(csvPath), {
    exists: true,
    valid: true,
    rows: [{ file_id: "FILE-0001", status: "failed" }],
  });
  assert.equal((await readJsonFile(invalidJsonPath)).valid, false);
  assert.equal((await readJsonFile(path.join(root, "missing.json"))).exists, false);
  assert.equal((await readCsvFile(path.join(root, "missing.csv"))).exists, false);
});

test("matter attention helpers shape evidence and bounded display text", () => {
  assert.deepEqual(evidence("10_Library/Source Index.json", { row: "FILE-0001" }), {
    path: "10_Library/Source Index.json",
    row: "FILE-0001",
  });
  assert.deepEqual(sampleRowEvidence("File Register.csv", [{
    file_id: "FILE-0001",
    status: "failed",
    notes: "bad parser",
  }], "file_id"), [{
    path: "File Register.csv",
    row: "FILE-0001",
    status: "failed",
    notes: "bad parser",
  }]);
  assert.deepEqual(sampleSourceEvidence([{
    source_id: "FILE-0002",
    label_status: "needs_review",
  }]), [{
    path: "10_Library/Source Index.json",
    source_id: "FILE-0002",
    label_status: "needs_review",
  }]);
  assert.equal(normalizeText("abcdef", 4), "abc…");
});

test("matter attention helpers detect files and developer-name leaks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-helpers-file-"));
  await mkdir(path.join(root, "folder"));
  const filePath = path.join(root, "file.txt");
  await writeFile(filePath, "text\n");

  assert.equal(await fileExists(filePath), true);
  assert.equal(await fileExists(path.join(root, "folder")), false);
  assert.equal(await fileExists(path.join(root, "missing.txt")), false);
  assert.equal(hasDeveloperNameLeak(["Readable source label"]), false);
  assert.equal(hasDeveloperNameLeak(["FILE-0001 raw document"]), true);
  assert.equal(hasDeveloperNameLeak(["10_Library/Source Index.json"]), true);
});

test("matter attention helpers join detail sentences cleanly", () => {
  assert.equal(joinDetailSentences([
    "Source labels changed",
    "Dependency state: label_refresh_needed.",
    "",
  ]), "Source labels changed. Dependency state: label_refresh_needed.");
});
