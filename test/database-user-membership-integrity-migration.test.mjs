import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/004_user_membership_integrity.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

test("fourth database migration enforces tenant membership for user references", () => {
  const sql = readMigration();
  const userReferenceConstraints = [
    ["matter_memberships_user_tenant_member_fk", "matter_memberships", "user_id"],
    ["matters_created_by_tenant_member_fk", "matters", "created_by_user_id"],
    ["matter_intakes_created_by_tenant_member_fk", "matter_intakes", "created_by_user_id"],
    ["upload_sessions_created_by_tenant_member_fk", "upload_sessions", "created_by_user_id"],
    ["source_descriptors_confirmed_by_tenant_member_fk", "source_descriptors", "confirmed_by_user_id"],
    ["processing_jobs_created_by_tenant_member_fk", "processing_jobs", "created_by_user_id"],
    ["attention_acknowledgements_user_tenant_member_fk", "attention_acknowledgements", "user_id"],
    ["audit_events_actor_tenant_member_fk", "audit_events", "actor_user_id"],
    ["skill_ideas_created_by_tenant_member_fk", "skill_ideas", "created_by_user_id"],
    ["configurable_skills_created_by_tenant_member_fk", "configurable_skills", "created_by_user_id"],
    ["configurable_skills_status_changed_by_tenant_member_fk", "configurable_skills", "status_changed_by"],
    ["configurable_skill_versions_created_by_tenant_member_fk", "configurable_skill_versions", "created_by_user_id"],
  ];

  for (const [constraintName, tableName, userColumn] of userReferenceConstraints) {
    assert.match(
      sql,
      new RegExp(`alter table ${tableName}[\\s\\S]*constraint ${constraintName}[\\s\\S]*foreign key \\(tenant_id, ${userColumn}\\)[\\s\\S]*references tenant_memberships \\(tenant_id, user_id\\)`, "i"),
      `${tableName}.${userColumn} must point to a user in the same tenant`,
    );
  }
});

test("fourth database migration ties cost approvals to tenant audit events", () => {
  const sql = readMigration();

  assert.match(
    sql,
    /create unique index if not exists audit_events_id_tenant_id_unique\s+on audit_events\s*\(id, tenant_id\)/i,
  );
  assert.match(
    sql,
    /alter table provider_runs[\s\S]*constraint provider_runs_approval_event_tenant_fk[\s\S]*foreign key \(approval_event_id, tenant_id\)[\s\S]*references audit_events \(id, tenant_id\)/i,
  );
  assert.match(
    sql,
    /alter table cost_events[\s\S]*constraint cost_events_approval_event_tenant_fk[\s\S]*foreign key \(approval_event_id, tenant_id\)[\s\S]*references audit_events \(id, tenant_id\)/i,
  );
});
