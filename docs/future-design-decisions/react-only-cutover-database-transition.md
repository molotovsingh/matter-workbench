# React-Only Cutover And Database Transition

Date: 2026-05-24
Status: Current local contract / transition prep

## Decision

Matter Workbench V1 local beta is React-only.

- `/` serves the compiled React shell.
- `/react/` remains a React alias for compatibility and Vite-dev testing.
- The previous plain-JS shell is retired as a product fallback.
- Backend API route shapes remain unchanged.
- Database migration is a separate control-plane track, not part of this UI cutover.

The point of this cutover is to stop maintaining two browser products while
keeping useful helper code long enough to migrate or delete it safely.

## Legacy Frontend Buckets

### Retired Product UX

These root shell files have been deleted because they are no longer product
surfaces:

- `index.html`
- `app.js`
- `styles.css`
- `frontend/event-wiring.js`
- `frontend/skills/context-preview.js`
- `frontend/skills/context-search.js`
- `frontend/skills/create-listofdates.js`
- `frontend/skills/describe-sources.js`
- `frontend/skills/doctor.js`
- `frontend/skills/extract.js`
- `frontend/skills/matter-init.js`
- `frontend/skills/prepare-matter.js`
- `frontend/matter-screens.js`
- `frontend/state.js`
- `frontend/views/add-files.js`
- `frontend/views/extract-result.js`
- `frontend/views/settings-page.js`

These legacy entrypoints are still present only while helper dependencies and
tests are migrated, and should not be imported by new product code:

- `frontend/ai-command-box.js`
- `frontend/views/skills-page.js`

They can be deleted when old tests and any remaining helper dependencies have
been migrated. Route tests must continue to ensure retired shell paths are not
served from the product entrypoint.

### Keep Temporarily

Some `frontend/*` modules are pure enough to keep while tests still depend on
them:

- escaping and presentation helpers;
- command parsing and command classification helpers;
- file collection helpers;
- markdown/List of Dates preview helpers;
- receipt and run-report formatting helpers;
- small rendering helpers used by legacy tests until React equivalents fully
  own the contract.

Keeping these temporarily does not make the old shell supported. It only avoids
deleting useful tested logic before the replacement module exists.

### Promote Later

Helpers that remain valuable should move to the right owner before deletion of
the old frontend tree:

- shared, UI-agnostic contracts -> `shared/*`;
- React-only view helpers -> `react-ui/src/lib/*` or React components;
- backend/reporting helpers -> `services/*` or `routes/*`, depending on the
  owner.

No new product work should add imports from retired legacy UX entrypoints.

## Database Transition First Slice

Do not combine the React-only cutover with a database rewrite.

The first database slice should be a control plane:

- matters and matter ownership;
- document identity, source numbers, and checksums;
- upload/import jobs and long-running job state;
- provider runs and model/cost metadata;
- incidents, advisory items, and validation results;
- skill ideas and generated skill samples;
- custom skill definitions, lifecycle state, and version pointers;
- custom skill run receipts.

Files and generated artifacts can remain filesystem-backed locally and
object-storage-backed when hosted. The database should point to those payloads
and own their identity, lifecycle, and audit trail. It should not become the
place where large source files or generated legal artifacts are stored inline.

The first schema baseline now lives at:

- `db/migrations/001_control_plane.sql`
- `db/migrations/002_tenant_rls.sql`
- `db/migrations/003_tenant_reference_integrity.sql`
- `db/migrations/004_user_membership_integrity.sql`
- `db/migrations/005_storage_object_lifecycle.sql`
- `db/migrations/006_job_execution_leases.sql`
- `db/migrations/007_local_matter_import_ledger.sql`
- `db/migrations/008_job_worker_functions.sql`
- `db/migrations/009_incident_helper_functions.sql`
- `db/migrations/010_advisory_snapshot_functions.sql`
- `db/migrations/011_custom_skill_lifecycle_functions.sql`
- `scripts/db-migrate.mjs`

These migrations are intentionally preparatory. `001_control_plane.sql` creates
the hosted control-plane shape for tenancy, document identity, jobs, provider
runs, incidents, advisory snapshots, artifacts, costs, audit events, and
configurable-skill ledgers. It also installs a shared `updated_at` trigger helper
on mutable control-plane tables. `002_tenant_rls.sql` enables and forces
row-level security for tenant-scoped tables and denies access unless the DB
session sets `app.tenant_id`. `003_tenant_reference_integrity.sql` adds
tenant-consistent parent references so tenant-scoped rows cannot point at parent
matter, job, artifact, incident, or skill rows owned by another tenant.
`004_user_membership_integrity.sql` makes tenant-scoped user references point at
tenant members and ties provider/cost approvals to tenant-local audit events.
`005_storage_object_lifecycle.sql` adds a tenant-scoped storage object custody
ledger for originals, extraction payloads, text payloads, artifacts, exports,
and cleanup candidates while leaving existing object-key columns in place.
`006_job_execution_leases.sql` adds worker claim, heartbeat, retry, and
expired-lock metadata to `processing_jobs` and `job_outbox`, so hosted workers
can be durable later without inventing an ad hoc queue outside Postgres.
`007_local_matter_import_ledger.sql` adds batch and per-file ledgers for
migrating existing local matter folders without silent source renumbering,
dropped import warnings, or cross-tenant references.
`008_job_worker_functions.sql` adds database-side claim, heartbeat, completion,
and retry functions for processing jobs and outbox events, keeping the future
worker queue atomic inside Postgres. `009_incident_helper_functions.sql` adds
canonical helpers for recording job failures, provider-run failures, and
artifact-validation warnings as tenant-scoped incidents, and for resolving those
incidents later. `010_advisory_snapshot_functions.sql` preserves append-only
Preparation Advisory snapshots from open incidents and validation rows.
`011_custom_skill_lifecycle_functions.sql` adds database-owned lifecycle
transitions for configurable skills only, keeping native skills read-only and
app-owned. None of these migrations switches the local runtime away from the
filesystem-backed engines.

Developer commands:

```bash
npm run db:migrations:list
npm run db:migrations:check
npm run db:doctor
npm run db:shadow:preflight
npm run db:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:migrate
MWB_DATABASE_URL="postgres://..." npm run db:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:shadow:inspect
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
npm run db:jobs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:jobs:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:jobs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:jobs:shadow:inspect
npm run db:costs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:costs:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:costs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:costs:shadow:inspect
npm run db:audit:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:audit:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:audit:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:audit:shadow:inspect
npm run db:shadow:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:shadow:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:shadow:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:shadow:report
MWB_DATABASE_URL="postgres://..." npm run db:shadow:snapshot
```

`db:migrations:check` can run without a database URL; in that case it lists the
available migration files with unknown status. `db:doctor` is the read-only
handoff command: it checks URL presence, `psql`, and the migration plan while
redacting connection secrets. `db:shadow:preflight` is the one-command
read-only readiness check that combines `db:doctor` with the full shadow
hydration dry-run. If it says `psql` is available and dry-run planning works
but the database URL is missing, the repo-side DB path is waiting for database
URL / credential setup rather than another code change. The tools honor
`MWB_PSQL_BIN`, auto-discover common PostgreSQL client paths such as Homebrew
`libpq`, and finally fall back to `psql` on `PATH`. With a database URL, the
runner records applied versions and SHA-256 checksums in `schema_migrations`,
serializes each migration transaction with a Postgres advisory lock, and fails
closed if an already-applied migration file is edited. The migration file
sequence is also gapless: `001`, `002`, `003`, and so on. A missing number stops
the runner before any deployment applies a later migration.

`db:hydrate:dry-run`, `db:hydrate`, `db:hydrate:verify`, and
`db:shadow:inspect` are shadow-only transition commands. They rehearse metadata
hydration from local matter folders into Postgres and then verify or inspect the
result. They do not make Postgres the runtime storage backend, and they do not
store original source files or generated legal work product inline.

The `db:skills:*` commands perform the same shadow-only rehearsal for app-level
skill factory ledgers: skill ideas, skill samples, configurable skills,
versions, and custom-skill run receipts. Sample Markdown is represented by hash
and object-key style metadata rather than inline legal work product.

The `db:advisory:*` commands perform the same shadow-only rehearsal for
Preparation Advisory preservation. They map local matter attention items into
canonical incident rows, then append one advisory snapshot per mirrored matter.
This keeps attention as a projection over incidents instead of turning it into a
second durable truth source.

The `db:storage:*` commands rehearse object-custody metadata. They mirror local
file identities into `storage_objects` and `document_blobs`, then link extraction
payloads, matter artifacts, and skill samples to storage-object rows. They do not
upload source documents or generated work product, and they do not make the app
read from object storage.

The `db:provider-runs:*` commands rehearse the AI run ledger from metadata
already attached to source-backed artifacts, skill samples, and custom-skill run
receipts. They mirror provider, model, task class, status, token, and cost
metadata where available, then link each run back to its artifact, sample, or
custom-skill run. They do not copy prompts, context packets, model outputs, or
generated legal work product into Postgres.

The `db:jobs:*` commands rehearse `processing_jobs` only where the local record
has enough evidence: provider-run-backed work. They create shadow jobs for
source labels, List of Dates, skill creation, and skill execution, then link
`provider_runs.job_id`. They do not backfill a `job_outbox` or pretend local V1
had a durable hosted queue.

The `db:costs:*` commands rehearse cost-governance rows from the provider-run
shadow ledger. They preserve known token and cost values where available, and
record `unknown` confidence where the local metadata does not know spend. This
is a visibility rehearsal for future budget/approval controls, not a billing
backend.

The `db:audit:*` commands rehearse privacy-safe audit-event rows from the local
command interaction log. They mirror action names, matched matter links,
provider-invoked flags, and small routing/status metadata, but intentionally do
not copy raw typed input, terminal lines, router reasoning, prompts, error
details, or legal work product into Postgres. This is the first audit-trail
rehearsal, not a chat transcript database.

The `db:shadow:hydrate:*` commands are operator shortcuts over the same
shadow-only tracks. Dry-run mode executes all planners without a database URL.
Apply mode hydrates all rows in dependency order and then runs the combined
report. Verify mode runs all count checks and then runs the combined report.
This reduces handoff friction without adding a runtime database dependency.

`db:shadow:report` is the combined read-only report. It verifies and inspects
matter metadata, skill-factory metadata, advisory snapshots, storage-custody
rows, provider-run links, job links, cost-event rows, and audit-event rows from
the same tenant-scoped shadow database, so handoff review does not require
stitching together separate matter, skill, advisory, storage, provider-run, job,
cost, and audit command outputs.

`db:shadow:snapshot` freezes that combined report into timestamped Markdown and
JSON files under `docs/shadow-db-snapshots/`. This is the handoff artifact for
the shadow database track: it lets a developer inspect exactly what the VM
shadow database mirrored at a point in time, without making Postgres the runtime
backend. Treat each snapshot as one-run evidence, not live truth. Refresh it
after meaningful repo changes, local matter folder or skill-ledger changes, or
another shadow hydration / verify pass.

## Stop Rule

Do not start hosted legal-engine execution until the database/object-storage/job
foundation proves:

- tenant or organization scoping;
- private file custody;
- idempotent upload/object lifecycle;
- durable job state;
- provider-run ledger;
- incident/advisory projection;
- audit events.

Until that foundation exists, keep legal engines on the local filesystem-backed
path and keep the database work preparatory.
