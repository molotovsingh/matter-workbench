# Matter Log, File Removal, And Eventing

Date: 2026-06-26
Status: Review draft — not yet an accepted implementation contract
Priority: High before file-removal workflows
Confidence: Low-medium; use this to guide design review, not direct implementation.

## Review Posture

This note is intentionally not settled.

It records the direction that emerged from tester feedback and product
reflection, but it should not be treated as an executable build contract yet.
Before implementation, Matter Workbench needs a narrower schema/design pass and
at least one spike against the current runtime DB and local filesystem behavior.

The safest current conclusion is negative:

```text
Do not add a normal file delete button to the matter record.
```

The positive architecture — Matter Log, append-only events, tombstones,
projections, outbox/jobs, possible later broker — is plausible but still needs
review.

## Context

A tester asked for the ability to delete a file from the record. That request is
natural: wrong files, duplicates, privileged material, corrupted scans, and
irrelevant uploads will happen in real matters.

The working hypothesis is that this must not be implemented as an ordinary file
system delete. In Matter Workbench, removing a source file is a
**matter-record custody mutation** with downstream consequences for extraction,
source labels, source citations, List of Dates, Matter Story, custom-skill
outputs, and assistant context.

This note records the design and process assumptions for a first safe version,
plus the uncertainties that need resolution.

## Scope That Is Not Yet Settled

The word `file` is too broad.

This draft is primarily about **source/original files in the active matter
record**, not every file visible in the workspace.

Different objects may need different lifecycle rules:

| Object | Likely first action | Notes |
| --- | --- | --- |
| Uploaded source/original file | Remove from active record / tombstone | Main subject of this note. |
| Extracted text payload | Reconciled or hidden from active context | Usually derived from source file state, not independently user-deleted. |
| Source Index / source labels | Mark stale or refresh | Generated source-control artifact. |
| List of Dates | Mark `chronology_regeneration_needed` or regenerate with consent | Do not silently present old output as current. |
| Matter Story / custom skill output | Mark stale if source-backed and affected | Preserve old output with warning/history. |
| Draft / dispatch copy | Separate artifact lifecycle | Dispatch copies are frozen; do not silently mutate. |
| Technical/audit file | Operator/technical lifecycle | Not normal lawyer-facing delete. |

Before coding, the first implementation must choose exactly which object classes
are in scope.

## Tentative Core Decision

Matter Workbench likely needs a lawyer-facing **Matter Log** and an append-only
matter-event ledger before or alongside any source-file-removal feature.

Working rule:

```text
No matter-record mutation should happen without a timestamped who / what / why /
impact entry.
```

File removal is therefore not a simple delete. It is a recorded event that
changes the active source set and triggers stale-state projections and refresh
work.

This is not yet a commitment to full event sourcing. A first slice may be an
append-only event/audit ledger plus explicit projection updates.

## Incremental Plan To Start The Journey

The journey should start with small, reversible phases. Do not wait for a full
Kafka/event-sourcing architecture. Also do not jump straight to a visible delete
button.

Each phase below should be small enough to ship behind tests and, where useful,
behind a feature flag.

### Phase 0 — Product guardrail now

Goal: prevent the wrong implementation from appearing.

Deliverables:

- keep `Delete file` out of normal lawyer UI;
- document that the only acceptable future label is closer to `Remove from
  active record`;
- add/keep a repo test or product-doc check if needed to prevent a normal delete
  affordance from landing accidentally.

Exit criteria:

- team understands that file removal is a matter-custody mutation, not a file
  manager action.

### Phase 1 — Current mutation inventory

Goal: know what already mutates a matter before adding a Matter Log.

Deliverables:

- inventory current matter-changing operations:
  - matter create;
  - switch matter, if logged only as UI activity;
  - files added;
  - prepare matter;
  - extraction;
  - source labels;
  - List of Dates create/refresh;
  - Matter Story;
  - custom skill create/run;
  - lifecycle/status changes;
- classify each operation as source mutation, derived artifact mutation, UI-only
  state, or audit/system event.

Exit criteria:

- a short table exists showing which existing ledgers/jobs/events can seed a
  Matter Log without pretending they are full custody records.

### Phase 2 — Event vocabulary spike, not schema lock-in

Goal: define event names and payload classes lightly enough to test.

Deliverables:

- draft event vocabulary for existing operations and future file removal;
- separate source-file events from artifact events;
- identify required event fields versus optional diagnostic fields;
- decide which event summaries are generated from templates instead of stored as
  free text.

Exit criteria:

- a minimal event envelope is accepted for a spike, not yet frozen as a public
  API.

### Phase 3 — Read-only Matter Log from existing records

Goal: give the product a Matter Log surface before new destructive actions.

Deliverables:

- read-only Matter Log API that projects from existing job/run/activity records
  where possible;
- UI surface under matter home or activity that shows matter-scoped timeline;
- clear labels that distinguish current best-effort history from full custody
  events.

Exit criteria:

- users can answer basic questions such as `what changed recently in this
  matter?` without any file-removal feature existing yet.

Current narrow implementation slices (2026-06-26):

- `services/matter-log-service.mjs` and `GET /api/matter-log` expose
  `matter-log/v0-readonly` as a **best-effort projection**.
- The initial projection used the job status ledger and configurable skill run
  ledger.
- `db/migrations/020_matter_events.sql`, `services/matter-events-service.mjs`,
  and `services/runtime-db-matter-events-service.mjs` add the durable event-store
  foundation: tenant-scoped `matter_events`, RLS, idempotency keys, local JSONL
  fallback, and Matter Log merge support for canonical events when present.
- The first production mutation is now wired: Skill Factory activation appends
  `custom_skill.created`. Runtime DB mode appends the event in the same SQL
  transaction as the configurable skill store write; local filesystem mode
  appends to the JSONL fallback after the skill store write under the same
  mutation queue.
- The first active-source read-side foundation is now wired. Local mode can read
  `.matter-workbench/source-tombstones.json` and suppress removed/quarantined
  sources from Matter Context, extraction, Source Index generation, List of Dates
  generation, stale generated artifact summaries, and local rerun/currentness
  advice. Runtime DB read paths use inactive source document statuses for
  workspace/payload/overlap reads and suppress inactive File Register rows in
  context packets.
- The React Activity page labels this as `Matter Log` / `Preview` and states
  that it is not custody-grade yet.
- These slices do **not** add file removal, tombstones, restore/quarantine, or
  artifact currentness projection.
- These slices do **not** make Copilot receipts or conversation memory evidence.

### Phase 4 — Append-only event store behind the scenes

Goal: start recording canonical events for new mutations.

Status: started. `custom_skill.created` is the first implemented event.

Deliverables:

- runtime DB `matter_events` or equivalent app-owned event table;
- local fallback event ledger if local filesystem mode remains supported;
- append helper used by one low-risk operation first, such as custom skill
  creation or List of Dates refresh;
- idempotency key support for event appends.

Exit criteria:

- at least one existing mutation writes a real Matter Log event in both runtime
  DB mode and local mode, with tests. This is satisfied for
  `custom_skill.created`; source-custody mutations still require later phases.

### Phase 5 — Tombstone/suppression design spike

Goal: prove removed source files will not resurrect during preparation.

Status: read-side foundation exists and a non-routed backend source-removal
mutation service now exists for tests/future wiring. No route, endpoint, or UI
exists yet.

Deliverables:

- runtime DB design for active/removed source document status;
- local filesystem design for tombstones:
  - tombstone manifest;
  - quarantine lane;
  - or other suppression mechanism;
- tests showing source scanners can skip tombstoned files.

Exit criteria:

- rerunning matter-init/source reconciliation after tombstone cannot re-add the
  removed file.

Current partial exit evidence:

- Matter Context, extraction, Source Index generation, List of Dates generation,
  and local rerun/currentness advice ignore locally suppressed source ids/paths.
- Runtime DB workspace/payload/overlap reads now use the same inactive source
  status vocabulary as the read-side contract: `removed_from_active_record`,
  `quarantined`, `deleted_pending`, and `deleted`.
- A true source-removal write path, source reconciliation behavior, and restore
  semantics are still not implemented.

### Phase 6 — Active source set projection

Goal: make every context builder read from a canonical active source set.

Status: started for read-side context/build paths, not complete for write-side
custody or UI.

Deliverables:

- active source set read model/API;
- removed/tombstoned source set read model/API;
- matter context builder and source inventory readers respect active-only status;
- technical/audit views can still find tombstoned records where allowed.

Exit criteria:

- Ask, Skills, Source Index, and List of Dates input paths can be tested against
  active-only source selection.

### Phase 7 — Artifact currentness projection

Goal: avoid stale downstream outputs before removal ships.

Status: foundation started. A read-only/local projection, non-routed local
manifest helper, runtime DB schema, and non-routed source-removal currentness
writes exist. No route, endpoint, or UI exists yet.

Deliverables:

- artifact currentness model for source-backed artifacts;
- List of Dates uses existing dependency state contract;
- Matter Story and custom skill outputs get at least coarse stale/current flags;
- UI can show old artifact preserved but not current.

Exit criteria:

- when source set changes in a test fixture, List of Dates is marked
  `chronology_regeneration_needed` or equivalent without deleting the old output.

### Phase 8 — Removal impact preview, no mutation yet

Goal: let users/operators understand consequences before enabling removal.

Status: backend read-only endpoint exists. It has no UI and performs no mutation.

Deliverables:

- backend dry-run endpoint for `what would happen if FILE-0007 were removed?`;
- lists affected artifacts and refresh needs;
- no state mutation;
- Matter Log not changed by dry run unless separately logged as an operator
  diagnostic.

Exit criteria:

- UI can show impact preview: source will be removed, List of Dates will become
  stale, Matter Story/custom outputs may need review;
- Matter Log can render a privilege-safe source-removal summary from the
  canonical event.

### Phase 9 — Backend tombstone operation, no broad UI

Goal: implement the core mutation safely before making it easy to click.

Status: foundation started as a non-routed service only. It is not exposed to
users and does not unlock a file-removal UI. Matter Log can render the canonical
source-removal event when present.

Deliverables:

- operator-only or test-only backend operation to remove source from active
  record;
- required reason;
- idempotency key;
- event append;
- active source set update;
- artifact currentness updates;
- no physical purge.

Exit criteria:

- tests prove removed source is absent from future context and `FILE-NNNN` ids
  are not renumbered.

### Phase 10 — Preparation reconciliation after tombstone

Goal: make the normal preparation path compatible with removals.

Deliverables:

- matter-init/source reconciliation respects tombstones;
- extraction/source-label refresh does not resurrect removed files;
- stale advisories are updated consistently;
- failure states are logged.

Exit criteria:

- running preparation after a tombstone leaves the removed source inactive and
  records visible refresh status.

### Phase 11 — Minimal Matter Log UI as trust surface

Goal: make the mutation explainable to lawyers.

Deliverables:

- matter-scoped log entries for source removal, stale marking, refresh start,
  refresh completion/failure;
- actor, timestamp, reason, affected FILE id, and impact;
- privilege-safe summaries;
- filter for source changes versus generated-output changes.

Exit criteria:

- after a test removal, a user can see who did it, why, what changed, and which
  outputs became stale.

### Phase 12 — Gated `Remove from active record` UI

Goal: expose removal carefully.

Deliverables:

- feature-flagged UI on source/original files only;
- confirmation with impact preview;
- required reason;
- no availability on generated Library artifacts, drafts, dispatch copies, or
  technical files;
- no silent paid/model regeneration.

Exit criteria:

- beta tester can remove a wrong source file and understand the consequence
  before committing.

### Phase 13 — Restore path

Goal: make ordinary mistakes reversible.

Deliverables:

- restore tombstoned source file;
- restore event;
- active source projection update;
- stale downstream outputs again unless proven unaffected;
- Matter Log entry.

Exit criteria:

- removed file can be restored without FILE id renumbering or citation breakage.

### Phase 14 — Refresh orchestration

Goal: turn removal aftermath into guided recovery.

Deliverables:

- queue or run deterministic reconciliation;
- mark List of Dates regeneration needed;
- ask user before paid/model regeneration unless policy says otherwise;
- show refresh status in Matter Log and Matter Home.

Exit criteria:

- user is not left with silent stale outputs after removal.

### Phase 15 — Broker decision point

Goal: decide whether Postgres outbox remains enough.

Trigger this phase only after Matter Log and removal flows are real.

Questions:

- Are there multiple worker services consuming the same stream?
- Do projections need replay at scale?
- Is cross-service fanout becoming complex?
- Are hosted reliability requirements beyond Postgres outbox?

Exit criteria:

- explicit decision: stay with Postgres jobs/outbox, or introduce Kafka/another
  broker as transport while keeping matter events as custody authority.

### Suggested first three pull requests

1. **Matter mutation inventory doc/test** — no runtime behavior change.
2. **Read-only Matter Log skeleton** — project existing jobs/runs/activity into a
   matter timeline with honest `best effort` labeling.
3. **Event append spike for one low-risk mutation** — record one new canonical
   event, prove local/runtime DB compatibility, and add idempotency tests.

These start the fundamental shift without prematurely implementing deletion.

## Terminology

### Matter Log

Lawyer-facing matter history.

Examples:

- `File FILE-0007 removed from active record by Asha on 2026-06-26. Reason:
  duplicate upload. List of Dates marked stale.`
- `Source Index refreshed after file removal.`
- `List of Dates regenerated from active files.`

The Matter Log should be understandable without storage-engine or provider
knowledge. It should not expose privileged content, hashes, storage keys, raw
provider traces, or internal payload details in normal lawyer view.

### Audit / Custody Ledger

System/operator-level detail.

Examples:

- event id;
- tenant id;
- actor id / actor label / session id;
- causation event id and correlation id;
- FILE id;
- document id;
- storage object id / key;
- hashes;
- previous status and new status;
- job ids;
- exact payload snapshots or references.

The audit/custody ledger may contain technical metadata that is not shown in the
lawyer-facing Matter Log.

### State / Projections

Current app state may be derived or updated from events:

- active files;
- removed/tombstoned files;
- stale artifacts;
- current Source Index;
- current List of Dates;
- current Matter Story;
- current custom-skill run receipts;
- pending/running/failed refresh jobs.

Events explain what happened. State shows where the matter stands now.

Open design point: do not assume full replay-based event sourcing in the first
slice. It may be enough to append events transactionally and update explicit
read models/projections.

### Outbox / Jobs

The outbox is the transactional bridge between a committed matter mutation and
background or foreground processing work.

For the first implementation, prefer Postgres-backed events + outbox/jobs over a
separate broker.

### Kafka / Broker

Kafka-style brokering is a possible future transport, not the source of
correctness. The durable matter-event ledger is the source of correctness.

## File Removal UX Decision Draft

Do not lead with `Delete file`.

Likely user-facing label:

```text
Remove from active record
```

Optional operator-only future action:

```text
Permanently purge
```

`Permanently purge` is not part of the first user-facing version.

### Required confirmation copy

The user should see a plain warning such as:

```text
This will remove the file from future matter review, assistant context, and
workflow runs. Existing outputs that cited this file may become stale. The
removal will be recorded in the Matter Log.
```

This copy may need stronger language for privileged or legally sensitive
material.

### Required reason

The first version should require or strongly prompt for a reason:

- duplicate;
- wrong upload;
- privileged / should not be reviewed;
- irrelevant;
- corrupted / unreadable;
- other.

Privileged material is not just another reason. It may require a stronger
quarantine workflow, restricted preview, and operator review. That is unresolved.

## Custody Rules For Source File Removal

1. **Do not renumber FILE ids.**
   - If `FILE-0007` is removed, it stays `FILE-0007` forever.
   - Later files do not shift.
   - Prior citations remain interpretable.

2. **Tombstone first.**
   - Mark the file/document inactive or removed from active record.
   - Preserve enough metadata to explain old citations and restore if allowed.

3. **Make matter-init / source scanning tombstone-aware.**
   - This is a critical gap in the first draft.
   - If local filesystem scanning still sees the physical source file, a future
     `matter-init` or reconciliation pass could resurrect the removed file.
   - The removal design must define how the scanner suppresses tombstoned files.
   - Runtime DB may use document status/custody rows; local filesystem may need a
     tombstone manifest, quarantine location, or equivalent exclusion mechanism.

4. **Do not physically erase in the first user-facing version.**
   - Physical purge requires a separate retention/legal-hold design.
   - Purge must still leave an audit event.

5. **Restore should be possible for ordinary tombstoned records.**
   - Restore is also a matter event.
   - Restore should mark dependent artifacts stale again unless the app can prove
     no downstream dependency.
   - Privileged/quarantined records may need different restore rules.

6. **Conversation memory is not evidence.**
   - Prior assistant answers must not be used to reconstruct removed content.
   - Future Ask/Skill context must use the active source set.

7. **Matter Log summaries are not the evidence source.**
   - Human summaries should be derived from event payloads.
   - They should not become the only record of what changed.

## Downstream Consequences

File removal is a matter-structure mutation.

Safe first-order rule:

```text
Removing any source file makes downstream source-backed artifacts stale unless
Matter Workbench can prove they did not depend on that file.
```

Affected downstream objects may include:

- extraction payloads;
- File Register / source inventory;
- Source Index / source labels;
- matter context packets;
- List of Dates;
- Matter Story;
- custom skill outputs and run receipts;
- Copilot Ask source context.

This must align with the canonical staleness contract:

- source file removal usually implies `chronology_regeneration_needed` for List
  of Dates;
- old artifacts should be preserved with a warning/history;
- dispatch copies are frozen and must not be silently rewritten;
- label-only refresh rules are not enough when the document set changes.

See `docs/contracts/dependency-states-and-staleness.md` and
`docs/contracts/artifact-visibility-and-dispatch.md`.

## Matter-Init / Refresh Decision Draft

Do not blindly rerun List of Dates as the only action.

A List of Dates rerun is safe only after the active source set has been updated,
reconciled, and future source-context builders exclude the removed file.

Likely safe sequence:

1. validate permission and object scope;
2. acquire matter/document lock or equivalent concurrency guard;
3. append or prepare `source_file.removal_requested` event;
4. tombstone the file in the active source inventory;
5. ensure future source scanning / matter-init will not resurrect it;
6. append `source_file.removed_from_active_record` event;
7. mark matter preparation/source inventory stale;
8. reconcile matter structure / equivalent `matter-init` subset;
9. refresh deterministic source inventory/source labels where needed;
10. mark List of Dates with the appropriate dependency state, usually
    `chronology_regeneration_needed`;
11. offer or queue regeneration only when user consent/cost policy allows;
12. mark Matter Story and custom skill outputs stale where affected;
13. append completion/failure events to the Matter Log.

Product-facing button might be simple, but needs care:

```text
Remove file and update matter record
```

A more aggressive button such as `Remove file and refresh matter outputs` should
not silently trigger paid/model regeneration unless the user has explicitly
accepted that behavior.

Under the hood, the app must do the minimal safe dependency chain, not just rerun
List of Dates against stale source records.

## Event Model Hypothesis

Use append-only matter events for record-changing actions.

The event names below are placeholders, not accepted API strings:

```text
matter.created
source_file.added
source_file.removal_requested
source_file.removed_from_active_record
source_file.restore_requested
source_file.restored
matter.structure_reconcile_requested
matter.structure_reconcile_completed
source_index.marked_stale
source_index.refresh_requested
source_index.refresh_completed
list_of_dates.marked_stale
list_of_dates.regeneration_requested
list_of_dates.regenerated
matter_story.marked_stale
custom_skill_output.marked_stale
custom_skill.created
custom_skill.run_completed
```

Each matter event likely needs:

- event id;
- event type;
- tenant id;
- matter id / matter name;
- actor id / actor label / system actor;
- created at;
- reason, if user-triggered;
- affected FILE ids / artifact paths;
- previous state and new state;
- human summary or summary key;
- machine payload;
- related job id, if any;
- causation event id;
- correlation id;
- idempotency key, where applicable.

Open design issue: human-readable summaries should probably be derived at read
time or from stable summary templates, not manually stored as the only UI truth.

## Postgres First, Broker Later

Do not introduce Kafka merely to implement the first Matter Log.

First implementation likely uses:

```text
matter_events
matter_event_outbox or existing job/outbox tables
processing_jobs / job status projections
artifact currentness projections
```

Why:

- file removal needs atomicity between tombstone, event, and queued refresh work;
- Postgres transactions can keep those changes together;
- a broker does not by itself solve custody correctness;
- the current runtime DB direction already has job/outbox ingredients.

Kafka or another broker becomes relevant later if:

- workers become separate services;
- multiple independent consumers need the same stream;
- hosted/multi-tenant scale requires fanout;
- replay/rebuild projections need a streaming platform;
- cross-region or integration events become product requirements.

Even then, the matter-event ledger remains authoritative; Kafka is transport.

Important caveat: this is not a decision to build full Kafka-like architecture in
local/private beta.

## Matter Log UI Decision Draft

Before shipping user-facing file removal, add at least a minimal Matter Log
surface for removal-related entries.

The Matter Log should show:

- who changed the matter;
- when;
- what changed;
- why;
- downstream impact;
- refresh status;
- restore availability, where applicable.

Good first Matter Log event categories:

- matter created;
- files added;
- file removed from active record;
- file restored;
- matter prepared / structure reconciled;
- extraction run;
- Source Index refreshed;
- List of Dates created/refreshed/marked stale;
- Matter Story generated/marked stale;
- custom skill created/run;
- stale artifact warning created/cleared.

Open UX issue: for privileged removals, the log may need to say that a file was
removed without showing filename, preview text, or other sensitive details to all
users.

## Process Decision For Implementation

Do not implement removal as a local one-off UI action.

Recommended order, still subject to review:

1. Narrow the first slice scope: source/original files only, not all workspace
   files.
2. Define matter-event schema and event-normalization helpers.
3. Define the tombstone/suppression mechanism for both runtime DB and local
   filesystem mode.
4. Add minimal Matter Log read model/API/UI for existing event-like records where
   possible.
5. Add artifact-currentness/staleness projection for source-backed outputs.
6. Add tombstone/remove-from-active-record backend operation.
7. Add refresh/outbox/job orchestration for affected dependencies.
8. Add restore operation for ordinary tombstoned files.
9. Only then expose `Remove from active record` in the file UI.
10. Keep `Permanently purge` parked behind separate legal-hold/retention review.

Acceptance tests should prove:

- removed files do not appear in future active matter context;
- rerunning matter-init / source reconciliation does not resurrect a removed
  file;
- FILE ids are never renumbered;
- the Matter Log shows actor, reason, affected file, and impact;
- privileged/sensitive removal does not leak content through the Matter Log;
- List of Dates is marked `chronology_regeneration_needed` or regenerated after
  explicit consent;
- old artifacts that cite the removed file are not silently presented as current;
- restoring a file records an event and invalidates downstream outputs safely;
- retrying the same removal request is idempotent;
- runtime DB and local filesystem modes behave consistently enough for beta.

## Non-Goals For First Slice

- no physical purge;
- no Kafka deployment;
- no automatic legal-hold engine;
- no full event-sourced rewrite of current app state;
- no per-citation dependency precision unless already available;
- no silent deletion of prior artifacts;
- no renumbering;
- no hidden mutation without Matter Log entry;
- no silent paid/model regeneration after removal.

## Open Questions

1. Should `Remove from active record` be available to all beta users or only to
   matter owners/operators?
2. Should privileged removals have a distinct warning, quarantine state, and
   operator review?
3. What is the exact tombstone/suppression mechanism in local filesystem mode?
4. Should the first Matter Log be per matter only, or also have a global recent
   activity view?
5. Should old List of Dates remain visible with a stale banner, or be moved under
   history until regenerated?
6. What is the minimum restore UX for a mistakenly removed file?
7. Should user-facing removal ever automatically rerun paid/model outputs, or
   should it stop after marking regeneration needed?
8. Which existing ledgers can be projected into Matter Log without pretending
   they are full custody events?

## Current Product Rule

Until this contract is accepted and implemented:

```text
Do not add a normal file delete button to the matter record.
```
