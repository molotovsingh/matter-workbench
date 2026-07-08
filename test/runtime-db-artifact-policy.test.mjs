import assert from "node:assert/strict";
import test from "node:test";

import {
  runtimeArtifactFormatForPath,
  runtimeArtifactMetadataForRow,
  runtimeArtifactMimeTypeForPath,
  runtimeArtifactRoleForPath,
} from "../services/runtime-db-artifact-policy.mjs";

test("runtime DB artifact policy classifies materialized storage roles", () => {
  assert.equal(runtimeArtifactRoleForPath("matter.json"), "matter_artifact");
  assert.equal(runtimeArtifactRoleForPath("00_Inbox/Intake 01/File Register.csv"), "matter_artifact");
  assert.equal(runtimeArtifactRoleForPath("00_Inbox/Intake 01/_extracted/FILE-0001.json"), "extraction_payload");
  assert.equal(runtimeArtifactRoleForPath("10_Library/Case Timeline.md"), "matter_artifact");
  assert.equal(runtimeArtifactRoleForPath("30_Drafts/Demand Notice.docx"), "matter_artifact");
  assert.equal(runtimeArtifactRoleForPath("00_Inbox/Intake 01/Originals/notice.pdf"), "source_original");
  assert.equal(runtimeArtifactRoleForPath("00_Inbox/Intake 01/Source Files/notice.pdf"), "source_working_copy");
  assert.equal(runtimeArtifactRoleForPath("00_Inbox/Intake 01/misc.bin"), "other");
});

test("runtime DB artifact policy derives canonical matter artifact metadata", () => {
  assert.deepEqual(
    runtimeArtifactMetadataForRow({ objectRole: "matter_artifact", relativePath: "10_Library/Source Index.json" }),
    { family: "source_index", mode: "default", profileKey: "default", format: "json" },
  );
  assert.deepEqual(
    runtimeArtifactMetadataForRow({ objectRole: "matter_artifact", relativePath: "10_Library/Case Timeline.md" }),
    { family: "list_of_dates", mode: "default", profileKey: "default", format: "md" },
  );
  assert.deepEqual(
    runtimeArtifactMetadataForRow({ objectRole: "matter_artifact", relativePath: "30_Drafts/Demand Notice.docx" }),
    { family: "draft", mode: "default", profileKey: "30_Drafts/Demand Notice", format: "docx" },
  );
  assert.deepEqual(
    runtimeArtifactMetadataForRow({ objectRole: "matter_artifact", relativePath: "20_Workshop/Issues Note.md" }),
    { family: "custom_skill_output", mode: "default", profileKey: "20_Workshop/Issues Note", format: "md" },
  );
});

test("runtime DB artifact policy rejects non-artifact and unsupported artifact formats", () => {
  assert.equal(runtimeArtifactMetadataForRow({ objectRole: "source_original", relativePath: "10_Library/Source Index.json" }), null);
  assert.equal(runtimeArtifactMetadataForRow({ objectRole: "matter_artifact", relativePath: "10_Library/Notes.xyz" }), null);
  assert.equal(runtimeArtifactFormatForPath("40_Dispatch/Email.markdown"), "md");
});

test("runtime DB artifact policy reuses workspace raw MIME mapping", () => {
  assert.equal(runtimeArtifactMimeTypeForPath("10_Library/Source Index.json"), "application/json; charset=utf-8");
  assert.equal(runtimeArtifactMimeTypeForPath("30_Drafts/Demand Notice.docx"), "application/octet-stream");
});
