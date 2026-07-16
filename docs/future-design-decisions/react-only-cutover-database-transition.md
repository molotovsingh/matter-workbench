# React-Only Cutover And Database Transition

Date: 2026-06-06
Status: Current local contract / runtime DB transition

## Decision

Matter Workbench V1 local beta is React-only.

- `/` serves the compiled React shell.
- `/react/` remains a React alias for compatibility and Vite-dev testing.
- The previous plain-JS shell is retired as a product fallback.
- Backend API route shapes remain unchanged.
- Database migration started as a separate control-plane track. It now also has
  an accepted local/private runtime DB storage and write-bridge slice behind
  explicit runtime flags. Hosted workers and cloud deployment remain separate.

The cutover now has one browser product. The former plain-JS `frontend/` tree,
its root shell files, and its legacy-only tests have been deleted. Reusable
contracts live under `shared/`; React presentation and interaction behavior
live under `react-ui/src/` and are covered by React-side contract tests plus the
live UI smoke pack. Route tests continue to ensure retired shell paths are not
served from the product entrypoint.

## Legacy Frontend Status

- `index.html`, `app.js`, and `styles.css` remain deleted.
- The former root-level `frontend/` tree remains deleted.
- No product or test code may import the retired plain-JS browser surface.
- Do not recreate a compatibility or fallback shell. Shared behavior belongs in
  `shared/`; browser behavior belongs in `react-ui/src/`.

## Database Transition Slices

Do not confuse the React-only cutover with the database transition. The UI
cutover removed the old browser product. The DB track started as a control
plane, then added an explicit local/private runtime mode.

The first database slice was a control plane:

- matters and matter ownership;
- document identity, source numbers, and checksums;
- upload/import jobs and long-running job state;
- provider runs and model/cost metadata;
- incidents, advisory items, and validation results;
- skill ideas and generated skill samples;
- custom skill definitions, lifecycle state, and version pointers;
- custom skill run receipts.

Files and generated artifacts can remain filesystem-backed in ordinary local
mode and object-storage-backed when hosted. For local/private runtime DB mode,
`storage_object_payloads` can store source and artifact bytes in Postgres so a
DB backup does not merely restore object keys pointing at missing files.

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
- `db/migrations/012_tenant_org_profile.sql`
- `db/migrations/013_hosted_auth_session_model.sql`
- `db/migrations/014_tenant_sessions_user_rls.sql`
- `db/migrations/015_storage_object_payloads.sql`
- `scripts/db-migrate.mjs`

These migrations are intentionally preparatory. `001_control_plane.sql` creates
the hosted control-plane shape for tenancy, document identity, jobs, provider
runs, incidents, advisory snapshots, artifacts, costs, audit events, and
configurable-skill ledgers. It also installs a shared `updated_at` trigger helper
on mutable control-plane tables. `012_tenant_org_profile.sql` keeps that tenancy
model honest by making the tenant row itself say whether it is a single-user
account or an organization-scoped account, with optional organization slug,
member capacity, and primary owner fields. It does not implement hosted sign-in;
it prevents the database shape from looking accidentally single-user.
`002_tenant_rls.sql` enables and forces
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
app-owned. `013_hosted_auth_session_model.sql` and
`014_tenant_sessions_user_rls.sql` add provider-neutral auth identity/session
rows for future hosted middleware. `015_storage_object_payloads.sql` adds
optional tenant-scoped byte custody for the accepted local/private runtime DB
mode.

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
npm run db:runtime:role-setup -- --write-env-shadow
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:smoke
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:write-smoke -- --out-dir docs/runtime-db-write-smokes
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
`db:shadow:inspect` are shadow transition commands. They rehearse metadata
hydration from local matter folders into Postgres and then verify or inspect the
result. They do not by themselves make Postgres the runtime storage backend.

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

The `db:storage:payloads:*` commands are the local/private DB-custody bridge.
They copy source, artifact, and skill-sample bytes into
`storage_object_payloads`. Runtime DB storage mode reads workspace trees,
previews, raw files, status, prepare state, and advisory snapshots from this
payload custody.

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

`db:runtime:role-setup` creates or updates the non-superuser runtime database
role and can write `MWB_RUNTIME_DATABASE_URL` into ignored `.env.shadow`.
`db:runtime:smoke` proves the accepted runtime read/storage path. The stronger
`db:runtime:write-smoke` creates a disposable matter through the real upload
API, verifies DB rows and payload bytes, proves rollback, and archives the
smoke matter. These commands are the current local/private runtime acceptance
path, not a hosted-worker proof.

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

## Hosted Stop Rule

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
or local/private runtime DB materialized path. Do not describe the accepted
foreground bridge as a hosted worker supervisor.
