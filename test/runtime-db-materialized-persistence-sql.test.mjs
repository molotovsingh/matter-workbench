import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  buildMaterializedDeletionPersistenceSql,
  buildMaterializedFilePersistenceSql,
  materializedDeletionRowsForFiles,
  materializedRowsForFiles,
  summarizeMaterializedRows,
} from "../services/runtime-db-materialized-persistence-sql.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";
const matter = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "DB Matter",
};

test("runtime DB materialized persistence SQL builds custody, artifact, extraction, and source descriptor writes", () => {
  const rows = materializedRowsForFiles({
    matter,
    files: [
      file("10_Library/Case Timeline.md", "# dates", "matter_artifact", "text/markdown"),
      file("00_Inbox/Intake 01/_extracted/FILE-0001.json", JSON.stringify({ file_id: "FILE-0001" }), "extraction_payload", "application/json"),
      file("10_Library/Source Index.json", JSON.stringify({
        sources: [{
          file_id: "FILE-0001",
          source_label: "Agreement dated 1 June 2014",
          label_status: "needs_review",
          document_date: "2014-06-01",
          needs_review: true,
        }],
      }), "matter_artifact", "application/json"),
    ],
  });

  assert.deepEqual(summarizeMaterializedRows(rows).map((row) => row.relativePath), [
    "10_Library/Case Timeline.md",
    "00_Inbox/Intake 01/_extracted/FILE-0001.json",
    "10_Library/Source Index.json",
  ]);
  assert.equal(rows[0].objectKey, "DB Matter/10_Library/Case Timeline.md");
  assert.equal(rows[0].payloadHex, Buffer.from("# dates").toString("hex"));

  const sql = buildMaterializedFilePersistenceSql({ tenantId, matter, rows });

  assert.match(sql, /^begin;/);
  assert.match(sql, /mwb_runtime_role_guard/);
  assert.match(sql, /insert into storage_objects/i);
  assert.match(sql, /insert into storage_object_payloads/i);
  assert.match(sql, /insert into matter_artifacts/i);
  assert.match(sql, /insert into extraction_records/i);
  assert.match(sql, /insert into source_descriptors/i);
  assert.match(sql, /Agreement dated 1 June 2014/);
  assert.match(sql, /needs_review/);
  assert.match(sql, /commit;/);
});

test("runtime DB materialized persistence SQL builds deletion tombstones", () => {
  const rows = materializedDeletionRowsForFiles({
    matter,
    files: [{ relativePath: "10_Library/Old Artifact.md" }],
  });
  const sql = buildMaterializedDeletionPersistenceSql({ tenantId, matter, rows });

  assert.deepEqual(rows, [{
    relativePath: "10_Library/Old Artifact.md",
    objectKey: "DB Matter/10_Library/Old Artifact.md",
  }]);
  assert.match(sql, /update storage_objects/i);
  assert.match(sql, /state = 'deleted_pending'/i);
  assert.match(sql, /update matter_artifacts/i);
  assert.match(sql, /update extraction_records\nset superseded_at = now\(\)/i);
  assert.match(sql, /update source_descriptors\nset superseded_at = now\(\), updated_at = now\(\)/i);
  assert.doesNotMatch(sql, /insert into storage_object_payloads/i);
});

function file(relativePath, text, objectRole, mimeType) {
  const bytes = Buffer.from(text);
  return {
    relativePath,
    bytes,
    objectRole,
    mimeType,
    sizeBytes: bytes.length,
    sha256: "a".repeat(64),
  };
}
