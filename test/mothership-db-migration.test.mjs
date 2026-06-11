import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../mothership/db/migrations/001_mothership.sql", import.meta.url);
const metricsMigrationPath = new URL("../mothership/db/migrations/002_mothership_metrics.sql", import.meta.url);
const runnerPath = new URL("../mothership/db-migrate.mjs", import.meta.url);

test("mothership migration isolates installations, tokens, feedback, and signals", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /create table if not exists mothership_installations/i);
  assert.match(sql, /installation_id text primary key/i);
  assert.match(sql, /status text not null default 'active'/i);

  assert.match(sql, /create table if not exists mothership_ingestion_tokens/i);
  assert.match(sql, /token_sha256 text not null unique/i);
  assert.doesNotMatch(sql, /raw_token|token_plaintext/i);
  assert.match(sql, /references mothership_installations\(installation_id\) on delete cascade/i);
  assert.match(sql, /create index[^;]+mothership_ingestion_tokens[^;]+installation_id/i);

  assert.match(sql, /create table if not exists mothership_feedback_events/i);
  assert.match(sql, /unique \(installation_id, feedback_id\)/i);
  assert.match(sql, /payload jsonb not null/i);
  assert.match(sql, /create index[^;]+mothership_feedback_events[^;]+received_at/i);
  assert.match(sql, /create index[^;]+mothership_feedback_events[^;]+classification/i);

  assert.match(sql, /create table if not exists mothership_signal_events/i);
  assert.match(sql, /unique \(installation_id, signal_id\)/i);
  assert.match(sql, /occurrence_count integer not null/i);
  assert.match(sql, /create index[^;]+mothership_signal_events[^;]+severity/i);
  assert.match(sql, /create index[^;]+mothership_signal_events[^;]+received_at/i);

  assert.doesNotMatch(sql, /references\s+(tenants|matters|documents|processing_jobs)/i);
});

test("mothership metrics migration stores operator-only deployment snapshots", async () => {
  const sql = await readFile(metricsMigrationPath, "utf8");

  assert.match(sql, /create table if not exists mothership_metric_snapshots/i);
  assert.match(sql, /installation_id text not null references mothership_installations/i);
  assert.match(sql, /snapshot_id text not null/i);
  assert.match(sql, /captured_at timestamptz not null/i);
  assert.match(sql, /payload jsonb not null/i);
  assert.match(sql, /unique \(installation_id, snapshot_id\)/i);
  assert.match(sql, /create index[^;]+mothership_metric_snapshots[^;]+received_at/i);
});

test("mothership migration runner uses its own database URL and migration directory", async () => {
  const {
    defaultMothershipMigrationsDir,
    resolveMothershipDatabaseUrl,
    listMothershipMigrations,
  } = await import(runnerPath.href);

  assert.equal(
    resolveMothershipDatabaseUrl({ env: { MOTHERSHIP_DATABASE_URL: "postgres://mothership" } }),
    "postgres://mothership",
  );
  assert.equal(resolveMothershipDatabaseUrl({ env: { MWB_DATABASE_URL: "postgres://wrong" } }), "");
  assert.match(defaultMothershipMigrationsDir, /mothership\/db\/migrations$/);

  const migrations = await listMothershipMigrations();
  assert.deepEqual(migrations.map((migration) => migration.fileName), ["001_mothership.sql", "002_mothership_metrics.sql"]);
});
