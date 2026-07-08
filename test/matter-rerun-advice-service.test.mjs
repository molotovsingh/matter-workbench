import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isNewerByTrustedMtime,
  readRerunAdviceForSkill,
} from "../services/matter-rerun-advice-service.mjs";
import {
  SOURCE_TOMBSTONES_RELATIVE,
  SOURCE_TOMBSTONES_SCHEMA_VERSION,
} from "../services/active-source-set-service.mjs";

test("rerun advice mtime comparison ignores unknown zero timestamps", () => {
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 0, targetMtimeMs: 0 }), false);
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 1000, targetMtimeMs: 0 }), false);
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 0, targetMtimeMs: 1000 }), false);
});

test("rerun advice mtime comparison only marks stale when both timestamps are trusted", () => {
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 1003, targetMtimeMs: 1000 }), true);
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 1000, targetMtimeMs: 1000 }), false);
  assert.equal(isNewerByTrustedMtime({ inputMtimeMs: 1001, targetMtimeMs: 1000 }), false);
});

test("describe-sources rerun advice treats tombstoned source descriptors as stale", async () => {
  const root = await makeMatterRoot();
  await writeExtractionRecord(root, "FILE-0001", "hash-1");
  await writeExtractionRecord(root, "FILE-0002", "hash-2");
  await writeSourceIndex(root, [
    { file_id: "FILE-0001", content_hash: "hash-1", display_label: "Active source" },
    { file_id: "FILE-0002", content_hash: "hash-2", display_label: "Removed source" },
  ]);
  await writeSourceTombstones(root, [{ file_id: "FILE-0002", status: "removed_from_active_record" }]);

  const advice = await readRerunAdviceForSkill("/describe_sources", root);

  assert.equal(advice.state, "stale");
  assert.equal(advice.shouldConfirm, false);
  assert.match(advice.reason, /no longer in the active source set/);
  assert.equal(advice.artifactPath, "10_Library/Source Index.json");
});

test("Case Timeline rerun advice marks chronology regeneration needed when snapshot contains inactive source", async () => {
  const root = await makeMatterRoot();
  await writeExtractionRecord(root, "FILE-0001", "hash-1");
  await writeExtractionRecord(root, "FILE-0002", "hash-2");
  await writeSourceIndex(root, [
    { file_id: "FILE-0001", content_hash: "hash-1", display_label: "Active source" },
    { file_id: "FILE-0002", content_hash: "hash-2", display_label: "Removed source" },
  ]);
  await writeListOfDates(root, [
    { file_id: "FILE-0001", source_id: "FILE-0001", content_hash: "hash-1", source_label: "Active source" },
    { file_id: "FILE-0002", source_id: "FILE-0002", content_hash: "hash-2", source_label: "Removed source" },
  ]);
  await writeSourceTombstones(root, [{ file_id: "FILE-0002", status: "removed_from_active_record" }]);

  const advice = await readRerunAdviceForSkill("/create_case_timeline", root);

  assert.equal(advice.state, "stale");
  assert.equal(advice.dependencyState, "chronology_regeneration_needed");
  assert.match(advice.reason, /Case Timeline snapshot is no longer in the active source set/);
  assert.equal(advice.shouldConfirm, false);
});

test("rerun advice exposes a stable code for unsupported skills", async () => {
  let thrown;
  try {
    await readRerunAdviceForSkill("/unknown_skill", "/tmp/matter");
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.code, "rerun_advice.unsupported_skill");
  assert.equal(thrown?.statusCode, 400);
});

async function makeMatterRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rerun-active-source-test-"));
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  return root;
}

async function writeExtractionRecord(root, fileId, contentHash) {
  await writeFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", `${fileId}.json`),
    `${JSON.stringify({
      schema_version: "extraction-record/v1",
      file_id: fileId,
      sha256: contentHash,
      source_path: `00_Inbox/Intake 01 - Initial/By Type/PDFs/${fileId}__source.pdf`,
      pages: [{ page: 1, blocks: [{ id: "p1.b1", text: `${fileId} text` }] }],
    }, null, 2)}\n`,
  );
}

async function writeSourceIndex(root, sources) {
  await writeFile(
    path.join(root, "10_Library", "Source Index.json"),
    `${JSON.stringify({
      schema_version: "source-index/v1",
      generated_at: "2026-06-26T00:00:00.000Z",
      sources,
    }, null, 2)}\n`,
  );
}

async function writeListOfDates(root, sourceSnapshot) {
  await writeFile(
    path.join(root, "10_Library", "Case Timeline.json"),
    `${JSON.stringify({
      schema_version: "list-of-dates/v1",
      generated_at: "2026-06-26T00:00:00.000Z",
      source_snapshot: sourceSnapshot,
      entries: [{ date_iso: "2026-04-20", event: "Fixture event", citation: "FILE-0001 p1.b1" }],
    }, null, 2)}\n`,
  );
  await writeFile(path.join(root, "10_Library", "Case Timeline.md"), "# List of Dates\n\nFixture chronology.\n");
}

async function writeSourceTombstones(root, sources) {
  await mkdir(path.join(root, path.dirname(SOURCE_TOMBSTONES_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, SOURCE_TOMBSTONES_RELATIVE), `${JSON.stringify({
    schema_version: SOURCE_TOMBSTONES_SCHEMA_VERSION,
    sources,
  }, null, 2)}\n`);
}
