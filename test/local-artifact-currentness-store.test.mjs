import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ARTIFACT_CURRENTNESS_RELATIVE,
  ARTIFACT_CURRENTNESS_STORE_SCHEMA_VERSION,
  createLocalArtifactCurrentnessStore,
  readLocalArtifactCurrentnessStore,
} from "../services/local-artifact-currentness-store.mjs";

test("local artifact currentness store upserts normalized records atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-currentness-store-"));
  const store = createLocalArtifactCurrentnessStore({
    matterRoot: root,
    now: () => new Date("2026-06-26T00:00:00.000Z"),
  });

  const projection = await store.upsertRecords([
    {
      matterName: "Demo Matter",
      artifactFamily: "list_of_dates",
      artifactPath: "10_Library/Case Timeline.md",
      state: "stale",
      dependencyState: "chronology_regeneration_needed",
      reasonCode: "source_removal.chronology_regeneration_needed",
      affectedFileIds: ["file-0007"],
      metadata: { skill: "/create_case_timeline", sourceText: "must not persist" },
    },
  ]);

  assert.equal(store.storePath, path.join(root, ARTIFACT_CURRENTNESS_RELATIVE));
  assert.equal(projection.schema_version, "artifact-currentness-projection/v1");
  assert.equal(projection.store_schema_version, ARTIFACT_CURRENTNESS_STORE_SCHEMA_VERSION);
  assert.equal(projection.records.length, 1);
  assert.equal(projection.records[0].artifactFamily, "list_of_dates");
  assert.equal(projection.records[0].state, "stale");
  assert.deepEqual(projection.records[0].affectedFileIds, ["FILE-0007"]);
  assert.equal(JSON.stringify(projection).includes("must not persist"), false);

  const raw = await readFile(store.storePath, "utf8");
  assert.match(raw, /matter-artifact-currentness\/v1/);
  assert.doesNotMatch(raw, /must not persist/);
});

test("local artifact currentness store replaces records by artifact family and path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-currentness-store-merge-"));
  const store = createLocalArtifactCurrentnessStore({ matterRoot: root });

  await store.upsertRecords([
    { artifactFamily: "source_index", artifactPath: "10_Library/Source Index.json", state: "stale" },
    { artifactFamily: "matter_story", artifactPath: "20_Workshop/The Story.md", state: "needs_review" },
  ]);
  const projection = await store.upsertRecords([
    { artifactFamily: "source_index", artifactPath: "10_Library/Source Index.json", state: "current" },
  ]);

  assert.equal(projection.records.length, 2);
  assert.equal(projection.records.find((record) => record.artifactFamily === "source_index").state, "current");
  assert.equal(projection.records.find((record) => record.artifactFamily === "matter_story").state, "needs_review");
});

test("local artifact currentness store ignores invalid manifests with warnings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-currentness-store-invalid-"));
  const storePath = path.join(root, ARTIFACT_CURRENTNESS_RELATIVE);
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, "{not json\n");

  const read = await readLocalArtifactCurrentnessStore(storePath);

  assert.deepEqual(read.records, []);
  assert.match(read.warnings.join("\n"), /Skipped invalid artifact-currentness\.json/);
});
