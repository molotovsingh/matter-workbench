# Database Transition Handoff

Status: accepted runtime DB storage/write-bridge slice; hosted DB worker path pending

This note is for a developer/operator taking over the database transition
track. It now describes two different things that must not be blurred:

- the older shadow-control-plane rehearsal, which mirrors local evidence into
  Postgres for inspection and handoff; and
- the new explicit runtime DB storage mode, which can serve matter selection,
  uploads, workspace trees, file previews, file downloads, matter status,
  preparation plans, advisory snapshots, skill-factory state, custom-skill run
  receipts, and materialized workflow outputs from Postgres custody.

Legal-engine writes are now DB-runtime backed through a temporary materialized
folder bridge. They are not yet DB-worker-native: long-running work still runs
inside the foreground local app, and hosted claim/heartbeat/recovery remains a
future worker slice.

## Current Boundary

The database can now be used as a live read/file-custody backend only when the
operator explicitly opts in:

```bash
MWB_RUNTIME_DB=postgres
MWB_RUNTIME_DB_STORAGE=postgres
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes
```

Without those flags, the local beta remains filesystem-backed.

- Postgres owns the control-plane rows rehearsed by the shadow track: tenants,
  matters, document identity, extraction records, source descriptors, artifact
  pointers, provider runs, jobs, costs, audit events, advisory snapshots, custom
  skills, versions, and run receipts.
- `storage_object_payloads` can now store local/private file and artifact bytes
  in Postgres for runtime DB storage mode. This closes the earlier "DB pointer
  without file bytes" problem for local/private single-host testing.
- In `MWB_RUNTIME_DB_STORAGE=postgres`, the React shell can read workspace
  trees, text previews, raw file streams, matter status, prepare-matter state,
  and latest advisory snapshots from Postgres payload rows.
- Uploads in runtime DB storage mode write source payloads, storage custody,
  document identity, blob rows, and import history into Postgres without
  creating a live matter folder.
- Materialized preparation/workflow routes reconstruct a temporary matter
  folder from Postgres payload rows, run the existing engine, and persist new or
  changed outputs back into Postgres. The temporary folder is scratch, not the
  source of truth.
- Custom skill ideas, generated samples, custom skill definitions/versions,
  custom skill run receipts, and command interaction history are DB-owned in
  runtime DB storage mode.
- Runtime DB `psql` adapters now prepend a role-safety guard that refuses to run
  when `current_user` is a PostgreSQL superuser or has `BYPASSRLS`. `FORCE ROW
  LEVEL SECURITY` is only meaningful for a normal runtime role; do not point
  `MWB_DATABASE_URL` at a superuser connection.
- Runtime DB write adapters now wrap logical writes in one transaction. This
  covers DB-backed uploads/add-files, materialized workflow output persistence,
  configurable skill definitions, skill ideas, skill samples, custom-skill run
  receipts, and command interaction audit rows. A statement failure should now
  roll back the logical write instead of leaving a half-written matter or
  receipt.
- Local matter folders still act as the import/hydration source until a hosted
  upload path exists. They are no longer the live read source in runtime DB
  storage mode, but they are still needed to populate that mode.
- Existing legal engines are not SQL-native and are not hosted worker-backed.
  Do not present the bridge as a production background-job system; it is a
  controlled local/private runtime adapter that keeps Postgres as file custody
  truth.
- Do not treat this as a hosted multi-user cutover until auth/session
  middleware, object-storage policy, background workers, rollback, and backup
  behavior are explicitly approved for that environment.

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

Use a separate runtime URL for the app wherever possible:

```bash
export MWB_RUNTIME_DATABASE_URL="<redacted-runtime-postgres-url>"
```

`MWB_DATABASE_URL` may still point at an admin or migration-capable role for
schema setup and hydration. `MWB_RUNTIME_DATABASE_URL` is the app runtime role
and must be a normal PostgreSQL role: no superuser, no `BYPASSRLS`. If
`MWB_RUNTIME_DATABASE_URL` is absent, runtime mode falls back to
`MWB_DATABASE_URL`; that fallback is acceptable only for local diagnostics with
a safe non-superuser role.

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
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql --verify-mode sql-summary
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:restore-drill -- --backup .local/shadow-db-backups/<backup>.sql --out-dir docs/shadow-db-restore-drills
npm run db:shadow:storage-backup
npm run db:shadow:storage-restore-check -- --manifest .local/shadow-storage-backups/<backup>/manifest.json
npm run private-vm:recoverability-pack -- --base-url http://127.0.0.1:4191
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:storage:payloads:hydrate:dry-run
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:storage:payloads:hydrate
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:storage:payloads:hydrate:verify
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:snapshot
npm run db:runtime:role-setup -- --write-env-shadow
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:smoke
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:write-smoke -- --out-dir docs/runtime-db-write-smokes
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
for a restore drill. On a VM that does not carry the original local matter
folder tree, pass `--verify-mode sql-summary`; the default report mode is a
source-host verifier and may fail even when SQL restore succeeded. Pass
`--out-dir docs/shadow-db-restore-drills` to preserve a redacted Markdown/JSON
restore-drill proof for handoff. Use
`db:shadow:storage-backup` to copy the DB-referenced local PDF objects into an
ignored `.local/shadow-storage-backups/` folder and write a hash manifest. Use
`db:shadow:storage-restore-check` against that manifest to prove the copied PDF
objects are present and hash-matching. This storage backup travels with the DB
backup during local/single-host rehearsal; it is not a hosted object-storage
provider decision. Use
`private-vm:recoverability-pack` on the private VM when you want the operator
version of the same proof: DB backup, DB restore drill, storage backup, storage
hash-check, and live service check in one evidence bundle. Use
`db:storage:payloads:hydrate:*` after the storage-object metadata track when
you need DB-backed file custody for local/private runtime testing. This command
reads local source, artifact, and sample files and inserts their bytes into
`storage_object_payloads`; unlike the older shadow storage metadata track, it is
not pointer-only. Use `db:shadow:snapshot` to preserve the combined report for
handoff. New snapshots also record the repo branch, short commit, and whether
the worktree was clean when the report was generated.
`db:shadow:snapshot` runs a read-only `db:doctor` preflight and refuses to write
snapshot files unless the doctor reports `ready_to_hydrate: yes`.

The runtime cutover check is not part of shadow acceptance. Run it separately
only when you are testing the runtime-cutover stop rule. Without
`MWB_DB_RUNTIME_CUTOVER_APPROVED=yes`, it is expected to fail closed with
`runtime_cutover_not_approved` even when the shadow mirror is accepted. The
runtime smoke is the stronger practical check for the new DB read/storage slice:
with `MWB_RUNTIME_DB_STORAGE=postgres`, it must prove DB workspace, file preview,
raw file delivery, status, prepare state, and advisory reads.

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

## Accepted Runtime DB Storage And Write Bridge

The first runtime DB slice was the matter-index cutover. The stronger current
slice is DB storage-backed runtime reads and foreground write materialization.
It is implemented behind explicit
opt-in:

```bash
MWB_RUNTIME_DB=postgres \
MWB_RUNTIME_DB_STORAGE=postgres \
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes \
npm run db:runtime:smoke
```

In this mode Postgres is the runtime source for:

- `/api/matters`;
- active matter resolution in `/api/switch-matter`;
- resolving a legal matter name or local folder name to the DB matter row;
- `/api/workspace`;
- `/api/file`;
- `/api/file-raw`;
- `/api/matter-status`;
- `/api/prepare-matter`;
- `/api/matter-attention`;
- `/api/matter-init`;
- `/api/extract`;
- `/api/describe-sources`;
- `/api/create-listofdates`;
- `/api/create-listofdates/refresh-labels`;
- `/api/doctor/scan` and `/api/doctor/fix`;
- matter context search and copilot answer routes;
- rerun-advice reads;
- custom skill creation state and custom skill run receipts;
- command interaction history.

The write routes above are DB-backed through materialization, not direct SQL
engines. The server reconstructs a temporary matter folder from DB payloads,
runs the existing engine, then persists changed files back into Postgres as
storage objects, payloads, artifacts, extraction records, source descriptors,
run receipts, and audit events where applicable. This prevents the app from
pretending a Postgres pseudo-root such as `postgres:<matter>` is a normal matter
folder while still letting the local beta use the mature engines.

On the local VM, the storage runtime smoke passed against the hydrated database:
15 active DB matters were visible, the app switched to a DB-listed matter, the
workspace was read from DB payload custody, a DB-backed text file preview loaded,
and a raw file response streamed from Postgres bytes. Treat that as current
read/storage-runtime evidence.

```text
runtime_db_enabled: yes
runtime_db_storage_mode: postgres
matter_count: 15
target_matter: Atlas Constuction vs Diptishree
workspace_readable: yes
storage_file_preview_readable: yes
storage_raw_readable: yes
```

The runtime write smoke also passed against the local VM with
`MWB_RUNTIME_DATABASE_URL` pointing at the non-superuser `mwb_user` runtime
role. The script created a disposable matter through the real
`/api/matters/new` upload route, read the DB-backed workspace, previewed and
streamed the uploaded source payload from Postgres, verified matter/document/
storage/payload/import rows, intentionally exercised a failing transaction and
confirmed rollback, then deleted the disposable smoke matter so it no longer
pollutes the active matter list or exact shadow-hydration verification counts.

Current checked-in write-smoke evidence:

```text
docs/runtime-db-write-smokes/runtime-db-write-smoke-2026-06-06T08-45-48-055Z.md
docs/runtime-db-write-smokes/runtime-db-write-smoke-2026-06-06T08-45-48-055Z.json
```

```text
passed: yes
database_url_source: MWB_RUNTIME_DATABASE_URL
role_guard_passed: yes
upload_created: yes
workspace_readable: yes
file_preview_readable: yes
raw_file_readable: yes
db_rows_verified: yes
rollback_verified: yes
cleanup_deleted: yes
counts: {"documents":1,"matterCount":1,"payloadRows":2,"payloadBytes":514,"importBatches":1,"storageObjects":2,"activeMatterCount":1}
```

This is the first live Postgres write proof for runtime DB mode. It is still not
proof of hosted background-worker recovery; the legal engines still run inside
the foreground local app and persist results through the materialized bridge.

The payload hydration that fed this smoke inserted 512
`storage_object_payloads` rows. The dry-run reported 70 missing local payload
warnings, mostly for previously planned synthetic extraction/sample objects that
did not have a corresponding file body. Runtime DB workspace reads therefore
list only storage objects with actual payload rows.

## Accepted DB Payload Custody Slice

`015_storage_object_payloads.sql` adds the byte-custody table used by local DB
runtime storage mode. It is tenant-scoped, row-level-security protected, and
hash/size checked:

- each payload belongs to one `storage_objects` row in the same tenant;
- each payload may point to the owning matter in the same tenant;
- `sha256` must be a 64-character lowercase hash;
- `size_bytes` must match `octet_length(payload)`;
- `(tenant_id, storage_object_id)` is unique.

This is the local/private answer to the earlier concern that a database backup
could restore object keys without the matching file bytes. For hosted or
multi-host deployment, this table may be replaced or supplemented by durable
object storage; the invariant is the same: DB records must never be backed up
without the bytes or durable object references they depend on.

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
28 matter artifacts, 8 configurable skills, 35 configurable-skill runs, 72 open
local attention incidents, and 74 provider runs. It also records
`storage_custody: ok`, with 168 PDF storage objects checked and 0 missing local
files. Treat it as one-run evidence, not live truth.
It is not a promise that future repo changes, local matter folders, skill
ledgers, or shadow hydration runs still match. Refresh the snapshot after any of
those changes before using it as a developer handoff artifact. The recorded
commit is the source repo state that produced the report, before the snapshot
files themselves are committed. Do not keep refreshing only to make a checked-in
snapshot cite the commit that contains that same snapshot; that is a
self-referential loop, not better evidence.

One provider-run audit caveat remains intentionally quarantined from runtime DB
readiness: historical local ledgers still include legacy `gpt-5.4` model labels
and unknown-cost rows. The runtime DB role, RLS, payload custody, shadow
acceptance, and read/write smokes are green despite that. Do not wire billing,
spend limits, or model-catalog compliance to those historical rows until the
cost-governance cleanup normalizes legacy model aliases and marks unknown-cost
runs explicitly.

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
a local filesystem-backed runtime unless DB runtime flags are explicitly set.
The DB tools can use `MWB_DATABASE_URL`, but `server.mjs` does not depend on
Postgres merely because that URL exists. The acceptance check proves this by
creating the React/local server with a bogus database URL and confirming the
runtime still initializes.

This closes the `postgres_unavailable_user_behavior` blocker for the
local/private shadow rehearsal. It is not a hosted outage policy. Once the app
actually becomes database-backed in production, hosted deployment still needs a
separate outage, degraded-mode, and rollback design.

## Accepted Local Foreground Worker Policy

The local beta also has an accepted worker policy: long-running preparation is a
foreground local app action, not a database-claimed worker process. Runtime DB
storage mode can now run those foreground actions through the materialized DB
bridge, but the shadow DB's `processing_jobs` and `job_outbox` rows are still
future hosted-worker ingredients. The current product runtime does not consume
those queues.

This closes the `worker_process_owner_and_recovery` blocker for the
local/private foreground runtime. It is not a hosted worker supervisor decision.
Because extraction, source labels, List of Dates, copilot/context, and custom
skill execution now have a DB-backed foreground bridge, the remaining hosted
question is process ownership, restart policy, dead-worker recovery, and
operator visibility for non-foreground execution.

## Accepted Local Matter Import Policy

The DB transition now has an accepted local matter import policy: existing
matter folders can be mirrored through
`matter_import_batches` and `matter_import_items`, using deterministic IDs and a
fail-closed collision policy. The import ledger preserves the local folder name,
expected file counts, imported file counts, and per-file storage links without
renumbering `FILE-NNNN` identities. In ordinary filesystem mode this is shadow
evidence; in runtime DB storage mode it supports the accepted Postgres custody
path. It closes the separate `local_matter_import_policy` cutover blocker for
the local/private database track.

## Accepted Incident And Advisory Preservation

The DB transition now has an accepted incident/advisory preservation path:
Matter Attention items can be mirrored as canonical incident rows, and each
mirrored matter receives an append-only advisory snapshot derived from those
incidents and validation rows. Runtime DB storage mode can read the latest
advisory snapshot from Postgres. The snapshot is evidence of what the advisory
surface showed at that time; it is not a second source of truth. This closes
the separate `incident_advisory_preservation_policy` blocker for the
local/private database track.

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

## Private Debian VM Runtime Rehearsal

The next deployment rehearsal ran the React app on the private Debian VM at
`172.16.37.128` from checkpoint `12d8cd7` with explicit runtime DB mode:

```text
MWB_RUNTIME_DB=postgres
MWB_RUNTIME_DB_STORAGE=postgres
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes
```

The app was reachable from the Mac at `http://172.16.37.128:4191/`, served the
React shell, returned 15 DB-backed matters with `mattersHome: null`, streamed an
original PDF payload, previewed an extracted JSON payload, and passed
`npm run db:runtime:write-smoke` from inside the VM deployment directory.

This proves the local/private runtime DB app can run on a separate private host
without using the Mac matter folder as live runtime truth.

The rehearsal also found an important verifier boundary:
`db:runtime-cutover-check` still depends on `db:hydrate:verify`, and that
verification step expects the source matter folder tree to exist at
`/home/aks/matters-matter-workbench`. On the VM, that folder is intentionally
absent, so the shadow verifier fails even though runtime serving and runtime
write smoke pass. Treat the shadow verifier as source-host hydration evidence,
not as the final product-serving proof for a VM that runs from DB payload
custody.

See [Private VM Runtime Deployment Rehearsal](private-vm-runtime-deployment-rehearsal.md).

The service-pack layer adds the operational wrapper for that same private VM
runtime:

```bash
npm run private-vm:serve
npm run private-vm:service-check -- --base-url http://127.0.0.1:4191
```

The committed user-level `systemd` template lives at
`deployment/private-vm/matter-workbench-runtime.service`. It expects a protected
runtime env file at `$HOME/.config/matter-workbench/runtime.env` and a deployment
symlink at `$HOME/matter-workbench-deployments/current`. This is still a private
single-host service posture, not a hosted multi-user service.

Installed service-pack evidence from the Debian VM:

```text
checkpoint: aff9fea
systemd user service: active and enabled
linger: yes
runtime env mode: 0600
VM-local service check: passed
Mac-to-VM service check: passed
runtime write-smoke: passed
database backup: succeeded
restore drill: restore ok, verification failed on missing source matter folder
```

The restore-drill verification failure is the same source-host shadow-verifier
boundary noted above. Do not treat it as a runtime DB serving failure.

The follow-up recoverability pack closes that operator gap:

```bash
npm run private-vm:recoverability-pack -- --base-url http://127.0.0.1:4191 --out-dir "$HOME/matter-workbench-backups/recoverability"
```

It runs the database backup, restores that backup into a temporary database
using `--verify-mode sql-summary`, copies local PDF storage objects, verifies
the storage manifest hashes, and checks the live VM service URL. That makes the
recovery question explicit: do the database rows and the file bytes travel
together?

The first live run passed on `2026-06-06T15:06:20.446Z`: 513,494,009 bytes of
Postgres dump were backed up, the temporary restored database was verified with
`sql-summary` and dropped, 168 local PDF storage objects were copied, all 168
hash-checked, and the VM service check passed against
`http://172.16.37.128:4191`.

The access/security hardening layer adds a separate proof that the private VM is
still private-operator beta posture, not public hosting:

```bash
npm run private-vm:security-check -- --base-url http://127.0.0.1:4191 --runtime-env "$HOME/.config/matter-workbench/runtime.env"
```

That check verifies private-network or loopback access, protected `runtime.env`
permissions, the systemd template's `EnvironmentFile`/restart/process-hardening
rules, the runtime DB role proof command, npm audit disposition when audit JSON
is supplied, and the live service smoke. It intentionally does not claim HTTPS,
authentication, browser session controls, public ingress, or multi-user hosted
authorization.

The first Mac-to-VM access/security check passed on
`2026-06-06T15:16:04.101Z` against `http://172.16.37.128:4191` with
`--skip-runtime-env` because the Mac cannot inspect the VM-local env file. It
proved the URL is private-network scoped, the committed systemd template is
hardened, the runtime DB role proof command is in place, the live service smoke
found 15 matters, and the `xlsx` high npm audit finding has the private-beta
disposition in `docs/security/npm-audit-disposition.md`.

## What A Developer Should Check Next

Before the next hosted DB-worker or cloud runtime slice:

1. Re-run the migration and shadow verification commands on the target database.
2. Run `db:storage:payloads:hydrate:*` if the runtime will read file/artifact
   bytes from Postgres.
3. Confirm the snapshot is secret-free. Payload hydration intentionally stores
   bytes in Postgres, so do not commit payload dumps, raw `bytea` output, or
   generated legal work bodies into docs.
4. Confirm tenant isolation with `002_tenant_rls.sql` and tenant-reference
   checks from later migrations.
5. Confirm object-storage custody rules before any upload path moves hosted.
   Local/private DB payload custody is acceptable for this machine; hosted
   deployment still needs object storage or a managed shared-volume policy.
6. Confirm hosted worker process ownership before long-running preparation
   moves out of the local foreground app.
7. Confirm hosted rollback/degraded-mode behavior before the product runtime
   depends on Postgres for writes.
8. Run `MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime-cutover-check`
   only after runtime-storage approval is explicit.

## Stop Rule

Stop before hosted/cloud runtime cutover if any of these are still unresolved:

- for multi-host/cloud deployment, object storage provider, bucket layout, and
  deletion policy;
- backup and restore process for both Postgres and PDF/object storage;
- hosted worker process owner and failure recovery;
- hosted web/session middleware that validates provider tokens and sets
  `app.tenant_id` / `app.user_id`;
- hosted rollback/degraded-mode behavior once Postgres becomes live product
  storage beyond the accepted local/private runtime bridge;
- hosted DB-claimed worker path for preparation, extraction, source labels,
  List of Dates, copilot/context, and skill execution;
- explicit runtime-storage approval recorded before setting
  `MWB_DB_RUNTIME_CUTOVER_APPROVED=yes`.

The database is allowed to learn from the local app now. The local app may
depend on the database for the approved storage/write-bridge runtime slice until
the remaining hosted/runtime questions are closed.
