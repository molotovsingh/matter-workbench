# Implementation Plan: Provision V4 durable storage on the beta VM

**Branch**: `002-v4-database-provisioning` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-v4-database-provisioning/spec.md`

## Summary

Provision a separate `matter_workbench_v4` database on the existing PostgreSQL instance,
with a privileged migration identity and a restricted runtime identity capped at 16
connections. Apply and verify migrations while the V4 flag is off, then produce backup and
restore evidence inside the existing private-VM recoverability pack. A fail-closed readiness
command emits a non-secret posture record and is the only path allowed to authorize first
activation or activation after a material database-posture change.

At runtime, V4 uses the restricted URL, `MWB_V4_AUTO_MIGRATE=0`, and an independently bounded
pool. A failed V4 start leaves Matter Workbench and legacy extraction live, retains a
mount-owned `/api/v4/status` response with HTTP 503 and a stable code, and schedules no retry.
Recovery is an operator readiness run followed by an application restart.

## Technical Context

**Language/Version**: Node.js ESM (`.mjs`), SQL migrations, user-level systemd on Debian
**Primary Dependencies**: Existing `pg`; existing `pg_dump`/`psql` wrappers; no new package
**Storage**: Separate PostgreSQL database on the VM's existing instance; non-secret evidence
files under the existing recoverability-pack root
**Testing**: `node --test`; real PostgreSQL integration tests using disposable databases and
roles; private-VM service and recoverability checks
**Target Platform**: Debian private beta VM, PostgreSQL 16, 3.8 GB RAM, one shared instance
**Project Type**: Operator tooling plus one runtime failure-containment seam
**Performance Goals**: V4 pool and role remain at or below 16 connections under all worker
settings; provisioning causes zero application restart or downtime
**Constraints**: Separate database, same instance. Migration runs with V4 off. Runtime role
cannot administer schema or bypass RLS. Existing migrations are immutable. Runtime and
mothership databases are not modified. Backup cadence and retention are inherited by placing
V4 in the same recoverability pack, not by adding a scheduler
**Scale/Scope**: One beta VM, two in-house users, one V4 database, no HA or replication

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. Simple Surface, Rigorous Spine** | PASS. Lawyers see either the normal panel or no V4 panel. Database detail remains operator-only. A degraded status gives operators evidence without pushing infrastructure language into the lawyer surface. |
| **II. Never Invent Into The Legal Record** | PASS. Provisioning does not touch matter data. The canary is non-sensitive operational data inside V4 only. Runtime and mothership databases are explicitly immutable to this workflow. |
| **III. Fail Closed** | PASS and load-bearing. Activation is refused without current backup/restore evidence. Conflicting ownership or migration history stops rather than being repaired automatically. Failed V4 startup yields 503 for V4 while the host remains live. |
| **IV. Evidence Before Claims** | PASS with obligations. Creating a database is not readiness. Role denial, migration checksums, connection ceiling, backup integrity, restored canary, RLS, cleanup, and host health require executable evidence. |
| **V. Invariants Must Be Executable** | PASS with obligations. Tests must prove the runtime role cannot administer schema or cross databases; a broken V4 URL must leave Matter Workbench healthy; and recoverability evidence must become stale after posture changes. |

**Release discipline**: provisioning may be deployed while V4 remains off as a Tier 2
operational checkpoint only if it changes no tester-visible behaviour. Turning V4 on is part
of `v1.0.0-beta.133` and remains Tier 1. The flag is not set by this feature's provisioning
command; activation is a separate explicit operator step after evidence passes.

No violations. Complexity Tracking is omitted.

### Post-design re-check

PASS. Phase 1 keeps each guarantee at the layer that owns it:

- role identity and connection ceiling are PostgreSQL facts, verified against PostgreSQL;
- migration integrity is checked against V4's immutable migration ledger;
- backup cadence is inherited structurally by one recoverability pack, rather than asserted
  in documentation;
- activation evidence includes a posture fingerprint, so a schema, backup-policy, or database
  move invalidates proof automatically;
- degraded status is a small host-owned surface and does not create a retry lifecycle.

The design deliberately rejects auto-remount, shared-schema deployment, editing runtime or
mothership database privileges, and adding a second backup scheduler.

### Agent-context step

`.specify/scripts/bash/update-agent-context.sh generic` remains incompatible with macOS system
bash 3.2: `common.sh` expands an empty array under `set -u`. No new technology is introduced,
so no agent context is needed; the failure is recorded rather than patching vendored code in
this feature.

## Project Structure

### Documentation (this feature)

```text
specs/002-v4-database-provisioning/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/
│   ├── operator-commands.md
│   ├── readiness-record.md
│   └── degraded-status.md
└── tasks.md                 # generated later
```

### Source Code (repository root)

```text
scripts/
├── v4-db-operator-config.mjs        # shared safe parsing, posture and redaction
├── v4-db-pg-hba.mjs                 # pure render/verify helpers; never writes privileged files
├── v4-db-pg-hba-install.mjs         # explicit privileged marker-block installer and reload
├── v4-db-provision.mjs              # create/verify DB and roles; migrate while flag off
├── v4-db-readiness.mjs              # read-only gate and posture evidence
├── v4-db-activate.mjs               # consumes current readiness, changes flag last
├── v4-db-backup.mjs                 # V4-specific backup wrapper and manifest
├── v4-db-restore-drill.mjs          # disposable restore + migration/RLS/canary verification
└── private-vm-recoverability-pack.mjs # runs runtime and V4 backup/restore together

services/document-intake-extraction/
├── integration/app-mount.mjs        # explicit 16-connection pool; no auto migration
└── postgres/
    ├── migrate.mjs                  # reused unchanged
    ├── runtime-role-sql.mjs         # reused for grants
    └── migrations/
        └── 011_recovery_canary.sql  # non-sensitive restore canary

server.mjs                            # preserve degraded /api/v4/status after start failure
public-deployment.env.example         # document V4 runtime/operator variables, no secrets

test/
├── v4-db-operator-config.test.mjs
├── v4-db-pg-hba.test.mjs
├── v4-db-provision.test.mjs
├── v4-db-readiness.test.mjs
├── v4-db-activate.test.mjs
├── v4-db-backup.test.mjs
├── v4-db-restore-drill.test.mjs
├── private-vm-recoverability-pack.test.mjs
└── document-intake-extraction-v4-app-mount.test.mjs

integration-test/
└── document-intake-extraction-v4-db-provisioning.postgres.mjs
```

**Structure Decision**: Keep database-specific operator workflows in dedicated scripts, using
existing PostgreSQL argument/redaction helpers and V4 migration/grant builders. The pg_hba
renderer/verifier is pure; one explicit privileged installer owns the bounded file mutation
and reload. Extend the existing recoverability pack rather than introduce a second schedule.
Runtime change is limited to pool configuration and degraded status containment;
provisioning never mutates `runtime.env` or sets the flag. The mount consumes
`MWB_V4_AUTO_MIGRATE`; readiness/activation enforce its production value rather than
application code attempting to set environment.
