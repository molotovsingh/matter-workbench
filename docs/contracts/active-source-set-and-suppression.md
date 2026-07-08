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
- generated Library artifact summaries inside Matter Context packets;
- extraction runs reading `File Register.csv`;
- Source Index generation;
- Case Timeline generation;
- rerun/currentness advice for Source Index and Case Timeline artifacts;
- read-only artifact currentness projection for Source Index, Case Timeline, and
  Matter Story, plus source-removal currentness effect records for future
  source-backed custom-skill outputs;
- non-routed local artifact-currentness manifest persistence for future
  transaction/journal wiring.

Matter Context does not allow stale generated artifacts to reintroduce suppressed
`FILE-NNNN` citations: Case Timeline JSON entries that cite suppressed file ids
are omitted from active context, Case Timeline Markdown is skipped if it cites a
suppressed file id, and Source Index summary counts are reduced to active
sources.

Rerun/currentness advice must not treat a source-backed artifact as current when
its Source Index descriptors or Case Timeline source snapshot still reference a
source that is no longer in the active source set. For Case Timeline, that state
maps to `chronology_regeneration_needed`, not a cheap label refresh.

Runtime DB mode also supports inactive source document statuses
`removed_from_active_record`, `quarantined`, `deleted_pending`, and `deleted`.
Workspace, payload, overlap, and runtime Matter Context read paths treat those
statuses as inactive. Runtime DB workspace and payload reads apply that filter to
source originals/working copies and to derived extraction/text payloads when they
are linked to an inactive source document. Runtime matter-context packets also
treat inactive File Register rows as suppressed.

Suppressed extraction records, source descriptors, and stale generated artifact
entries are not deleted. They remain custody/evidence history, but they do not
feed the active context/read model.

## Non-Goals

This contract is not:

- a user-facing file-removal feature;
- a restore/quarantine workflow;
- a physical purge policy;
- a privilege-review policy;
- a user-facing source-removal workflow;
- a replacement for canonical `matter_events` source-custody events.

## Future Write-Side Requirements

A non-routed backend service now covers the canonical `source_file.removed_from_active_record` event append, atomic local manifest /
runtime DB status update, matter/document locking or equivalent idempotency, and
artifact currentness writes for test/future wiring. Before a real user-facing
source-removal workflow ships, Matter Workbench still needs:

1. routed/authorized endpoint wiring behind a feature flag;
2. operator-visible local repair workflow;
3. restore/quarantine semantics;
4. privilege-safe Matter Log summaries;
5. impact preview endpoint and confirmation copy that says
   `Remove from active record`, never ordinary `Delete file`.
