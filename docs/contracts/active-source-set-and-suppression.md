# Active Source Set And Suppression

Date: 2026-06-26
Status: Current read-side contract; not a file-removal UI or source-custody write contract

## Purpose

Matter Workbench must know which source records are active before it can safely
ship any future `Remove from active record` workflow. This contract defines the
current read-side suppression foundation.

It does **not** add a lawyer-facing removal action. It does **not** physically
delete source files. It does **not** renumber `FILE-NNNN` identifiers.

## Local Suppression Manifest

Filesystem mode may contain an optional matter-owned manifest:

```text
.matter-workbench/source-tombstones.json
```

Current schema:

```json
{
  "schema_version": "matter-source-tombstones/v1",
  "sources": [
    {
      "file_id": "FILE-0002",
      "source_path": "00_Inbox/Intake 01 - Initial/Source Files/wrong.pdf",
      "status": "removed_from_active_record",
      "event_id": "evt_...",
      "occurred_at": "2026-06-26T00:00:00.000Z",
      "reason": "optional operator/lawyer reason"
    }
  ]
}
```

Suppressing statuses:

- `removed_from_active_record`;
- `quarantined`;
- `deleted_pending`;
- `deleted`.

The manifest stores identifiers and custody metadata only. It must not store
source text, extracted evidence blocks, or legal work product.

Invalid or missing manifests fail safe for current beta behavior: missing means
no local suppression; invalid manifests are ignored with a warning. Future
write-side removal must make manifest/event writes atomic and operator-visible.

## Current Read-Side Behavior

When a source is suppressed, these local read paths exclude it from active work:

- Matter Context packets used by Copilot/search/custom skills;
- extraction runs reading `File Register.csv`;
- Source Index generation;
- List of Dates generation.

Runtime DB mode also filters `deleted_pending` source documents from workspace
and payload reads, and runtime matter-context packets treat inactive File
Register rows as suppressed.

Suppressed extraction records and source descriptors are not deleted. They remain
custody/evidence history, but they do not feed the active context/read model.

## Non-Goals

This contract is not:

- a user-facing file-removal feature;
- a restore/quarantine workflow;
- a physical purge policy;
- a privilege-review policy;
- an artifact-currentness implementation;
- a replacement for canonical `matter_events` source-custody events.

## Future Write-Side Requirements

Before a real source-removal mutation ships, Matter Workbench still needs:

1. canonical `source_file.removed_from_active_record` event append;
2. atomic local manifest update / runtime DB source status update;
3. matter/document locking or equivalent idempotency;
4. artifact currentness projection for List of Dates, Matter Story, and custom
   skill outputs;
5. restore/quarantine semantics;
6. privilege-safe Matter Log summaries;
7. operator/lawyer confirmation copy that says `Remove from active record`, never
   ordinary `Delete file`.
