# Phase 1 Data Model: V4 Database Provisioning

**Branch**: `002-v4-database-provisioning` | **Date**: 2026-08-29

No product-domain entity is added. These are operational entities and evidence records.

## V4 Database

| Field | Rule |
|---|---|
| name | Exactly `matter_workbench_v4` on this VM |
| owner | Migration identity |
| instance | Existing beta PostgreSQL instance |
| schema | `document_intake_extraction` |
| state | absent → created → migrated → grants_verified → recoverable → activation_ready |

A transition only advances after its check passes. Failure leaves the last proven state and
never enables V4.

## Migration Identity

Privileged login used only by operator commands.

| Attribute | Rule |
|---|---|
| database ownership | Owns `matter_workbench_v4` and V4 schema objects |
| service exposure | URL is not loaded by systemd runtime service |
| use | migrations, grants, backup, restore verification |
| reporting | role name allowed; password/URL forbidden |

## Runtime Identity

Restricted login used by the V4 application pool.

| Attribute | Required value |
|---|---|
| superuser | false |
| create database | false |
| create role | false |
| inherit | false |
| bypass RLS | false |
| connection limit | 16 |
| database access | V4 database only |
| schema privileges | usage plus explicit table/function privileges |

The identity has no schema ownership and cannot run migrations.

## Recovery Canary

One non-sensitive fixed record in the V4 schema.

| Field | Rule |
|---|---|
| key | Stable versioned identifier |
| value | Non-secret constant |
| created at | Migration time |

It exists only to prove row content survives dump/restore. It is not application state and
has no runtime-identity grant; the restore drill verifies it using the migration identity.

## Backup Manifest

| Field | Rule |
|---|---|
| schema version | `v4-db-backup/v1` |
| generated at | ISO timestamp |
| database name | `matter_workbench_v4` |
| database URL | Never recorded; only `configured` |
| SQL file | Relative basename |
| bytes | Positive integer |
| SHA-256 | Lowercase 64-character digest |
| success | true only when dump exists, is non-empty, and has digest |

Stored inside the same timestamped recoverability-pack directory as the runtime database
backup, so retention applies to both as one unit.

## Restore Drill Record

| Field | Rule |
|---|---|
| schema version | `v4-db-restore-drill/v1` |
| source backup SHA-256 | Must match manifest |
| restored database | Unique, prefix-restricted disposable name |
| migration verification | Every current name/checksum matches |
| RLS verification | Enabled and forced on every tenant table |
| canary verification | Fixed row matches |
| cleanup | true unless an explicit operator keep option was used |
| success | all required checks and cleanup passed |

The drill may delete only the database it created. A name outside the restricted prefix is
rejected before any command runs.

## Readiness Record

| Field | Rule |
|---|---|
| schema version | `v4-db-readiness/v1` |
| generated at | ISO timestamp |
| database name | V4 name |
| migration role name | non-secret identifier |
| runtime role name | non-secret identifier |
| runtime role checks | explicit booleans for each prohibited/required capability |
| pool maximum | exactly 16 |
| automatic migration | false for activation-ready posture |
| migration set | names and SHA-256 values |
| backup policy | stable identifier for runtime-matched policy |
| backup manifest | path, generated time, bytes, digest — no URL |
| restore drill | path, generated time, success, cleanup |
| posture fingerprint | SHA-256 over the canonical non-secret posture fields |
| activation ready | true only when every check passes and evidence fingerprint is current |
| failed checks | stable codes only |

### Invalidation

The fingerprint changes when any of these changes:

- database name/location;
- migration set/checksum;
- role name or required attributes;
- 16-connection budget or automatic-migration setting;
- backup-policy identifier.

A changed fingerprint makes previous restore evidence ineligible. Routine flag cycles do not
change the fingerprint and may reuse evidence.

## Degraded V4 Status

Not persisted. Host-owned state held for the lifetime of the application process after a V4
start failure.

```text
status: 503
body:
  ok: false
  enabled: true
  started: false
  code: one stable V4 failure code
```

No message, exception detail, host, username, database name, or connection string is exposed.
It clears only on process restart. There is no background transition from degraded to ready.

## Activation State Machine

```text
flag off
  └─ provision database and identities
      └─ migrate and grant
          └─ backup + restore drill
              └─ readiness passes for current fingerprint
                  └─ operator sets flag and restarts
                      ├─ start succeeds → V4 available
                      └─ start fails → host remains live, V4 degraded 503
                                          └─ readiness + operator restart required
```
