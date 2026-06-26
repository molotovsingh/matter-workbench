import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SOURCE_TOMBSTONES_RELATIVE,
  SOURCE_TOMBSTONES_SCHEMA_VERSION,
  addInactiveRegisterRowsToSuppressionIndex,
  createSourceSuppressionIndex,
  isInactiveSourceStatus,
  isSourceSuppressed,
  readSourceSuppressionIndex,
  sourceSuppressionEntryFor,
} from "../services/active-source-set-service.mjs";

test("source suppression index treats removed and quarantined source rows as inactive", () => {
  const index = createSourceSuppressionIndex([
    {
      file_id: "FILE-0002",
      source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0002__privileged.pdf",
      status: "removed_from_active_record",
      event_id: "evt_2",
    },
    {
      file_id: "FILE-0003",
      status: "quarantined",
    },
  ]);

  assert.equal(isSourceSuppressed({ file_id: "FILE-0002" }, index), true);
  assert.equal(isSourceSuppressed({ source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0002__privileged.pdf" }, index), true);
  assert.equal(isSourceSuppressed({ file_id: "FILE-0003" }, index), true);
  assert.equal(isSourceSuppressed({ file_id: "FILE-0001" }, index), false);
  assert.equal(sourceSuppressionEntryFor({ file_id: "FILE-0002" }, index).event_id, "evt_2");
  assert.equal(isInactiveSourceStatus("deleted-pending"), true);
  assert.equal(isInactiveSourceStatus("exact-duplicate"), false);
});

test("source suppression manifest is optional and fail-safe on invalid JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "active-source-set-test-"));
  const warnings = [];
  const empty = await readSourceSuppressionIndex(root, { warnings });
  assert.equal(isSourceSuppressed({ file_id: "FILE-0001" }, empty), false);
  assert.deepEqual(warnings, []);

  await mkdir(path.join(root, path.dirname(SOURCE_TOMBSTONES_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, SOURCE_TOMBSTONES_RELATIVE), "not json");
  const invalidWarnings = [];
  const invalid = await readSourceSuppressionIndex(root, { warnings: invalidWarnings });
  assert.equal(isSourceSuppressed({ file_id: "FILE-0001" }, invalid), false);
  assert.match(invalidWarnings.join("\n"), /Skipped invalid \.matter-workbench\/source-tombstones\.json/);
});

test("inactive File Register rows can seed the suppression index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "active-source-set-test-"));
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  await mkdir(intakeDir, { recursive: true });
  await writeFile(path.join(intakeDir, "File Register.csv"), [
    "file_id,source_path,status",
    "FILE-0005,00_Inbox/Intake 01 - Initial/Source Files/removed.pdf,removed_from_active_record",
  ].join("\n"));
  const index = createSourceSuppressionIndex();

  await addInactiveRegisterRowsToSuppressionIndex(root, [{ intake_dir: "00_Inbox/Intake 01 - Initial" }], index);

  assert.equal(isSourceSuppressed({ file_id: "FILE-0005" }, index), true);
  assert.equal(isSourceSuppressed({ source_path: "00_Inbox/Intake 01 - Initial/Source Files/removed.pdf" }, index), true);
});

test("source suppression manifest loads file ids and paths without source text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "active-source-set-test-"));
  await mkdir(path.join(root, path.dirname(SOURCE_TOMBSTONES_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, SOURCE_TOMBSTONES_RELATIVE), `${JSON.stringify({
    schema_version: SOURCE_TOMBSTONES_SCHEMA_VERSION,
    sources: [{
      file_id: "FILE-0004",
      source_path: "00_Inbox/Intake 01 - Initial/Source Files/remove-me.pdf",
      status: "removed_from_active_record",
      reason: "wrong matter",
    }],
  }, null, 2)}\n`);

  const warnings = [];
  const index = await readSourceSuppressionIndex(root, { warnings });
  assert.deepEqual(warnings, []);
  assert.equal(isSourceSuppressed({ file_id: "FILE-0004" }, index), true);
  assert.equal(isSourceSuppressed({ source_path: "00_Inbox/Intake 01 - Initial/Source Files/remove-me.pdf" }, index), true);
  assert.doesNotMatch(JSON.stringify(sourceSuppressionEntryFor({ file_id: "FILE-0004" }, index)), /wrong matter evidence text/i);
});
