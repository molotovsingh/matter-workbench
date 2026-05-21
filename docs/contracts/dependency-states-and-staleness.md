# Dependency States And Staleness

Status: Current canonical contract

This contract defines how Matter Workbench distinguishes cheap presentation
refreshes from legal chronology review and full AI regeneration.

The core rule is:

```text
stale is a UI warning
dependency_state explains what kind of action is needed
```

Do not collapse every changed input into "rerun AI."

## Why This Exists

Source-backed legal artifacts depend on earlier matter preparation steps.

For List of Dates, the key upstream dependency is Source Labels / Document
Index. When that upstream record changes, the app must decide whether the
existing chronology can be safely re-rendered, should be lawyer-reviewed, or
needs a fresh chronology generation.

That distinction matters because:

- label-only changes should be cheap and low-risk;
- source metadata changes may affect legal judgment but not always require a
  full model rerun immediately;
- document content changes can invalidate chronology reasoning;
- paid AI reruns should be deliberate, not automatic cost-saving guesses or
  blanket reactions.

## Current Scope

This contract currently governs List of Dates dependency handling.

It may later be generalized to other source-backed artifacts, but do not assume
that every artifact has the same dependency semantics.

Current code constants live in:

- `shared/listofdates-dependency-states.mjs`;
- `frontend/listofdates-dependency-state.js`;
- `services/listofdates-dependency-state.mjs`.

## State Strings

The canonical state strings are:

```text
label_refresh_needed
chronology_review_needed
chronology_regeneration_needed
```

These strings are API/UI contract values. Do not rename them without a migration
plan and test updates.

## `label_refresh_needed`

Use this when the source set and material source facts are unchanged, but
lawyer-facing labels changed.

Typical cause:

- Source Index label text changed;
- short label changed;
- confirmed label changed;
- display wording improved;
- raw source identity and content hash still match the chronology snapshot.

Expected behavior:

- do not call the chronology model;
- re-render the existing List of Dates with current labels;
- preserve raw citations and chronology rows;
- keep the result tied to the same source snapshot;
- show this as a cheap refresh path, not a legal reasoning rerun.

## `chronology_review_needed`

Use this when source metadata changed in a way that may affect how a lawyer
understands the chronology, but the source set/content has not clearly changed.

Typical cause:

- document type changed;
- document date changed;
- source `needs_review` changed;
- Source Index is missing or incomplete;
- chronology snapshot is too weak to prove a label-only refresh is safe.

Expected behavior:

- warn the user that source metadata changed;
- ask the lawyer to review before relying on the existing chronology;
- allow deliberate regeneration when appropriate;
- do not pretend label refresh is enough.

This is a judgment-warning state. It is not automatically the same as a full AI
rerun, but regeneration may be the correct action.

## `chronology_regeneration_needed`

Use this when source content or the document set changed in a way that can
invalidate chronology reasoning.

Typical cause:

- new source file added to the Source Index;
- a source file was removed;
- source content hash changed;
- extraction record changed materially;
- newer non-Source-Index inputs exist;
- a chronology source snapshot cannot be matched to the current source set.

Expected behavior:

- warn that the chronology may not reflect current source material;
- prefer a full List of Dates regeneration before downstream drafting;
- preserve the old output until the user deliberately regenerates or full
  preparation reruns it;
- do not silently rewrite final or dispatched artifacts.

## Relationship To `stale`

`stale` is an umbrella UI/rerun-advice condition.

The dependency state explains the action class underneath it:

| UI condition | Dependency state | Meaning |
| --- | --- | --- |
| `stale` | `label_refresh_needed` | Cheap re-render should be enough. |
| `stale` | `chronology_review_needed` | Review source metadata and decide whether to regenerate. |
| `stale` | `chronology_regeneration_needed` | Rebuild chronology from current source material. |

UI copy should not use a generic stale warning when a more precise dependency
state is available.

## Relationship To Source Identity

Dependency decisions are only reliable if source identity is stable.

Use raw source identity and snapshots for decision-making:

- `file_id`;
- content hash / `sha256`;
- source path where relevant;
- document type;
- document date;
- review flags.

Do not use lawyer-facing labels as proof that source content is unchanged.

See [Source Identity And Labels](source-identity-and-labels.md).

## Relationship To Artifact Visibility

A dependency warning does not make an old artifact disappear.

The app should preserve prior artifacts, show a clear warning, and only replace
or refresh them through the appropriate workflow.

Dispatched copies are frozen. If a dependency state changes after dispatch, the
app may show provenance/advisory information, but it must not silently update
the dispatched copy.

See [Artifact Visibility And Dispatch](artifact-visibility-and-dispatch.md).

## Non-Goals

- This contract does not define every rerun-advice state.
- This contract does not define sample/skill-design staleness.
- This contract does not require hard-blocking downstream drafting.
- This contract does not authorize silent paid AI reruns.
- This contract does not rename current API strings.

## Implementation Pointers

Current code and tests connected to this contract include:

- `shared/listofdates-dependency-states.mjs`;
- `services/listofdates-dependency-state.mjs`;
- `services/matter-rerun-advice-service.mjs`;
- `services/listofdates-label-refresh-service.mjs`;
- `frontend/listofdates-dependency-state.js`;
- `frontend/views/matter-overview.js`;
- `react-ui/src/views/MatterOverview.tsx`;
- `test/frontend-dependency-state.test.mjs`;
- `test/listofdates-label-refresh.test.mjs`;
- `test/matter-overview.test.mjs`.
