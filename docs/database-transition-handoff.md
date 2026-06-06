# Database Transition Handoff

Status: shadow-only handoff for the PostgreSQL control-plane rehearsal

This note is for a developer/operator taking over the database transition
track. It deliberately does not describe a runtime cutover. Matter Workbench
local beta still reads and writes matter state through the filesystem-backed
engines.

## Current Boundary

The database work is a mirror, not the live backend.

- Postgres owns rehearsed control-plane rows: tenants, matters, document
  identity, extraction records, source descriptors, artifact pointers, provider
  runs, jobs, costs, audit events, advisory snapshots, custom skills, versions,
  and run receipts.
- Local matter folders still own originals, generated legal artifacts, JSON
  ledgers, and lawyer-facing output files.
- The shadow database stores local file pointers and hashes for PDFs, not PDF
  bytes. A database backup without the matching local storage backup can restore
  DB rows that point to missing PDFs.
- The app does not read matters, skills, advisory state, or receipts from
  Postgres at runtime.
- Do not cut over runtime reads or writes until auth, durable object storage or
  an explicit single-host volume policy, backups for both DB and file custody,
  job workers, and rollback behavior are explicitly approved.

## Environment Needed

Use a PostgreSQL instance with the migration files applied. The local VM setup
used for the current rehearsal had enough disk and memory for shadow hydration,
but the handoff does not depend on that exact VM address.

Set a database URL only in the shell, `.env`, or the ignored `.env.shadow` file;
do not write credentials into docs, snapshots, tests, or commits. Shell values
remain authoritative; `.env.shadow` is only a local convenience for shadow DB
credentials:

```bash
export MWB_DATABASE_URL="<redacted-postgres-url>"
```

The DB scripts load `.env` first and then `.env.shadow`. Because `.env.shadow`
is git-ignored, it is a safer place for local VM or rehearsal database
credentials than tracked docs or command history.

If `psql` is installed through Homebrew on macOS, the operator may need:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
```

The repo tools also auto-discover common `psql` locations, including Homebrew
`libpq`. If the client lives somewhere else, set an explicit command path
without committing it:

```bash
export MWB_PSQL_BIN="/absolute/path/to/psql"
```

## Reproduce The Shadow Mirror

From the repo root:

```bash
npm run db:shadow:preflight
npm run db:doctor
npm run db:migrations:check
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:migrate
npm run db:shadow:hydrate:dry-run
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:hydrate
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:hydrate:verify
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:acceptance
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:backup
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql --out-dir docs/shadow-db-restore-drills
npm run db:shadow:storage-backup
npm run db:shadow:storage-restore-check -- --manifest .local/shadow-storage-backups/<backup>/manifest.json
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:snapshot
```

Use `db:shadow:hydrate:dry-run` before writes to confirm what the local app will
try to mirror. Use `db:shadow:hydrate:verify` after writes to confirm row counts
still match. Use `db:shadow:acceptance` as the read-only acceptance gate before
handoff: it requires the migrated schema to be ready to hydrate, runs the verify
pipeline, and fails closed if the combined shadow report no longer matches. Use
`db:shadow:backup` to create a local ignored backup under
`.local/shadow-db-backups/` before handing the VM database to another operator
or before applying a new migration. Use `db:shadow:restore-drill` to prove that
backup can restore into a temporary restore database and still pass the combined
shadow report; the restore database name is forced to a
`matter_workbench_shadow_restore_` prefix and is dropped after the drill unless
the operator explicitly keeps it. This restore drill is a backup proof, not a
runtime cutover. The database host must allow the DB user to connect to that
temporary restore database in `pg_hba.conf`; allowing only the live
`matter_workbench_shadow` database is enough for hydration and backup, but not
for a restore drill. Pass `--out-dir docs/shadow-db-restore-drills` to preserve
a redacted Markdown/JSON restore-drill proof for handoff. Use
`db:shadow:storage-backup` to copy the DB-referenced local PDF objects into an
ignored `.local/shadow-storage-backups/` folder and write a hash manifest. Use
`db:shadow:storage-restore-check` against that manifest to prove the copied PDF
objects are present and hash-matching. This storage backup travels with the DB
backup during local/single-host rehearsal; it is not a hosted object-storage
provider decision. Use
`db:shadow:snapshot` to preserve the combined report for handoff. New snapshots
also record the repo branch, short commit, and whether the worktree was clean
when the report was generated.
`db:shadow:snapshot` runs a read-only `db:doctor` preflight and refuses to write
snapshot files unless the doctor reports `ready_to_hydrate: yes`.

The runtime cutover check is not part of shadow acceptance. Run it separately
only when you are testing the runtime-cutover stop rule. Without
`MWB_DB_RUNTIME_CUTOVER_APPROVED=yes`, it is expected to fail closed with
`runtime_cutover_not_approved` even when the shadow mirror is accepted.

Use `db:shadow:preflight` as the first command when resuming this track. It is a
read-only combined check: `db:doctor` plus the full shadow hydration dry-run. If
it reports that `psql` is available and dry-run planning works but the database
URL is missing, the repo-side preparation is ready and the operator is only
waiting for database URL / credential setup. If it reports `ready_to_apply`, run
`db:migrate`. If it reports `ready_to_hydrate`, proceed to shadow hydration,
verification, report, or snapshot.

`db:doctor` is the first sanity check. If it reports `ready_to_apply: yes`, run
the migrations before hydrating. If it reports `ready_to_hydrate: yes`, the
schema is already settled and the next useful step is shadow hydration, report,
or snapshot. The all-shadow apply and verify commands run this `db:doctor`
preflight themselves and stop before writes unless the schema is ready to
hydrate.

Use `db:runtime-cutover-check` only when asking whether the product runtime may
start depending on Postgres. It consumes `db:shadow:acceptance` and fails closed
unless the shadow evidence is accepted and a separate runtime-storage approval
has been given. It does not switch runtime storage, hydrate rows, apply
migrations, or write snapshots. After explicit runtime-storage approval, set
`MWB_DB_RUNTIME_CUTOVER_APPROVED=yes` for the stop-check only:

```bash
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime-cutover-check
```

That flag allows the guard to report readiness. It does not make the app read
or write Postgres by itself.

## Accepted First Runtime Slice

The first runtime DB slice is now implemented behind an explicit opt-in:

```bash
MWB_RUNTIME_DB=postgres \
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes \
MWB_DATABASE_URL="$MWB_DATABASE_URL" \
npm run db:runtime:smoke
```

Scope is intentionally narrow. In this mode Postgres is the runtime source for:

- `/api/matters`;
- active matter resolution in `/api/switch-matter`;
- resolving a legal matter name or local folder name to the local matter folder.

The app still uses the filesystem/object-custody path for:

- original files and PDF bytes;
- workspace tree and file previews;
- preparation outputs;
- source labels and List of Dates artifacts;
- custom skill outputs and receipts.

This is the right first cutover because it proves that the product can depend
on Postgres for a visible runtime decision without pretending that file custody,
artifact writes, worker execution, or hosted auth have fully moved.

On the local VM, the runtime smoke passed against the hydrated shadow database:
15 active DB matters were visible, the app switched to a DB-listed matter, and
the workspace remained readable from local storage. Treat that as current
runtime-slice evidence, not a full database migration.

## Current Snapshot Evidence

The current checked-in snapshot is:

```text
docs/shadow-db-snapshots/shadow-db-snapshot-2026-06-05T13-39-26-825Z.md
docs/shadow-db-snapshots/shadow-db-snapshot-2026-06-05T13-39-26-825Z.json
docs/shadow-db-snapshots/shadow-db-snapshot-2026-06-06T01-28-18-726Z.md
docs/shadow-db-snapshots/shadow-db-snapshot-2026-06-06T01-28-18-726Z.json
```

The 2026-06-06 snapshot is the latest handoff evidence. It reports
`matched: yes` for the VM shadow database at the time it was generated. It
mirrors 15 matters, 180 documents, 180 extraction records, 125 source descriptors,
28 matter artifacts, 8 configurable skills, 22 configurable-skill runs, 64 open
local attention incidents, and 61 provider runs. It also records
`storage_custody: ok`, with 168 PDF storage objects checked and 0 missing local
files. Treat it as one-run evidence, not live truth.
It is not a promise that future repo changes, local matter folders, skill
ledgers, or shadow hydration runs still match. Refresh the snapshot after any of
those changes before using it as a developer handoff artifact. The recorded
commit is the source repo state that produced the report, before the snapshot
files themselves are committed. Do not keep refreshing only to make a checked-in
snapshot cite the commit that contains that same snapshot; that is a
self-referential loop, not better evidence.

## Current Restore Drill Evidence

The current checked-in restore drill evidence is:

```text
docs/shadow-db-restore-drills/shadow-db-restore-drill-2026-06-05T05-53-07-036Z.md
docs/shadow-db-restore-drills/shadow-db-restore-drill-2026-06-05T05-53-07-036Z.json
docs/shadow-db-restore-drills/shadow-db-restore-drill-2026-06-06T01-28-31-835Z.md
docs/shadow-db-restore-drills/shadow-db-restore-drill-2026-06-06T01-28-31-835Z.json
```

The 2026-06-06 restore drill is the latest handoff evidence. It reports
`Success: yes` for restoring `shadow-db-backup-2026-06-06T01-28-21-222Z.sql`
into a temporary PostgreSQL database, verifying the restored shadow report, and
cleaning up the temporary database. The recorded drill steps were:

```text
create restore database: ok
restore backup: ok
verify restored database: ok
drop restore database: ok
```

This proves the Postgres shadow backup can be restored and checked. It does not
prove PDF/object-storage backup and restore; local PDF custody remains a separate
runtime-cutover concern.

## Current Storage Restore-Check Evidence

The current checked-in storage restore-check evidence is:

```text
docs/shadow-storage-restore-checks/shadow-storage-restore-check-2026-06-05T06-08-44-843Z.md
docs/shadow-storage-restore-checks/shadow-storage-restore-check-2026-06-05T06-08-44-843Z.json
docs/shadow-storage-restore-checks/shadow-storage-restore-check-2026-06-06T01-28-34-818Z.md
docs/shadow-storage-restore-checks/shadow-storage-restore-check-2026-06-06T01-28-34-818Z.json
```

The 2026-06-06 storage restore-check is the latest handoff evidence. It reports
`Success: yes` for a local ignored storage backup generated at
`2026-06-06T01:28:21.589Z`, with 168 checked PDF objects and 0 failed objects.
This proves the local backup manifest can be read and the copied PDF objects are
present and hash-matching. It does not decide the hosted object-storage provider
or prove a multi-host deployment storage policy.

## Accepted Single-Host Storage Policy

The shadow DB transition now has an accepted single-host storage policy for the
private/local beta path. In this mode, shadow `storage_objects` may point to
`local-filesystem` objects as long as the database backup travels with the
matching storage backup manifest and hash-checked file copy. The current
checked-in restore-check evidence proves that the DB-referenced PDF objects can
be backed up and verified for this single-host path.

This closes the separate `object_storage_or_single_host_volume_policy` blocker
for local/private single-host rehearsal. It is not a multi-host or cloud object
storage decision. A future hosted deployment still needs either durable object
storage or an explicitly managed shared volume, plus deletion and restore
procedures for that environment.

## Accepted Postgres-Unavailable Local Runtime Policy

The local beta runtime has an accepted Postgres-unavailable behavior: it remains
a local filesystem-backed runtime. The DB tools can use `MWB_DATABASE_URL`, but
`server.mjs` does not use Postgres for product reads or writes. The acceptance
check now proves this by creating the React/local server with a bogus database
URL and confirming the runtime still initializes.

This closes the `postgres_unavailable_user_behavior` blocker for the
local/private shadow rehearsal. It is not a hosted outage policy. Once the app
actually becomes database-backed in production, hosted deployment still needs a
separate outage, degraded-mode, and rollback design.

## Accepted Local Foreground Worker Policy

The local beta also has an accepted worker policy: long-running preparation is a
foreground local app action, not a database-claimed worker process. The shadow
DB contains `processing_jobs` and `job_outbox` rows, and the migrations include
claim/heartbeat/complete functions for future hosted workers, but the current
product runtime does not consume those queues.

This closes the `worker_process_owner_and_recovery` blocker for the
local/private shadow rehearsal. It is not a hosted worker supervisor decision.
Once extraction, source labels, List of Dates, or custom skill execution move
into background workers, deployment still needs a process owner, restart policy,
dead-worker recovery, and operator visibility.

## Accepted Local Matter Import Policy

The shadow DB transition now has an accepted local matter import policy for the
current filesystem-backed beta: existing matter folders are mirrored through
`matter_import_batches` and `matter_import_items`, using deterministic IDs and a
fail-closed collision policy. The import ledger preserves the local folder name,
expected file counts, imported file counts, and per-file storage links without
renumbering `FILE-NNNN` identities. This does not make Postgres the live matter
runtime, but it closes the separate `local_matter_import_policy` cutover blocker
for the shadow-control-plane rehearsal.

## Accepted Incident And Advisory Preservation

The shadow DB transition now has an accepted incident/advisory preservation path
for the current local beta: Matter Attention items are mirrored as canonical
incident rows, and each mirrored matter receives an append-only advisory
snapshot derived from those incidents and validation rows. The snapshot is
evidence of what the advisory surface showed at that time; it is not a second
source of truth. This closes the separate
`incident_advisory_preservation_policy` blocker for the shadow-control-plane
rehearsal while keeping runtime matter behavior filesystem-backed.

## Accepted Tenant Organization Profile

The shadow DB transition now has an explicit tenant organization profile:
`tenants.account_scope`, `tenants.organization_slug`,
`tenants.max_member_count`, and `tenants.primary_owner_user_id`. The existing
`tenant_memberships` and `matter_memberships` tables already carried the
multi-user shape; these tenant fields make the product posture visible at the
account row itself.

This means the shadow schema can represent both a single-user personal beta
tenant and a future firm or organization tenant without reshaping matter,
document, job, advisory, or skill tables.

## Accepted Hosted Auth And Tenant Session Model

The shadow DB transition now has a provider-neutral hosted auth and tenant
session model. `auth_identities` maps an external identity provider and subject
to an app `users` row. `tenant_sessions` records the selected tenant, user,
session hash, expiry, revocation status, and membership enforcement through the
existing `(tenant_id, user_id)` tenant membership key. `tenant_sessions` is
tenant/user-scoped with row-level security, and `current_app_user_id()` mirrors
`current_app_tenant_id()` for future request context. The user binding matters
because a future firm tenant can contain many lawyers; a normal request should
not see another member's session rows merely because both users belong to the
same tenant.

This closes the `hosted_auth_and_tenant_session_model` blocker as a database
model. It does not choose an auth provider, issue browser cookies, or make the
local product runtime database-backed. A future hosted runtime still needs the
web/session middleware that validates a provider token, selects the active
tenant, sets `app.tenant_id` and `app.user_id`, and refuses inactive or
cross-tenant memberships.

## What A Developer Should Check Next

Before any real hosted or database-backed runtime work:

1. Re-run the migration and shadow verification commands on the target database.
2. Confirm the snapshot is secret-free and does not contain source document
   bodies or generated legal work-product bodies.
3. Confirm tenant isolation with `002_tenant_rls.sql` and tenant-reference
   checks from later migrations.
4. Confirm object-storage custody rules before any upload path moves hosted. A
   database backup alone is not enough while storage objects still point at local
   filesystem paths; restored DB rows can otherwise point to missing PDFs.
5. Confirm hosted worker process ownership before long-running preparation
   moves out of the local foreground app.
6. Confirm hosted rollback/degraded-mode behavior before the product runtime
   actually depends on Postgres. The local beta currently avoids this class of
   outage by staying filesystem-backed.
7. Run `MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime-cutover-check`
   only after the runtime-storage approval is explicit.

## Stop Rule

Stop before runtime cutover if any of these are still unresolved:

- for multi-host/cloud deployment, object storage provider, bucket layout, and
  deletion policy;
- backup and restore process for both Postgres and PDF/object storage;
- hosted worker process owner and failure recovery;
- hosted web/session middleware that validates provider tokens and sets
  `app.tenant_id` / `app.user_id`;
- hosted rollback/degraded-mode behavior once Postgres becomes live product
  storage beyond the first matter-index slice.
- explicit runtime-storage approval recorded before setting
  `MWB_DB_RUNTIME_CUTOVER_APPROVED=yes`.

The database is allowed to learn from the local app now. The local app may
depend on the database only for the approved matter-index runtime slice until
the remaining hosted/runtime questions are closed.
