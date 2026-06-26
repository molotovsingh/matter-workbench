# Matter Log, File Removal, And Eventing

Date: 2026-06-26
Status: Implementation contract draft
Priority: High before file-removal workflows

## Context

A tester asked for the ability to delete a file from the record. That request is
natural: wrong files, duplicates, privileged material, corrupted scans, and
irrelevant uploads will happen in real matters.

The product decision is that this must not be implemented as an ordinary file
system delete. In Matter Workbench, removing a file is a **matter-record custody
mutation** with downstream consequences for extraction, source labels, source
citations, List of Dates, Matter Story, custom-skill outputs, and assistant
context.

This note records the design and process decisions for the first safe version.

## Core Decision

Matter Workbench needs a lawyer-facing **Matter Log** and an append-only
matter-event ledger before or alongside any file-removal feature.

Rule:

```text
No matter-record mutation should happen without a timestamped who / what / why /
impact entry.
```

File removal is therefore not a simple delete. It is a recorded event that
changes the active source set and triggers stale-state projections and refresh
work.

## Terminology

### Matter Log

Lawyer-facing matter history.

Examples:

- `File FILE-0007 removed from active record by Asha on 2026-06-26. Reason:
  duplicate upload. List of Dates marked stale.`
- `Source Index refreshed after file removal.`
- `List of Dates regenerated from active files.`

The Matter Log should be understandable without storage-engine or provider
knowledge.

### Audit / Custody Ledger

System/operator-level detail.

Examples:

- event id;
- tenant id;
- actor id / session id;
- FILE id;
- document id;
- storage object id / key;
- hashes;
- job ids;
- exact payload snapshots or references.

The audit/custody ledger may contain technical metadata that is not shown in the
lawyer-facing Matter Log.

### State / Projections

Current app state should be derived or updated from events:

- active files;
- removed/tombstoned files;
- stale artifacts;
- current Source Index;
- current List of Dates;
- current Matter Story;
- current custom-skill run receipts;
- pending/running/failed refresh jobs.

Events explain what happened. State shows where the matter stands now.

### Outbox / Jobs

The outbox is the transactional bridge between a committed matter mutation and
background or foreground processing work.

For the first implementation, prefer Postgres-backed events + outbox/jobs over a
separate broker.

### Kafka / Broker

Kafka-style brokering is a possible future transport, not the source of
correctness. The durable matter-event ledger is the source of correctness.

## File Removal UX Decision

Do not lead with `Delete file`.

Use:

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

### Required reason

The first version should require or strongly prompt for a reason:

- duplicate;
- wrong upload;
- privileged / should not be reviewed;
- irrelevant;
- corrupted / unreadable;
- other.

## Custody Rules For File Removal

1. **Do not renumber FILE ids.**
   - If `FILE-0007` is removed, it stays `FILE-0007` forever.
   - Later files do not shift.
   - Prior citations remain interpretable.

2. **Tombstone first.**
   - Mark the file/document inactive or removed from active record.
   - Preserve enough metadata to explain old citations and restore if allowed.

3. **Do not physically erase in the first user-facing version.**
   - Physical purge requires a separate retention/legal-hold design.
   - Purge must still leave an audit event.

4. **Restore should be possible for tombstoned records.**
   - Restore is also a matter event.
   - Restore should mark dependent artifacts stale again unless the app can prove
     no downstream dependency.

5. **Conversation memory is not evidence.**
   - Prior assistant answers must not be used to reconstruct removed content.
   - Future Ask/Skill context must use the active source set.

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

## Matter-Init / Refresh Decision

Do not blindly rerun List of Dates as the only action.

A List of Dates rerun is safe only after the active source set has been updated
and reconciled.

Preferred sequence:

1. append `file.removal_requested` / `file.removed_from_active_record` event;
2. tombstone the file in the active source inventory;
3. mark matter preparation/source inventory stale;
4. reconcile matter structure / equivalent `matter-init` subset;
5. refresh extraction/source labels where needed;
6. mark or regenerate List of Dates;
7. mark or regenerate Matter Story and custom skill outputs where affected;
8. append completion/failure events to the Matter Log.

Product-facing button can be simple:

```text
Remove file and refresh matter outputs
```

Under the hood, it must do the minimal safe dependency chain, not just rerun List
of Dates against stale source records.

## Event Model Decision

Use append-only matter events for record-changing actions.

Example event names:

```text
matter.created
file.added
file.removal_requested
file.removed_from_active_record
file.restore_requested
file.restored
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

Each matter event should carry at least:

- event id;
- event type;
- matter id / matter name;
- actor id / actor label;
- created at;
- reason, if user-triggered;
- affected FILE ids / artifact paths;
- human summary;
- machine payload;
- related job id, if any;
- idempotency key, where applicable.

## Postgres First, Broker Later

Do not introduce Kafka merely to implement the first Matter Log.

First implementation should use:

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

## Matter Log UI Decision

Before shipping user-facing file removal, add a Matter Log surface that can show:

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

## Process Decision For Implementation

Do not implement removal as a local one-off UI action.

Recommended order:

1. Define matter-event schema and event-normalization helpers.
2. Add Matter Log read model/API/UI for existing event-like records where
   possible.
3. Add artifact-currentness/staleness projection for source-backed outputs.
4. Add tombstone/remove-from-active-record backend operation.
5. Add refresh/outbox/job orchestration for affected dependencies.
6. Add restore operation for tombstoned files.
7. Only then expose `Remove from active record` in the file UI.
8. Keep `Permanently purge` parked behind separate legal-hold/retention review.

Acceptance tests should prove:

- removed files do not appear in future active matter context;
- FILE ids are never renumbered;
- the Matter Log shows actor, reason, affected file, and impact;
- List of Dates is stale or regenerated after removal;
- old artifacts that cite the removed file are not silently presented as current;
- restoring a file records an event and invalidates downstream outputs safely;
- retrying the same removal request is idempotent.

## Non-Goals For First Slice

- no physical purge;
- no Kafka deployment;
- no automatic legal-hold engine;
- no per-citation dependency precision unless already available;
- no silent deletion of prior artifacts;
- no renumbering;
- no hidden mutation without Matter Log entry.

## Open Questions

1. Should `Remove from active record` be available to all beta users or only to
   matter owners/operators?
2. Should privileged removals have a distinct warning and require operator
   review?
3. Should the first Matter Log be per matter only, or also have a global recent
   activity view?
4. Should old List of Dates remain visible with a stale banner, or be moved under
   history until regenerated?
5. What is the minimum restore UX for a mistakenly removed file?

## Current Product Rule

Until this contract is implemented:

```text
Do not add a normal file delete button to the matter record.
```
