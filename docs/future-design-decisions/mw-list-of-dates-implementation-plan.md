# MW List of Dates Implementation Plan

Date: 2026-07-08
Status: First implementation slice completed on `feature/mw-list-of-dates` — keep as contract for follow-on export/UI hardening

## Purpose

This plan turns the accepted SME reading of the old lawyer-facing List of Dates work into a concrete implementation path for a new **MW List of Dates** artifact.

It should be read with:

- [Legal Practice SME Q&A Ledger](legal-practice-sme-qna-ledger.md)
- [Case Analysis, Procedural Posture Diagnosis, and MW List of Dates](case-analysis-posture-diagnosis-and-lod.md)
- [Case Analysis Posture Diagnosis Implementation Plan](case-analysis-posture-diagnosis-implementation-plan.md)
- [Case Timeline Canonicalization Plan](case-timeline-canonicalization-plan.md)
- [Chronology / List of Dates](native-skill-chronology-list-of-dates.md)
- [Lawyer-Facing List of Dates Design Note](../lawyer-facing-list-of-dates.md)
- [Native Skill Runner Posture](native-skill-runner-posture.md)

The core reading is:

```text
Sources
  -> neutral Case Timeline
  -> Matter Story
  -> Filing and Procedural Posture Diagnosis
  -> MW List of Dates
  -> later court-facing List of Dates / draft export
```

The existing neutral chronology should be canonicalized to `10_Library/Case Timeline.*` before this feature is implemented. The new MW List of Dates is a downstream Case Analysis artifact shaped by the diagnosed court/forum, procedural posture, client side, priority remedy, and working legal objective.

## First Implementation Slice

Implemented on branch `feature/mw-list-of-dates` after Case Timeline canonicalization. The slice adds:

- service: `services/mw-list-of-dates-service.mjs`;
- native skill: `/create_mw_listofdates` (`skills/builtins/create_mw_listofdates`);
- API routes:
  - `GET /api/mw-list-of-dates/status?matter=...`;
  - `POST /api/mw-list-of-dates`;
- current artifacts:
  - `20_Workshop/Case Analysis/MW List of Dates.md`;
  - `20_Workshop/Case Analysis/MW List of Dates.json`;
- archive-on-overwrite under `20_Workshop/Case Analysis/archive/`;
- Matter Overview Case Analysis card plus command-panel fallback;
- runtime-DB-compatible reader/stat/writer injection;
- tests for service, API route, registry/command contracts, and full repository validation.

The first slice intentionally does **not** add MW List of Dates to automatic preparation and does **not** create a court-facing filing/export profile.

## Second-Pass Decision Summary

This is the intended implementation reading:

1. **Do not retrofit the neutral chronology into the advocacy artifact.** Canonicalize it first as `10_Library/Case Timeline.*` under the existing `10_Library` lane.
2. **Make Case Timeline a row/system action, not a lawyer-facing slash-list item.** It should run automatically during preparation and remain refreshable from the Home / Matter Overview preparation row. The old `/create_listofdates` slash can remain as a legacy/operator alias, but ordinary users should not see `create_listofdates` in the slash invoke list.
3. **Make MW LoD a Case Analysis operation, not a Core Preparation default.** In the first implementation, it should be manually triggered after diagnosis review. It can appear as a Case Analysis row/card, but automatic preparation should not silently spend another model run or generate advocacy-framed chronology before the lawyer has seen the diagnosis.
4. **Gate on procedural diagnosis.** Missing/stale diagnosis blocks. Unconfirmed diagnosis blocks by default, with an explicit `proceed unconfirmed` escape hatch only if the owner accepts that beta behavior.
5. **Transform from Case Timeline rows in V1.** Do not reopen the full source document set or run legal research inside MW LoD. This prevents a second, competing fact spine.
6. **Show lawyer-facing source labels in Markdown.** Internal handles stay in JSON/receipts/operator detail, not in the default lawyer-visible Markdown.
7. **Keep court-facing export separate.** The MW LoD is working analysis; an SLP/writ/court-facing List of Dates is a later export profile.

## Correct Reading Of The Older Notes

The older `lawyer-facing-list-of-dates.md` and `native-skill-chronology-list-of-dates.md` notes correctly captured many chronology rules, but their language predates the sharper Case Analysis split.

Interpret them as follows:

1. **The first-pass generated chronology becomes the Case Timeline.**
   It can still be lawyer-readable and can show relevance/materiality, but its product role is the neutral source-backed factual spine in `10_Library`, not the final advocacy List of Dates.

2. **The MW List of Dates is not a replacement for the Case Timeline.**
   It is a derivative Case Analysis artifact. It selects, orders, frames, and explains dates for the current diagnosed legal objective while staying traceable to the Case Timeline/source record.

3. **The MW List of Dates is not a court-facing filing copy.**
   It is MW-authored working analysis for lawyer review. Court-facing exports come later and must remove internal source handles and use annexure/exhibit/paper-book references.

4. **Procedural diagnosis is the governing frame.**
   Without a current Filing and Procedural Posture Diagnosis, the app does not know what the MW List of Dates is trying to serve.

5. **Facts remain ethically bounded.**
   Material adverse facts are handled with responsible framing, not suppressed. Facts considered but not emphasized must be preserved for lawyer review.

## Product Goal

Add a new native skill / Case Analysis operation that produces one current MW-authored List of Dates for the matter.

The artifact should answer:

```text
Given the current procedural diagnosis, which dates matter most, how should they be framed for the working legal objective, and what must the lawyer review before relying on them?
```

It should not answer the broader neutral question:

```text
What happened in the matter?
```

That is the job of the Case Timeline.

## Non-Goals

Do not implement in this slice:

- changing the existing root lane model (`10_Library`, `20_Workshop`, `30_Drafts`, `40_Dispatch`);
- deleting legacy `/create_listofdates` compatibility;
- court-specific filing templates;
- SLP/writ/appeal export profiles;
- annexure or paper-book pagination workflows;
- in-app row-by-row editing of the generated MW List of Dates;
- a final court-ready List of Dates;
- a pleading, synopsis, grounds, prayer, or dispatch-ready draft;
- automatic legal approval;
- silent use of stale or unconfirmed procedural posture.

## Terminology

| Term | Meaning |
| --- | --- |
| Case Timeline | Source-backed neutral chronology, canonicalized to `10_Library/Case Timeline.*`; legacy `/create_listofdates` remains a hidden compatibility alias. |
| Filing and Procedural Posture Diagnosis | MW-authored diagnosis of court/forum, posture, filings/remedies, governing framework, risks, and lawyer-confirmation needs. |
| MW List of Dates | New Case Analysis artifact: selected/framed chronology for the current working legal objective. |
| Court-facing List of Dates | Later export/draft profile for actual filing; not part of this slice. |
| Case Analysis Q&A | Persistent matter-local ledger of lawyer confirmations/corrections/instructions. |

## Artifact Model

### Current artifact paths

Use stable current paths for downstream consumers:

```text
20_Workshop/Case Analysis/MW List of Dates.md
20_Workshop/Case Analysis/MW List of Dates.json
```

The Markdown heading and JSON metadata carry the version number and generated timestamp.

### Archive paths

Before overwriting the current artifact, archive the previous current pair:

```text
20_Workshop/Case Analysis/archive/MW List of Dates v1 - 2026-07-08 16-30.md
20_Workshop/Case Analysis/archive/MW List of Dates v1 - 2026-07-08 16-30.json
20_Workshop/Case Analysis/archive/MW List of Dates v2 - 2026-07-08 17-05.md
20_Workshop/Case Analysis/archive/MW List of Dates v2 - 2026-07-08 17-05.json
```

Rationale:

- the stable current path is easy for downstream skills and UI;
- immutable archived versions preserve reasoning history;
- the current visible document can still display `Version: v3`.

### Relationship to existing chronology

After Case Timeline canonicalization, MW LoD reads but does not mutate the neutral source spine:

```text
10_Library/Case Timeline.md
10_Library/Case Timeline.json
10_Library/Case Timeline.csv
```

Legacy `10_Library/List of Dates.*` paths remain reader fallbacks only until old matters are migrated/regenerated.

## Native Skill Identity

Proposed manifest:

```text
skills/builtins/create_mw_listofdates/skill.json
```

Draft metadata:

```json
{
  "id": "create_mw_listofdates",
  "slash": "/create_mw_listofdates",
  "title": "Create MW List of Dates",
  "display": {
    "action": "Create MW List of Dates",
    "artifact": "MW List of Dates",
    "running": "Creating MW List of Dates",
    "complete": "MW List of Dates ready",
    "pill": "Uses AI"
  },
  "category": "Analyze",
  "product_surface": "native_legal",
  "purpose": "Create an MW-authored, source-backed working List of Dates shaped by the current procedural diagnosis.",
  "mode": "AI",
  "matter_required": true,
  "paid_provider_call": true,
  "rerun_guarded": true,
  "source_backed": "required",
  "legal_setting_scope": "litigation",
  "markdown_first": true,
  "inputs": [
    "10_Library/Case Timeline.md",
    "10_Library/Case Timeline.json",
    "10_Library/Source Index.json",
    "20_Workshop/The Story.md",
    "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md",
    "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json",
    "20_Workshop/Case Analysis/Case Analysis Q&A.md"
  ],
  "outputs": [
    "20_Workshop/Case Analysis/MW List of Dates.md",
    "20_Workshop/Case Analysis/MW List of Dates.json"
  ],
  "upstream": [
    "create_case_timeline",
    "/the_story",
    "/procedural_posture_diagnosis"
  ],
  "runner_key": "/create_mw_listofdates",
  "version": 1
}
```

User-facing invocation should be row-based, not slash-first. The app-system action should be `create_case_timeline` after the Case Timeline canonicalization work. Keep `/create_listofdates` as a legacy/operator alias for compatibility, but do not advertise it in the ordinary slash invoke list. `/create_mw_listofdates`, if added, should also be secondary to a Case Analysis row action.

## Inputs

### Required inputs

1. **Case Timeline Markdown and JSON**
   - Canonical internal path: `10_Library/Case Timeline.*`.
   - Legacy fallback: `10_Library/List of Dates.*`.
   - Product label: Case Timeline.
   - Provides the fact spine and row/source grounding.

2. **Matter Story**
   - Current path: `20_Workshop/The Story.md`.
   - Provides concise narrative context and issue framing.

3. **Filing and Procedural Posture Diagnosis**
   - Current paths:
     - `20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md`
     - `20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json`
   - Provides forum, posture, possible filings/remedies, working path, governing law, adverse facts, missing information, and confirmation state.

4. **Source Index**
   - Current path: `10_Library/Source Index.json`.
   - Provides lawyer-facing source labels and source identity.

### Optional inputs

1. **Case Analysis Q&A**
   - Current path: `20_Workshop/Case Analysis/Case Analysis Q&A.md`.
   - Provides lawyer confirmations/corrections/instructions.

2. **Matter metadata / Matter Profile**
   - Client side, role, forum, practice area, objectives if available.
   - Must not override source-backed or lawyer-confirmed matter-specific facts.

## Preflight And Gating

The runner must preflight before any paid provider call.

| State | Behavior |
| --- | --- |
| No matter selected | Refuse: pick a matter first. |
| Case Timeline missing | Refuse: build Case Timeline first. |
| Case Timeline stale | Refuse by default: refresh Case Timeline first. |
| Matter Story missing | Refuse: write Matter Story first. |
| Matter Story stale | Refuse by default: refresh Matter Story first. |
| Procedural diagnosis missing | Refuse: run Procedural Posture Diagnosis first. |
| Procedural diagnosis stale | Refuse: refresh diagnosis first. |
| Diagnosis unconfirmed | Refuse by default, but allow explicit `proceed_unconfirmed` with reason. |
| Diagnosis corrected | Use corrected fields and record correction source. |
| Diagnosis needs reconfirmation | Treat as stale/unconfirmed; require refresh or explicit proceed reason. |
| Source Index missing | Refuse unless Case Timeline JSON already has enough source labels and internal source identities. |

### Unconfirmed diagnosis policy

Default posture:

```text
No silent downstream use of unconfirmed procedural diagnosis.
```

For beta flexibility, the UI/API may allow:

```json
{
  "proceedUnconfirmed": true,
  "reason": "Urgent working chronology requested before formal confirmation."
}
```

If used, the MW LoD must mark:

```text
Status: Provisional — based on unconfirmed procedural diagnosis
```

and the receipt must record the reason.

## Staleness Rules

MW List of Dates is current only if:

- current MW LoD Markdown and JSON exist;
- Case Timeline is current;
- Matter Story is current;
- Procedural Diagnosis is current;
- current MW LoD was generated after the Case Timeline, Matter Story, and Diagnosis inputs it cites;
- no newer source/input invalidates upstream artifacts;
- if the diagnosis was confirmed/corrected before generation, it has not since moved to `needs_reconfirmation`.

Suggested status labels:

```text
missing
blocked_missing_case_timeline
blocked_stale_case_timeline
blocked_missing_story
blocked_stale_story
blocked_missing_diagnosis
blocked_stale_diagnosis
blocked_unconfirmed_diagnosis
ready_to_generate
current_provisional
current_unconfirmed
current_confirmed_basis
current_corrected_basis
stale
needs_reconfirmation
failed
```

UI may simplify these labels, but the JSON/status service should preserve the reason.

## Generation Strategy

### Principle

The MW LoD should transform and select from the Case Timeline. It should not rediscover facts from the original source documents in V1.

Rationale:

- reduces token cost;
- keeps source grounding stable;
- prevents the MW LoD from becoming a competing fact spine;
- avoids mixing Research/public-law retrieval into a matter-bound drafting artifact;
- lets validation prove every MW LoD row maps back to one or more Case Timeline/source rows.

### V1 source-mapping contract

The provider should not receive an unconstrained instruction to "write a List of Dates" from raw matter context. It should receive a bounded row-selection packet.

If the existing Case Timeline JSON has no stable row IDs, the MW LoD packet builder should assign request-local IDs:

```text
CT-0001, CT-0002, CT-0003, ...
```

Each request-local ID should also carry a deterministic row fingerprint derived from date, event text, source citation(s), and row ordinal. The fingerprint lets validation and receipts identify exactly which Case Timeline row was used even if the visible row label is later refreshed.

Provider output should be constrained to:

- selected Case Timeline row IDs;
- row treatment/classification;
- relevance to the diagnosed working posture/remedy;
- concise lawyer-facing framing that does not add new facts;
- review sections for adverse/difficult or de-emphasized facts.

The renderer should prefer the original Case Timeline event text unless the model supplies a conservative `framed_event` that passes support validation against the selected row text. The model must not introduce new dates, actors, reliefs, admissions, findings, statutes, annexure labels, or procedural steps that are absent from the provided packet.

### Candidate row construction

Before calling the model, build a bounded packet:

```json
{
  "matter": { "name": "", "client_side": "" },
  "procedural_diagnosis": {
    "court_forum": "",
    "procedural_posture": "",
    "recommended_working_path": "",
    "possible_filings": [],
    "governing_law": [],
    "adverse_or_difficult_facts": [],
    "missing_information": [],
    "confirmation_state": ""
  },
  "case_timeline_rows": [
    {
      "timeline_row_id": "CT-0001",
      "row_fingerprint": "sha256:...",
      "date": "",
      "event": "",
      "actor_or_posture": "",
      "materiality_or_relevance": "",
      "event_stream": "factual|procedural|mixed|uncertain",
      "source_labels": [],
      "internal_source_handles": []
    }
  ],
  "matter_story_excerpt": "",
  "case_analysis_qa_relevant_entries": [],
  "packet_limits": {
    "max_rows": 120,
    "row_text_policy": "truncate-long-rows-with-source-preserving-summary"
  }
}
```

The runner should prefer structured Case Timeline JSON rows over Markdown parsing. Markdown parsing is a fallback only.

### Model task

Ask the provider to:

1. choose rows from the Case Timeline that matter to the diagnosed working path;
2. preserve chronological order;
3. frame each row's relevance to the working posture/remedy;
4. classify treatment:
   - `central`
   - `introductory`
   - `procedural_context`
   - `supporting`
   - `adverse_or_difficult`
   - `background`
   - `not_emphasized`
5. include adverse/difficult material facts responsibly;
6. identify facts considered but not emphasized;
7. identify missing information/documents;
8. avoid inventing facts, law, authorities, dates, or sources;
9. cite only provided Case Timeline row IDs / source labels.

### Suggested provider shape

V1 can use a two-stage source-backed operation:

```text
Stage 1: selector/framer model
  -> structured MW LoD JSON draft

Stage 2: deterministic validator
  -> source-row mapping, chronology order, no unsupported IDs, no empty source grounding
```

If output quality is weak, add a critic/finalizer loop later:

```text
selector/framer -> legal critic -> finalizer -> deterministic validator
```

Do not start with a more expensive loop unless real matters show that the simpler shape misses adverse facts or misframes procedural relevance.

## Output Markdown Contract

Draft structure:

```markdown
# MW List of Dates

Author: MW
Status: Provisional — lawyer review required
Version: v3
Generated: 2026-07-08 16:30 IST
Matter: ...
Based on: Case Timeline ..., Matter Story ..., Procedural Diagnosis ...
Diagnosis confirmation state: confirmed | corrected | unconfirmed | proceeded unconfirmed

## Working Legal Frame

- Client side:
- Court/forum:
- Procedural posture:
- Priority filing/remedy:
- Main objective:
- Governing law / framework:

## How To Read This Document

This is an MW-authored working List of Dates for lawyer review. It is not a court-facing filing copy. It is derived from the Case Timeline and the current procedural diagnosis. Verify sources and posture before relying on it.

## List of Dates

| Date | Event | Treatment | Relevance to working posture / remedy | Source |
| --- | --- | --- | --- | --- |
| ... | ... | Central | ... | ... |

## Adverse Or Difficult Facts To Handle

...

## Facts Considered But Not Emphasized

> Internal lawyer-review section. Do not copy into court-facing drafts without lawyer decision.

...

## Missing Information / Documents

...

## Lawyer Review Checklist

- [ ] Court/forum still correct
- [ ] Procedural posture still correct
- [ ] Priority filing/remedy still correct
- [ ] Main relief/objective still correct
- [ ] Governing law/framework adequate
- [ ] Adverse facts handled responsibly
- [ ] Missing documents/facts addressed or deliberately parked
- [ ] Sources checked before court-facing use

## Source Audit Note

Internal source handles and row fingerprints are stored in the JSON sidecar and run receipt for audit/regeneration. They are not shown in this default lawyer-visible Markdown.
```

### Markdown source display rule

The visible table should prefer lawyer-facing source labels, not raw developer handles.

Acceptable in the visible table:

```text
Impugned Order dated 12.09.2023
Builder's Reply Notice dated 04.05.2024
Bank Statement for May 2022
```

Keep these out of the default Markdown and store them in JSON / run receipts / operator-only details:

```text
FILE-0008 p.12 block 4
source_id
hash
storage path
extraction id
row_fingerprint
```

Court-facing export later must remove internal source handles entirely. The MW LoD Markdown should already avoid them by default so the later export profile starts from a safer document.

## JSON Sidecar Contract

Draft shape:

```json
{
  "schema_version": "mw-list-of-dates/v1",
  "artifact": "MW List of Dates",
  "author": "MW",
  "version": 3,
  "status": "provisional|working|failed_validation",
  "generated_at": "",
  "matter": {
    "name": "",
    "client_side": "",
    "client_side_source": "diagnosis|qa|matter_metadata|unknown"
  },
  "based_on": {
    "case_timeline": {
      "markdown_path": "10_Library/Case Timeline.md",
      "json_path": "10_Library/Case Timeline.json",
      "updated_at": "",
      "fingerprint": ""
    },
    "matter_story": {
      "path": "20_Workshop/The Story.md",
      "updated_at": "",
      "fingerprint": ""
    },
    "procedural_diagnosis": {
      "markdown_path": "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md",
      "json_path": "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json",
      "updated_at": "",
      "fingerprint": "",
      "confirmation_state": "unconfirmed|confirmed|corrected|not_sure|needs_reconfirmation",
      "proceeded_unconfirmed": false,
      "proceeded_unconfirmed_reason": ""
    },
    "source_index": {
      "path": "10_Library/Source Index.json",
      "updated_at": "",
      "fingerprint": ""
    }
  },
  "working_legal_frame": {
    "court_forum": "",
    "procedural_posture": "",
    "priority_filing_or_remedy": "",
    "main_objective": "",
    "governing_law": []
  },
  "rows": [
    {
      "id": "MWLOD-0001",
      "date_iso": "",
      "display_date": "",
      "event": "",
      "treatment": "central|introductory|procedural_context|supporting|adverse_or_difficult|background",
      "event_stream": "factual|procedural|mixed|uncertain",
      "relevance_to_working_posture": "",
      "source_display": [],
      "case_timeline_row_ids": [],
      "case_timeline_row_fingerprints": [],
      "internal_source_handles": [],
      "adverse_or_difficult": false,
      "needs_lawyer_review": false,
      "review_reason": ""
    }
  ],
  "adverse_or_difficult_facts": [
    {
      "summary": "",
      "case_timeline_row_ids": [],
      "suggested_treatment": ""
    }
  ],
  "facts_considered_but_not_emphasized": [
    {
      "summary": "",
      "case_timeline_row_ids": [],
      "reason": ""
    }
  ],
  "missing_information_or_documents": [],
  "lawyer_review_checklist": [],
  "validation": {
    "source_row_ids_valid": true,
    "chronological_order_valid": true,
    "unsupported_rows_dropped": 0,
    "warnings": []
  },
  "receipt_id": ""
}
```

## Validation Rules

The runner must validate before writing final artifacts.

Hard failures:

- output is not valid JSON;
- output schema version unsupported;
- any main row lacks a date and no clear undated-event policy exists;
- any main row lacks a source display and source mapping;
- any main row cites a non-existent Case Timeline row ID;
- output adds a material fact not traceable to a Case Timeline row;
- output reverses chronology without explicit same-day ordering reason;
- output includes court-facing/final-approval wording;
- output suppresses all diagnosis-identified adverse facts without review explanation.

Soft warnings / repairable issues:

- duplicate rows;
- overly generic relevance;
- missing optional treatment classification;
- source labels available only as internal handles;
- diagnosis unconfirmed but explicit proceed reason exists;
- some diagnosis missing-information items not reflected.

Repair policy:

1. Drop unsupported duplicate/noise rows if safe and record warning.
2. Retry malformed/invalid provider JSON once if the provider adapter supports bounded repair.
3. Fail closed if source grounding cannot be validated.

## Runner Lifecycle

Implement as a native skill runner job, not an inline route.

Stages:

```text
preflight
load_inputs
build_input_packet
select_and_frame_rows
validate_output
archive_previous_version
persist_artifacts
write_receipt
```

Each stage should record:

- start/end timestamp;
- status;
- warnings;
- model/provider metadata where applicable;
- input/output artifact references, not full work product in metadata-only observability.

Receipt should include:

- matter name;
- request parameters;
- preflight decision;
- based-on artifact fingerprints/mtimes;
- diagnosis confirmation state;
- whether unconfirmed diagnosis was used and reason;
- provider model metadata;
- validation warnings;
- archive paths created;
- output paths;
- recovery hint on failure.

### Observability and privacy

Matter-local receipts may reference generated artifacts and validation summaries. Private-beta/global observability must remain metadata-only:

- no full Case Timeline rows;
- no MW LoD prose;
- no source excerpts;
- no prompts or provider payloads;
- no client facts in ambient Activity/toast copy;
- no secrets or tokens.

Activity and terminal lines should say things like:

```text
[mw-lod] validating source mapping
[mw-lod] completed — 18 row(s), 3 review item(s)
```

not quote the legal work product itself.

## Service Responsibilities

Proposed new service:

```text
services/mw-list-of-dates-service.mjs
```

Responsibilities:

- read MW LoD status;
- preflight dependencies;
- load/bound Case Timeline, Matter Story, Diagnosis, Source Index, Q&A;
- build the provider packet;
- call app-owned provider policy;
- validate output;
- archive existing current artifact;
- persist Markdown/JSON through artifact policy;
- write/update receipt;
- expose status for Matter Overview / preparation rows.

Do not place long-running business logic in routes.

## Artifact Persistence

The service must work in both local filesystem and runtime DB modes.

Rules:

- writes go through the same artifact/storage abstraction used by native skill runners;
- archive writes must be atomic from the user's perspective;
- if archiving succeeds but new write fails, recovery hint must identify the archived previous artifact;
- if runtime DB cannot persist both Markdown and JSON, the feature must not be enabled in private beta.

## UI Contract

### Matter Overview / Case Analysis

First-slice UX should be a **manual Case Analysis action**, not an automatic Core Preparation step.

Add a Case Analysis card/row after Procedural Posture Diagnosis:

```text
MW List of Dates
Status: Missing / Blocked / Ready / Current / Needs refresh
Based on: Case Timeline, Story, Diagnosis
Action: Create / Refresh / Open
```

The row can sit visually with preparation/currentness surfaces, but the first implementation should not auto-run it as part of `Prepare Matter`. Rationale: MW LoD is advocacy-framed and paid-provider-backed; it should wait until the lawyer/operator has at least seen the procedural diagnosis or deliberately proceeds unconfirmed.

If diagnosis is unconfirmed:

```text
Procedural posture is unconfirmed.
Confirm it before creating the MW List of Dates, or proceed unconfirmed with a reason.
```

### Command panel

Do not advertise `/create_listofdates` in the ordinary lawyer-facing slash invoke list. Case Timeline is automatic preparation plus a Home / Matter Overview row action (`Build / Refresh Case Timeline`). Keep the old slash parser path available as a hidden legacy/operator escape hatch until a migration contract removes it.

Expose `/create_mw_listofdates` only after the feature is coherent. During first local testing it can remain operator-only or hidden behind feature flag. Even then, the primary UX should be the Case Analysis row action, not slash invocation.

### Artifact preview

Use safe Markdown preview. The MW LoD can render as generic Markdown initially. Later it may get a specialized table view.

### Confirmation UX dependency

If the procedural diagnosis confirmation UI is not available, the MW LoD action should either:

1. block and tell the user to confirm/correct posture once that UI exists; or
2. expose a narrowly worded `Proceed unconfirmed` modal with required reason.

Do not silently treat a generated diagnosis as confirmed.

## API / Route Sketch

Prefer the generic native skill run API if available. If a dedicated route is needed, keep it thin.

Draft endpoints:

```http
GET /api/mw-list-of-dates/status?matterName=...
POST /api/mw-list-of-dates
```

Request:

```json
{
  "matterName": "...",
  "overwrite": true,
  "proceedUnconfirmed": false,
  "proceedUnconfirmedReason": ""
}
```

Response should include:

```json
{
  "job": { "id": "", "status": "queued|running|completed|failed" },
  "receipt": {},
  "artifact_paths": {
    "markdown": "20_Workshop/Case Analysis/MW List of Dates.md",
    "json": "20_Workshop/Case Analysis/MW List of Dates.json"
  }
}
```

Stable error codes:

```text
mw_lod.matter_required
mw_lod.case_timeline_missing
mw_lod.case_timeline_stale
mw_lod.story_missing
mw_lod.story_stale
mw_lod.diagnosis_missing
mw_lod.diagnosis_stale
mw_lod.diagnosis_unconfirmed
mw_lod.proceed_reason_required
mw_lod.provider_unavailable
mw_lod.provider_invalid_json
mw_lod.validation_failed
mw_lod.persistence_failed
```

## Provider / Prompt Policy

Use app-owned native skill provider policy, not user-selected Copilot policy.

Prompt must compose the legal workbench policy prompt and enforce:

- MW-authored working artifact, not final legal advice;
- no court-ready claim;
- no unsupported facts;
- use only Case Timeline rows/source IDs provided;
- preserve adverse/difficult facts;
- distinguish allegations, denials, findings, records, and procedural events;
- do not convert disputed allegations into established facts;
- do not cite law/cases/statutes unless present in diagnosis/input packet;
- do not invent annexure labels, court templates, page numbers, or filing status;
- include lawyer review checklist.

Model task:

```text
AI_TASKS.SOURCE_BACKED_ANALYSIS
```

A dedicated task may be added later:

```text
AI_TASKS.MW_LIST_OF_DATES
```

A dedicated task is recommended before broad release if cost/quality needs separate routing.

## Output Quality Rubric

Use this rubric when reviewing real matter outputs before enabling the feature beyond local/operator testing.

| Dimension | Good output | Failure smell |
| --- | --- | --- |
| Procedural alignment | Dates selected and relevance framed around the diagnosed forum, posture, filing/remedy, and objective. | Reads like a generic chronology with no connection to the working path. |
| Source fidelity | Every row maps to Case Timeline row IDs and source labels; disputed facts are attributed. | New facts, conclusions, admissions, or dates appear without source-row support. |
| Chronological discipline | Rows remain in time order; same-day order is sensible. | Challenged order is pulled to the top or facts are grouped argumentatively out of time. |
| Advocacy judgment | Central, introductory, procedural, and adverse facts are proportionately emphasized. | Every row is equal-weight, or helpful facts are over-amplified while adverse facts vanish. |
| Adverse-fact handling | Difficult facts are included or explicitly parked for lawyer review. | Material adverse facts disappear without explanation. |
| Lawyer usability | The table can be read as a working brief for the next filing/remedy. | The output is too verbose, too terse, or duplicates Case Timeline without added judgment. |
| Boundary clarity | It says MW-authored working material, not court-ready. | It sounds like final legal advice or a filing copy. |

A first beta implementation should be judged on this rubric before adding court-facing exports. If the output merely rephrases the Case Timeline, the feature is not ready; if it adds unsupported advocacy, it is unsafe.

## Test Plan

### Service / runner tests

- Refuses without matter.
- Refuses without Case Timeline.
- Refuses when Case Timeline stale.
- Refuses without Matter Story.
- Refuses without Procedural Diagnosis.
- Refuses when diagnosis stale.
- Refuses unconfirmed diagnosis unless explicit proceed reason supplied.
- Uses corrected/confirmed diagnosis fields when present.
- Builds bounded input packet from Case Timeline JSON, Story, Diagnosis, Source Index, Q&A.
- Archives previous current artifact before writing new current artifact.
- Writes Markdown and JSON sidecar.
- Receipt records based-on fingerprints, diagnosis confirmation state, output paths, and warnings.

### Provider / validation tests

- Prompt includes policy, source-only rule, adverse-fact handling, provisional wording.
- Malformed provider JSON retries once and then fails closed.
- Unsupported Case Timeline row IDs are rejected.
- Rows without source grounding are rejected.
- Invented source IDs are rejected.
- Rows remain chronological.
- Duplicate rows are dropped or warned.
- Diagnosis adverse facts must appear in main rows or review section.
- Court-ready/final-filing wording is rejected or warned.

### Artifact/version tests

- First run writes current files and no archive.
- Second run archives prior current files with version/timestamp.
- Archive filenames are collision-safe for same-day multiple runs.
- Runtime DB mode persists both current and archive artifacts.
- Failed write after archive produces recovery hint.

### UI tests

- Matter Overview shows MW List of Dates status/action.
- Missing/stale dependencies show correct recovery copy.
- Unconfirmed diagnosis requires explicit proceed reason.
- `/create_listofdates` remains Build Case Timeline.
- `/create_mw_listofdates` appears only when feature flag/visibility allows.
- Markdown preview uses safe renderer.

### Regression tests

- Existing Case Timeline generation unchanged.
- Matter Story still reads existing Case Timeline paths.
- Procedural diagnosis artifact flow unchanged.
- Preparation planner order remains Case Timeline -> Story -> Diagnosis -> MW LoD if MW LoD is included.
- Release-position tests unaffected.

## Rollout Plan

### Slice 0 — document and sample design

- Review this plan.
- Collect one or two real matter examples with existing Case Timeline + Story + Diagnosis.
- Manually draft expected MW LoD shape for quality comparison.

### Slice 1 — backend status/preflight only

- Add MW LoD status projection.
- Add preflight dependency checks.
- No provider call.
- UI can show blocked/ready state.

### Slice 2 — local runner prototype

- Add native runner that loads inputs and writes dry-run packet/receipt.
- Add provider call behind test fake.
- Validate JSON shape.
- Write artifacts locally only if runtime DB path is also planned.

### Slice 3 — artifact persistence and archive

- Add current + archive write policy.
- Add JSON sidecar and Markdown renderer.
- Add receipt/stages.

### Slice 4 — UI action

- Add Create/Refresh/Open actions on Matter Overview / Case Analysis surface.
- Add unconfirmed-diagnosis modal if needed.

### Slice 5 — runtime DB + full validation

- Ensure hosted/private beta storage path can persist and read artifacts.
- Run runtime DB tests and browser acceptance if enabled.

### Slice 6 — release decision

- Review output quality on real matters.
- Decide whether to ship in beta.
- If shipped, release notes must state this is an MW-authored working artifact, not court-ready.

## Recommended Defaults

| Decision | Default |
| --- | --- |
| Case Timeline artifact path? | Canonical `10_Library/Case Timeline.*`; legacy `10_Library/List of Dates.*` as reader fallback only. |
| Keep `/create_listofdates`? | Yes as hidden legacy/operator alias; do not advertise to ordinary users. |
| Case Timeline invocation? | Automatic preparation plus Home / Matter Overview row action (`Build / Refresh Case Timeline`). |
| New command? | `/create_mw_listofdates` only as hidden/secondary path until ready; primary UX should be row-based. |
| Where artifact lives? | `20_Workshop/Case Analysis/`. |
| Stable current path? | Yes: `MW List of Dates.md/json`. |
| Archive previous versions? | Yes, under `Case Analysis/archive/`. |
| Automatic preparation? | No for first slice; manual Case Analysis action after diagnosis review. |
| Require diagnosis? | Yes. |
| Require confirmed diagnosis? | Yes by default, with explicit proceed-unconfirmed escape hatch in beta. |
| Use original source docs directly? | No in V1; transform from Case Timeline/source labels. |
| Court-facing output? | Later export profile, not this slice. |
| Default Markdown includes raw internal handles? | No; source labels only, handles in JSON/receipt/operator detail. |
| Lawyer edits current MW LoD? | No; regenerate or edit downstream draft/export. |
| Adverse facts? | Include or explain in review section; never silently suppress. |

## Open Questions

1. Should the first beta UI allow `Proceed unconfirmed`, or should it strictly block until procedural diagnosis confirmation UI exists?
2. Should the runner read Case Analysis Q&A in V1, or wait until confirmation/correction UI is more mature?
3. Should source clickability in Markdown be handled by visible lawyer-facing labels only, or by UI affordances that map labels back to JSON source handles?
4. Should the output table include `Treatment` visibly, or keep treatment as metadata and write it into relevance prose?
5. What is the minimum row count/coverage expectation for real matters before the feature is beta-worthy?
6. Should the first court-facing export profile be SLP, writ, or generic filing chronology?

## Acceptance Criteria For First Implementation

The first acceptable implementation is complete when:

1. A matter with current Case Timeline, Matter Story, and Procedural Diagnosis can generate `MW List of Dates.md/json`.
2. Every main MW LoD row maps to one or more Case Timeline rows and source identities.
3. The artifact clearly states it is MW-authored working material, not a court-facing filing copy.
4. Missing/stale/unconfirmed diagnosis states are guarded before provider calls.
5. Previous MW LoD versions archive before overwrite.
6. Runtime DB mode can persist/read the current and archived artifacts if the feature is enabled in beta.
7. Tests cover preflight, validation, archive, provider output, and UI status/action copy.
8. Existing legacy `/create_listofdates` compatibility remains, but new MW LoD work depends on canonical `10_Library/Case Timeline.*` paths.
