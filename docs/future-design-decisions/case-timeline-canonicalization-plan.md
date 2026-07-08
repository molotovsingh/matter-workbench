# Case Timeline Canonicalization Plan

Date: 2026-07-08
Status: Implementation contract draft — prerequisite cleanup before MW List of Dates

## Purpose

This plan fixes the naming debt around the current neutral chronology before implementing the new MW List of Dates.

The accepted product decision is **not** to replace the existing root lane model with new root folders like `Case Record`, `Source Record`, `Timeline`, or `Analysis`. The original lane model remains useful and should stay canonical:

```text
10_Library
20_Workshop
30_Drafts
40_Dispatch
```

The real debt is narrower:

```text
10_Library/List of Dates.*
```

is now product-conceptually:

```text
10_Library/Case Timeline.*
```

This rename should happen first, before MW List of Dates, because otherwise MW LoD will inherit and amplify the old ambiguity between neutral chronology and advocacy/court-facing List of Dates.

## Canonical Lane Model

Keep the root folders.

| Root folder | Canonical meaning | What belongs there |
| --- | --- | --- |
| `10_Library` | Source-backed reference shelf / matter record outputs | Source Index, source labels, extracted record, **Case Timeline** |
| `20_Workshop` | MW working analysis area | Matter Story, procedural posture diagnosis, Case Analysis Q&A, MW List of Dates |
| `30_Drafts` | Lawyer-shaped draft documents | petitions, replies, notices, counsel notes, draft filing text |
| `40_Dispatch` | Final/sendable/file-ready boundary | filing copies, final bundles, dispatch-ready PDFs |

Do not introduce new top-level folders for this cleanup.

Rejected for now:

```text
Case Record/
Source Record/
Timeline/
Analysis/
```

Reason: those names add root-folder clutter and may be less user-friendly than the existing Library / Workshop / Drafts / Dispatch metaphor.

## Canonical Artifact Structure

Target structure:

```text
matter root/
  matter.json

  10_Library/
    Source Index.json
    Case Timeline.md
    Case Timeline.json
    Case Timeline.csv

  20_Workshop/
    The Story.md
    Case Analysis/
      Filing and Procedural Posture Diagnosis.md
      Filing and Procedural Posture Diagnosis.json
      Case Analysis Q&A.md
      MW List of Dates.md
      MW List of Dates.json
      archive/

  30_Drafts/

  40_Dispatch/
```

Legacy structure to support during migration:

```text
10_Library/List of Dates.md
10_Library/List of Dates.json
10_Library/List of Dates.csv
10_Library/List of Dates Candidates.json
```

## Naming Rule

Use one canonical vocabulary inside new code:

| Layer | Canonical name |
| --- | --- |
| Product concept | Case Timeline |
| Artifact kind | `case_timeline` |
| Operation key | `create_case_timeline` |
| Stage id | `case-timeline` |
| Visible action | Build / Refresh Case Timeline |
| Canonical artifact paths | `10_Library/Case Timeline.*` |

Legacy names remain only as compatibility shims:

| Legacy | Compatibility behavior |
| --- | --- |
| `/create_listofdates` | Hidden/operator/legacy alias; normalize to `create_case_timeline`. |
| `/api/create-listofdates` | Backward-compatible route alias; normalize to canonical route/service. |
| `create-listofdates` stage id | Read/normalize only; new plans/stages use `case-timeline`. |
| `10_Library/List of Dates.*` | Reader fallback and one-time migration source. |
| `list_of_dates` artifact kind/schema | Reader compatibility only until schema migration is explicitly done. |

## Migration Strategy

Do the migration in two layers, one after the other, in a worktree.

### Layer 1 — artifact/folder canonicalization

Goal:

```text
new writes -> 10_Library/Case Timeline.*
readers -> prefer Case Timeline.*, fallback to List of Dates.*
```

Tasks:

1. Add centralized artifact path constants, e.g.:

   ```text
   CASE_TIMELINE_MARKDOWN_RELATIVE = "10_Library/Case Timeline.md"
   CASE_TIMELINE_JSON_RELATIVE = "10_Library/Case Timeline.json"
   CASE_TIMELINE_CSV_RELATIVE = "10_Library/Case Timeline.csv"
   CASE_TIMELINE_CANDIDATES_RELATIVE = "10_Library/Case Timeline Candidates.json"

   LEGACY_LIST_OF_DATES_MARKDOWN_RELATIVE = "10_Library/List of Dates.md"
   LEGACY_LIST_OF_DATES_JSON_RELATIVE = "10_Library/List of Dates.json"
   LEGACY_LIST_OF_DATES_CSV_RELATIVE = "10_Library/List of Dates.csv"
   LEGACY_LIST_OF_DATES_CANDIDATES_RELATIVE = "10_Library/List of Dates Candidates.json"
   ```

2. Replace inline `10_Library/List of Dates.*` reader code with registry lookups.

3. Update chronology writers to write canonical Case Timeline paths.

4. Update Matter Story and posture diagnosis readers to prefer canonical Case Timeline paths and fallback to legacy.

5. Update runtime DB persistence tests and helpers to persist/read canonical paths.

6. Add tests for:
   - new matter writes canonical Case Timeline paths;
   - old matter with only legacy List of Dates paths still works;
   - if both exist, canonical wins;
   - label-only refresh writes canonical path when possible;
   - runtime DB mode handles canonical and legacy paths.

7. Decide migration behavior for existing local matters:
   - first safe default: read legacy, write canonical on next regeneration;
   - optional later command: migrate/copy legacy artifacts to canonical paths.

Layer 1 should not rename commands, routes, or skill IDs yet except where tests need labels.

### Layer 2 — operation/command canonicalization

Only after Layer 1 passes.

Goal:

```text
canonical operation -> create_case_timeline
canonical stage id -> case-timeline
legacy slash/API accepted but hidden
```

Tasks:

1. Add canonical operation key and stage id.
2. Update preparation planner/stages to emit `case-timeline` / `create_case_timeline`.
3. Update route/API internals to use canonical naming.
4. Keep old API and slash aliases accepted at boundary only:

   ```text
   /create_listofdates -> create_case_timeline
   /api/create-listofdates -> /api/case-timeline
   create-listofdates -> case-timeline
   ```

5. Remove old command from normal lawyer-facing slash suggestions.
6. Add tests proving legacy inputs normalize to canonical outputs.

## Worktree Plan

Use a separate worktree because this is broad and can break runtime DB, preparation, and artifact readers.

Suggested setup:

```bash
git worktree add ../matter-workbench-case-timeline-canonical \
  -b feature/case-timeline-canonical-rename HEAD
```

Suggested commit sequence:

```text
1. Centralize Case Timeline artifact paths
2. Write Case Timeline artifacts to canonical paths
3. Add legacy List of Dates fallback readers
4. Canonicalize Case Timeline operation/stage naming
5. Hide legacy List of Dates slash from ordinary invoke list
```

Keep MW List of Dates implementation out of this worktree until the canonicalization passes.

## UI Behavior

User-facing behavior after migration:

```text
Home / Matter Overview row:
  Case Timeline
  Build / Refresh Case Timeline

Automatic preparation:
  builds Case Timeline

Command panel:
  does not advertise /create_listofdates
```

Legacy/operator behavior:

```text
Typing /create_listofdates still works for compatibility.
```

## Backend Behavior

New internal code should not talk about List of Dates for the neutral chronology except in legacy compatibility modules/tests.

Allowed legacy locations:

- migration/fallback readers;
- route/command normalization tests;
- release notes/history;
- compatibility constants.

Not allowed in new code:

- new stage ids;
- new operation keys;
- new artifact paths;
- new user-facing labels;
- MW List of Dates implementation internals.

## Relationship To MW List of Dates

MW List of Dates should be built only after this cleanup or against the canonicalized API/path registry.

Reason:

```text
10_Library/Case Timeline.*
  -> neutral source-backed timeline

20_Workshop/Case Analysis/MW List of Dates.*
  -> advocacy-aware Case Analysis derivative
```

This makes the distinction visible in the actual matter folder structure and prevents MW LoD from depending on `List of Dates` as a hidden alias for a neutral timeline.

## Test Plan

Minimum validation after Layer 1:

```bash
npm test --silent
npm run ui:typecheck --silent
git diff --check
```

Focused tests to add/update:

- Case Timeline artifact writer tests.
- Matter Story reads canonical Case Timeline.
- Procedural diagnosis reads canonical Case Timeline.
- Runtime DB persistence of canonical Case Timeline files.
- Legacy `List of Dates.*` fallback tests.
- Workspace tree displays canonical Case Timeline files for new runs.

Minimum validation after Layer 2:

- preparation planner tests emit `case-timeline` stage;
- old `/create_listofdates` route/slash still works;
- ordinary slash invoke list hides old command;
- runtime preparation job kind maps canonical operation to `case_timeline`;
- row actions still build/refresh Case Timeline.

## Acceptance Criteria

The canonicalization is complete when:

1. New runs write `10_Library/Case Timeline.md/json/csv`.
2. Existing matters with only `10_Library/List of Dates.*` still load.
3. Case Timeline is runnable automatically and from the Home / Matter Overview row.
4. Ordinary users are not asked to choose `/create_listofdates`.
5. Internal new code uses `case_timeline` / `create_case_timeline` / `case-timeline`.
6. Legacy names are confined to boundary compatibility and migration/fallback code.
7. MW List of Dates can safely depend on `10_Library/Case Timeline.*` as its neutral source spine.
