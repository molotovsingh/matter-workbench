import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/003_tenant_reference_integrity.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

test("third database migration makes tenant-parent references enforceable", () => {
  const sql = readMigration();
  const parentTables = [
    "matters",
    "matter_intakes",
    "upload_sessions",
    "documents",
    "document_blobs",
    "extraction_records",
    "processing_jobs",
    "provider_runs",
    "matter_artifacts",
    "incidents",
    "skill_ideas",
    "configurable_skills",
    "configurable_skill_versions",
  ];

  for (const tableName of parentTables) {
    assert.match(
      sql,
      new RegExp(`create unique index if not exists ${tableName}_id_tenant_id_unique\\s+on ${tableName}\\s*\\(id, tenant_id\\)`, "i"),
      `${tableName} needs a composite tenant reference target`,
    );
  }
});

test("third database migration blocks cross-tenant matter and document links", () => {
  const sql = readMigration();

  assert.match(sql, /constraint matter_memberships_matter_tenant_fk[\s\S]*foreign key \(matter_id, tenant_id\)[\s\S]*references matters \(id, tenant_id\)/i);
  assert.match(sql, /constraint matter_intakes_matter_tenant_fk[\s\S]*foreign key \(matter_id, tenant_id\)[\s\S]*references matters \(id, tenant_id\)/i);
  assert.match(sql, /constraint upload_sessions_matter_tenant_fk[\s\S]*foreign key \(matter_id, tenant_id\)[\s\S]*references matters \(id, tenant_id\)/i);
  assert.match(sql, /constraint upload_sessions_intake_tenant_fk[\s\S]*foreign key \(intake_id, tenant_id\)[\s\S]*references matter_intakes \(id, tenant_id\)/i);
  assert.match(sql, /constraint documents_matter_tenant_fk[\s\S]*foreign key \(matter_id, tenant_id\)[\s\S]*references matters \(id, tenant_id\)/i);
  assert.match(sql, /constraint documents_intake_tenant_fk[\s\S]*foreign key \(intake_id, tenant_id\)[\s\S]*references matter_intakes \(id, tenant_id\)/i);
  assert.match(sql, /constraint documents_upload_session_tenant_fk[\s\S]*foreign key \(upload_session_id, tenant_id\)[\s\S]*references upload_sessions \(id, tenant_id\)/i);
  assert.match(sql, /constraint document_blobs_document_tenant_fk[\s\S]*foreign key \(document_id, tenant_id\)[\s\S]*references documents \(id, tenant_id\)/i);
  assert.match(sql, /constraint extraction_records_document_tenant_fk[\s\S]*foreign key \(document_id, tenant_id\)[\s\S]*references documents \(id, tenant_id\)/i);
  assert.match(sql, /constraint document_text_blocks_extraction_tenant_fk[\s\S]*foreign key \(extraction_record_id, tenant_id\)[\s\S]*references extraction_records \(id, tenant_id\)/i);
  assert.match(sql, /constraint source_descriptors_document_tenant_fk[\s\S]*foreign key \(document_id, tenant_id\)[\s\S]*references documents \(id, tenant_id\)/i);
});

test("third database migration blocks cross-tenant job, artifact, and skill links", () => {
  const sql = readMigration();

  assert.match(sql, /constraint job_outbox_job_tenant_fk[\s\S]*foreign key \(job_id, tenant_id\)[\s\S]*references processing_jobs \(id, tenant_id\)/i);
  assert.match(sql, /constraint provider_runs_job_tenant_fk[\s\S]*foreign key \(job_id, tenant_id\)[\s\S]*references processing_jobs \(id, tenant_id\)/i);
  assert.match(sql, /constraint matter_artifacts_job_tenant_fk[\s\S]*foreign key \(created_by_job_id, tenant_id\)[\s\S]*references processing_jobs \(id, tenant_id\)/i);
  assert.match(sql, /constraint artifact_validation_artifact_tenant_fk[\s\S]*foreign key \(artifact_id, tenant_id\)[\s\S]*references matter_artifacts \(id, tenant_id\)/i);
  assert.match(sql, /constraint attention_acknowledgements_incident_tenant_fk[\s\S]*foreign key \(incident_id, tenant_id\)[\s\S]*references incidents \(id, tenant_id\)/i);
  assert.match(sql, /constraint skill_samples_idea_tenant_fk[\s\S]*foreign key \(idea_id, tenant_id\)[\s\S]*references skill_ideas \(id, tenant_id\)/i);
  assert.match(sql, /constraint configurable_skill_versions_skill_tenant_fk[\s\S]*foreign key \(skill_id, tenant_id\)[\s\S]*references configurable_skills \(id, tenant_id\)/i);
  assert.match(sql, /constraint configurable_skill_runs_skill_version_tenant_fk[\s\S]*foreign key \(skill_version_id, tenant_id\)[\s\S]*references configurable_skill_versions \(id, tenant_id\)/i);
});
