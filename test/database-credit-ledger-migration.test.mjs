import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/019_credit_ledger.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

function tableBlock(sql, tableName) {
  const match = sql.match(new RegExp(`create table if not exists ${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"));
  assert.ok(match, `missing table ${tableName}`);
  return match[1];
}

test("nineteenth database migration adds tenant-scoped credit ledger primitives", () => {
  const sql = readMigration();
  for (const tableName of ["credit_accounts", "credit_grants", "credit_reservations", "credit_ledger"]) {
    assert.match(sql, new RegExp(`create table if not exists ${tableName}\\b`, "i"), tableName);
    assert.match(tableBlock(sql, tableName), /\btenant_id uuid not null references tenants\(id\)/i, `${tableName} must be tenant-scoped`);
    assert.match(sql, new RegExp(`alter table ${tableName} enable row level security`, "i"), `${tableName} must enable RLS`);
    assert.match(sql, new RegExp(`create policy ${tableName}_tenant_isolation[\\s\\S]*using \\(tenant_id = current_app_tenant_id\\(\\)\\)`, "i"), `${tableName} must isolate tenants`);
  }
});

test("nineteenth database migration separates credits from provider costs", () => {
  const sql = readMigration();

  assert.match(tableBlock(sql, "credit_accounts"), /account_type text not null check \(account_type in \('tenant_pool', 'user_limit', 'matter_budget'\)\)/i);
  assert.match(tableBlock(sql, "credit_grants"), /credits numeric not null check \(credits > 0\)/i);
  assert.match(tableBlock(sql, "credit_reservations"), /credits_reserved numeric not null check \(credits_reserved > 0\)/i);
  assert.match(tableBlock(sql, "credit_ledger"), /credits_delta numeric not null/i);
  assert.match(tableBlock(sql, "credit_ledger"), /currency text not null default 'MWB_CREDIT'/i);
  assert.match(tableBlock(sql, "credit_ledger"), /cost_event_id uuid references cost_events\(id\)/i);
  assert.doesNotMatch(sql, /alter table cost_events\s+add column[\s\S]*credits_delta/i);
});

test("nineteenth database migration makes credit writes idempotent", () => {
  const sql = readMigration();

  assert.match(tableBlock(sql, "credit_grants"), /idempotency_key text not null/i);
  assert.match(tableBlock(sql, "credit_reservations"), /idempotency_key text not null/i);
  assert.match(tableBlock(sql, "credit_ledger"), /idempotency_key text not null/i);
  assert.match(tableBlock(sql, "credit_grants"), /unique \(tenant_id, idempotency_key\)/i);
  assert.match(tableBlock(sql, "credit_reservations"), /unique \(tenant_id, idempotency_key\)/i);
  assert.match(tableBlock(sql, "credit_ledger"), /unique \(tenant_id, idempotency_key\)/i);
});

test("nineteenth database migration keeps credit references tenant-local", () => {
  const sql = readMigration();

  assert.match(sql, /create unique index if not exists credit_accounts_id_tenant_id_unique\s+on credit_accounts \(id, tenant_id\)/i);
  assert.match(sql, /create unique index if not exists cost_events_id_tenant_id_unique\s+on cost_events \(id, tenant_id\)/i);
  assert.match(sql, /constraint credit_grants_account_tenant_fk[\s\S]*foreign key \(account_id, tenant_id\)[\s\S]*references credit_accounts \(id, tenant_id\)/i);
  assert.match(sql, /constraint credit_reservations_provider_run_tenant_fk[\s\S]*foreign key \(provider_run_id, tenant_id\)[\s\S]*references provider_runs \(id, tenant_id\)/i);
  assert.match(sql, /constraint credit_ledger_account_tenant_fk[\s\S]*foreign key \(account_id, tenant_id\)[\s\S]*references credit_accounts \(id, tenant_id\)/i);
  assert.match(sql, /constraint credit_ledger_provider_run_tenant_fk[\s\S]*foreign key \(provider_run_id, tenant_id\)[\s\S]*references provider_runs \(id, tenant_id\)/i);
  assert.match(sql, /constraint credit_ledger_cost_event_tenant_fk[\s\S]*foreign key \(cost_event_id, tenant_id\)[\s\S]*references cost_events \(id, tenant_id\)/i);
});

test("nineteenth database migration supports one active pool per tenant and active overlays", () => {
  const sql = readMigration();

  assert.match(sql, /create unique index if not exists credit_accounts_one_active_tenant_pool[\s\S]*on credit_accounts \(tenant_id\)[\s\S]*where account_type = 'tenant_pool' and status = 'active'/i);
  assert.match(sql, /create unique index if not exists credit_accounts_one_active_user_limit[\s\S]*on credit_accounts \(tenant_id, user_id\)[\s\S]*where account_type = 'user_limit' and status = 'active'/i);
  assert.match(sql, /create unique index if not exists credit_accounts_one_active_matter_budget[\s\S]*on credit_accounts \(tenant_id, matter_id\)[\s\S]*where account_type = 'matter_budget' and status = 'active'/i);
  assert.match(tableBlock(sql, "credit_accounts"), /account_type = 'tenant_pool' and user_id is null and matter_id is null/i);
  assert.match(tableBlock(sql, "credit_accounts"), /account_type = 'user_limit' and user_id is not null and matter_id is null/i);
  assert.match(tableBlock(sql, "credit_accounts"), /account_type = 'matter_budget' and user_id is null and matter_id is not null/i);
});
