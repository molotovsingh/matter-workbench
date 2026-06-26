# Matter Event Vocabulary Spike

Date: 2026-06-26
Status: Review draft — vocabulary spike only, not an accepted event schema
Priority: High before canonical Matter Log events or file-removal workflows
Confidence: Low-medium; use this to guide the first append-only event spike, not
as a frozen contract.

Related notes:

- [Matter Log, File Removal, And Eventing](matter-log-file-removal-and-eventing.md)
- [Matter Mutation Inventory](../matter-mutation-inventory.md)
- [Source Identity and Labels](../contracts/source-identity-and-labels.md)
- [Dependency States and Staleness](../contracts/dependency-states-and-staleness.md)
- [Artifact Visibility and Dispatch](../contracts/artifact-visibility-and-dispatch.md)

## Posture

This document names event families so the first canonical Matter Log spike can
be small and reviewable.

It is not:

- an accepted database schema;
- a public API contract;
- a permission to add file removal;
- a Kafka/broker design;
- a replacement for custody/state/currentness decisions.

The current product surface remains the read-only `matter-log/v0-readonly`
preview. That preview is a projection from existing ledgers, not this event
vocabulary.

## Naming Rules

Tentative rules:

1. Use past-tense event names: `custom_skill.created`, not `create_skill`.
2. Separate source-record events from generated-artifact events.
3. Keep assistant receipts out of evidence semantics.
4. Treat file removal as `removed_from_active_record`, not `deleted`.
5. Prefer template keys and structured payloads over stored free-text summaries.
6. Every canonical matter event must be idempotent.

## Minimal Event Envelope Candidate

Illustrative only:

```json
{
  "event_id": "evt_...",
  "event_type": "custom_skill.created",
  "occurred_at": "2026-06-26T00:00:00.000Z",
  "matter_id": "optional runtime DB matter UUID",
  "matter_name": "optional matter folder/name",
  "actor": {
    "username": "operator or tester username",
    "role": "operator"
  },
  "idempotency_key": "route/action/object/version key",
  "source": {
    "route": "/api/skill-ideas/:id/create-skill",
    "request_id": "req_...",
    "trace_id": "trace_..."
  },
  "summary_key": "custom_skill_created",
  "object": {
    "type": "custom_skill",
    "id": "skill_..."
  },
  "payload": {}
}
```

Open questions:

- whether `matter_name` is mandatory for app-level Skill Factory events;
- whether local filesystem mode needs a separate stable matter id before events;
- how privilege/quarantine summaries are redacted;
- whether canonical events store human summaries or summary keys only;
- how failed attempted mutations are represented.

## Event Family Candidates

| Family | Event type candidate | Class | Current source / future source | Notes |
| --- | --- | --- | --- | --- |
| Matter intake | `matter.created` | Source mutation | Upload/runtime DB custody | New matter creation. Must preserve legal caption and storage identity. |
| Matter intake | `source_file.added` | Source mutation | Upload/runtime DB custody | Add-files intake. Must preserve FILE ids and source identity. |
| Matter preparation | `matter.initialized` | Source preparation | Job now; future event | Matter setup / reconciliation completed. |
| Matter preparation | `source_text.extracted` | Source preparation | Job now; future event | Extraction completed for active source set. |
| Matter preparation | `source_index.refreshed` | Source preparation | Job/provider run now; future event | Source labels/index refreshed. |
| Generated artifacts | `chronology.generated` | Generated artifact | Job/artifact now; future event | List of Dates generated. Must carry currentness inputs later. |
| Generated artifacts | `chronology.labels_refreshed` | Generated artifact | Job/artifact now; future event | Label-only refresh; not chronology regeneration. |
| Generated artifacts | `matter_story.generated` | Generated artifact | Job/artifact now; future event | The Story generated/refreshed. |
| Generated artifacts | `custom_skill.run_started` | Generated artifact | Job/run ledger now; future event | Optional if starts are useful; terminal events may be enough for first slice. |
| Generated artifacts | `custom_skill.run_succeeded` | Generated artifact | Job/run ledger now; future event | Should record output artifact paths and source-backed flag. |
| Generated artifacts | `custom_skill.run_failed` | Generated artifact | Job/run ledger now; future event | Should record stable failure class/code, not raw provider secrets. |
| Generated artifacts | `custom_skill.run_cancelled` | Generated artifact | Run ledger now; future event | Includes overwrite-cancelled decisions. |
| Skill Factory | `skill_idea.created` | Skill factory | Skill idea store now; future event | App-level design record; may be linked to selected matter. |
| Skill Factory | `skill_sample.generated` | Skill factory | Job/sample store now; future event | Review sample only, not a matter artifact. |
| Skill Factory | `skill_sample.approved` | Skill factory | Sample store now; future event | Approval that enables custom skill creation. |
| Skill Factory | `custom_skill.created` | Skill factory | Skill store now; future event | Preferred first canonical event spike candidate. |
| Skill Factory | `custom_skill.lifecycle_changed` | Skill factory | Skill store now; future event | Suspend/resume/archive/restore/delete workflow availability. |
| Maintenance | `doctor.fix_applied` | Source preparation / maintenance | Job now; future event | Needs per-fix payload; not every fix is source mutation. |
| Assistant activity | `assistant.receipt_recorded` | Ledger activity | Copilot receipts | Activity only; not evidence and not source mutation. |
| Future file removal | `source_file.removed_from_active_record` | Source mutation | Future canonical event | Not ordinary delete. Must tombstone/suppress and mark downstream stale. |
| Future file removal | `source_file.restored_to_active_record` | Source mutation | Future canonical event | Requires restore/quarantine design. |
| Future file removal | `source_file.quarantined` | Source mutation / privilege | Future canonical event | Privilege/confidentiality semantics unresolved. |

## First Canonical Event Spike Candidate

Preferred first mutation: `custom_skill.created`.

Why this first:

- it does not alter source evidence;
- it already has a governed creation route;
- it has clear source objects: idea, approved sample, created skill;
- it can be idempotent by idea/sample/skill ids;
- it can appear in Matter Log without claiming source custody.

Candidate payload:

```json
{
  "skill_id": "skill_...",
  "slash": "/comparison_chart",
  "title": "Comparison Chart",
  "source_idea_id": "idea_...",
  "source_sample_id": "sample_...",
  "skill_version": 1,
  "status": "active"
}
```

Do not include sample markdown, evidence blocks, or matter source text in the
event payload.

## File Removal Event Must Wait

`source_file.removed_from_active_record` should not be implemented until these
are accepted:

1. active source set projection;
2. local tombstone/suppression behavior;
3. runtime DB source/document status behavior;
4. artifact currentness/staleness projection;
5. restore/quarantine rules;
6. privilege-safe Matter Log summaries;
7. idempotent matter/document locking.

## Outbox / Broker Posture

First move:

1. append to an app-owned `matter_events` equivalent;
2. use an outbox/job table only when something asynchronous must happen;
3. project UI Matter Log from canonical events plus legacy ledgers;
4. consider Kafka/broker transport only if operational pressure appears.

A broker should not be the source of truth for legal matter custody.

## Review Questions Before Coding The Spike

- Should app-level Skill Factory events require a matter id when the user had an
  active matter, or should they be global with optional matter context?
- Should failed attempts be canonical events or job failures only?
- What is the local filesystem event ledger path and locking behavior?
- What runtime DB table shape best fits existing tenancy and RLS patterns?
- How will projections merge canonical events with legacy `matter-log/v0-readonly`
  entries without duplicates?
