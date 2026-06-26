# Matter Mutation Inventory

Date: 2026-06-26
Status: Phase 1 inventory for Matter Log / file-removal planning

This inventory starts the Matter Log journey without adding file removal. It maps
current Matter Workbench operations that change matter state, generated outputs,
or durable ledgers. It should stay honest about what current records can and
cannot prove.

Related design note:

- [Matter Log, File Removal, And Eventing](future-design-decisions/matter-log-file-removal-and-eventing.md)

## Purpose

Before adding `Remove from active record`, Matter Workbench needs to know which
operations already mutate matter state and which existing records can seed a
read-only Matter Log.

This document is not an event schema. It is an inventory.

## Classification

| Class | Meaning | Matter Log posture |
| --- | --- | --- |
| Source mutation | Changes the source/original document set or matter intake structure. | Must become custody-grade before file removal. |
| Source preparation mutation | Changes deterministic/source-control records derived from source files. | Good Matter Log candidate, but must distinguish currentness. |
| Generated artifact mutation | Writes or updates generated legal/source-backed artifacts. | Good Matter Log candidate with output paths and stale/currentness. |
| Skill factory mutation | Changes reusable workflow definitions, samples, or runs. | Good Matter Log candidate; global skill definitions may be matter-linked but not matter-owned. |
| Ledger/audit mutation | Writes telemetry, receipts, jobs, or beta signals. | Useful projection seed, not automatically a custody event. |
| UI/session state | Changes app selection or display state only. | Usually not Matter Log custody; may appear in activity/debug surfaces. |

## Current Mutation Surfaces

| Operation | Routes / services | Class | Existing durable record | Matter Log readiness | Notes |
| --- | --- | --- | --- | --- | --- |
| Create new matter from upload | `POST /api/matters/new`; `uploadService.createMatter`; runtime DB `createMatterFromUploadedFiles`; filesystem upload + `runMatterInit` | Source mutation | Runtime DB custody rows in DB mode; filesystem matter folder + `matter.json` / File Register in local mode | High-value future event; current local record is source truth but not append-only event | Allocates matter identity and first intake/source files. |
| Add files to matter | `POST /api/matters/add-files`; `uploadService.addFilesToMatter`; runtime DB `addUploadedFilesToMatter`; filesystem add-files + `runMatterInit` | Source mutation | Runtime DB upload/import rows in DB mode; filesystem intake folder + File Register in local mode | High-value future event; needs Matter Log before source removal | Reverse operation will be `Remove from active record`; must preserve FILE ids. |
| Set up / initialize matter | `POST /api/matter-init`; `runMatterInit`; runtime DB `initializeMatter` | Source preparation mutation | Job ledger when routed through API; matter artifacts/registers | Good projection seed from job ledger, not full custody on its own | Reconciles matter structure and records. Must become tombstone-aware before removal. |
| Extract documents | `POST /api/extract`; `runExtract`; runtime DB `extractDocuments` | Source preparation mutation | Job ledger; extraction payloads | Good projection seed | Derived from active source set; removal must prevent extracted payloads from staying in active context. |
| Create / refresh Source Index labels | `POST /api/describe-sources`; `runSourceDescriptors`; runtime DB `describeSources` | Source preparation mutation | Job ledger; Source Index artifact/provider runs | Good projection seed | Label-only changes differ from source-set changes. |
| Create List of Dates | `POST /api/create-listofdates`; `runCreateListOfDates`; runtime DB `createListOfDates` | Generated artifact mutation | Job ledger; `10_Library/List of Dates.*`; provider run metadata | Good projection seed with currentness caveat | Source removal should normally mark `chronology_regeneration_needed` before any regeneration. |
| Refresh List of Dates labels | `POST /api/create-listofdates/refresh-labels`; `refreshListOfDatesSourceLabels`; runtime DB label refresh | Generated artifact mutation | Job ledger; List of Dates artifact update | Good projection seed | Cheap label refresh, not legal chronology regeneration. |
| Write Matter Story | `POST /api/matter-story`; `matterStoryService.runDisputeStory`; runtime DB `persistTextArtifacts`/`persistMatterJson` | Generated artifact mutation | Job ledger; Matter Story artifact; custom skill run-like metadata | Good projection seed | Downstream of current List of Dates; must become stale if source set changes. |
| Doctor fix | `POST /api/doctor/fix`; `runDoctorFix`; runtime DB `fixDoctorIssues` | Source preparation mutation / maintenance | Job ledger; matter artifact/layout changes | Projection candidate, needs per-fix semantics | Some fixes may rewrite layout; not all are source mutations. |
| Doctor scan / matter status / prepare plan | `POST /api/doctor/scan`, `GET /api/matter-status`, `GET /api/prepare-matter` | Read/advisory | No mutation intended | Not Matter Log mutation | May inform currentness and readiness displays. |
| Ask Copilot | `POST /api/matter-copilot/answer` | Ledger/audit mutation | Copilot interaction receipt | Useful non-evidence receipt, not matter mutation | Conversation memory is not evidence. |
| Research Copilot | `POST /api/matter-copilot/research` | Ledger/audit mutation | Copilot interaction receipt; public-source answer | Useful non-evidence receipt, not matter mutation | Public research remains explicit and separate. |
| Command interaction | `POST /api/command-interactions` | Ledger/audit mutation | Command interaction JSONL / runtime DB audit log | Useful activity seed, not custody | Records user intent/routing, not source truth. |
| Skill idea create/update/status | `POST /api/skill-ideas`; design brief/status routes | Skill factory mutation | Skill ideas store / runtime DB skill ideas | Good Skill Factory log candidate | May be linked to a matter but is a workflow-design record. |
| Skill sample generation | `POST /api/skill-ideas/sample-output` | Skill factory mutation / generated sample | Job ledger; skill sample store / runtime DB samples | Good Skill Factory log candidate | Sample output is review-only, not matter artifact. |
| Skill sample approval | `POST /api/skill-ideas/:id/samples/:sampleId/approve` | Skill factory mutation | Skill sample store / runtime DB samples | Good Skill Factory log candidate | Approval changes which sample can create a skill. |
| Custom skill creation | `POST /api/skill-ideas/:id/create-skill`; `configurableSkillsService.createSkillFromApprovedSample` | Skill factory mutation | Configurable skill store / runtime DB skill store; idea status; `custom_skill.created` matter event | First canonical event implemented | Low-risk first event because it does not alter source evidence. Runtime DB mode appends the event transaction-coupled with the skill store write; local mode appends to JSONL fallback after the skill store write under the same mutation queue. |
| Custom skill lifecycle | `POST /api/configurable-skills/:id/lifecycle` | Skill factory mutation | Configurable skill store / runtime DB skill store | Good Skill Factory log candidate | Pause/archive/delete affects workflow availability, not matter source record. |
| Custom skill run | `POST /api/configurable-skills/run`; `configurableSkillsService.runSkill`; runtime DB `persistTextArtifacts` | Generated artifact mutation / skill run | Job ledger; configurable skill run ledger; output artifacts | Good Matter Log candidate | Matter-bound output; should be stale if it cites removed sources. |
| Custom skill overwrite cancelled | `POST /api/configurable-skills/runs/cancelled` | Ledger/audit mutation | Configurable skill run ledger | Good Activity/Matter Log candidate | Records decision to keep existing output. |
| AI settings save/test | `POST /api/ai-settings`; `/test` | System config mutation | AI settings store | System log, not Matter Log | Operator-only; not matter custody. |
| Private beta feedback/signals | `/api/private-beta/*` | Beta telemetry | Feedback/signal ledgers | Product/ops log, not Matter Log | May reference a matter but is not a matter mutation. |
| Switch active matter / clear active matter | `/api/switch-matter`; `/api/active-matter/clear` | UI/session state | Active matter state | Not Matter Log custody | Selecting a matter is not a matter-record mutation. |
| Config matters home | `POST /api/config` | System config mutation | Config store | System log, not Matter Log | Changes local workspace root. |

## Existing Records That Can Seed A Read-Only Matter Log

These are useful but must be labeled honestly until canonical matter events
exist.

| Existing source | Strength | Limitation |
| --- | --- | --- |
| Job status ledger | Captures many workflow starts/completions/failures with matter name, kind, label, status, user/request context. | Not all mutations are tracked; jobs are not custody events; local write paths may mutate before/inside job operation. |
| Configurable skill run ledger | Captures custom skill run status, matter, output paths, overwrite state, receipt state. | Only custom skill runs, not native workflows; output availability is a projection. |
| Copilot receipts | Captures Ask/Research interaction outcomes. | Receipts are explicitly not evidence and not matter mutations. |
| Command interaction log | Captures user command/routing history. | Intent/activity, not proof of record mutation. |
| Skill ideas/samples/skills stores | Capture Skill Factory lifecycle. | Some records are global workflow design records, not matter-owned events. |
| Runtime DB custody tables | Strongest source in DB mode for uploads/artifacts/payloads. | Not yet exposed as a unified Matter Log; local fallback differs. |
| Matter artifacts on filesystem | Current local artifact truth. | Not append-only; no uniform actor/reason/impact envelope. |

## No-Regret First Matter Log Projection

A safe read-only Matter Log skeleton can begin by projecting:

1. job status records for matter-bound workflow jobs;
2. configurable skill runs for the selected matter;
3. source/matter upload events only where existing records can prove them;
4. skill creation/run records as workflow events;
5. Copilot receipts only in a separate `assistant activity` category, clearly not
   evidence.

The projection must say `best effort` or equivalent until canonical events are
written.

## Gaps Blocking File Removal

File removal should remain blocked until these gaps are addressed:

1. No source-custody event implementation for active source-set changes.
2. No source-removal write-side tombstone mutation for local filesystem source scanning.
3. No complete unified active source set read/write model.
4. No artifact currentness projection across List of Dates, Matter Story, and
   custom skill outputs.
5. No restore/quarantine design.
6. No privilege-safe Matter Log summaries.
7. No idempotent removal mutation with matter/document locking.

## First Implemented Event Spike

Implemented: custom skill creation emits `custom_skill.created`.

Why this was first:

- it is already a governed action;
- it has a clear actor/time/result;
- it updates existing stores but does not alter source evidence;
- a failure does not risk source custody;
- post-create UI already expects a refresh signal.

The first canonical event is shaped as:

```json
{
  "event_type": "custom_skill.created",
  "matter_name": "optional selected matter folder",
  "actor": { "label": "current user or local operator" },
  "summary_key": "custom_skill_created",
  "payload": {
    "skill_id": "skill_...",
    "slash": "/comparison_chart",
    "title": "Comparison Chart",
    "source_idea_id": "idea_...",
    "source_sample_id": "sample_..."
  }
}
```

This shape is implemented for the first event, but it is not a public API schema
and it does not unlock source-file removal.

## Test Hooks For This Inventory

Tests should protect that this inventory remains aligned with current route
names and known mutation categories. If a new matter mutation route is added, the
inventory should be updated or the test should deliberately acknowledge why it is
not part of Matter Log planning.
