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
can be durable later without inventing an ad hoc queue outside Postgres. None of
these migrations switches the local runtime away from the filesystem-backed
engines.

Developer commands:

```bash
npm run db:migrations:list
npm run db:migrations:check
npm run db:doctor
MWB_DATABASE_URL="postgres://..." npm run db:migrate
```

`db:migrations:check` can run without a database URL; in that case it lists the
available migration files with unknown status. `db:doctor` is the read-only
handoff command: it checks URL presence, `psql`, and the migration plan while
redacting connection secrets. With a database URL, the runner uses `psql`,
records applied versions and SHA-256 checksums in `schema_migrations`,
serializes each migration transaction with a Postgres advisory lock, and fails
closed if an already-applied migration file is edited. The migration file
sequence is also gapless: `001`, `002`, `003`, and so on. A missing number stops
the runner before any deployment applies a later migration.

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
