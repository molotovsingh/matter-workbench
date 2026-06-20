# Future Design Decision: Matter Story Lifecycle

Date: 2026-06-20
Status: Current local contract / first Story lifecycle slice landed

## Why This Exists

Matter Workbench needs a simple matter landing-page explanation that helps a
lawyer understand the case before they have read every file. The first intake
description typed during matter creation is often rough, incomplete, or based on
what the client/operator knew before preparation.

The List of Dates is the first prepared spine of the matter. Once it is current,
Matter Workbench can generate a short matter story from that spine and place it
where the lawyer first lands.

## Product Rule

The Story is downstream of the current List of Dates:

```text
Source files / extraction / source labels
↓
10_Library/List of Dates.md and .json current
↓
20_Workshop/The Story.md and .json refreshed
↓
Matter Overview displays Matter Workbench story
```

The Story is not a lawyer-approved filing draft. It is Matter Workbench's
prepared understanding of the matter, based on the current List of Dates.

## Output Custody

The durable work products remain:

```text
20_Workshop/The Story.md
20_Workshop/The Story.json
matter.json.brief_description
matter.json.brief_description_source
matter.json.original_intake_note
```

`20_Workshop` is the correct lane because The Story is case understanding, not a
lawyer-editable draft and not Ready to Send material.

## Matter Overview Presentation

Matter Overview should show the Matter Workbench story before the raw matter
metadata card when an MW-authored story exists.

Visible provenance should be simple and app-owned:

```text
Author: MW
Based on: Current List of Dates
```

Do not show model, provider, API, billing, quota, or prompt language to normal
users.

The visible story should progress from simple to more analytical:

1. At a glance
2. What this matter is about
3. Key dispute
4. Procedural posture
5. Main risks and missing facts

Risks and missing facts belong at the end of the story. A future matter landing
page may also show a separate risk card or matter-completeness chart, but that
is not part of this first slice.

## Original Intake Note

If a user/operator supplied a description at matter creation, preserve it as the
original intake note when MW first writes the story:

```text
original_intake_note = previous brief_description
brief_description = Matter Workbench story
brief_description_source.author = MW
```

The original note is secondary after preparation. It may be shown below the MW
story, collapsed by default. It is not the prepared case spine.

## Refresh Rule

When List of Dates changes after The Story was written, The Story becomes stale.
The next preparation pass should refresh it and update the Matter Overview story.
No approval gate is required because this is MW-authored case understanding, not
a dispatched or lawyer-final document.

When an MW story is already current, preparation should skip `/the_story`.
When a raw intake description exists but no MW story exists, preparation should
run `/the_story` after List of Dates is current.

## Source Boundary

The Story should treat the current List of Dates as its primary source. Source
Index and matter metadata may help names, roles, document labels, and procedural
context. It should not independently invent new facts from raw documents in a
way that drifts from the List of Dates spine.

## Non-Goals

- No deployment change by this note.
- No court-facing draft generation.
- No Ready to Send promotion.
- No lawyer approval workflow for the MW story.
- No matter-completeness pie chart in this slice.
- No separate risk dashboard in this slice.

## Implementation Pointers

Current implementation points:

- `services/matter-story-service.mjs`
- `services/prepare-matter-service.mjs`
- `services/runtime-db-preparation-read-model.mjs`
- `services/runtime-db-storage-service.mjs`
- `react-ui/src/views/MatterOverview.tsx`
- `react-ui/src/lib/autoPreparationRunner.ts`

The accepted first slice landed on the post-Beta-3 branch in commit
`b434ac9 Refresh Matter Story after chronology finalization`.
