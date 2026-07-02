# Ambient Job Feedback and Activity Surface

Date: 2026-07-02
Status: Working product note / UX contract draft

## Problem Statement

Long-running Matter Workbench jobs can feel silent even when the backend is doing the right thing. If a user starts a preparation job and the interface looks still, the user may reasonably think nothing happened, the click was missed, the app is frozen, or they should click other controls again.

The product problem is not only missing status text. It is missing *felt responsiveness*: the user should immediately sense that something is cooking, while still having one clear durable place to inspect and recover the job.

At the same time, Matter Workbench should avoid showing duplicate primary actions for the same intent in multiple places. A user should not have to decide whether a preparation row, an Activity card, a toast, or a command rail is the “real” place to manage a running diagnosis.

## Product Goal

Make long-running work visibly alive without creating a second workflow surface.

The user should experience:

1. Immediate acknowledgement that the job started.
2. A persistent row-level state that says what is happening.
3. A small ambient signal that the system is still working.
4. A transient toast when lifecycle transitions occur.
5. A full audit trail only when the user or operator chooses to inspect it.

## Surface Roles

| Surface | Role | Should do | Should not do |
| --- | --- | --- | --- |
| Matter Preparation row | Durable workflow control and truth | Own primary actions, currentness, running/failed state, retry affordance | Compete with Activity for the same primary action |
| Middle-pane recent activity strip | Ambient liveness ticker | Show the latest one or two job lines; reassure that work is active | Become a full activity manager or receipt browser |
| Toast | Lifecycle transition signal | Announce started/completed/failed moments | Be the only place where failure recovery exists |
| Activity page | Audit and recovery archive | Show durable receipts, stages, errors, and operator evidence | Pull the user away from the row for ordinary workflow decisions |

## Proposed Interaction Model

### On job start

When the user clicks a row action such as **Run saved Procedural Diagnosis**:

- the button should immediately become disabled or running-state aware;
- the row status should move to **Running** without waiting for a later refresh;
- a toast should say the job started;
- the middle-pane activity strip should show the active job.

Example copy:

```text
Started Procedural Diagnosis
```

Recent activity strip:

```text
Working on Procedural Diagnosis
Preparing diagnosis from the current Case Timeline
```

### While job is active

The interface should remain visibly alive even if no meaningful stage text changes for 30-60 seconds.

A lightweight animated “zinger” is acceptable here: a subtle left-to-right / right-to-left sweep, shimmer, moving underline, or pulsing dot around the active recent-activity line or active preparation row.

The animation should communicate liveness, not fake precision. Do not show a percentage unless the system has a real bounded denominator.

### On completion

The row should return to the saved artifact/currentness state after refresh, and a toast should confirm completion.

Example copy:

```text
Procedural Diagnosis completed
```

Recent activity strip:

```text
Completed Procedural Diagnosis
Saved to Matter Workshop
```

### On failure

The row should own the ordinary failure state and retry path.

Example copy:

```text
Procedural Diagnosis failed — retry from Matter Preparation
```

Activity remains available for receipt detail, stage attribution, and operator evidence, but it should not be presented as a competing main route for the same user intent.

## MECE Rule

One user intent should map to one primary surface.

For preparation work:

```text
Run / retry / inspect current preparation state -> Matter Preparation row
Feel that something is happening -> middle-pane activity strip + liveness animation
Know a lifecycle transition happened -> toast
Audit what happened in detail -> Activity page
```

## Design Constraints

- Keep observability metadata-only for private beta surfaces.
- Do not expose work product, source text, provider prompts, or secrets in ambient activity/toast copy.
- Keep Activity durable and accurate, but demote it from primary workflow control for ordinary preparation actions.
- Avoid fake progress. Prefer truthful stage names, queued/running/completed/failed states, and liveness animation.
- Do not make transient toasts the only place to discover or recover a failure.

## Open Questions

1. Should the two-line recent activity strip live in the center/middle pane globally, or only on Matter Overview?
2. Should the liveness zinger attach to the active preparation row, the middle activity strip, or both?
3. How long should completed items remain in the two-line strip before they roll off?
4. Should failed jobs pin in the strip until the user sees the row, or should only the row pin failures?
5. Should Activity page retry actions remain visible inside expanded receipts, or be hidden for preparation jobs to keep row ownership strict?

## Initial Recommendation

Adopt the row-owned workflow model first. Add a compact middle-pane recent activity strip with only one or two visible lines, then add lifecycle toasts and a subtle non-percent liveness zinger for active jobs.

This should make the app feel alive during long-running diagnosis/preparation work without reintroducing duplicate workflow control surfaces.
