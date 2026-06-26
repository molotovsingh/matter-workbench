import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ARTIFACT_CURRENTNESS_FAMILIES,
  ARTIFACT_CURRENTNESS_STATES,
  buildSourceRemovalArtifactCurrentnessEffects,
  normalizeArtifactCurrentnessRecord,
  readLocalArtifactCurrentnessProjection,
} from "../services/artifact-currentness-service.mjs";
import {
  SOURCE_TOMBSTONES_RELATIVE,
  SOURCE_TOMBSTONES_SCHEMA_VERSION,
} from "../services/active-source-set-service.mjs";

test("artifact currentness normalization keeps identifiers and omits source text metadata", () => {
  const record = normalizeArtifactCurrentnessRecord({
    matterName: "Demo Matter",
    artifactFamily: "list_of_dates",
    artifactPath: "/10_Library/List of Dates.md",
    state: "stale",
    dependencyState: "chronology_regeneration_needed",
    reasonCode: "source_removal.chronology_regeneration_needed",
    affectedFileIds: ["file-0002", "nope", "FILE-0002"],
    metadata: {
      skill: "/create_listofdates",
      inputCount: 2,
      sourceText: "must not be retained",
      markdown: "must not be retained",
    },
    observedAt: "2026-06-26T00:00:00.000Z",
  });

  assert.equal(record.schema_version, "artifact-currentness-record/v1");
  assert.equal(record.artifactFamily, ARTIFACT_CURRENTNESS_FAMILIES.LIST_OF_DATES);
  assert.equal(record.artifactPath, "10_Library/List of Dates.md");
  assert.equal(record.state, ARTIFACT_CURRENTNESS_STATES.STALE);
  assert.deepEqual(record.affectedFileIds, ["FILE-0002"]);
  assert.deepEqual(record.metadata, { skill: "/create_listofdates", inputCount: 2 });
  assert.equal(JSON.stringify(record).includes("must not be retained"), false);
});

test("source removal currentness effects mark downstream artifacts without regeneration", () => {
  const records = buildSourceRemovalArtifactCurrentnessEffects({
    matterName: "Demo Matter",
    fileId: "FILE-0007",
    sourceIndexPresent: true,
    listOfDatesAffected: true,
    matterStoryPresent: true,
    customSkillOutputPaths: ["20_Workshop/Issue Notes.md", "20_Workshop/Issue Notes.md"],
    sourceEventId: "11111111-1111-4111-8111-111111111111",
    observedAt: "2026-06-26T00:00:00.000Z",
  });

  assert.deepEqual(records.map((record) => record.artifactFamily), [
    "source_index",
    "list_of_dates",
    "matter_story",
    "custom_skill_output",
  ]);
  assert.equal(records.find((record) => record.artifactFamily === "list_of_dates").dependencyState, "chronology_regeneration_needed");
  assert.equal(records.find((record) => record.artifactFamily === "matter_story").state, "needs_review");
  assert.equal(records.find((record) => record.artifactFamily === "custom_skill_output").state, "needs_review");
  assert.deepEqual(records[0].affectedFileIds, ["FILE-0007"]);
});

test("local artifact currentness projection marks artifacts stale when they cite suppressed sources", async () => {
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
  await writeStory(root);
  await writeSourceTombstones(root, [{ file_id: "FILE-0002", status: "removed_from_active_record" }]);

  const projection = await readLocalArtifactCurrentnessProjection(root, {
    matterName: "Demo Matter",
    now: () => new Date("2026-06-26T00:00:00.000Z"),
  });

  const byFamily = new Map(projection.records.map((record) => [record.artifactFamily, record]));
  assert.equal(projection.schema_version, "artifact-currentness-projection/v1");
  assert.equal(byFamily.get("source_index").state, "stale");
  assert.equal(byFamily.get("source_index").reasonCode, "artifact_currentness.active_source_set_changed");
  assert.equal(byFamily.get("list_of_dates").state, "stale");
  assert.equal(byFamily.get("list_of_dates").dependencyState, "chronology_regeneration_needed");
  assert.equal(byFamily.get("matter_story").state, "stale");
  assert.equal(byFamily.get("matter_story").reasonCode, "artifact_currentness.basis_not_current");
  assert.equal(projection.staleCount, 3);
});

async function makeMatterRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-currentness-test-"));
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await mkdir(path.join(root, "20_Workshop"), { recursive: true });
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
    path.join(root, "10_Library", "List of Dates.json"),
    `${JSON.stringify({
      schema_version: "list-of-dates/v1",
      generated_at: "2026-06-26T00:00:00.000Z",
      source_snapshot: sourceSnapshot,
      entries: [{ date_iso: "2026-04-20", event: "Fixture event", citation: "FILE-0001 p1.b1" }],
    }, null, 2)}\n`,
  );
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# List of Dates\n\nFixture chronology.\n");
}

async function writeStory(root) {
  await writeFile(path.join(root, "20_Workshop", "The Story.md"), "# The Story\n\nFixture story.\n");
}

async function writeSourceTombstones(root, sources) {
  await mkdir(path.join(root, path.dirname(SOURCE_TOMBSTONES_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, SOURCE_TOMBSTONES_RELATIVE), `${JSON.stringify({
    schema_version: SOURCE_TOMBSTONES_SCHEMA_VERSION,
    sources,
  }, null, 2)}\n`);
}
