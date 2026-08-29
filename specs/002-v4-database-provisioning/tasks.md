---
description: "Task list for 002-v4-database-provisioning"
---

# Tasks: Provision V4 durable storage on the beta VM

**Input**: `/specs/002-v4-database-provisioning/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. The feature's value is evidence that failure and recovery boundaries
hold; those claims cannot be established by scripts existing.

## Phase 1: Setup

**Purpose**: Establish clean baselines before operator or runtime behaviour changes.

- [X] T001 Run `npm test`, `npm run ui:build`, and the existing PostgreSQL integration suite; record baseline results and known pre-existing failures in `specs/002-v4-database-provisioning/tasks.md`
- [X] T002 [P] Confirm V4 remains disabled on the beta VM and capture current service health, database list, role list, and connection count in a non-secret local note under `specs/002-v4-database-provisioning/evidence/preflight.md`

---

## Phase 2: Foundational — Safe configuration and canary

**Purpose**: Shared primitives required by provisioning, backup, readiness, and activation.

⚠️ No story phase starts until T007 passes.

- [X] T003 Write failing tests for database/role-name validation, fixed database identity, URL redaction, operator/runtime environment separation, and stable failure codes in `test/v4-db-operator-config.test.mjs` *(FR-001, FR-002, FR-013, SC-008)*
- [X] T004 Implement shared parsing, safe identifiers, database-name assertion, environment loading, canonical non-secret posture fields, and secret redaction in `scripts/v4-db-operator-config.mjs` until `test/v4-db-operator-config.test.mjs` passes *(FR-001, FR-002, FR-013, SC-008)*
- [X] T005 Write a failing migration test in `test/document-intake-extraction-v4-migrations.test.mjs` requiring `011_recovery_canary.sql`, its fixed non-sensitive row, runtime denial of mutation, and checksum immutability *(FR-004, FR-008, SC-005)*
- [X] T006 Add `services/document-intake-extraction/postgres/migrations/011_recovery_canary.sql` with one fixed non-sensitive canary row verified by the migration identity and inaccessible to the runtime identity *(FR-004, FR-008, SC-005)*
- [X] T007 Run the focused configuration and migration tests and confirm both were observed failing before implementation and now pass; record the red/green evidence in `specs/002-v4-database-provisioning/tasks.md`

**Checkpoint**: Shared safety primitives and restore canary exist; no production state changed.

---

## Phase 3: User Story 1 — Provision safely while the workbench stays live (Priority: P1)

**Goal**: Create/verify the separate database and identities, migrate and grant while V4 is
off, with no host restart or mutation of runtime/mothership databases.

**Independent test**: Provision from absent state, run again, and prove both runs pass while
the workbench remains healthy; runtime operations succeed and prohibited ones fail.

- [X] T008 [US1] Write failing create-or-verify unit tests in `test/v4-db-provision.test.mjs` for absent state, idempotent correct state, conflicting owner, conflicting role attributes, migration checksum mismatch, and flag-on refusal *(FR-001–FR-005, SC-001, SC-002)*
- [X] T009 [US1] Write failing tests in `test/v4-db-pg-hba.test.mjs` for exact local/TCP V4 runtime-role rejection against runtime and mothership databases, safe marker-block rendering, duplicate-block refusal, existing-file preservation, refusal without privileged file access, reload verification, and rollback on invalid active rules *(FR-003, FR-015, SC-003)*
- [X] T010 [US1] Implement pure render/verify helpers in `scripts/v4-db-pg-hba.mjs` and an explicitly invoked privileged installer in `scripts/v4-db-pg-hba-install.mjs`; the installer must never invoke sudo or prompt, must own only its marker block, write atomically with a backup, reload, verify active rules, and restore the backup on failure *(FR-003, FR-015, SC-003)*
- [X] T011 [US1] Implement `scripts/v4-db-provision.mjs` to require V4 flag off; create or verify `matter_workbench_v4`, migration/runtime identities, database ownership, role attributes, runtime role `CONNECTION LIMIT 16`, and pg_hba denial before applying V4 migrations and grants *(FR-001–FR-006, FR-015)*
- [X] T012 [US1] Make `scripts/v4-db-provision.mjs` run `runDocumentIntakeExtractionMigrations` using the migration identity, apply `buildDocumentIntakeExtractionRuntimeRoleSql`, verify forced RLS and required runtime operations, and fail rather than repair conflicts *(FR-003–FR-005, SC-002, SC-003)*
- [X] T013 [US1] Add a failing pool-budget case to `test/document-intake-extraction-v4-app-mount.test.mjs` proving worker settings cannot raise the configured maximum above 16 *(FR-006, SC-007)*
- [X] T014 [US1] Update `services/document-intake-extraction/integration/app-mount.mjs` to require/use `MWB_V4_DB_POOL_MAX=16` independently of lane settings; the mount consumes `MWB_V4_AUTO_MIGRATE` but never rewrites environment, while readiness and activation require its production value to be `0` *(FR-004, FR-006, SC-007)*
- [X] T015 [US1] Add `integration-test/document-intake-extraction-v4-db-provisioning.postgres.mjs` exercising real role/database creation, second-run idempotency, migration/grant verification, prohibited operations, and unchanged runtime/mothership databases; run a flag-off representative 4-primary/4-repair database workload, sample the runtime role in `pg_stat_activity`, and assert peak connections never exceed 16 *(FR-001–FR-006, FR-015, SC-001–SC-003, SC-007)*
- [X] T016 [US1] Document non-secret runtime and operator variables, file-permission boundaries, and flag-off provisioning in `public-deployment.env.example` and `deployment/private-vm/README.md` *(FR-002, FR-004, FR-006)*

**Checkpoint**: US1 local implementation complete. Independent VM acceptance remains pending T038; the database is not activation-ready.

---

## Phase 4: User Story 2 — Restore evidence exists before activation (Priority: P1)

**Goal**: Produce V4 backup and restore evidence in the same recoverability pack, cadence and
retention unit as the runtime database.

**Independent test**: Seed the canary, back up, restore into a unique disposable database,
verify migrations/RLS/roles/canary, and prove cleanup; a corrupt backup must fail.

- [X] T017 [US2] Write failing backup tests in `test/v4-db-backup.test.mjs` for exact database targeting, non-empty dump, SHA-256 manifest, secret redaction, command failure, and zero-byte dump refusal *(FR-007, FR-013, SC-004, SC-008)*
- [X] T018 [US2] Implement `scripts/v4-db-backup.mjs` using existing pg_dump connection/redaction helpers but emitting unambiguous `v4-db-backup/v1` artifacts under a caller-supplied pack directory *(FR-007, FR-013, SC-004, SC-008)*
- [X] T019 [US2] Write failing restore tests in `test/v4-db-restore-drill.test.mjs` for manifest digest validation, safe unique names, create/restore/verify/drop order, migration/RLS/canary checks, corrupt backup refusal, and cleanup on verification failure *(FR-008, SC-005, SC-008)*
- [X] T020 [US2] Implement `scripts/v4-db-restore-drill.mjs` producing `v4-db-restore-drill/v1`, accepting only `matter_workbench_v4_restore_*`, verifying current migration names/checksums, forced RLS and canary, and dropping only its own database *(FR-008, SC-005, SC-008)*
- [X] T021 [US2] Add real PostgreSQL backup/restore integration coverage to `integration-test/document-intake-extraction-v4-db-provisioning.postgres.mjs`, including canary content and cleanup verification *(FR-007, FR-008, SC-004, SC-005)*
- [X] T022 [US2] Extend `test/private-vm-recoverability-pack.test.mjs` with failing cases requiring V4 backup and restore steps, whole-pack failure propagation, shared timestamp/root, and runtime/V4 evidence retention as one unit *(FR-007–FR-009, SC-004)*
- [X] T023 [US2] Update `scripts/private-vm-recoverability-pack.mjs` to run runtime and V4 backup/restore in one timestamped pack, fail the pack when either database fails, and emit both evidence paths without secrets *(FR-007–FR-009, FR-013, SC-004, SC-008)*

**Checkpoint**: US2 local implementation complete. Independent VM recovery acceptance remains pending T039.

---

## Phase 5: User Story 3 — V4 fails as V4, not as Matter Workbench (Priority: P1)

**Goal**: A flagged-on V4 initialization failure leaves the host healthy and exposes a stable
503 V4 status without offering the panel or retrying in the background.

**Independent test**: Start with an unreachable V4 URL; host and legacy route work, V4 status
returns 503, other V4 routes remain unavailable, and no retry occurs.

- [ ] T024 [US3] Write failing startup-containment tests in `test/document-intake-extraction-v4-app-mount.test.mjs` for database unavailable, migration mismatch, privilege failure, unknown initialization failure, host availability, no background retry, and stable redacted codes *(FR-011, FR-012, FR-016, SC-006, SC-008, SC-010)*
- [ ] T025 [US3] Implement stable error classification and a host-owned degraded V4 status response in `server.mjs`: 503 for flagged-on failure, 404 only when intentionally disabled, all non-status V4 routes unavailable, no raw message exposed *(FR-011, FR-012, SC-006, SC-008)*
- [ ] T026 [US3] Preserve the failed-mount cleanup and no-retry lifecycle in `server.mjs`; require operator readiness plus process restart for recovery, with no timer or dynamic remount path *(FR-016, SC-010)*
- [ ] T027 [P] [US3] Verify `react-ui/src/api/v4Intake.ts` continues to hide the panel for a 503 degraded response and add coverage to the existing UI smoke mechanism without introducing a component-test framework *(FR-012, SC-006)*
- [ ] T028 [US3] Add a controlled real-process failure test in `integration-test/document-intake-extraction-v4-db-provisioning.postgres.mjs` proving Matter Workbench/legacy availability and degraded V4 503 with an unreachable database *(FR-011, FR-012, SC-006, SC-008)*

**Checkpoint**: US3 independently complete. The V4 boundary has operational meaning.

---

## Phase 6: User Story 4 — Activation is explicit and reversible (Priority: P2)

**Goal**: Current, non-secret evidence gates activation; disable preserves all V4 data.

**Independent test**: Activation fails with missing/stale evidence, succeeds with current
evidence, changes the flag last, and disable removes only the flag without touching the DB.

- [ ] T029 [US4] Write failing readiness-record tests in `test/v4-db-readiness.test.mjs` for every field in `contracts/readiness-record.md`, canonical fingerprinting, secret exclusion, stale migration/role/budget/policy/location invalidation, and routine flag-cycle reuse *(FR-009, FR-013, SC-004, SC-008)*
- [ ] T030 [US4] Implement read-only `scripts/v4-db-readiness.mjs` to verify database/roles/grants/RLS/migrations/16-connection budget, `MWB_V4_AUTO_MIGRATE=0`, and supplied backup/restore evidence, write JSON/Markdown, and never migrate, grant, restore, restart or set the flag *(FR-009, FR-013, SC-004, SC-008)*
- [ ] T031 [US4] Write failing activation/disable tests in `test/v4-db-activate.test.mjs` for absent/failed/stale evidence, current evidence, atomic runtime-env edit, flag-last ordering, no restart before edit, disable preserving DB state, and secret-safe output *(FR-009, FR-010, FR-014, SC-009)*
- [ ] T032 [US4] Implement `scripts/v4-db-activate.mjs` to consume current readiness evidence, refuse activation unless `MWB_V4_AUTO_MIGRATE=0`, atomically set or remove only `MWB_V4_INTAKE`, restart only after a successful edit, and never migrate, grant, back up, restore, or delete V4 data *(FR-009, FR-010, FR-014, SC-009)*
- [ ] T033 [US4] Add package commands for provision, backup, restore, readiness, activation and disable to `package.json`, and document the exact flag-last sequence in `deployment/private-vm/README.md` *(FR-009, FR-010, FR-014, FR-016)*
- [ ] T034 [US4] Add an end-to-end operator-flow test to `integration-test/document-intake-extraction-v4-db-provisioning.postgres.mjs`: provision → backup → restore → readiness → activation dry-run → disable dry-run, proving no earlier step changes the flag *(FR-004, FR-009, FR-010, FR-014, SC-001, SC-004, SC-009)*

**Checkpoint**: All stories complete. Activation has one explicit, evidence-gated path.

---

## Phase 7: Polish and Release Readiness

- [ ] T035 Run `npm test`, `npm run ui:build`, `git diff --check`, and the complete PostgreSQL integration suite; compare test count against T001 and explain every increase in `specs/002-v4-database-provisioning/tasks.md`
- [ ] T036 [P] Run a secret scan over V4 evidence fixtures and rendered reports in `test/`, `integration-test/`, and `specs/002-v4-database-provisioning/` and assert zero URLs/passwords/tokens *(SC-008)*
- [ ] T037 [P] Validate requirement traceability: every FR/SC in `specs/002-v4-database-provisioning/spec.md` maps to at least one task and every task maps to a story, requirement, or release obligation
- [ ] T038 Execute a flag-off beta-VM provisioning rehearsal and capture non-secret evidence under `specs/002-v4-database-provisioning/evidence/`, confirming host uptime and service start timestamp do not change *(SC-001)*
- [ ] T039 Execute `npm run private-vm:recoverability-pack` and `npm run v4:db:readiness` on the beta VM with V4 still off; confirm the restore database is removed and readiness is activation-ready for the current posture *(SC-004, SC-005)*
- [ ] T040 Update `docs/releases/v1.0.0-beta.133.md` with the exact provisioning, migration, backup/restore, readiness and degraded-status evidence; do not tag or move `docs/releases/current.md` until the later flag-on deploy completes

---

## Dependencies

```text
Phase 1 Setup
  └─▶ Phase 2 Foundational
        └─▶ Phase 3 US1 Provisioning
              ├─▶ Phase 4 US2 Recoverability
              └─▶ Phase 5 US3 Failure containment
                    └─▶ Phase 6 US4 Activation
                          └─▶ Phase 7 Polish / VM evidence
```

- US2 needs a provisioned database and canary from US1.
- US3 needs the runtime pool/role posture from US1, but can proceed in parallel with US2.
- US4 needs current provisioning and recoverability evidence plus the degraded runtime contract.
- VM tasks T038–T040 require all local gates green and explicit operator authority.

## Parallel Opportunities

- T002 alongside T001.
- T003/T004 may proceed alongside the strictly sequential T005 → T006 canary pair.
- T008 can proceed alongside the strictly sequential T009 → T010 pg_hba pair; T011 waits for both.
- T013 → T014 is strictly sequential but may proceed alongside T008–T012 after shared foundations.
- T017 → T018 and T019 → T020 are two independent test-first pairs until T021.
- US2 and US3 can proceed in parallel after US1.
- T029 → T030 and T031 → T032 are independent test-first pairs until T034.
- T036 and T037 are independent of each other.

## Implementation Strategy

**MVP is US1 + US2 + US3**, not provisioning alone. A created database without restore evidence
or failure containment is exactly the unsafe half-feature this spec exists to prevent.

Build test-first in each story. Every failing-test task is a hard predecessor of its implementation task; `[P]` never permits a test and the code intended to satisfy it to run together. The highest-risk work is pg_hba manipulation (T009/T010),
degraded runtime routing (T024–T026), and activation's atomic runtime-env edit (T031/T032).
Each must be observed failing before implementation.

The flag is never set during implementation until T039 has produced activation-ready evidence
on the VM. T040 updates the release note; the separate beta.133 deploy remains the activation
event.

## Notes

- T001 baseline: **1940 tests, 1940 pass, 0 fail** on 2026-08-29.
- T009 red: missing pg_hba modules; green: 5/5 focused tests.
- T013 red: pool factory ignored; green: app-mount suite 6/6.
- T017/T019 red: missing backup/restore modules; green: 5/5 focused tests.
- T021 real PostgreSQL: 75,022-byte dump, SHA-256 verified, restored migrations/RLS/canary, disposable database cleaned; integration 1/1 pass.
- T022 pack red: V4 steps absent; green: combined recoverability suite 11/11.
- T015 PostgreSQL: fixed database provisioned twice; 1/1 pass with sampled 4-primary/4-repair role workload at 8 connections.
- T003/T005 red: missing operator-config module and missing 011 canary. Green: 6/6 focused tests.
- The current repository contains no scheduled backup timer; “same cadence and retention” is
  implemented by placing runtime and V4 evidence in the same recoverability-pack directory,
  so one invocation and one external retention rule cover both.
