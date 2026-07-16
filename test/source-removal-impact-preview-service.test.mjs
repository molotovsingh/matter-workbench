import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SOURCE_REMOVAL_IMPACT_PREVIEW_SCHEMA_VERSION,
  buildSourceRemovalImpactPreviewFromPacket,
  previewSourceRemovalImpact,
} from "../services/source-removal-impact-preview-service.mjs";

function packetFixture() {
  return {
    sources: [
      {
        file_id: "FILE-0001",
        source_id: "FILE-0001",
        source_label: "Agreement dated 20 April 2026",
        source_short_label: "Agreement",
        document_type: "agreement",
        source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__agreement.pdf",
        sample_citations: ["FILE-0001 p1.b1"],
      },
    ],
    evidence_blocks: [
      {
        file_id: "FILE-0001",
        citation: "FILE-0001 p1.b1",
        text: "Agreement source text must not appear in preview.",
      },
    ],
    library_artifacts: [
      {
        kind: "source_index",
        path: "10_Library/Source Index.json",
        source_count: 1,
      },
      {
        kind: "list_of_dates",
        path: "10_Library/Case Timeline.json",
        entries: [
          {
            event: "Chronology event must not appear in preview.",
            citation: "FILE-0001 p1.b1",
            source_excerpt: "Generated excerpt must not appear in preview.",
          },
        ],
        citation_index: [
          {
            citation: "FILE-0001 p1.b1",
            event: "Citation index text must not appear in preview.",
          },
        ],
      },
    ],
  };
}

test("source removal impact preview summarizes active-source effects without source text", () => {
  const preview = buildSourceRemovalImpactPreviewFromPacket(packetFixture(), {
    fileId: "file-0001",
    artifactInventory: {
      sourceIndexPresent: true,
      listOfDatesPresent: true,
      matterStoryPresent: true,
      customSkillOutputPaths: ["20_Workshop/Issue Map.md"],
    },
  });

  assert.equal(preview.schema_version, SOURCE_REMOVAL_IMPACT_PREVIEW_SCHEMA_VERSION);
  assert.equal(preview.file_id, "FILE-0001");
  assert.equal(preview.can_remove, true);
  assert.equal(preview.action_label, "Remove from active record");
  assert.equal(preview.requires_reason, true);
  assert.equal(preview.requires_idempotency_key, true);
  assert.equal(preview.physical_deletion, false);
  assert.equal(preview.source.file_id, "FILE-0001");
  assert.equal(preview.source.source_label, "Agreement dated 20 April 2026");
  assert.deepEqual(preview.active_context, { source_records: 1, evidence_blocks: 1 });
  assert.deepEqual(preview.affected_artifacts.map((artifact) => artifact.family), [
    "source_index",
    "list_of_dates",
    "matter_story",
    "custom_skill_output",
  ]);
  assert.equal(
    preview.affected_artifacts.find((artifact) => artifact.family === "custom_skill_output").artifact_path,
    "20_Workshop/Issue Map.md",
  );
  assert.equal(preview.affected_artifacts.find((artifact) => artifact.family === "list_of_dates").reference_count, 2);
  assert.match(preview.warnings.join("\n"), /must not delete bytes/);
  assert.match(preview.warnings.join("\n"), /Paid\/model regeneration must be a separate explicit action/);

  const serialized = JSON.stringify(preview);
  assert.doesNotMatch(serialized, /Agreement source text/);
  assert.doesNotMatch(serialized, /Chronology event/);
  assert.doesNotMatch(serialized, /Generated excerpt/);
  assert.doesNotMatch(serialized, /Citation index text/);
});

test("source removal impact preview reports inactive or missing sources without mutation", () => {
  const preview = buildSourceRemovalImpactPreviewFromPacket({ sources: [], evidence_blocks: [] }, { fileId: "FILE-0007" });

  assert.equal(preview.can_remove, false);
  assert.equal(preview.physical_deletion, false);
  assert.deepEqual(preview.active_context, { source_records: 0, evidence_blocks: 0 });
  assert.equal(Array.isArray(preview.affected_artifacts), false);
  assert.match(preview.warnings.join("\n"), /not in the active source register or is already inactive/);
});

test("source removal impact preview validates FILE ids and can wrap a packet builder", async () => {
  assert.throws(
    () => buildSourceRemovalImpactPreviewFromPacket(packetFixture(), { fileId: "not-a-file" }),
    (error) => error.statusCode === 400 && error.code === "source_removal_preview.file_id_required",
  );

  const preview = await previewSourceRemovalImpact({
    matterRoot: "/safe/test/matter",
    fileId: "FILE-0001",
    matterContextBuilder: async (matterRoot) => {
      assert.equal(matterRoot, "/safe/test/matter");
      return packetFixture();
    },
  });
  assert.equal(preview.can_remove, false);
  assert.match(preview.warnings.join("\n"), /active source register/);

  await assert.rejects(
    () => previewSourceRemovalImpact({ fileId: "FILE-0001", matterContextBuilder: async () => packetFixture() }),
    (error) => error.statusCode === 400 && error.code === "source_removal_preview.matter_required",
  );
});

test("source removal preview permits a registered source before extraction and finds custom outputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "source-removal-preview-register-"));
  const intake = path.join(root, "00_Inbox", "Intake 01 - Initial");
  const workshop = path.join(root, "20_Workshop");
  await mkdir(intake, { recursive: true });
  await mkdir(workshop, { recursive: true });
  await writeFile(path.join(intake, "File Register.csv"), [
    "file_id,original_name,status,source_path",
    "FILE-0042,registered.txt,active,00_Inbox/Intake 01 - Initial/registered.txt",
  ].join("\n"));
  await writeFile(path.join(workshop, "Issue Map.md"), "# Issue Map\n");
  await writeFile(path.join(workshop, "Issue Map.json"), JSON.stringify({
    schema_version: "configurable-skill-run/v1",
    outputPath: "20_Workshop/Issue Map.md",
  }));

  const preview = await previewSourceRemovalImpact({
    matterRoot: root,
    fileId: "FILE-0042",
    matterContextBuilder: async () => ({ sources: [], evidence_blocks: [], library_artifacts: [] }),
  });

  assert.equal(preview.can_remove, true);
  assert.equal(preview.source.original_name, "registered.txt");
  assert.deepEqual(preview.active_context, { source_records: 1, evidence_blocks: 0 });
  assert.deepEqual(preview.affected_artifacts, [{
    family: "custom_skill_output",
    artifact_path: "20_Workshop/Issue Map.md",
    effect: "needs_review",
    reason: "Custom skill output may depend on the active source set.",
  }]);
});
