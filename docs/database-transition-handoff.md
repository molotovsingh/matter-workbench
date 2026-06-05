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
for a restore drill. Use `db:shadow:snapshot` to preserve the
combined report for handoff. New snapshots also record the repo branch, short
commit, and whether the worktree was clean when the report was generated.
`db:shadow:snapshot` runs a read-only `db:doctor` preflight and refuses to write
snapshot files unless the doctor reports `ready_to_hydrate: yes`.

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

## Current Snapshot Evidence

The current checked-in snapshot is:

```text
docs/shadow-db-snapshots/shadow-db-snapshot-2026-06-05T05-41-38-516Z.md
docs/shadow-db-snapshots/shadow-db-snapshot-2026-06-05T05-41-38-516Z.json
```

It reports `matched: yes` for the VM shadow database at the time it was
generated. The snapshot mirrors 15 matters, 180 documents, 180 extraction
records, 125 source descriptors, 28 matter artifacts, 8 configurable skills,
22 configurable-skill runs, 64 open local attention incidents, and 61 provider
runs. It also records `storage_custody: ok`, with 168 PDF storage objects
checked and 0 missing local files. Treat it as one-run evidence, not live truth.
It is not a promise that future repo changes, local matter folders, skill
ledgers, or shadow hydration runs still match. Refresh the snapshot after any of
those changes before using it as a developer handoff artifact. The recorded
commit is the source repo state that produced the report, before the snapshot
files themselves are committed. Do not keep refreshing only to make a checked-in
snapshot cite the commit that contains that same snapshot; that is a
self-referential loop, not better evidence.

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
5. Confirm worker lease/heartbeat behavior before long-running preparation
   moves out of the local foreground app.
6. Confirm rollback: how to return to filesystem-backed local runtime if the DB
   path misbehaves.

## Stop Rule

Stop before runtime cutover if any of these are still unresolved:

- hosted auth and tenant-session model;
- object storage provider, bucket layout, and deletion policy;
- backup and restore process for both Postgres and PDF/object storage;
- worker process owner and failure recovery;
- incident/advisory preservation policy;
- import policy for existing local matter folders;
- user-visible behavior when Postgres is unavailable.

The database is allowed to learn from the local app now. The local app should
not depend on the database until those questions are closed.
