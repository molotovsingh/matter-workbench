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
- `008_job_worker_functions.sql` adds atomic claim, heartbeat, completion, and
  retry functions for hosted processing jobs and outbox events.
- `009_incident_helper_functions.sql` adds canonical helpers for recording and
  resolving job, provider-run, and artifact-validation incidents.
- `010_advisory_snapshot_functions.sql` adds an append-only helper for
  preserving Preparation Advisory snapshots from canonical incidents and
  validation rows.
- `011_custom_skill_lifecycle_functions.sql` adds tenant-scoped pause, resume,
  archive, restore, and soft-delete transitions for configurable skills.

## Commands

```sh
npm run db:migrations:list
npm run db:migrations:check
npm run db:doctor
npm run db:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:migrate
MWB_DATABASE_URL="postgres://..." npm run db:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:shadow:inspect
MWB_DATABASE_URL="postgres://..." npm run db:shadow:inspect -- --matter "Atlas"
npm run db:skills:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:skills:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:skills:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:skills:shadow:inspect
npm run db:advisory:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:advisory:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:advisory:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:advisory:shadow:inspect
npm run db:storage:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:storage:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:storage:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:storage:shadow:inspect
npm run db:provider-runs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:provider-runs:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:provider-runs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:provider-runs:shadow:inspect
npm run db:costs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:costs:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:costs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:costs:shadow:inspect
MWB_DATABASE_URL="postgres://..." npm run db:shadow:report
```

`db:migrations:check` can run without a database URL. In that case it lists the
known migration files with `unknown` status.

`db:doctor` is a read-only deployment-prep check. It reports whether a database
URL is configured, whether `psql` is available, and the migration plan if the
database can be inspected. It redacts connection secrets and does not apply
anything.

`db:hydrate:dry-run` is a shadow-hydration rehearsal. It scans the local matter
folder, reads existing `matter.json`, `File Register.csv`, `Extraction Log.csv`,
`Source Index.json`, and `List of Dates.json` metadata, and reports the
control-plane rows that would be needed. It does not connect to Postgres, does
not read original source file bodies, and does not write database rows.

`db:hydrate` is the write-side shadow rehearsal. It uses the same local metadata
and inserts deterministic, idempotent control-plane rows into an already
migrated shadow database. It still does not switch app runtime reads or writes
to Postgres, does not store original source file bodies, and does not store
generated legal artifact bodies inline.

`db:hydrate:verify` compares the current shadow database row counts against the
local metadata plan. It sets the same local shadow tenant context used during
hydration and exits non-zero if any tenant-scoped control-plane count diverges.

`db:shadow:inspect` is a read-only shadow inspection command. It lists hydrated
matter control-plane summaries from Postgres using the local shadow tenant
context. Pass `-- --matter "name fragment"` to inspect one matter family without
switching app runtime reads to the database.

`db:skills:hydrate:dry-run` rehearses app-level skill factory hydration from the
local JSON stores: `skill-ideas.json`, `skill-samples.json`,
`configurable-skills.json`, and `configurable-skill-runs.json`. It plans skill
ideas, generated samples, configurable skills, skill versions, and run receipts.
It stores hashes/object-key style references for sample Markdown rather than
putting sample work product into Postgres.

`db:skills:hydrate`, `db:skills:hydrate:verify`, and
`db:skills:shadow:inspect` are the write, count-check, and read-only inspection
counterparts for that skill-factory shadow data. They are still shadow-only and
do not make the app read custom skills from Postgres.

`db:advisory:hydrate:dry-run` rehearses Preparation Advisory preservation. It
reads the current local matter attention projection, maps each item to a
canonical incident row, and plans one append-only advisory snapshot per mirrored
matter. `db:advisory:hydrate`, `db:advisory:hydrate:verify`, and
`db:advisory:shadow:inspect` apply, count-check, and inspect that shadow-only
advisory state. This still does not make the app read advisory state from
Postgres.

`db:storage:hydrate:dry-run` rehearses file-custody metadata without uploading
or reading source file bodies. It creates shadow `storage_objects`,
`document_blobs`, extraction-payload links, matter-artifact links, and
skill-sample links from existing local registers and ledgers. `db:storage:hydrate`,
`db:storage:hydrate:verify`, and `db:storage:shadow:inspect` apply, count-check,
and inspect those object-custody rows. This is still a pointer/lifecycle
rehearsal, not an object-storage runtime cutover.

`db:provider-runs:hydrate:dry-run` rehearses the provider-run ledger from
existing AI metadata on Source Index/List of Dates artifacts, skill samples, and
custom-skill run receipts. It stores provider/model/task/status/token/cost
metadata where available, and links rows back to the owning artifact, sample, or
run. It does not store prompts, context packets, model outputs, or generated
legal work product.

`db:costs:hydrate:dry-run` rehearses cost-governance rows derived from the
provider-run shadow plan. It creates one shadow `cost_events` row per mirrored
provider run, including known token/cost values where available and `unknown`
cost confidence where the local provider metadata lacks spend information. It is
still a ledger rehearsal, not a billing system or approval workflow.

`db:shadow:report` is the one-command read-only operator view. It verifies and
inspects matter control-plane rows, skill-factory rows, advisory snapshots,
storage-custody rows, provider-run links, and cost-event rows, then prints a
single summary of what the shadow database currently mirrors. Pass
`-- --matter "name fragment"` or
`-- --slash "/the_story"` to narrow the report.

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
