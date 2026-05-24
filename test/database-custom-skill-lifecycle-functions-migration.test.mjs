import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/011_custom_skill_lifecycle_functions.sql", import.meta.url);

function readMigration() {
  assert.ok(existsSync(migrationPath), "missing 011 custom skill lifecycle functions migration");
  return readFileSync(migrationPath, "utf8");
}

test("eleventh database migration adds a tenant-scoped custom skill lifecycle helper", () => {
  const sql = readMigration();

  assert.match(sql, /create index if not exists configurable_skills_tenant_status_idx/i);
  assert.match(sql, /on configurable_skills\s*\(tenant_id, status, updated_at desc\)/i);
  assert.match(sql, /create or replace function update_configurable_skill_lifecycle\(/i);
  assert.match(sql, /p_skill_id uuid/i);
  assert.match(sql, /p_action text/i);
  assert.match(sql, /p_reason text default null/i);
  assert.match(sql, /p_actor_user_id uuid default null/i);
  assert.match(sql, /returns table[\s\S]*skill_id uuid[\s\S]*previous_status text[\s\S]*new_status text/i);
  assert.match(sql, /from configurable_skills cs[\s\S]*cs\.id = p_skill_id[\s\S]*cs\.tenant_id = current_app_tenant_id\(\)/i);
});

test("custom skill lifecycle helper enforces allowed transitions", () => {
  const sql = readMigration();

  assert.match(sql, /case p_action[\s\S]*when 'suspend' then/i);
  assert.match(sql, /when 'resume' then/i);
  assert.match(sql, /when 'archive' then/i);
  assert.match(sql, /when 'restore' then/i);
  assert.match(sql, /when 'delete' then/i);
  assert.match(sql, /if skill_row\.status = 'disabled' then[\s\S]*raise exception 'previous skill versions cannot be lifecycle-mutated'/i);
  assert.match(sql, /when 'suspend' then[\s\S]*skill_row\.status = 'active'[\s\S]*next_status := 'suspended'/i);
  assert.match(sql, /when 'resume' then[\s\S]*skill_row\.status = 'suspended'[\s\S]*next_status := 'active'/i);
  assert.match(sql, /when 'restore' then[\s\S]*skill_row\.status = 'archived'[\s\S]*next_status := 'suspended'/i);
  assert.match(sql, /raise exception 'invalid configurable skill lifecycle transition/i);
});

test("custom skill lifecycle helper rejects resume slash collisions and records metadata", () => {
  const sql = readMigration();

  assert.match(sql, /if next_status = 'active' and exists \([\s\S]*from configurable_skills other[\s\S]*other\.tenant_id = current_app_tenant_id\(\)[\s\S]*other\.id <> p_skill_id[\s\S]*other\.slash = skill_row\.slash[\s\S]*other\.status = 'active'/i);
  assert.match(sql, /raise exception 'another active custom skill already owns this slash'/i);
  assert.match(sql, /update configurable_skills[\s\S]*set status = next_status[\s\S]*previous_status = skill_row\.status[\s\S]*status_changed_at = now\(\)[\s\S]*status_changed_by = p_actor_user_id[\s\S]*status_change_reason = p_reason/i);
  assert.match(sql, /where id = p_skill_id[\s\S]*tenant_id = current_app_tenant_id\(\)/i);
});
