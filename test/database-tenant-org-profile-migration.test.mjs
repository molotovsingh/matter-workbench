import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/012_tenant_org_profile.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

test("twelfth database migration makes tenant organization posture explicit", () => {
  const sql = readMigration();

  assert.match(sql, /alter table tenants\s+add column if not exists account_scope text/i);
  assert.match(sql, /account_scope = case when type = 'firm' then 'organization' else 'single_user' end/i);
  assert.match(sql, /constraint tenants_account_scope_check[\s\S]*check \(account_scope in \('single_user', 'organization'\)\)/i);
  assert.match(sql, /alter table tenants\s+add column if not exists organization_slug text/i);
  assert.match(sql, /create unique index if not exists tenants_organization_slug_unique/i);
  assert.match(sql, /where organization_slug is not null/i);
});

test("twelfth database migration records bare multi-user capacity and owner linkage", () => {
  const sql = readMigration();

  assert.match(sql, /alter table tenants\s+add column if not exists max_member_count integer/i);
  assert.match(sql, /max_member_count = case when account_scope = 'organization' then greatest\(max_member_count, 2\) else coalesce\(max_member_count, 1\) end/i);
  assert.match(sql, /constraint tenants_max_member_count_positive[\s\S]*check \(max_member_count > 0\)/i);
  assert.match(sql, /constraint tenants_org_member_capacity_check[\s\S]*check \(\s*account_scope = 'single_user'[\s\S]*or max_member_count >= 2[\s\S]*\)/i);
  assert.match(sql, /alter table tenants\s+add column if not exists primary_owner_user_id uuid/i);
  assert.match(sql, /constraint tenants_primary_owner_user_fk[\s\S]*foreign key \(primary_owner_user_id\)[\s\S]*references users \(id\)/i);
  assert.match(sql, /constraint tenants_primary_owner_membership_fk[\s\S]*foreign key \(id, primary_owner_user_id\)[\s\S]*references tenant_memberships \(tenant_id, user_id\)[\s\S]*deferrable initially deferred/i);
});
