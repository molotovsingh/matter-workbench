# Phase 0 Research: Provision V4 durable storage on the beta VM

**Branch**: `002-v4-database-provisioning` | **Date**: 2026-08-29

## R1. Database boundary

**Decision**: `matter_workbench_v4`, a separate database on the existing PostgreSQL instance.

**Rationale**: Chosen for reversibility, not isolation. V4 ends in cutover or abandonment;
both should be a database-level operation rather than editing the runtime database under
pressure. A database also gives migration ownership and backup artifacts an explicit target.

**Alternatives considered**:
- Dedicated schema in `matter_workbench_runtime`: simpler, but couples restore and removal to
  the matter-record database.
- Separate instance: real fault isolation, but outside the two-user beta scope and hardware.

## R2. Identity and privilege split

**Decision**: Two login identities. The migration identity owns the V4 database/schema, is
used only by operator commands, and has `BYPASSRLS` so it can migrate, verify the recovery
canary, and dump every row from tables that force RLS. It remains `NOSUPERUSER NOCREATEDB
NOCREATEROLE NOINHERIT`. The runtime identity is `NOSUPERUSER NOCREATEDB NOCREATEROLE
NOINHERIT NOBYPASSRLS`, receives only V4 table/function grants, and has `CONNECTION LIMIT 16`.

The runtime service loads only its URL. Migration/admin URLs and passwords live in a separate
mode-0600 operator environment file that systemd does not load.

**Rationale**: Auto-migrating with the runtime connection makes least privilege impossible.
Role names are non-secret; URLs and passwords are secrets and never enter reports.

**Cross-database access**: PostgreSQL grants `CONNECT` to `PUBLIC` by default. Revoking a
permission only from the V4 role does not override that inherited privilege. Enforcing
FR-003 therefore requires database/role rules in `pg_hba.conf` (reject the V4 runtime role for
runtime and mothership databases before the general allow rule), or revoking `PUBLIC CONNECT`
from those databases and explicitly granting every legitimate role. The first has smaller
blast radius and is chosen.

**Privilege boundary**: provisioning renders and verifies the required rules but never
silently escalates. A separate, explicitly invoked installer is the only command that writes
the pg_hba file and reloads PostgreSQL. It must already be running as an identity with that
filesystem privilege; it never invokes `sudo` or prompts internally. The installer owns one
marker-delimited block, preserves everything outside it, keeps a backup, validates active
rules after reload, and rolls back its block on failure. Provisioning does not edit unrelated
database grants.

## R3. Migration timing

**Decision**: Out-of-band migration while `MWB_V4_INTAKE` is unset. Runtime uses
`MWB_V4_AUTO_MIGRATE=0`.

**Rationale**: V4's migration runner is already checksum-immutable and idempotent. What is
wrong is running it during host boot: a role/grant error becomes an application restart
failure. Provisioning applies migrations with the migration identity, then grants and verifies
the runtime identity, while the current workbench process remains untouched.

**Alternatives considered**:
- First-boot auto migration: rejected; activation becomes the diagnostic mechanism.
- Runtime identity owning schema: rejected; violates FR-003.

## R4. Connection budget

**Decision**: Add an explicit `MWB_V4_DB_POOL_MAX`, required to equal 16 on the beta VM. Use it
for the application pool, independent of lane counts. Set the runtime PostgreSQL role's
cluster-wide `CONNECTION LIMIT` to 16 as a second enforcement layer. The mount consumes this
setting; it does not rewrite environment. Readiness and activation require
`MWB_V4_AUTO_MIGRATE=0`, while development callers may still opt into automatic migration
explicitly.

**Rationale**: The current formula is `lanes + repairLanes + 8`; changing worker settings
silently changes database pressure. Configuration and database enforcement must agree.

## R5. Backup cadence and retention

**Decision**: Add V4 backup/restore as mandatory steps inside
`private-vm-recoverability-pack`, under the same timestamped pack directory as the runtime
backup. Do not add a V4 scheduler.

**Rationale**: The repository has no database-backup timer; the operator's recoverability
pack is the actual cadence. Co-locating both backups makes any external retention of the pack
apply to both, structurally satisfying “same cadence and retention” rather than depending on
two schedules remaining aligned.

**Implementation posture**: Build V4-specific wrappers around existing `pg_dump`/`psql`
connection helpers. Do not reuse `runShadowBackup`'s result names or schema version — calling
a production V4 backup “shadow” makes evidence ambiguous.

## R6. Restore verification and canary

**Decision**: Add migration `011_recovery_canary.sql` with one non-sensitive, fixed canary row.
The restore drill creates a uniquely-prefixed database, restores the dump, then verifies:
all current migration names/checksums, forced RLS, runtime role attributes/grants, and the
canary using the migration identity. The runtime identity receives no canary grant; it does
not need this operational row, and least privilege is clearer than making it readable merely
because a test can. It drops only the database name it created.

**Rationale**: “pg_restore exited 0” proves syntax, not usable recovery. A canary proves row
content; migrations prove schema; RLS/grants prove security posture. A dedicated operational
row is clearer than treating migration metadata as a canary accidentally.

## R7. Readiness evidence and invalidation

**Decision**: Emit a non-secret `v4-db-readiness/v1` JSON/Markdown pair carrying a posture
fingerprint over database name, host identifier (not credentials), role names/attributes,
connection budget, migration checksum set, backup-policy identifier, backup manifest hash,
and restore result.

Activation consumes a successful readiness record whose fingerprint matches current posture.
First activation requires it. Routine flag cycles may reuse it; a schema migration,
backup-policy change, or database move changes the fingerprint and invalidates it.

**Rationale**: A human “we ran the drill” note goes stale invisibly. The fingerprint makes
staleness executable.

## R8. Degraded runtime status

**Decision**: If a flagged-on V4 mount fails to start, retain a host-owned degraded status:
`GET /api/v4/status` returns 503 with `{ ok:false, enabled:true, started:false, code }`.
Other V4 routes remain unavailable. The panel probe already hides itself unless `ok === true`
and `enabled === true`.

Stable codes:
- `v4.database_unavailable`
- `v4.migration_invalid`
- `v4.privileges_missing`
- `v4.initialization_failed`

No raw database error crosses the endpoint. Full details remain in redacted operator logs.

**Rationale**: 404 means intentionally disabled. Reusing it for broken conflates two opposite
states and makes monitoring blind. A disabled panel protects lawyers from infrastructure
language; 503 gives operators a diagnostic surface.

## R9. Recovery lifecycle

**Decision**: No periodic retry or dynamic remount. After degraded startup, the operator runs
readiness and deliberately restarts the application.

**Rationale**: Dynamic remount creates a second component lifecycle inside an already-running
host, including synchronization with request handling and worker cleanup. Two in-house users
do not justify it. Explicit verified restart is simpler, observable, and reversible.

## R10. Provisioning idempotency and ownership conflicts

**Decision**: Provisioning is create-or-verify, never “repair by replacement.” Missing database,
roles, schema and grants are created/applied. Existing matching state is verified. Conflicting
owner, role attributes, role connection limit, database name, or migration checksum fails with
a stable non-secret code.

**Rationale**: Automatic ownership correction on production conceals drift and can revoke
access from a legitimate operator. Idempotency means the same correct state produces the same
result, not that every state is coerced into correctness.
