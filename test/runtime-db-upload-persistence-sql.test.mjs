import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { materializedRowsForFiles } from "../services/runtime-db-materialized-persistence-sql.mjs";
import {
  buildRuntimeUploadPersistenceSql,
  createMatterAddFilesSql,
  createMatterUploadSql,
  runtimeDbActorSqls,
} from "../services/runtime-db-upload-persistence-sql.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";
const matter = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "DB Matter",
  clientName: "Client A",
  oppositeParty: "Other Side",
  matterType: "Consumer",
  jurisdiction: "India",
  briefDescription: "Captioned matter",
};
const actor = {
  id: "22222222-2222-4222-8222-222222222222",
  username: "tester@example.com",
  email: "tester@example.com",
  displayName: "Tester User",
  role: "tester",
};

test("runtime DB upload persistence SQL builds new-matter custody and document identity writes", () => {
  const importItems = [importItem("FILE-0001", "00_Inbox/Intake 01 - Initial/Source Files/notice.txt")];
  const persistedRows = materializedRowsForFiles({ matter, files: [storageFile(importItems[0].relativePath, "notice body")] });
  const uploadPlan = {
    intakeDbId: "33333333-3333-4333-8333-333333333333",
    uploadSessionId: "44444444-4444-4444-8444-444444444444",
    importBatchId: "55555555-5555-4555-8555-555555555555",
  };

  const sql = buildRuntimeUploadPersistenceSql({
    tenantId,
    actor,
    matter,
    uploadPlan,
    importItems,
    persistedRows,
    uploadSqls: createMatterUploadSql({
      matter,
      actor,
      intakeId: uploadPlan.intakeDbId,
      uploadSessionId: uploadPlan.uploadSessionId,
      importBatchId: uploadPlan.importBatchId,
      expectedFileCount: 1,
      receivedDate: "2026-06-19",
    }),
  });

  assert.match(sql, /^begin;/);
  assert.match(sql, /mwb_runtime_role_guard/);
  assert.match(sql, /insert into users/i);
  assert.match(sql, /insert into tenant_memberships/i);
  assert.match(sql, /insert into matters/i);
  assert.match(sql, /insert into matter_memberships/i);
  assert.match(sql, /insert into storage_objects/i);
  assert.match(sql, /insert into storage_object_payloads/i);
  assert.match(sql, /insert into documents/i);
  assert.match(sql, /insert into document_blobs/i);
  assert.match(sql, /insert into matter_import_items/i);
  assert.match(sql, /FILE-0001/);
  assert.match(sql, /notice\.txt/);
  assert.match(sql, /commit;/);
});

test("runtime DB upload persistence SQL builds add-files allocation finalization", () => {
  const importItems = [importItem("FILE-0002", "00_Inbox/Intake 02/Source Files/update.txt", { duplicateOf: "FILE-0001" })];
  const persistedRows = materializedRowsForFiles({ matter, files: [storageFile(importItems[0].relativePath, "update body")] });
  const uploadPlan = {
    intakeDbId: "33333333-3333-4333-8333-333333333333",
    uploadSessionId: "44444444-4444-4444-8444-444444444444",
    importBatchId: "55555555-5555-4555-8555-555555555555",
  };

  const sql = buildRuntimeUploadPersistenceSql({
    tenantId,
    actor,
    matter,
    uploadPlan,
    importItems,
    persistedRows,
    uploadSqls: createMatterAddFilesSql({
      matter,
      actor,
      intakeDbId: uploadPlan.intakeDbId,
      intakeNumber: 2,
      uploadSessionId: uploadPlan.uploadSessionId,
      importBatchId: uploadPlan.importBatchId,
      expectedFileCount: 1,
      label: "",
      receivedDate: "2026-06-19",
    }),
  });

  assert.match(sql, /Intake 02/);
  assert.match(sql, /runtime-db-upload:11111111-1111-4111-8111-111111111111:2/);
  assert.match(sql, /duplicate_of_document_id/);
  assert.match(sql, /file_id = 'FILE-0001'/);
  assert.match(sql, /insert into matter_import_items/i);
});

test("runtime DB actor SQL maps operator-like users to admin membership", () => {
  const sql = runtimeDbActorSqls({
    tenantId,
    actor: { ...actor, role: "operator" },
  }).join("\n");

  assert.match(sql, /insert into users/i);
  assert.match(sql, /insert into tenant_memberships/i);
  assert.match(sql, /'admin'/);
});

function storageFile(relativePath, text) {
  const bytes = Buffer.from(text);
  return {
    relativePath,
    bytes,
    objectRole: "source_working_copy",
    mimeType: "text/plain",
    sizeBytes: bytes.length,
    sha256: "a".repeat(64),
  };
}

function importItem(fileId, relativePath, overrides = {}) {
  return {
    fileId,
    fileNumber: Number(fileId.replace(/^FILE-/, "")),
    relativePath,
    originalRelativePath: relativePath,
    originalPath: relativePath,
    workingCopyPath: relativePath,
    sha256: "a".repeat(64),
    duplicateOf: "",
    ...overrides,
  };
}
