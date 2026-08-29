---
description: "Task list for 001-v4-record-parity"
---

# Tasks: Fast extraction results reach the matter record under PostgreSQL storage

**Input**: Design documents from `/specs/001-v4-record-parity/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/matter-record-store.md, quickstart.md

**Tests**: Test tasks are included. They are not optional here — the spec's parity claim is
unverifiable without them, and Constitution principles IV and V require the invariant be
demonstrated and executable rather than asserted.

**Organization**: Grouped by user story. US2 is independently deliverable — it improves the
filesystem arrangement on its own, without US1.

**Traceability**: Each task names the requirements it discharges. Coverage is checked at
T028; requirements without a task are visible rather than inferred.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup

**Purpose**: Establish the reference baseline this feature must not break.

- [X] T001 Record the baseline: run `npm test` and write the pass count into the Notes section of `specs/001-v4-record-parity/tasks.md`, so any later change in total is visible rather than assumed
- [X] T002 [P] Create the directory `services/matter-record-store/` with no implementation yet

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extract the storage port with **zero behaviour change**. Every user story depends
on this. The reference suite passing unedited is the proof the extraction was faithful.

The contract test is written first, and must be seen failing. A test that has never failed
proves less than one that has.

⚠️ Nothing in Phase 3 or 4 may start until T009 passes.

- [X] T003 Write the port contract test in `test/matter-record-store.test.mjs`, covering every MUST and MUST NOT in `specs/001-v4-record-parity/contracts/matter-record-store.md`. It MUST fail at this point — the adapter does not exist yet
- [X] T004 Implement `resolveMatter`, `readText`, `writeText` in `services/matter-record-store/filesystem-matter-record-store.mjs`, moving the existing directory-resolution, file-read, and atomic-write behaviour out of `services/v4-extraction-import-service.mjs` verbatim
- [X] T005 Refactor `services/v4-extraction-import-service.mjs` to accept a store and call it, removing every direct `node:fs/promises` import while leaving all filing rules — content matching, the readability gate, the existing-record check, the log merge — exactly where they are *(FR-003)*
- [X] T006 Update `server.mjs` to construct the filesystem store and pass it to the import service, leaving the postgres-mode branch untouched for now
- [X] T007 Verify `test/matter-record-store.test.mjs` now passes against the filesystem adapter
- [X] T008 Verify `test/v4-extraction-import.test.mjs` passes **with no edits to that file**. If it needs changing, T004–T006 altered reference behaviour and must be reworked
- [X] T009 Assert in `test/matter-record-store.test.mjs` that a record written through the filesystem adapter satisfies `canUseCachedExtraction` from `extract-engine.mjs:101` for its matching register row, pinning the reuse property before the refactor can lose it *(FR-008, SC-003)*

**Checkpoint**: Filesystem arrangement behaves exactly as before, now through the port, with
its reuse eligibility pinned by a test.

---

## Phase 3: User Story 1 — Results reach the record however the matter is stored (Priority: P1) 🎯 MVP

**Goal**: Fast extraction files results into the matter under database storage, producing the
same observable result as the filesystem arrangement.

**Independent test**: Run the same documents against a matter held each way and compare the
resulting records — same accepted documents, same text, same references, same log entries.

- [ ] T010 [US1] Add a narrow full-text read to `services/runtime-db-storage-service.mjs` that returns a matter-relative file as a string with **no display size cap**, distinct from `getRawFile` (research R2)
- [ ] T011 [US1] Implement `services/matter-record-store/runtime-db-matter-record-store.mjs` against the same contract, resolving matters by name only and declining when the name does not resolve (research R3) *(FR-001, FR-009)*
- [ ] T012 [US1] In `services/matter-record-store/runtime-db-matter-record-store.mjs`, make `writeText` persist **one file per call** rather than accumulating a batch, so a mid-batch failure leaves the same state as the filesystem arrangement (research R4) *(FR-002)*
- [ ] T013 [P] [US1] Extend `test/matter-record-store.test.mjs` to run the identical contract cases against the database adapter
- [ ] T014 [US1] Write the parity scenario table in `test/v4-record-parity.test.mjs`: one table of scenarios executed through both adapters, asserting obligations P1–P5 from the contract by **comparing the two results to each other**, not against two hand-written expectations *(FR-002, SC-002)*
- [ ] T015 [US1] Add these scenarios to the table in `test/v4-record-parity.test.mjs`: unregistered content, duplicate registrations, an existing valid record, a document with one unreadable page, an existing activity-log entry, a filename mismatch, and an unresolvable matter *(FR-004, FR-005, FR-006, FR-007, FR-009, SC-005)*
- [ ] T016 [US1] Add a reuse-eligibility case to `test/v4-record-parity.test.mjs`: records written by **both** adapters must satisfy `canUseCachedExtraction`. Assert this **absolutely, not by comparing adapters** — equality passes if both are wrong, which is the one hole parity testing cannot see *(FR-008, SC-003)*
- [ ] T017 [US1] Replace the postgres-mode branch in `server.mjs` (the block logging "postgres storage mode — extraction results stay in the V4 store") so it selects the database adapter instead of setting the result consumer to null *(FR-001)*
- [ ] T018 [US1] Add `integration-test/v4-record-parity.postgres.mjs` filing real results against a real database, run via `npm run test:postgres` *(SC-001)*
- [ ] T019 [P] [US1] Verify `test/document-intake-extraction-v4-isolation.test.mjs` still passes — the import service and its adapters must not have acquired an import from the extraction service

**Checkpoint**: US1 complete and independently shippable. The defect is fixed.

---

## Phase 4: User Story 2 — The lawyer can see which documents landed (Priority: P2)

**Goal**: After a run, the lawyer can tell which documents entered the record and which did
not, with a reason — including when they were not watching.

**Independent test**: Run a mixed batch and confirm the reported outcome for every document
matches the record. Reload mid-run and confirm the run rejoins rather than restarting.

**Note**: No React component test harness exists in this repository. Verification for the UI
tasks is `npm run ui:build` (which runs typecheck), `npm run ui:smoke`, and manual use.

- [ ] T020 [US2] Carry the filing summary back through the result-delivery seam as plain data in `services/document-intake-extraction/integration/app-mount.mjs`, without the import service gaining any knowledge of the extraction service
- [ ] T021 [US2] Assert in `test/v4-record-parity.test.mjs` that the returned summary matches the record: every document reported filed has a record, every document reported skipped or left has none, and the counts agree *(FR-010, FR-011, SC-004)*
- [ ] T022 [US2] Render per-document outcomes in `react-ui/src/components/upload/V4IntakePanel.tsx` — filed, left for normal extraction, skipped as unregistered, skipped because a record existed — with a reason for every document not filed *(FR-010, SC-006)*
- [ ] T023 [US2] Show a plain "nothing entered the record" state in `react-ui/src/components/upload/V4IntakePanel.tsx` rather than a success message when no document was filed
- [ ] T024 [US2] Persist the run identity per matter in `react-ui/src/components/upload/V4IntakePanel.tsx` and re-attach on mount using the existing `getV4Intake` / progress reads in `react-ui/src/api/v4Intake.ts` — no new endpoint, and re-attaching must not resubmit documents *(FR-013, SC-007)*
- [ ] T025 [US2] Handle an aged-out run in `react-ui/src/components/upload/V4IntakePanel.tsx`: state that the report is no longer available rather than rendering an empty one *(FR-013)*

**Checkpoint**: US2 complete. Outcomes are visible, verified against the record, and survive
leaving the page.

---

## Phase 5: Polish & Cross-Cutting

- [ ] T026 [P] Add a cross-tenant filing test to `test/matter-record-store.test.mjs` asserting that filing declines to write into a matter outside the caller's tenant *(FR-014)*
- [ ] T027 [P] Run the full gate set: `npm test`, `npm run ui:build`, `git diff --check`, and `MWB_POSTGRES_TEST_ADMIN_URL=... npm run test:postgres`
- [ ] T028 Confirm requirement coverage: every FR and SC in `specs/001-v4-record-parity/spec.md` is cited by at least one task above, except FR-012, which is deliberately uncovered — no task touches the path that could break it
- [ ] T029 Run `npm test` and confirm the total rose only by the tests added in T003, T009, T013, T014, T015, T016, T018, T021 and T026, comparing against the baseline recorded in the Notes below
- [ ] T030 Prepare the Tier 1 release note per `docs/release-policy.md`. This changes storage and custody semantics on a path testers reach, so it is not a maintenance checkpoint. State explicitly in Not Promised that the five V4 certifications remain open and that this feature does not make fast extraction automatic

---

## Dependencies

```text
Phase 1 (Setup)
   └─▶ Phase 2 (Foundational: port + filesystem adapter)   ← BLOCKS EVERYTHING
          ├─▶ Phase 3 (US1: database adapter + parity)     ← MVP
          └─▶ Phase 4 (US2: outcomes + re-attach)          ← independent of US1
                 └─▶ Phase 5 (Polish)
```

**Story independence**: US2 depends on Phase 2, not on US1. It can ship first and delivers
value on the filesystem arrangement alone. US1 is nonetheless the MVP, because it is the
defect.

**Within Phase 2**: strictly sequential. T003 must fail, T004–T006 make it pass, T007–T009
confirm. Nothing here is parallel — each step's evidence depends on the previous one.

**Within US1**: T010 → T011 → T012 are sequential (same subject). T013 and T019 are parallel
with each other. T014–T016 need T011–T012. T017 needs the adapter. T018 needs T017.

**Within US2**: T020 precedes everything else. T021 needs T020. T022, T023 touch the same
file — sequential. T024 → T025 sequential.

## Parallel Opportunities

- **Phase 3**: T013 and T019 together; T019 anytime after Phase 2
- **Phase 5**: T026 and T027 together

Phase 2 has no parallel work by design — see Dependencies.

## Implementation Strategy

**MVP** is Phase 1 + Phase 2 + Phase 3. That fixes the defect and is independently
shippable.

**Recommended order**: Phase 2 first and carefully — it changes code that works today, and
T008 is the only thing standing between a faithful extraction and a silent behaviour change.
Then Phase 3, where the actual bug dies. Phase 4 is additive and touches no server code.

**Highest-risk task**: T005. It moves I/O out of a service whose rules protect the legal
record. The rules must not move with it — only the reads and writes.

**The subtlest task**: T016. Every other case in the parity table asserts that the two
adapters *agree*. T016 must assert that the record is *correct*, because two adapters can
agree on a record that preparation will silently re-read — which would leave the whole
feature green and worthless. Do not write it in the comparison style of its neighbours.

**Traps** (from quickstart.md, repeated because they are easy to violate while implementing):

- Do not batch database writes (T012 exists to prevent this)
- Do not add a matter-listing query to mirror the filesystem's fallback resolution
- Do not reuse `getRawFile` — its size cap is for browser display
- Do not add a server endpoint for re-attachment — run state is already addressable
- Do not "fix" confidence synthesis, block segmentation, or the extraction race while
  refactoring. They are the reference behaviour

## Notes

- T001 baseline pass count: **1908 pass / 0 fail** (2026-08-29). Note: a fresh worktree has
  no `node_modules` (gitignored, per-worktree), so the first run reported 116 failures that
  were purely environmental. `npm ci` first. This is exactly what the baseline task exists
  to catch.
- FR-012 ("fast extraction remains an explicit choice") is deliberately uncovered. It is a
  negative requirement and nothing in this plan touches the automated preparation path that
  could violate it. Recorded here so the gap is a decision rather than an oversight.
