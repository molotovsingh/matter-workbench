import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runExtract } from "../extract-engine.mjs";
import { toCsv } from "../shared/csv.mjs";
import {
  SOURCE_TOMBSTONES_RELATIVE,
  SOURCE_TOMBSTONES_SCHEMA_VERSION,
} from "../services/active-source-set-service.mjs";

const HASH_ONE = "1".repeat(64);
const HASH_TWO = "2".repeat(64);

test("extract skips sources suppressed from the active source set", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "extract-active-source-set-test-"));
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  const byTypeDir = path.join(intakeDir, "By Type", "Text Notes");
  await mkdir(byTypeDir, { recursive: true });
  await writeFile(path.join(root, "matter.json"), `${JSON.stringify({
    matter_name: "Suppression Matter",
    intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
  }, null, 2)}\n`);
  await writeFile(path.join(byTypeDir, "FILE-0001__active.txt"), "Active source text\n");

  const activePath = "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__active.txt";
  const removedPath = "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0002__removed.txt";
  await writeFile(path.join(intakeDir, "File Register.csv"), toCsv([
    {
      file_id: "FILE-0001",
      intake_id: "INTAKE-01",
      source_path: activePath,
      original_path: activePath,
      working_copy_path: activePath,
      category: "Text Notes",
      original_name: "active.txt",
      sha256: HASH_ONE,
      size_bytes: "19",
      duplicate_of: "",
      status: "unique",
    },
    {
      file_id: "FILE-0002",
      intake_id: "INTAKE-01",
      source_path: removedPath,
      original_path: removedPath,
      working_copy_path: removedPath,
      category: "Text Notes",
      original_name: "removed.txt",
      sha256: HASH_TWO,
      size_bytes: "20",
      duplicate_of: "",
      status: "unique",
    },
  ], [
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
  ]));
  await mkdir(path.join(root, path.dirname(SOURCE_TOMBSTONES_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, SOURCE_TOMBSTONES_RELATIVE), `${JSON.stringify({
    schema_version: SOURCE_TOMBSTONES_SCHEMA_VERSION,
    sources: [{ file_id: "FILE-0002", source_path: removedPath, status: "removed_from_active_record" }],
  }, null, 2)}\n`);

  const result = await runExtract({ matterRoot: root, dryRun: true, concurrency: 1 });

  assert.deepEqual(result.fileResults.map((row) => row.file_id), ["FILE-0001"]);
  assert.equal(result.counts.totalFiles, 1);
  assert.match(result.outputLines.join("\n"), /FILE-0002: skipped-suppressed \(removed_from_active_record\)/);
});
