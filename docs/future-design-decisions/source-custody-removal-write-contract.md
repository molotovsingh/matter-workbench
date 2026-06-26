# Source Custody Removal Write Contract

Date: 2026-06-26
Status: Draft implementation contract — not yet enabled by any route or UI
Priority: High before any `Remove from active record` workflow

## Purpose

This note narrows the future write-side source-removal mutation. It is a contract
draft for implementation review, not permission to add a user-facing removal
button.

The operation is **not** ordinary file deletion. It is a matter-custody mutation
that removes a source from the active source set while preserving identity,
history, bytes, extracted records, citations, and generated artifacts for audit
and possible restore.

## Non-Negotiable Product Copy

The lawyer-facing action must be named:

```text
Remove from active record
```

Do not call it `Delete file`, `Delete source`, or `Remove permanently`.
Physical purge is a separate retention/legal-hold workflow and is out of scope.

## Scope Of The First Write Mutation

Allowed object class for the first mutation:

- uploaded source/original file represented by a stable `FILE-NNNN` id.

Not allowed in the first mutation:

- generated Library artifacts;
- extracted text payloads as independent targets;
- Matter Story, custom-skill outputs, drafts, dispatch copies, receipts, logs,
  or technical files;
- physical storage-object or filesystem deletion.

## Required Inputs

A source-removal mutation must require:

- `matter_id` or explicit `matter_name` resolved under the current tenant/user;
- `file_id` exactly matching an existing source record;
- `reason` entered by the operator/lawyer;
- `idempotency_key` supplied by the caller;
- authenticated actor context;
- impact preview or equivalent server-side impact calculation.

The mutation must reject:

- blank reasons;
- missing or malformed `FILE-NNNN` ids;
- missing idempotency keys;
- files already inactive unless the idempotency key matches the original event;
- generated artifact paths or raw arbitrary relative paths;
- attempts to renumber `FILE-NNNN` ids.

## Canonical Event

The canonical event type is:

```text
source_file.removed_from_active_record
```

Unsafe event names stay blocked:

```text
source_file.deleted
source_document.deleted
```

Minimum event envelope fields:

- `eventType`: `source_file.removed_from_active_record`;
- `summaryKey`: `source_file_removed_from_active_record`;
- `matterId` / `matterName`;
- `actor` from request context;
- `object`: `{ type: "source_file", id: "FILE-NNNN", label?: string }`;
- `idempotencyKey`;
- `occurredAt`.

Payload may contain identifiers and custody metadata only:

```json
{
  "file_id": "FILE-0007",
  "previous_status": "verified",
  "new_status": "removed_from_active_record",
  "source_path": "00_Inbox/.../FILE-0007__wrong.pdf",
  "working_copy_path": "00_Inbox/.../FILE-0007__wrong.pdf",
  "sha256": "...",
  "reason": "Wrong client file uploaded to this matter.",
  "affected_artifacts": [
    { "family": "list_of_dates", "effect": "regeneration_needed" }
  ]
}
```

Payload must not contain:

- source text;
- extracted evidence blocks;
- generated legal work product;
- Copilot conversation text;
- privileged summaries beyond the user's short reason.

## Transaction Coupling

Runtime DB mode must perform these inside one transaction:

1. lock the matter row and target document row;
2. confirm the source is currently active;
3. update `documents.status` to `removed_from_active_record`;
4. write a canonical `matter_events` row with the same idempotency key;
5. mark affected source-backed artifacts stale/currentness-needed where that
   projection exists;
6. return the source id, event id, and affected-artifact summary.

If the transaction fails, neither the source status nor the event may be partly
written.

Local filesystem mode must serialize the mutation through the existing matter
mutation queue and perform, in order:

1. read and validate `File Register.csv` / source identity;
2. update `.matter-workbench/source-tombstones.json` atomically;
3. append the canonical local matter-event JSONL entry;
4. mark affected artifacts stale where the local projection exists;
5. return the source id, event id, and affected-artifact summary.

If a local append fails after a manifest write, the operation must surface an
operator-visible repair state before any UI is enabled. A future implementation
may use a single local transaction journal to make this stronger.

## Active Source Set Effects

After a successful mutation:

- the source remains addressable by `FILE-NNNN` for history and restore;
- active Matter Context excludes the source;
- extraction/source-label/List-of-Dates input paths exclude the source;
- stale generated artifact summaries cannot reintroduce the source;
- File Register rows are not renumbered;
- technical/operator views may still inspect custody history.

## Artifact Currentness Effects

At minimum, removal must mark these as not current or needing review when present:

- Source Index / source labels;
- List of Dates;
- Matter Story;
- source-backed custom-skill outputs.

Do not silently regenerate paid/model artifacts during the removal mutation.
Regeneration is a separate explicit refresh action unless a future policy says
otherwise.

## Matter Log Summary Template

Matter Log must render from structured fields, not stored free-text summaries:

```text
FILE-0007 removed from the active record by Asha on 2026-06-26. Reason: Wrong client file uploaded to this matter. List of Dates marked stale.
```

The summary must be privilege-safe and must not quote source text or generated
legal analysis.

## Restore And Quarantine Are Separate

This contract does not implement restore or quarantine. It reserves the states so
future workflows can be explicit:

- `quarantined`: hidden from active context pending review;
- `removed_from_active_record`: intentionally inactive but retained;
- `deleted_pending` / `deleted`: physical purge lifecycle, only after separate
  retention/legal-hold review.

## Current Implementation Status

Already present:

- canonical `matter_events` foundation;
- `custom_skill.created` transaction-coupled event path;
- local source tombstone read-side suppression;
- runtime DB inactive source document statuses;
- active-context suppression for stale generated artifact summaries;
- pure read-only source-removal impact preview helper with no route and no UI;
- artifact currentness schema/service foundation for read-only projection,
  non-routed local manifest persistence, and runtime DB stale/needs-review write
  helpers;
- non-routed source-removal mutation service with required reason/idempotency,
  local tombstone/event/currentness writes, local repair-state failure posture,
  and runtime DB transaction SQL.

Still missing before any UI:

- routed/authorized source-removal endpoint;
- operator-visible local repair workflow for failed local mutations;
- restore/quarantine workflows;
- Matter Log source-removal summary rendering;
- impact preview endpoint;
- feature-flagged UI;
- release/deploy of the non-routed mutation service when it becomes active
  runtime behavior.
