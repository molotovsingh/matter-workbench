# Preparation Planner V2 and Procedural Diagnosis Robustness

Date: 2026-07-01

Status: Review draft / implementation plan

Priority: High

## Problem Statement

Matter Workbench preparation currently behaves too much like a linear pipeline:

```text
register files -> extract -> prepare source record -> build Case Timeline -> write Matter Story -> diagnose procedural posture
```

That model is no longer adequate.

The product now has multiple kinds of work mixed together:

1. deterministic custody/setup work;
2. source-preparation work driven by intake/source-file changes;
3. generated workspace backbone artifacts such as Case Timeline and Matter Story;
4. matter metadata/profile discovery;
5. legal-analysis artifacts such as Filing and Procedural Posture Diagnosis.

When these are treated as one pipeline, several bad outcomes follow:

- **Unnecessary reruns**: if no intake/source file changed, extraction, source labels, and Case Timeline should usually not rerun just because a later artifact is missing or failed.
- **Brittle end-stage failures**: if procedural posture diagnosis fails because Assistant/provider is temporarily unavailable, the whole matter can look blocked even though core preparation succeeded.
- **Poor dependency explanation**: the UI does not yet clearly answer “what changed?” and “why is this step being run?”
- **New matter vs add-files confusion**: creating a matter shell and adding files to an existing/new matter are related, but they are different flows with different dependency implications.
- **Matter metadata underuse**: Matter Story currently updates the matter description, but parties, jurisdiction, forum, matter type, and other profile facts should also be discovered and suggested from source material.
- **Override opacity**: force rebuilds, overwrites, and AI-credit-consuming reruns need explicit reasons, warnings, and audit trails.

The immediate beta.112 fix made stale Story/posture jobs runnable, but it did not solve the larger design problem. This plan records the deeper redesign.

## Desired Product Posture

Matter Workbench should move from a linear preparation pipeline to a dependency-aware preparation planner.

The planner should answer:

```text
What active matter inputs changed?
Which artifacts depend on those inputs?
Which outputs are missing, stale, blocked, failed, optional, or current?
Which action is the smallest safe next action?
Will the action consume AI credits?
Will it overwrite or archive generated work?
What is the reason?
```

The default user action should remain simple:

```text
Run needed preparation
```

But the backend must make that action precise. It should run only the needed stages, not blindly rebuild the chain.

## Core Concepts

### 1. Active Intake / Source Set

The first planner question should be:

```text
Has any active intake-level source file been added, removed, restored, replaced, or reclassified since the relevant output was produced?
```

If no active source-file change occurred, the planner should not rerun extraction, source labels, or Case Timeline merely because a downstream artifact is missing or failed.

### 2. Core Preparation

Core preparation should include the stable workspace foundation:

- matter setup / file registration;
- extraction for active source files that lack current extraction;
- Source Index / source record preparation;
- Case Timeline;
- Matter Story;
- Matter Profile suggestions/currentness.

A matter can be core-prepared even if optional legal-analysis artifacts still need work.

### 3. Case Analysis Artifacts

Filing and Procedural Posture Diagnosis should live under Case Analysis, not as a hard blocker for the whole matter being prepared.

That does not mean diagnosis can remain brittle. It means diagnosis failure must be contained while the diagnosis engine itself gets a proper preflight, retry path, and evidence-readiness model.

### 4. Matter Profile

Matter Profile should be a first-class concept separate from raw matter setup.

Suggested profile fields include:

- client / claimant / petitioner;
- opposite party / respondent;
- party roles;
- jurisdiction;
- forum/court/tribunal if visible;
- matter type;
- procedural stage hints;
- case number or filing identifiers if visible;
- brief description;
- confidence and source evidence for each suggestion.

The profile can be populated from Matter Story, Case Timeline, Source Index, and selected source evidence. User/lawyer-entered fields must not be silently overwritten.

## Target User Flows

### New Matter Flow

Creating a new matter should create the matter shell and custody container.

It should capture or initialize:

- matter caption/name;
- optional known client/opposite party;
- optional jurisdiction/matter type;
- optional intake note;
- ownership/user scope;
- empty profile fields marked unknown or user-supplied.

New Matter should not imply that documents have been prepared.

### Upload Files Into A New Matter

Uploading files into a new matter should start source preparation:

1. register uploaded files;
2. extract text only for active files needing extraction;
3. prepare/update Source Index only from current extraction records;
4. build/update Case Timeline if source inputs changed;
5. write/update Matter Story if Case Timeline basis changed or Story is missing;
6. discover Matter Profile suggestions;
7. optionally run Case Analysis artifacts if their preflight passes and policy allows auto-run.

### Add Files To Existing Matter

Adding files to an existing matter should not replay new-matter setup.

It should:

1. register the added intake/source files;
2. extract only new/unextracted active files;
3. mark affected downstream artifacts stale with reasons;
4. run only the minimum downstream work needed to restore currentness;
5. preserve old generated artifacts through latest-plus-archive behavior where applicable.

### Run Needed Preparation

Default behavior should be:

```text
Run only stages that are missing/stale/failed and whose dependencies are current.
Skip everything current.
Explain every skip and every run.
```

Example desired plan when only diagnosis is missing:

```text
Register files — current; no active intake changes.
Read documents — skipped; all active files have current extraction.
Prepare source record — skipped; source labels current.
Build Case Timeline — skipped; timeline basis current.
Write Matter Story — skipped; Story current.
Update Matter Profile — skipped/current or suggestions available.
Diagnose procedural posture — ready; diagnosis missing.
```

Example desired plan when Story is stale but no intake files changed:

```text
Register files — current; no active intake changes.
Read documents — skipped; no new active files.
Prepare source record — skipped; source labels current.
Build Case Timeline — skipped; Case Timeline current.
Write Matter Story — needs update; Case Timeline changed after Story.
Diagnose procedural posture — blocked until Story refresh completes.
```

## Dependency Model

The planner should track each stage as a node with:

- inputs;
- outputs;
- input version/basis;
- last successful run;
- currentness state;
- action;
- reason;
- cost/credit implication;
- overwrite/archive implication;
- failure/retry classification.

Suggested states:

```text
current
missing
stale
blocked
failed_retryable
failed_needs_operator
needs_confirmation
current_unconfirmed
not_applicable
```

Suggested actions:

```text
skip_current
run
confirm_paid_run
retry
retry_optional
review_suggestions
blocked
force_rebuild_only
```

### Stage Dependency Table

| Stage | Inputs | Runs when | Skips when | Notes |
| --- | --- | --- | --- | --- |
| Matter setup / register files | matter record, upload custody rows | matter shell/files not registered | matter record and active file register current | Deterministic, no AI credits. New Matter and Add Files should share registration primitives but not semantics. |
| Extraction | active source files | active file has no current extraction, extraction version changed, source restored/replaced | no active file-level extraction delta | Should be incremental. No downstream failure should force extraction without source/input change. |
| Source Index / source record | current extraction records | extraction changed, source labels missing/failed/stale | source labels current for active extraction set | AI credits likely. Can be batched. |
| Case Timeline | current Source Index and source records | source set or chronology-relevant inputs changed, timeline missing/failed/stale | no relevant source/timeline basis change | Label-only refresh should not regenerate chronology. |
| Matter Story | current Case Timeline, matter context | Story missing/stale, Case Timeline basis changed, approved overwrite requested | Story current for current Case Timeline | AI credits likely. Should update description and feed Matter Profile. |
| Matter Profile | Story, Case Timeline, source evidence, existing profile | blank fields have high-confidence suggestions, conflicts need review, profile stale against Story/Timeline | profile current or suggestions already reviewed | Should not silently overwrite user/lawyer fields. |
| Procedural posture diagnosis | current Story, Case Timeline, profile, selected evidence packet | diagnosis missing/stale/failed_retryable and preflight passes | diagnosis current or not requested | Case Analysis artifact. Should not block core preparation. |

## Matter Profile Design

Matter Profile should not be a single silent metadata overwrite.

Each suggested field should carry:

```text
field
current_value
suggested_value
source
confidence
reason
basis_artifacts
basis_file_ids_or_source_refs
state: suggested | applied | rejected | superseded | conflict
actor
created_at
reviewed_at
```

Rules:

- Blank fields may be auto-filled only if confidence threshold and product policy permit.
- User/lawyer-entered fields require explicit confirmation before overwrite.
- Conflicts must be shown as suggestions, not silent replacements.
- Every applied override needs a reason.
- Old values must be retained in audit/history.

This lets Matter Story update the brief description while Matter Profile discovery can populate or suggest parties, jurisdiction, forum, matter type, and procedural hints.

## Procedural Diagnosis Robustness

Making diagnosis optional is not enough. The diagnosis must still work reliably when invoked.

### Diagnosis Preflight

Before any AI call, the backend should build a deterministic preflight result:

```text
Case Timeline current? yes/no
Matter Story current? yes/no
Source Index current? yes/no
Matter Profile sufficient? yes/no
parties known? yes/no
jurisdiction/forum known? yes/no/unknown
visible filed proceeding evidence? yes/no/unknown
notices/pleadings/orders detected? yes/no/unknown
existing diagnosis present? yes/no
existing diagnosis stale? yes/no
retryable previous failure? yes/no
```

If preflight fails, do not call AI. Return a user-visible reason and next action.

Example:

```text
Diagnosis not ready: Matter Story must be refreshed first.
```

or:

```text
Diagnosis not ready: the current record does not identify jurisdiction or filing forum. Review Matter Profile suggestions first.
```

### Diagnosis Evidence Packet

The AI should not infer from an unstructured matter dump alone. The backend should assemble a posture evidence packet:

- current Case Timeline excerpts;
- current Matter Story;
- relevant source labels;
- known profile fields;
- detected procedural documents;
- explicit unknowns;
- questions to resolve.

The packet should distinguish:

```text
known from source
suggested by MW
unknown
user-entered
lawyer-confirmed
```

### First-Class Insufficient Record Outcome

A safe diagnosis can be:

```text
status: insufficient_record
```

This should be considered a successful generated Case Analysis artifact, not a provider failure.

Example output:

```text
The current record does not show a filed proceeding. Treat the visible posture as unknown/pre-filing until the lawyer confirms whether any suit, arbitration, tribunal matter, notice, order, or case number exists.
```

It should include lawyer questions rather than forcing a brittle legal conclusion.

### Diagnosis Failure Taxonomy

Failed diagnosis jobs should record safe machine-readable reasons:

```text
dependency_blocked
preflight_not_ready
assistant_temporarily_unavailable
provider_timeout
provider_invalid_json
schema_validation_failed
insufficient_record_written
operator_configuration_needed
internal_error
```

User-facing copy can stay sanitized, but Activity and operator diagnostics should know the category.

### Retry Diagnosis Only

If only diagnosis failed, the UI should offer:

```text
Retry procedural posture diagnosis
```

not:

```text
Run needed preparation
```

and definitely not:

```text
Force full rebuild
```

A retry should reuse current dependencies unless preflight says they became stale.

## UI Contract

Matter Overview should separate:

```text
Core Preparation
Case Analysis
```

Recommended high-level statuses:

| Surface | Possible status | Meaning |
| --- | --- | --- |
| Core Preparation | Prepared | Core workspace backbone is current. |
| Core Preparation | Needs update | Source/Story/Profile work is stale or missing. |
| Core Preparation | Blocked | A required deterministic/core dependency cannot proceed. |
| Case Analysis | Ready to run | Dependencies are current and analysis is missing. |
| Case Analysis | Needs retry | Last analysis run failed but dependencies are current. |
| Case Analysis | Not ready | Preflight says dependencies/profile/evidence are insufficient. |
| Case Analysis | Current / needs confirmation | Artifact exists; lawyer confirmation may still be pending. |

The UI should display a plan summary before or during runs:

```text
No new source files detected. Skipping extraction, Source Index, and Case Timeline.
Next: retry procedural posture diagnosis.
```

or:

```text
New source files detected. Extracting 3 new files, then checking whether Source Index, Case Timeline, Story, Profile, and diagnosis are affected.
```

## Credit, Warning, and Override Contract

Any AI-credit-consuming or destructive/overwrite-like action should declare:

- action label;
- reason;
- stages affected;
- estimated credit/cost class if available;
- artifacts that may be overwritten or archived;
- whether old output remains accessible;
- confirmation requirement.

### Default Needed Preparation

Default needed preparation can proceed when the planner identifies missing/stale work, but the UI should still show that paid AI calls may occur.

### Selected Refresh

Examples:

```text
Refresh Matter Story
Retry procedural posture diagnosis
Regenerate Case Timeline
Refresh source labels
```

Each selected refresh should carry a reason from the planner.

### Force Full Rebuild

Full rebuild should remain advanced and exceptional.

Required controls:

- explicit reason;
- `REBUILD` confirmation;
- credit warning;
- list of stages to rerun;
- archive/overwrite explanation;
- audit entry.

Suggested copy:

```text
This may consume AI credits and replace generated work products. Use only if the current preparation cannot be trusted.
```

## Implementation Plan

### Phase 0 — Record and Align

- Accept, revise, or reject this plan.
- Keep beta.112 as the current emergency fix but do not treat it as the final architecture.
- Decide whether procedural posture auto-runs after core prep or becomes an explicit Case Analysis action.

### Phase 1 — Read-Only Planner V2 Projection

Add a backend read-only planner projection without changing execution first.

The projection should expose:

- active source-set fingerprint/version;
- per-stage input basis;
- per-stage output basis;
- reasoned skip/run/block states;
- credit/overwrite flags;
- core vs analysis grouping.

Acceptance examples:

- If only diagnosis is missing, extraction/source/timeline/story are skipped with reasons.
- If no intake files changed, no upstream source work is scheduled.
- If Story is stale, Story is the next runnable step and posture is blocked downstream.
- If diagnosis failed but dependencies are current, diagnosis is `failed_retryable` and retryable alone.

### Phase 2 — UI Containment

Update Matter Overview to separate Core Preparation from Case Analysis.

Acceptance examples:

- Diagnosis provider failure does not make core preparation appear failed.
- The user sees “Core preparation complete; procedural posture diagnosis needs retry.”
- The default action does not imply full rebuild.

### Phase 3 — Execution Planner

Make **Run needed preparation** consume Planner V2 rather than ad hoc first-runnable stage selection.

Acceptance examples:

- Add Files extracts only new/unextracted active files.
- Missing diagnosis queues only diagnosis when dependencies are current.
- Stale Story queues Story with overwrite metadata, then posture only if still needed.
- Existing current stages are not requeued.

### Phase 4 — Matter Profile Discovery

Introduce Matter Profile suggestions and review/apply semantics.

Acceptance examples:

- Matter Story can continue updating brief description.
- Parties, jurisdiction, forum, and matter type are suggested with reasons/sources.
- User-entered fields are not silently overwritten.
- Overrides require a reason and are auditable.

### Phase 5 — Diagnosis Robustness

Add diagnosis preflight, evidence packet, retry-only action, and insufficient-record output.

Acceptance examples:

- Missing/stale Story blocks diagnosis before AI call.
- Missing jurisdiction/forum can produce a preflight not-ready state.
- Provider temporary failure records `assistant_temporarily_unavailable` and leaves retry-diagnosis-only available.
- Insufficient record produces a safe artifact with questions, not a hard failure.

### Phase 6 — Full Rebuild Governance

Replace the current broad advanced rebuild with a planner-backed selected-stage rebuild interface.

Acceptance examples:

- User sees exactly which stages will rerun.
- User gives a reason.
- Credit warning is visible.
- Old generated outputs are archived or otherwise recoverable.
- Audit records action, reason, actor, affected artifacts, and timestamp.

## Testing Strategy

Add tests for:

- no active intake changes -> extraction/source/timeline skipped;
- diagnosis missing -> diagnosis-only plan/action;
- diagnosis failed retryable -> retry-only action;
- diagnosis provider failure does not mark core prep failed;
- stale Story -> Story overwrite metadata and downstream posture after unblock;
- Add Files -> only added/unextracted files extracted;
- source removal/restoration -> downstream currentness reasons;
- profile suggestion does not overwrite user-entered values;
- force rebuild requires reason and confirmation;
- credit warning copy appears for paid selected refresh/full rebuild.

## Tradeoffs

### More planner complexity vs better user trust

A dependency-aware planner is more complex than a linear chain, but it prevents unnecessary AI calls and makes the app explain itself.

### Optional diagnosis vs reliable diagnosis

Moving diagnosis out of core preparation prevents it from blocking the workspace, but does not by itself make diagnosis reliable. The robustness work is still required.

### Auto-fill metadata vs lawyer control

Auto-discovering parties and jurisdiction can save time, but wrong metadata is dangerous. The safer approach is suggestions with confidence, sources, and review/override controls.

### Credit transparency vs friction

Warnings about AI credits and overwrites add friction, but they are necessary for legal-workflow trust and supervised beta cost discipline.

### Incremental reruns vs stale hidden state

Skipping upstream stages reduces unnecessary work, but only if currentness tracking is trustworthy. The planner must invest in basis fingerprints and reasoned staleness.

### First-class insufficient-record output vs perceived weakness

Allowing “insufficient record” may feel less impressive than a confident diagnosis, but it is legally safer and more useful than brittle over-inference.

## Open Questions

1. Should procedural posture diagnosis auto-run after core prep, or should it always be an explicit Case Analysis action?
2. What confidence threshold permits Matter Profile auto-fill vs suggestion-only?
3. Should credit/cost warnings show exact estimates, broad classes, or only “may consume credits” at first?
4. How should old Matter Profile suggestions be archived after later source uploads?
5. Should Matter Profile become a saved artifact, a DB projection, or both?
6. Should Case Analysis artifacts share one readiness/preflight framework?

## Recommended Next Slice

The next implementation slice should not be another one-off patch to the linear pipeline.

Recommended first slice:

```text
Planner V2 read-only projection + Matter Overview core-vs-analysis containment + diagnosis retry-only state.
```

This gives immediate product clarity while creating the backend contract needed for incremental reruns, Matter Profile discovery, and robust diagnosis.
