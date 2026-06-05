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
- The app does not read matters, skills, advisory state, or receipts from
  Postgres at runtime.
- Do not cut over runtime reads or writes until auth, object storage, backups,
  job workers, and rollback behavior are explicitly approved.

## Environment Needed

Use a PostgreSQL instance with the migration files applied. The local VM setup
used for the current rehearsal had enough disk and memory for shadow hydration,
but the handoff does not depend on that exact VM address.

Set a database URL only in the shell or `.env`; do not write credentials into
docs, snapshots, tests, or commits:

```bash
export MWB_DATABASE_URL="<redacted-postgres-url>"
```

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
npm run db:doctor
npm run db:migrations:check
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:migrate
npm run db:shadow:hydrate:dry-run
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:hydrate
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:hydrate:verify
MWB_DATABASE_URL="$MWB_DATABASE_URL" npm run db:shadow:snapshot
```

Use `db:shadow:hydrate:dry-run` before writes to confirm what the local app will
try to mirror. Use `db:shadow:hydrate:verify` after writes to confirm row counts
still match. Use `db:shadow:snapshot` to preserve the combined report for
handoff. New snapshots also record the repo branch, short commit, and whether
the worktree was clean when the report was generated. `db:shadow:snapshot` runs
a read-only `db:doctor` preflight and refuses to write snapshot files unless the
doctor reports `ready_to_hydrate: yes`.

`db:doctor` is the first sanity check. If it reports `ready_to_apply: yes`, run
the migrations before hydrating. If it reports `ready_to_hydrate: yes`, the
schema is already settled and the next useful step is shadow hydration, report,
or snapshot. The all-shadow apply and verify commands run this `db:doctor`
preflight themselves and stop before writes unless the schema is ready to
hydrate.

## Current Snapshot Evidence

The current checked-in snapshot is:

```text
docs/shadow-db-snapshots/shadow-db-snapshot-2026-06-04T00-00-00-000Z.md
docs/shadow-db-snapshots/shadow-db-snapshot-2026-06-04T00-00-00-000Z.json
```

It reports `matched: yes` for the VM shadow database at the time it was
generated. Treat it as one-run evidence, not live truth. It is not a promise
that future repo changes, local matter folders, skill ledgers, or shadow
hydration runs still match. Refresh the snapshot after any of those changes
before using it as a developer handoff artifact. The recorded commit is the
source repo state that produced the report, before the snapshot files themselves
are committed. Do not keep refreshing only to make a checked-in snapshot cite
the commit that contains that same snapshot; that is a self-referential loop,
not better evidence.

## What A Developer Should Check Next

Before any real hosted or database-backed runtime work:

1. Re-run the migration and shadow verification commands on the target database.
2. Confirm the snapshot is secret-free and does not contain source document
   bodies or generated legal work-product bodies.
3. Confirm tenant isolation with `002_tenant_rls.sql` and tenant-reference
   checks from later migrations.
4. Confirm object-storage custody rules before any upload path moves hosted.
5. Confirm worker lease/heartbeat behavior before long-running preparation
   moves out of the local foreground app.
6. Confirm rollback: how to return to filesystem-backed local runtime if the DB
   path misbehaves.

## Stop Rule

Stop before runtime cutover if any of these are still unresolved:

- hosted auth and tenant-session model;
- object storage provider, bucket layout, and deletion policy;
- backup and restore process;
- worker process owner and failure recovery;
- incident/advisory preservation policy;
- import policy for existing local matter folders;
- user-visible behavior when Postgres is unavailable.

The database is allowed to learn from the local app now. The local app should
not depend on the database until those questions are closed.
