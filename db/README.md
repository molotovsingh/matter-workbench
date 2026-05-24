# Matter Workbench Database Migrations

This folder is the preparatory database track for hosted beta.

The local V1 app still runs from the filesystem-backed matter engines. These
migrations do not switch live matter storage to Postgres.

## Current Migrations

- `001_control_plane.sql` creates the hosted control plane: tenants, matters,
  document identity, object pointers, extraction records, jobs, provider runs,
  artifacts, incidents, advisory snapshots, costs, audit events, skill ideas,
  samples, custom skills, versions, and custom-skill run receipts.
- `002_tenant_rls.sql` enables and forces row-level security on tenant-scoped
  tables. Hosted sessions must set `app.tenant_id` before tenant legal data is
  visible.
- `003_tenant_reference_integrity.sql` adds tenant-consistent parent references
  so child rows cannot point at matters, jobs, artifacts, incidents, or custom
  skills owned by another tenant.
- `004_user_membership_integrity.sql` makes tenant-scoped user references point
  at tenant members and ties provider/cost approvals to tenant-local audit
  events.
- `005_storage_object_lifecycle.sql` adds a tenant-scoped storage-object ledger
  for private originals, extraction payloads, text payloads, generated artifacts,
  exports, and cleanup/orphan handling.
- `006_job_execution_leases.sql` adds worker claim, heartbeat, retry, and
  expired-lock metadata to hosted processing jobs and outbox events.
- `007_local_matter_import_ledger.sql` adds batch and per-file ledgers for
  importing existing local matter folders without silent renumbering or dropped
  import warnings.

## Commands

```sh
npm run db:migrations:list
npm run db:migrations:check
npm run db:doctor
MWB_DATABASE_URL="postgres://..." npm run db:migrate
```

`db:migrations:check` can run without a database URL. In that case it lists the
known migration files with `unknown` status.

`db:doctor` is a read-only deployment-prep check. It reports whether a database
URL is configured, whether `psql` is available, and the migration plan if the
database can be inspected. It redacts connection secrets and does not apply
anything.

`db:migrate` requires `psql` and records applied migrations in
`schema_migrations` with SHA-256 checksums. If an already-applied migration file
changes, the runner fails closed. Add a new numbered migration instead of editing
an applied one. Migration numbers must stay gapless from `001`; the runner
rejects missing numbers before listing, checking, doctoring, or applying.

## Runtime Cutover Stop Rule

Do not wire production matter reads/writes to Postgres until these decisions are
made explicitly:

- hosted database URL and migration environment;
- object storage provider and bucket layout;
- tenant/session auth model that sets `app.tenant_id`;
- backup, restore, and deletion policy;
- import path from existing local matter folders;
- observability for jobs, provider runs, incidents, and advisory snapshots.
