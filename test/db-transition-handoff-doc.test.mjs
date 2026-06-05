import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const handoffDocPath = new URL("../docs/database-transition-handoff.md", import.meta.url);
const docsReadmePath = new URL("../docs/README.md", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const localVmPasswordPattern = ["aks", "ingh11"].join("");
const passwordPlaceholderPattern = ["choose", "a", "password", "here"].join("-");

test("database transition handoff doc records the shadow-only path without secrets", async () => {
  const doc = await readFile(handoffDocPath, "utf8");

  assert.match(doc, /# Database Transition Handoff/);
  assert.match(doc, /shadow-only/i);
  assert.match(doc, /npm run db:migrate/);
  assert.match(doc, /npm run db:shadow:hydrate/);
  assert.match(doc, /npm run db:shadow:hydrate:verify/);
  assert.match(doc, /npm run db:shadow:snapshot/);
  assert.match(doc, /repo branch, short\s+commit, and whether\s+the worktree was clean/i);
  assert.match(doc, /npm run db:shadow:backup/);
  assert.match(doc, /npm run db:shadow:storage-backup/);
  assert.match(doc, /npm run db:shadow:storage-restore-check/);
  assert.match(doc, /\.local\/shadow-db-backups/);
  assert.match(doc, /\.local\/shadow-storage-backups/);
  assert.match(doc, /db:doctor[\s\S]*preflight/i);
  assert.match(doc, /db:shadow:snapshot[\s\S]*ready_to_hydrate:\s*yes/i);
  assert.match(doc, /db:shadow:snapshot[\s\S]*refuses to write/i);
  assert.match(doc, /restored DB rows[\s\S]*missing PDFs/i);
  assert.match(doc, /database backup[\s\S]*local storage/i);
  assert.match(doc, /durable object storage/i);
  assert.match(doc, /MWB_PSQL_BIN/);
  assert.match(doc, /Homebrew[\s\S]*libpq/i);
  assert.match(doc, /\.env\.shadow/);
  assert.match(doc, /\.env\.shadow[\s\S]*ignored/i);
  assert.match(doc, /docs\/shadow-db-snapshots\/shadow-db-snapshot-\d{4}-\d{2}-\d{2}T[0-9-]+Z\.md/);
  assert.match(doc, /docs\/shadow-db-restore-drills\/shadow-db-restore-drill-\d{4}-\d{2}-\d{2}T[0-9-]+Z\.md/);
  assert.match(doc, /docs\/shadow-storage-restore-checks\/shadow-storage-restore-check-\d{4}-\d{2}-\d{2}T[0-9-]+Z\.md/);
  assert.match(doc, /15 matters, 180 documents, 180 extraction\s+records, 125 source descriptors/i);
  assert.match(doc, /8 configurable skills,\s+22 configurable-skill runs/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*one[- ]run evidence/i);
  assert.match(doc, /Current Restore Drill Evidence[\s\S]*temporary\s+PostgreSQL\s+database/i);
  assert.match(doc, /Current Restore Drill Evidence[\s\S]*drop restore database:\s*ok/i);
  assert.match(doc, /Current Storage Restore-Check Evidence[\s\S]*168 checked PDF objects/i);
  assert.match(doc, /Current Storage Restore-Check Evidence[\s\S]*0 failed objects/i);
  assert.match(doc, /Accepted Single-Host Storage Policy[\s\S]*local-filesystem/i);
  assert.match(doc, /Accepted Single-Host Storage Policy[\s\S]*single-host/i);
  assert.match(doc, /Accepted Single-Host Storage Policy[\s\S]*object_storage_or_single_host_volume_policy/i);
  assert.match(doc, /Accepted Single-Host Storage Policy[\s\S]*not a multi-host/i);
  assert.match(doc, /Accepted Postgres-Unavailable Local Runtime Policy[\s\S]*local filesystem-backed runtime/i);
  assert.match(doc, /Accepted Postgres-Unavailable Local Runtime Policy[\s\S]*bogus\s+database\s+URL/i);
  assert.match(doc, /Accepted Postgres-Unavailable Local Runtime Policy[\s\S]*postgres_unavailable_user_behavior/i);
  assert.match(doc, /Accepted Postgres-Unavailable Local Runtime Policy[\s\S]*not a hosted outage/i);
  assert.match(doc, /Accepted Local Matter Import Policy[\s\S]*matter_import_batches/i);
  assert.match(doc, /Accepted Local Matter Import Policy[\s\S]*local_matter_import_policy/i);
  assert.match(doc, /Accepted Incident And Advisory Preservation[\s\S]*canonical\s+incident rows/i);
  assert.match(doc, /Accepted Incident And Advisory Preservation[\s\S]*incident_advisory_preservation_policy/i);
  assert.match(doc, /Accepted Tenant Organization Profile[\s\S]*account_scope/i);
  assert.match(doc, /Accepted Tenant Organization Profile[\s\S]*organization_slug/i);
  assert.match(doc, /Accepted Tenant Organization Profile[\s\S]*primary_owner_user_id/i);
  assert.match(doc, /Accepted Tenant Organization Profile[\s\S]*hosted auth and tenant-session model/i);
  assert.doesNotMatch(doc, /Stop Rule[\s\S]*import policy for existing local matter folders/i);
  assert.doesNotMatch(doc, /Stop Rule[\s\S]*incident\/advisory preservation policy/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*not live truth/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*repo changes/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*local matter/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*source repo state/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*do not keep refreshing/i);
  assert.match(doc, /Do not cut over runtime reads or writes/i);
  assert.doesNotMatch(
    doc,
    new RegExp(`${localVmPasswordPattern}|${passwordPlaceholderPattern}|192\\.168\\.210\\.\\d+|postgres:\\/\\/[^"\\s]+`),
  );
});

test("documentation map links the database transition handoff", async () => {
  const docsReadme = await readFile(docsReadmePath, "utf8");
  const dbReadme = await readFile(dbReadmePath, "utf8");

  assert.match(docsReadme, /\[Database Transition Handoff\]\(database-transition-handoff\.md\)/);
  assert.match(dbReadme, /\[Database Transition Handoff\]\(\.\.\/docs\/database-transition-handoff\.md\)/);
});
