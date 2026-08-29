# Implementation Plan: Fast extraction results reach the matter record under PostgreSQL storage

**Branch**: `001-v4-record-parity` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-v4-record-parity/spec.md`

## Summary

Fast-extraction results are filed into a matter by a service that knows one storage
arrangement: it reads and writes files under a matter directory. When matters are held in
the runtime database instead, the application detects this and disables the filing step, so
results are retained by the extraction service and never reach the matter.

The filing rules themselves are storage-agnostic — matching documents by content, refusing
to invent identifiers, refusing to overwrite existing records, refusing to write partial
text. Only the reads and writes are not. The approach is therefore to extract a narrow
storage port from the existing service and supply two adapters, keeping every acceptance
rule in one shared place. A second implementation would duplicate those rules and let them
drift, which is the specific failure the spec's parity requirement exists to prevent.

The per-document outcome the service already computes is returned to the caller and
discarded; surfacing it satisfies the spec's second story. Session recovery (FR-013) turns
out to be client-side only — the run already has a durable identity and an addressable
progress endpoint, so the panel needs to remember which run it was watching, not track one.

## Technical Context

**Language/Version**: Node.js ESM (`.mjs`) for services; TypeScript/React for the panel
**Primary Dependencies**: None new. Existing `pg` for the database path; `node:fs/promises`
for the filesystem path; browser-local storage for run re-attachment
**Storage**: Two arrangements for the same matter record — a directory tree, and payload
rows addressed by matter plus relative path in the runtime database
**Testing**: `node --test` for unit and cross-adapter parity; `integration-test/*.postgres.mjs`
against a real PostgreSQL instance via `npm run test:postgres`
**Target Platform**: Linux VM (supervised beta), macOS for development
**Project Type**: Server-side module inside the existing application, plus one client surface
**Performance Goals**: Not a goal. This feature must not add per-document work beyond the
storage read/write it replaces
**Constraints**: No new runtime dependency. No new server endpoint. The filesystem path's
observable behaviour must not change. The extraction service's isolation boundary must
continue to hold — the filing service imports nothing from it, and only plain data crosses
the seam
**Scale/Scope**: 10–30 documents in a typical batch; a few hundred in an archival batch

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.0.0.

| Principle | Assessment |
|---|---|
| **I. Simple Surface, Rigorous Spine** | PASS. The lawyer gains a per-document outcome that survives leaving the page. All added structure is behind the port. No lawyer-facing concept is introduced. |
| **II. Never Invent Into The Legal Record** | PASS, and load-bearing. The rules forbidding allocated identifiers, substituted text, and overwritten records are exactly the rules that must not be duplicated per adapter. This principle is the reason for a shared port rather than two implementations. |
| **III. Fail Closed** | PASS. Ambiguous matter identity declines to write (FR-009). Incomplete extraction is left for normal extraction rather than partially filed (FR-005). A run whose result has aged out reports that plainly rather than showing an empty report (FR-013). |
| **IV. Evidence Before Claims** | PASS with an obligation. Parity may not be asserted; it must be demonstrated by tests running the same scenarios through both adapters. A passing filesystem suite is not evidence about the database path. |
| **V. Invariants Must Be Executable** | PASS with an obligation. The parity property must be a test, not a comment. `V4-ISO-001` must still pass unchanged — the filing service must not acquire an import from the extraction service. |

**Workflow and release discipline**: this change alters storage/custody semantics on a path
testers can reach, so it is Tier 1 under `docs/release-policy.md` when deployed. Recorded
here so it is not discovered late.

No violations. Complexity Tracking is therefore omitted.

### Post-design re-check (after Phase 1)

Re-evaluated against the artifacts actually produced. Still passing, with design decisions
that exist specifically to hold a principle:

- **Principle II** drove the single-port design over two filing services. The rules live in
  exactly one place, so no adapter can drift away from them independently.
- **Principles IV and V** drove the contract's parity obligations P1–P5 and the requirement
  that one scenario table run against both adapters. Parity is asserted by comparison rather
  than by two hand-written expectations, so a scenario cannot silently exist for one
  arrangement only.
- **Principle III** shaped two port rules: `resolveMatter` returns null rather than guessing
  between candidate matters, and `readText` distinguishes absent from unreadable instead of
  collapsing both to null.

One thing worth naming: the contract's *Non-obligations* section forbids adding concurrency
control to either adapter. That looks like declining to fix a known race, and it is. The
spec makes the filesystem behaviour the reference, so adding locking to one arrangement
would itself be a parity break. The race is recorded in Out of Scope rather than silently
inherited.

**Session recovery does not change the port.** FR-013 is satisfied entirely on the client
plus existing server endpoints, so it adds no obligation to either adapter and no new
persisted state. Confirmed against `react-ui/src/api/v4Intake.ts:185-192`: both
`GET /v1/intakes/{intakeId}` and `.../progress` are addressable by run identity alone.

### Phase 1 step not completed

`update-agent-context.sh` could not run. `common.sh:175` iterates `"${args[@]}"` over a
possibly-empty array, which is an unbound-variable error under `set -u` on macOS's system
bash (3.2.57); that script is the only one enabling `set -u`. Verified directly: the current
idiom fails and `${args[@]+"${args[@]}"}` succeeds on the same shell.

This is vendored script code with no configuration surface, so it is reported rather than
patched. No plan artifact depends on it.

## Project Structure

### Documentation (this feature)

```text
specs/001-v4-record-parity/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── matter-record-store.md    # The storage port contract
├── checklists/
│   └── requirements.md  # Written by /speckit-specify
└── tasks.md             # Written by /speckit-tasks, not here
```

### Source Code (repository root)

```text
services/
├── v4-extraction-import-service.mjs        # Existing. Filing rules stay here;
│                                           #   direct fs calls become port calls
├── matter-record-store/                    # New. The port's two adapters
│   ├── filesystem-matter-record-store.mjs  #   Wraps the current fs behaviour
│   └── runtime-db-matter-record-store.mjs  #   Wraps the runtime database storage service
└── runtime-db-storage-service.mjs          # Existing. Gains one narrow read method

server.mjs                                  # Existing. Chooses an adapter instead of
                                            #   disabling the filing step

react-ui/src/
├── components/upload/V4IntakePanel.tsx     # Existing. Renders outcomes; remembers the
│                                           #   run it is watching and re-attaches
└── api/v4Intake.ts                         # Existing. Already exposes run-addressable
                                            #   progress and intake reads — no change needed

test/
├── v4-extraction-import.test.mjs           # Existing. Must pass unchanged
├── v4-record-parity.test.mjs               # New. Same scenarios through both adapters
└── matter-record-store.test.mjs            # New. Port contract, per adapter

integration-test/
└── v4-record-parity.postgres.mjs           # New. Real PostgreSQL, real filing
```

**Structure Decision**: The feature lives in the existing service layer. A new
`services/matter-record-store/` directory holds the port's two adapters; the port interface
itself is defined by its contract document and exercised by a shared test, not by a base
class. `v4-extraction-import-service.mjs` keeps every acceptance rule and gains a dependency
on the port. The client change is confined to the panel — no new endpoint, no new server
state. No new top-level project or package.
