# Feature Specification: Provision V4 durable storage on the beta VM

**Feature Branch**: `002-v4-database-provisioning`
**Created**: 2026-08-29
**Status**: Draft
**Input**: User description: "V4 cannot be enabled on the beta VM because it has no database to store its control plane. Provision durable storage so that V4 failure modes stay V4 failure modes rather than presenting as workbench outages, and so its data is covered by the same restore guarantees as everything else on that machine, all verified before the flag is set."

## Overview

V4 is deployed on the beta VM but cannot be enabled because it has nowhere to store its
control-plane state. Creating a database is necessary but insufficient. Done carelessly, a
V4 problem presents as a Matter Workbench outage: migration can fail during application
boot, competing connection pools can exhaust the instance, grants can target the wrong
place, and a new database can remain outside the backup and restore evidence until recovery
is needed.

This feature provisions a separate V4 database and proves, while V4 remains disabled, that
it is migrated, least-privileged, connection-bounded, backed up, and restorable. Enabling V4
is the final action, never the action used to discover whether provisioning worked.

The separate database is chosen for reversibility, not fault isolation. It shares the same
database server, memory, disk, and failure domain as the other databases on the VM. If V4 is
abandoned or later cut over, its boundary remains explicit and removable without editing the
runtime database that holds matter records.

## Clarifications

### Session 2026-08-29

- Q: What ongoing backup policy applies after the pre-activation restore drill? → A: Match
  the runtime database's backup cadence and retention, plus require a fresh V4 backup and
  successful restore drill before first activation. V4 does not invent a separate schedule,
  and its first empty backup is not treated as protection for later real work.
- Q: What is V4's maximum database connection budget on the beta VM? → A: 16 connections.
  This accommodates the intended starting shape of four primary workers, four repair
  workers, and eight coordination connections while keeping the limit independent of later
  worker-setting changes.
- Q: How is a V4 startup failure exposed without taking down Matter Workbench? → A: Keep a
  degraded V4 status endpoint returning 503 with a stable, non-secret error code. The panel
  remains hidden. This lets monitoring distinguish "flag off" from "flag on but broken"
  without asking a lawyer to understand infrastructure failure.
- Q: When must restore proof be repeated? → A: Before first activation, then after any V4
  schema migration, backup-policy change, or database move. A routine flag-off/flag-on cycle
  does not invalidate evidence when the database posture has not changed.
- Q: How does V4 recover after starting degraded because its database was unavailable? → A:
  Verified restart. The operator reruns readiness checks and restarts Matter Workbench only
  after they pass. V4 does not periodically remount itself inside an already-running process.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Provision safely while the workbench stays live (Priority: P1)

The operator provisions V4 storage, applies its schema, and verifies its runtime permissions
without enabling V4 or interrupting the running workbench.

**Why this priority**: V4 cannot start without storage, but testing provisioning by starting
V4 makes migration or permission failure a workbench boot failure. Every risky operation
must happen while the existing service remains untouched.

**Independent Test**: Run provisioning from an unprovisioned VM state. The V4 database and
identities exist, all schema and permission checks pass, V4 remains disabled, and the
workbench continues returning healthy responses throughout.

**Acceptance Scenarios**:

1. **Given** no V4 database exists, **When** provisioning runs, **Then** a separate V4
   database is created, all migrations are applied in order, and V4 remains disabled.
2. **Given** a fully provisioned V4 database, **When** provisioning is run again, **Then** it
   verifies the existing state without duplicating or replacing it.
3. **Given** a migration or grant failure, **When** provisioning runs, **Then** it stops
   before activation and the currently running workbench is unchanged.
4. **Given** the V4 runtime identity, **When** it attempts schema administration or access
   outside V4, **Then** access is denied while the operations required by V4 succeed.

---

### User Story 2 - Restore evidence exists before activation (Priority: P1)

Before V4 can be enabled, the operator can prove that V4 data is backed up and can be
restored into a clean disposable database.

**Why this priority**: A separate database is not safer if existing backups silently omit it.
That failure stays invisible until recovery is needed. Backup and restore coverage must be
part of provisioning, not a follow-up.

**Independent Test**: Write a non-sensitive canary record, create a backup, restore it into a
new disposable database, and verify the schema, migration history, row-level protections,
and canary contents. Remove the disposable database afterwards.

**Acceptance Scenarios**:

1. **Given** a migrated V4 database with a canary record, **When** backup runs, **Then** a
   non-empty backup and integrity manifest are produced and attributed to the V4 database.
2. **Given** that backup, **When** the restore drill runs, **Then** it creates a disposable
   database, restores the backup, verifies the canary and required protections, and removes
   the disposable database.
3. **Given** no successful restore evidence for the current schema, backup policy, and
   database location, **When** activation is requested, **Then** activation is refused.
4. **Given** a corrupt or incomplete backup, **When** the restore drill runs, **Then** it
   fails closed and does not count as readiness evidence.
5. **Given** V4 is active and producing data, **When** the runtime database's scheduled
   backup window occurs, **Then** V4 is backed up on the same cadence and retained for the
   same period.

---

### User Story 3 - V4 fails as V4, not as Matter Workbench (Priority: P1)

After activation, an unavailable or misconfigured V4 database makes fast extraction
unavailable while the ordinary Matter Workbench and legacy extraction remain usable.

**Why this priority**: The whole purpose of the boundary is lost if an optional,
pre-certification subsystem can prevent the host application from booting. This is part of
provisioning correctness, not a later reliability improvement.

**Independent Test**: With V4 configured on, make its database unavailable and restart the
application. Matter Workbench starts and serves the legacy paths; the V4 status is clearly
unavailable and its panel is not offered.

**Acceptance Scenarios**:

1. **Given** V4 is enabled and its database is unavailable, **When** the application starts,
   **Then** Matter Workbench starts normally, legacy extraction remains available, and V4's
   status returns 503 with a stable non-secret error code while its panel remains hidden.
2. **Given** V4 is enabled with a role lacking required privileges, **When** the application
   starts, **Then** the failure is confined to V4, its status returns 503 with a stable code
   identifying the failed check, and no credential value is exposed.
3. **Given** a healthy V4 database, **When** the application starts, **Then** V4 becomes
   available without changing ordinary matter behaviour.
4. **Given** V4 started degraded and its database later recovered, **When** the operator
   reruns readiness successfully and restarts Matter Workbench, **Then** V4 becomes available.
   Until that verified restart, V4 remains degraded and does not remount itself.

---

### User Story 4 - Activation is explicit and reversible (Priority: P2)

The operator enables V4 only after every prerequisite passes and can disable it without
altering or deleting V4 data.

**Why this priority**: Essential for operating the beta, but dependent on P1 proving the
storage safe and the failure boundary real.

**Independent Test**: Attempt activation before readiness and observe refusal. Complete all
checks, activate successfully, then disable V4 and confirm the workbench returns to its prior
surface while V4 data remains intact.

**Acceptance Scenarios**:

1. **Given** any failed prerequisite, **When** activation is requested, **Then** it is refused
   with the failed prerequisite named.
2. **Given** every prerequisite passed, **When** V4 is enabled, **Then** the V4 status and
   panel become available.
3. **Given** V4 is active, **When** it is disabled, **Then** only the V4 surface disappears;
   the database and its data remain available for investigation or later reactivation.

---

### Edge Cases

- The V4 database exists but is owned by the wrong identity: provisioning stops; it does not
  replace ownership automatically.
- The configured connection string points at the runtime or mothership database: readiness
  fails before migration or activation.
- An existing migration's checksum differs: readiness fails; the applied migration is never
  rewritten.
- Backup succeeds but its manifest or checksum is missing: restore readiness remains failed.
- Restore succeeds but tenant isolation is absent: readiness remains failed.
- The disposable restore database name collides with an existing database: the existing
  database is never reused or deleted.
- Provisioning is interrupted halfway through: re-running resumes by verifying completed
  steps and applying only missing safe steps.
- V4 reaches its 16-connection budget: new V4 work waits or fails as V4; increasing worker
  settings cannot silently raise the database budget or consume connections reserved for
  the workbench.
- The V4 database recovers after the application started degraded: V4 remains degraded until
  readiness is rerun and the application is deliberately restarted; it does not remount
  itself periodically.
- The database server itself is unavailable: both systems may be affected because they share
  one instance; this feature makes no false claim of instance-level isolation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: V4 MUST use a database separate from the runtime database that holds matter
  records and from the mothership database.
- **FR-002**: Provisioning MUST create or verify a privileged migration identity and a
  distinct restricted runtime identity.
- **FR-003**: The runtime identity MUST have only the data and execution privileges V4 needs.
  It MUST NOT create, alter, or drop schemas or databases, bypass tenant protections, or
  access the runtime or mothership databases.
- **FR-004**: All V4 migrations and runtime grants MUST be applied and verified while V4 is
  disabled.
- **FR-005**: Re-running provisioning against correct existing state MUST be idempotent.
  Conflicting ownership, grants, or migration history MUST fail rather than be replaced
  automatically.
- **FR-006**: V4 MUST have an explicit maximum connection budget of 16 on the beta VM.
  Activation readiness MUST verify that value rather than relying on a library default or
  deriving it from worker settings.
- **FR-007**: Provisioning MUST produce a backup and integrity manifest for the V4 database
  in the same operator workflow that creates it. After activation, V4 MUST be backed up on
  the same cadence and retained for the same period as the runtime database.
- **FR-008**: A restore drill MUST restore into a newly-created disposable database, verify
  migration history, required tenant protections, and a non-sensitive canary, then remove
  only the database created by that drill. Restore proof MUST be repeated after any V4 schema
  migration, backup-policy change, or database move; a routine reactivation with none of
  those changes MAY reuse the existing proof.
- **FR-009**: Activation MUST be refused until database identity, migration, grant,
  connection-budget, backup, and restore checks all pass for the current database posture.
- **FR-010**: Enabling V4 MUST be the final operation after readiness, not the mechanism used
  to run migrations or discover configuration errors.
- **FR-011**: A V4 initialization or database failure MUST NOT prevent Matter Workbench from
  starting or make legacy extraction unavailable.
- **FR-012**: When V4 is flagged on but unavailable, its status endpoint MUST return 503 with
  a stable, non-secret error code and the fast-extraction panel MUST not be offered. A 404 is
  reserved for V4 being intentionally disabled.
- **FR-013**: Readiness evidence MUST identify the database name, active identity, migration
  state, connection budget, backup artifact, and restore-drill result without recording
  secrets.
- **FR-014**: Disabling V4 MUST leave its database and data unchanged.
- **FR-015**: Provisioning MUST NOT modify schemas, ownership, or data in the runtime or
  mothership databases.
- **FR-016**: After a degraded V4 startup, recovery MUST require successful readiness checks
  followed by an operator-initiated application restart. V4 MUST NOT periodically retry and
  mount itself inside an already-running process.

### Key Entities

- **V4 database**: The separate durable store for V4 control-plane state and filing reports.
- **Migration identity**: Privileged operator identity used only for provisioning and schema
  change.
- **Runtime identity**: Restricted identity used by the running V4 service.
- **Readiness record**: Non-secret statement of which checks passed for which database and
  configuration.
- **Backup artifact**: Database dump paired with an integrity manifest.
- **Restore drill**: A bounded exercise that proves the backup can recreate the expected V4
  state in a disposable database.
- **Activation**: The explicit transition from provisioned-but-disabled to available.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Provisioning and all readiness checks complete with zero restart or downtime of
  the running Matter Workbench.
- **SC-002**: Re-running provisioning produces zero duplicate resources and zero changes to
  already-correct ownership, grants, or migration history.
- **SC-003**: The restricted runtime identity passes every required V4 operation and fails
  100% of tested schema-administration, tenant-bypass, and cross-database operations.
- **SC-004**: First activation and every activation after a schema, backup-policy, or
  database-location change is preceded by a successful backup and restore drill against the
  exact database being activated. Every scheduled runtime-database backup window produces a
  corresponding V4 backup under the same retention policy.
- **SC-005**: A restore drill recreates 100% of migrations and the canary record, verifies
  tenant protections, and deletes only its own disposable database.
- **SC-006**: With the V4 database unavailable, Matter Workbench and legacy extraction remain
  available after restart, the V4 panel is absent, and V4 status returns 503 rather than 404
  or a host-application failure.
- **SC-007**: V4 never exceeds 16 database connections during activation checks or a
  representative in-house run, regardless of worker-lane settings.
- **SC-008**: Readiness and failure reports contain zero connection strings, passwords,
  access tokens, or other secret values.
- **SC-009**: Disabling V4 changes zero rows and zero schema objects in the V4 database.
- **SC-010**: After a degraded startup, V4 remains unavailable through 100% of background
  retry intervals because none are scheduled, and becomes available only after a successful
  readiness check and operator-initiated restart.

## Assumptions

- The V4 database shares the existing PostgreSQL server, disk, memory, WAL, and failure
  domain. This feature does not claim instance-level isolation.
- A separate database is the decided posture, chosen for reversibility: abandonment and
  cutover should not require editing the runtime database.
- Backup coverage is part of provisioning, not follow-up work. Its ongoing cadence and
  retention match the runtime database rather than creating a V4-specific policy.
- The beta remains two in-house users; high availability and multi-region recovery are not
  required here.
- Local-disk object storage remains the settled V4 object-storage posture for this VM.
- V4 remains optional and legacy extraction remains authoritative.
- Existing V4 migrations remain immutable; new migrations may be added normally.

## Out of Scope

- A separate PostgreSQL server or managed database instance.
- High availability, replication, multi-region recovery, or zero-downtime database failover.
- V4 load, quality, provider-quota, security, or cutover certification.
- Making fast extraction automatic or part of new-matter set-up.
- Changing V4 extraction quality, provider routing, or object storage.
- Migrating V4 data into the runtime database or migrating runtime matter data into V4.
- Deleting the V4 database during disable or rollback.
