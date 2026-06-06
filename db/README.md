# Matter Workbench Database Migrations

This folder is the database track for the local-to-hosted transition.

The React local beta now has an explicit runtime DB mode for live matter
storage. In `MWB_RUNTIME_DB_STORAGE=postgres`, Postgres owns matter selection,
uploads, workspace/file reads, file payload custody, matter status,
prepare/advisory reads, materialized workflow outputs, custom skill
ideas/samples/definitions/runs, and command interaction history. Existing legal
engines still execute through temporary materialized folders, but those folders
are scratch workspaces; changed files and receipts are persisted back into
Postgres. Hosted background workers remain a separate future slice.

For the operator/developer handoff sequence, read
[Database Transition Handoff](../docs/database-transition-handoff.md).

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
- `012_tenant_org_profile.sql` makes the tenant row explicitly describe whether
  the account is single-user or organization-scoped, with an optional org slug,
  member capacity, and primary owner link.
- `013_hosted_auth_session_model.sql` adds provider-neutral auth identities and
  tenant/user-scoped session rows for future hosted middleware.
- `014_tenant_sessions_user_rls.sql` tightens the session RLS policy for shadow
  databases that applied the first auth/session migration during rehearsal.
- `015_storage_object_payloads.sql` adds optional tenant-scoped byte custody for
  local/private runtime DB mode, so a DB backup can contain file/artifact bytes
  instead of only object keys.

## Commands

```sh
npm run db:migrations:list
npm run db:migrations:check
npm run db:doctor
npm run db:shadow:preflight
npm run db:shadow:acceptance
npm run db:runtime-cutover-check
npm run db:shadow:backup
npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql
npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql --verify-mode sql-summary
npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql --out-dir docs/shadow-db-restore-drills
npm run db:shadow:storage-backup
npm run db:shadow:storage-restore-check -- --manifest .local/shadow-storage-backups/<backup>/manifest.json
npm run private-vm:ops-pack
npm run private-vm:recoverability-pack
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
npm run db:storage:payloads:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:storage:payloads:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:storage:payloads:hydrate:verify
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
MWB_DATABASE_URL="postgres://..." npm run db:shadow:acceptance
MWB_DATABASE_URL="postgres://..." npm run db:shadow:backup
MWB_DATABASE_URL="postgres://..." npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql
MWB_DATABASE_URL="postgres://..." npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql --verify-mode sql-summary
MWB_DATABASE_URL="postgres://..." npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql --out-dir docs/shadow-db-restore-drills
npm run db:shadow:storage-backup
npm run db:shadow:storage-restore-check -- --manifest .local/shadow-storage-backups/<backup>/manifest.json
MWB_DATABASE_URL="postgres://..." npm run db:shadow:report
MWB_DATABASE_URL="postgres://..." npm run db:shadow:snapshot
npm run db:runtime:role-setup -- --write-env-shadow
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:smoke
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:write-smoke -- --out-dir docs/runtime-db-write-smokes
```

`db:migrations:check` can run without a database URL. In that case it lists the
known migration files with `unknown` status.

`db:doctor` is a read-only deployment-prep check. It reports whether a database
URL is configured, whether `psql` is available, and the migration plan if the
database can be inspected. It redacts connection secrets and does not apply
anything. `ready_to_apply` means there are pending migrations and no detected
blocker; `ready_to_hydrate` means the migrations are already applied and the
shadow mirror can move on to hydration, verification, report, or snapshot.
The DB tools first honor `MWB_PSQL_BIN`, then try common PostgreSQL client
locations such as Homebrew `libpq`, and finally fall back to `psql` on `PATH`.
Use `MWB_PSQL_BIN=/absolute/path/to/psql` when the client is installed but not
discoverable.
DB scripts load `.env` first and then the ignored `.env.shadow` file. Shell
variables still win. Use `.env.shadow` for local shadow database credentials
when you do not want to mix rehearsal DB settings into the app's main `.env`.

`db:shadow:preflight` is the one-command read-only readiness check for the
shadow DB track. It runs `db:doctor`, then runs the full shadow hydration
dry-run, and prints a compact status: whether the database URL is configured,
whether `psql` is available, whether dry-run planning works, whether migrations
are ready to apply, whether the shadow schema is ready to hydrate, and the next
operator action. With no database URL it should still be useful: `psql`
availability plus a successful dry-run means the repo-side planners are ready
and the handoff is waiting for database URL / credential setup. If the dry-run
fails, the rendered result includes redacted failed stage evidence for handoff.

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

`db:storage:payloads:hydrate:dry-run` is the explicit full-custody rehearsal. It
uses the same storage-object plan but also reads local source/artifact/sample
file bytes and plans `storage_object_payloads` rows. `db:storage:payloads:hydrate`
copies those bytes into Postgres, and `db:storage:payloads:hydrate:verify`
checks that the payload rows exist. This mode is intended for local/private
runtime DB testing where a DB backup must not restore object keys pointing to
missing local PDFs.

`db:runtime:smoke` now checks two levels. With `MWB_RUNTIME_DB=postgres`, it
proves the matter index and active matter switch come from Postgres. With the
additional `MWB_RUNTIME_DB_STORAGE=postgres`, it also proves the workspace tree,
text file preview, raw file delivery, matter status, prepare plan, and latest
advisory snapshot use DB storage payloads instead of live matter folders.

`db:provider-runs:hydrate:dry-run` rehearses the provider-run ledger from
existing AI metadata on Source Index/List of Dates artifacts, skill samples, and
custom-skill run receipts. It stores provider/model/task/status/token/cost
metadata where available, and links rows back to the owning artifact, sample, or
run. It does not store prompts, context packets, model outputs, or generated
legal work product.

`db:jobs:hydrate:dry-run` rehearses the processing-job ledger only where local
evidence already exists: mirrored provider runs. It creates completed/running
shadow `processing_jobs` rows for provider-backed source-label, List of Dates,
skill-creation, and skill-execution work, then links `provider_runs.job_id`.
It deliberately does not invent `job_outbox` rows or a full historical
preparation queue, because local V1 does not have a durable worker queue ledger.

`db:costs:hydrate:dry-run` rehearses cost-governance rows derived from the
provider-run shadow plan. It creates one shadow `cost_events` row per mirrored
provider run, including known token/cost values where available and `unknown`
cost confidence where the local provider metadata lacks spend information. It is
still a ledger rehearsal, not a billing system or approval workflow.

`db:audit:hydrate:dry-run` rehearses privacy-safe audit-event rows from
`.local/command-interactions.jsonl`. It mirrors command action metadata, matter
links where they can be matched, and provider-invoked flags, but it deliberately
does not store raw typed input, terminal lines, router reasoning, prompt text, or
error details. `db:audit:hydrate`, `db:audit:hydrate:verify`, and
`db:audit:shadow:inspect` apply, count-check, and inspect those shadow-only audit
rows without changing the app runtime.

`db:shadow:hydrate:dry-run`, `db:shadow:hydrate`, and
`db:shadow:hydrate:verify` are operator shortcuts. They run the existing shadow
hydrators in dependency order: matter metadata, skills, advisory, storage,
provider runs, provider-backed jobs, costs, and audit events. Apply and verify
modes run a read-only `db:doctor` preflight first, stop before writes unless the
doctor reports `ready_to_hydrate: yes`, and then finish with
`db:shadow:report`. These commands still do not make the app read from Postgres.
If a failed stage stops the shortcut, the rendered result includes redacted
stdout/stderr snippets for operator handoff debugging.

`db:shadow:acceptance` is the read-only acceptance check after a shadow database
has been hydrated. It runs `db:doctor`, refuses to continue unless the schema is
ready to hydrate, then runs the verify pipeline and combined shadow report. It
does not apply migrations, hydrate rows, write snapshots, or switch runtime
storage. Use it when the question is "is this shadow database acceptable as
handoff evidence right now?" The command also prints `runtime_cutover_ready`
and a runtime-cutover blockers list so "shadow database accepted" is not
mistaken for "product runtime is ready to use Postgres."

`db:runtime-cutover-check` is the stop-check before any product runtime wiring.
It consumes the shadow acceptance result and fails closed while runtime-cutover
blockers remain. It does not switch runtime storage, apply migrations, hydrate
rows, or write snapshots. Use it when the question is "are we allowed to make
the app depend on Postgres yet?" Even when shadow evidence is accepted and no
technical blockers remain, the command still fails closed until the operator
sets `MWB_DB_RUNTIME_CUTOVER_APPROVED=yes` after explicit runtime-storage
approval.

`db:runtime:smoke` is the practical runtime-DB proof. It starts the app with
`MWB_RUNTIME_DB=postgres`, requires `MWB_DB_RUNTIME_CUTOVER_APPROVED=yes`, reads
`/api/matters` from Postgres, and switches to one DB-listed matter. With
`MWB_RUNTIME_DB_STORAGE=postgres`, it also verifies DB payload-backed workspace
listing, text file preview, raw file delivery, matter status, prepare-matter
state, and latest advisory reads. A passing storage-mode smoke proves the
read/file-custody surfaces are DB-backed. Workflow and skill writes now use the
runtime DB materialization bridge, but they are still foreground local actions,
not hosted DB-claimed background jobs.

`db:shadow:backup` creates a local ignored backup of the shadow database under
`.local/shadow-db-backups/` using `pg_dump`. It writes a plain SQL dump plus a
small manifest with the dump hash and byte size. It is for rehearsal and
handoff safety only: it does not restore data, apply migrations, hydrate rows,
or switch runtime storage. The DB tools honor `MWB_PG_DUMP_BIN`, then discover
common Homebrew/MacPorts/PostgreSQL `pg_dump` locations, then fall back to
`pg_dump` on `PATH`.

`db:shadow:restore-drill` restores a local shadow backup into a temporary restore database,
then verifies and drops the temporary database unless `--keep` is passed. By
default it runs the combined shadow DB report against that restored database.
Pass `--verify-mode sql-summary` to prove the restored SQL independently of the
source matter folder tree. Restore database names must start with
`matter_workbench_shadow_restore_`; the command will not restore into the live
shadow database name. This is the first practical backup/restore proof for the
DB transition, not a runtime cutover. Pass
`--out-dir docs/shadow-db-restore-drills` to preserve a redacted Markdown/JSON
handoff artifact for a successful drill.

`db:shadow:storage-backup` creates a local ignored backup of DB-referenced PDF
storage objects under `.local/shadow-storage-backups/`. It copies the PDF bytes
that shadow `storage_objects` currently point at, then writes a redacted
`manifest.json` with object keys, sizes, and SHA-256 hashes. It does not write
file bodies to Git, change database rows, hydrate anything, or switch runtime
storage.

`db:shadow:storage-restore-check -- --manifest
.local/shadow-storage-backups/<backup>/manifest.json` verifies that every
backed-up PDF named in the manifest is present and hash-matching. Use it with
the database restore drill when proving that the shadow control plane and the
local file custody it references can travel together.

The older shadow storage track stores PDF custody as metadata: storage provider,
bucket, object key, hash, and lifecycle rows. It does not store PDF bytes inline.
If storage still points at `local-filesystem`, a database backup must travel with
a matching local storage backup or an explicit migration to durable object
storage; otherwise a restore can produce valid control-plane rows that point at
missing PDFs.

`private-vm:recoverability-pack` is the private-VM operator command that ties
the lower-level backup pieces together. It runs a DB backup, a DB restore drill
with `sql-summary` verification, a local storage-object backup, a storage
restore/hash check, and an optional live service check. Use this before treating
a private VM as recoverable; a DB-only backup is not enough if local storage
objects are still part of the custody chain.

`private-vm:ops-pack` is the lighter daily/incident command. It captures the
current deployment symlink, rollback candidate, live service-check result,
disk/memory posture, and recent user-service logs, then writes a redacted
`ops-pack.md`, `ops-pack.json`, and `rollback-plan.sh`. Use it before debugging
or after a beta user reports a problem. It does not perform a backup and it does
not switch deployments automatically.

`db:storage:payloads:hydrate:*` is the local/private DB-custody answer to that
problem. It copies source, artifact, and skill-sample bytes into
`storage_object_payloads` with size and SHA-256 checks. Runtime DB storage mode
uses only payload-backed storage rows for workspace/file reads.

Runtime DB mode should use a dedicated runtime role through
`MWB_RUNTIME_DATABASE_URL`. Keep `MWB_DATABASE_URL` for migration/hydration
admin work if needed. Run `npm run db:runtime:role-setup -- --write-env-shadow`
to create or update a non-superuser, non-`BYPASSRLS` runtime role and store the
runtime URL in ignored `.env.shadow`.

Use `npm run db:runtime:write-smoke -- --out-dir docs/runtime-db-write-smokes`
as the live write acceptance check. It creates a disposable matter through the
real upload API, reads the DB-backed workspace and payload bytes, verifies
matter/document/storage/payload rows, proves a forced transaction rollback, and
deletes the disposable smoke matter afterward so exact shadow-hydration
verification is not polluted by smoke-test rows.

For the private/local single-host path, the accepted storage policy is:
`local-filesystem` storage is allowed only when the matching DB backup, storage
backup manifest, and hash-checked file copy travel together. This closes the
single-host storage policy gate for the shadow rehearsal. It does not decide a
multi-host or hosted-cloud object-storage provider.

`db:shadow:report` is the one-command read-only operator view. It verifies and
inspects matter control-plane rows, skill-factory rows, advisory snapshots,
storage-custody rows, provider-run links, cost-event rows, and audit-event rows,
then prints a single summary of what the shadow database currently mirrors. Pass
`-- --matter "name fragment"` or
`-- --slash "/the_story"` to narrow the report.

Local matter import policy is accepted for the shadow-control-plane rehearsal:
existing folders are represented through `matter_import_batches` and
`matter_import_items` with deterministic IDs, expected/imported file counts,
per-file storage links, and fail-closed collision handling. This does not switch
the app runtime to Postgres; it only means the separate local-import blocker is
closed for shadow evidence.

Incident/advisory preservation is also accepted for the shadow rehearsal:
Matter Attention items are mirrored into canonical incidents, and append-only
advisory snapshots preserve the advisory projection for each mirrored matter.
The snapshot is evidence, not a second source of truth.

Tenant organization posture is explicit but still preparatory. The schema now
has `tenants.account_scope`, `tenants.organization_slug`,
`tenants.max_member_count`, and `tenants.primary_owner_user_id` in addition to
the existing `tenant_memberships` and `matter_memberships` tables. That means a
future hosted beta can distinguish a single-user personal beta account from a
firm or organization account without changing the matter-control-plane shape.

Hosted auth and tenant-session modeling is accepted at the database layer.
`auth_identities` maps provider identities to app users, while
`tenant_sessions` records the selected tenant, user, session hash, expiry, and
membership enforcement. Session rows are scoped by tenant and user, not just by
tenant, so a future firm account can contain multiple users without exposing
one member's sessions to another normal member. This is provider-neutral: it
does not choose or configure an auth provider, issue cookies, or wire the local
runtime to Postgres.

Postgres-unavailable behavior is accepted for the local/private beta path: the
product runtime remains filesystem-backed unless DB runtime flags are explicitly
enabled. `db:shadow:acceptance` proves this by creating the React/local server
with a bogus database URL. DB scripts still fail closed when they need a real
database, but the local product does not depend on the shadow DB merely because
`MWB_DATABASE_URL` is present. This is not a hosted outage policy for a future
database-backed runtime.

Worker runtime behavior is accepted for the local/private beta path: preparation
still runs as a foreground local app action, not from DB-claimed worker queues.
The shadow DB has `processing_jobs`, `job_outbox`, and claim/heartbeat/complete
functions ready for hosted workers, but the product runtime does not consume
those queues yet. This closes the local worker policy gate without deciding a
hosted process supervisor or restart strategy.

`db:shadow:snapshot` writes that combined report to timestamped Markdown and
JSON files under `docs/shadow-db-snapshots/`. It is intended as a developer
handoff artifact: the operator can hydrate or verify the VM shadow database,
then preserve the exact mirror report without changing app runtime storage.
Treat each snapshot as one-run evidence, not live truth. Refresh it after
meaningful repo changes, local matter folder or skill-ledger changes, or another
shadow hydration / verify pass. The recorded commit is the source repo state
that produced the report, before the snapshot files themselves are committed. Do
not keep refreshing only to make a checked-in snapshot cite the commit that
contains that same snapshot; that is a self-referential loop, not better
evidence.
`db:shadow:snapshot` refuses to write handoff files unless its read-only
`db:doctor` preflight reports `ready_to_hydrate: yes`.
Pass `-- --out-dir /path/to/folder` to write the files somewhere else, or
`-- --timestamp 2026-06-04T00:00:00.000Z` for deterministic test/handoff names.

`db:migrate` requires `psql` and records applied migrations in
`schema_migrations` with SHA-256 checksums. If an already-applied migration file
changes, the runner fails closed. Add a new numbered migration instead of editing
an applied one. Migration numbers must stay gapless from `001`; the runner
rejects missing numbers before listing, checking, doctoring, or applying.

## Runtime Cutover Stop Rule

Do not wire production matter writes to Postgres until these decisions are made
explicitly:

- hosted database URL and migration environment;
- for multi-host/cloud deployment, object storage provider and bucket layout;
- backup, restore, and deletion policy;
- hosted runtime ownership and recovery for worker jobs and provider-run failures;
- hosted web/session middleware that validates provider tokens and sets
  `app.tenant_id` / `app.user_id`;
- hosted rollback/degraded-mode behavior once Postgres becomes live product
  write storage;
- hosted DB-claimed worker path for preparation, extraction, source labels,
  List of Dates, copilot/context, and skill execution.

After those decisions are approved, run the stop-check with an explicit approval
flag:

```sh
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime-cutover-check
```

This flag only lets the guard report readiness. It does not switch runtime
storage by itself. To exercise the approved read/storage runtime slice, run the
app or the smoke command with runtime DB mode explicitly enabled:

```sh
MWB_RUNTIME_DB=postgres \
MWB_RUNTIME_DB_STORAGE=postgres \
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes \
npm run db:runtime:smoke
```

Expected storage-slice behavior: `/api/matters`, matter switching,
`/api/workspace`, file previews, raw file delivery, matter status,
`/api/prepare-matter`, and `/api/matter-attention` use Postgres. Preparation,
extraction, source labels, List of Dates generation, copilot/context, doctor
fixes, and skill execution now use the local/private materialized DB write
bridge when runtime DB storage mode is enabled. Hosted DB-claimed workers are
still pending; do not describe the bridge as a hosted worker supervisor.
