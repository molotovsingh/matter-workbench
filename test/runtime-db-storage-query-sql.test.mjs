import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdvisorySnapshotSql,
  buildMatterAddFilesAllocationSql,
  buildMatterByNameSql,
  buildPayloadSql,
  buildUploadOverlapSql,
  buildWorkspaceSql,
} from "../services/runtime-db-storage-query-sql.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";
const matter = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "DB Matter",
};
const actor = {
  id: "22222222-2222-4222-8222-222222222222",
  username: "tester@example.com",
  email: "tester@example.com",
  role: "tester",
};

test("runtime DB storage query SQL builds workspace and payload reads", () => {
  const workspaceSql = buildWorkspaceSql({ tenantId, matter });
  const payloadSql = buildPayloadSql({ tenantId, matter, relativePath: "10_Library/List of Dates.md" });

  assert.match(workspaceSql, /set_config\('app\.tenant_id'/);
  assert.match(workspaceSql, /from storage_objects so/i);
  assert.match(workspaceSql, /join storage_object_payloads sop/i);
  assert.match(workspaceSql, /left join documents d/i);
  assert.match(workspaceSql, /left join extraction_records er/i);
  assert.match(workspaceSql, /left join document_text_blocks dtb/i);
  assert.match(workspaceSql, /d\.status not in \('removed_from_active_record', 'quarantined', 'deleted_pending', 'deleted'\)/);
  assert.match(workspaceSql, /extraction_document\.status not in \('removed_from_active_record', 'quarantined', 'deleted_pending', 'deleted'\)/);
  assert.match(workspaceSql, /text_document\.status not in \('removed_from_active_record', 'quarantined', 'deleted_pending', 'deleted'\)/);
  assert.match(workspaceSql, /coalesce\(d\.file_id, extraction_document\.file_id, text_document\.file_id, ''\) as file_id/);
  assert.match(workspaceSql, /'objects'/);
  assert.match(payloadSql, /with candidates as/i);
  assert.match(payloadSql, /left join documents d/i);
  assert.match(payloadSql, /left join extraction_records er/i);
  assert.match(payloadSql, /left join document_text_blocks dtb/i);
  assert.match(payloadSql, /d\.status not in \('removed_from_active_record', 'quarantined', 'deleted_pending', 'deleted'\)/);
  assert.match(payloadSql, /extraction_document\.status not in \('removed_from_active_record', 'quarantined', 'deleted_pending', 'deleted'\)/);
  assert.match(payloadSql, /text_document\.status not in \('removed_from_active_record', 'quarantined', 'deleted_pending', 'deleted'\)/);
  assert.match(payloadSql, /DB Matter\/10_Library\/List of Dates\.md/);
  assert.match(payloadSql, /encode\(sop\.payload, 'base64'\)/i);
  assert.match(payloadSql, /array_position/);
});

test("runtime DB storage query SQL builds upload allocation with row lock", () => {
  const sql = buildMatterAddFilesAllocationSql({
    tenantId,
    matter,
    expectedFileCount: 2,
    label: "Follow-up disclosure",
    receivedDate: "2026-06-19",
    actor,
  });

  assert.match(sql, /^begin;/);
  assert.match(sql, /mwb_runtime_role_guard/);
  assert.match(sql, /insert into users/i);
  assert.match(sql, /for update/i);
  assert.doesNotMatch(sql, /substring\(so\.object_key from 'Intake \(\[0-9\]\+\)'\)/);
  assert.match(sql, /substring\(so\.object_key from '00_Inbox\/Intake \(\[0-9\]\+\)/);
  assert.match(sql, /next_file_number = coalesce\(m\.next_file_number, 1\) \+ 2/i);
  assert.match(sql, /Follow-up disclosure/);
  assert.match(sql, /runtime-db-upload:/);
  assert.match(sql, /'fileIdStart'/);
  assert.match(sql, /commit;/);
});

test("runtime DB storage query SQL builds lookup, overlap, and advisory reads", () => {
  const lookupSql = buildMatterByNameSql({ tenantId, name: "O'Reilly Matter" });
  const overlapSql = buildUploadOverlapSql({ tenantId, hashes: ["a".repeat(64)] });
  const advisorySql = buildAdvisorySnapshotSql({ tenantId, matter });

  assert.match(lookupSql, /lower\(name\) = lower\('O''Reilly Matter'\)/);
  assert.match(overlapSql, /from unnest\(ARRAY\['aaaaaaaa/);
  assert.match(overlapSql, /d\.status not in \('removed_from_active_record', 'quarantined', 'deleted_pending', 'deleted'\)/);
  assert.match(overlapSql, /overlapPercent/);
  assert.match(advisorySql, /preparation_advisory_snapshots/);
  assert.match(advisorySql, /matter-attention\/v1/);
});
