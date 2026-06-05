import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/013_hosted_auth_session_model.sql", import.meta.url);
const userRlsMigrationPath = new URL("../db/migrations/014_tenant_sessions_user_rls.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

function readUserRlsMigration() {
  return readFileSync(userRlsMigrationPath, "utf8");
}

test("thirteenth database migration adds provider-neutral auth identities", () => {
  const sql = readMigration();

  assert.match(sql, /create table if not exists auth_identities/i);
  assert.match(sql, /provider text not null/i);
  assert.match(sql, /provider_subject text not null/i);
  assert.match(sql, /user_id uuid not null references users\(id\)/i);
  assert.match(sql, /unique \(provider, provider_subject\)/i);
  assert.match(sql, /create unique index if not exists auth_identities_id_user_id_unique/i);
  assert.match(sql, /status text not null default 'active'/i);
});

test("thirteenth database migration adds tenant-scoped sessions tied to membership", () => {
  const sql = readMigration();

  assert.match(sql, /create table if not exists tenant_sessions/i);
  assert.match(sql, /tenant_id uuid not null references tenants\(id\)/i);
  assert.match(sql, /user_id uuid not null references users\(id\)/i);
  assert.match(sql, /auth_identity_id uuid references auth_identities\(id\)/i);
  assert.match(sql, /session_hash text not null/i);
  assert.match(sql, /unique \(session_hash\)/i);
  assert.match(sql, /foreign key \(tenant_id, user_id\) references tenant_memberships \(tenant_id, user_id\)/i);
  assert.match(sql, /foreign key \(auth_identity_id, user_id\) references auth_identities \(id, user_id\)/i);
  assert.match(sql, /status text not null default 'active'[\s\S]*check \(status in \('active', 'revoked', 'expired'\)\)/i);
});

test("thirteenth database migration protects tenant sessions with tenant RLS", () => {
  const sql = readMigration();

  assert.match(sql, /alter table tenant_sessions enable row level security/i);
  assert.match(sql, /alter table tenant_sessions force row level security/i);
  assert.match(sql, /create policy tenant_sessions_tenant_isolation[\s\S]*using \(tenant_id = current_app_tenant_id\(\)\)/i);
  assert.match(sql, /with check \(tenant_id = current_app_tenant_id\(\)\)/i);
  assert.match(sql, /create or replace function current_app_user_id\(\)/i);
});

test("fourteenth database migration also binds hosted session rows to the current app user", () => {
  const sql = readUserRlsMigration();

  assert.match(sql, /drop policy if exists tenant_sessions_tenant_isolation on tenant_sessions/i);
  assert.match(sql, /create policy tenant_sessions_tenant_isolation/i);
  assert.match(sql, /using \(tenant_id = current_app_tenant_id\(\) and user_id = current_app_user_id\(\)\)/i);
  assert.match(sql, /with check \(tenant_id = current_app_tenant_id\(\) and user_id = current_app_user_id\(\)\)/i);
});
