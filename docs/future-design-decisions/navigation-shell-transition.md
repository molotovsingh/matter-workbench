# Navigation Shell Transition

Date: 2026-06-21
Status: First production shell slice landed; Matter Assistant remains protected
Priority: High for beta polish

## 2026-07-11 Folder Tree Update

The shell/navigation direction remains current, but the Matter Record folder tree labels from the prototype are superseded. The tree now shows canonical folder names exactly:

```text
00_Inbox
10_Library
20_Workshop
30_Drafts
40_Dispatch
```

Do not reintroduce `Case Record`, `Source Record`, `Case Analysis`, `Drafts`, or `Ready to Send` as folder-tree aliases. Command aliases and non-folder-tree copy are separate.

## Context

The current production React shell works, but the left navigation and matter record areas feel split across too many surfaces. A visual prototype was iterated at:

```text
https://mwb-beta.139.59.74.9.sslip.io/prototype/nav-shell-final
```

Latest reviewed prototype commit:

```text
95a170d Tighten final nav prototype from morning review
```

This document records the product decision and the guardrails for the production shell transition. The first production shell/layout slice has landed; further changes still need to preserve the guardrails below.

## Accepted Prototype Direction

The final-candidate prototype direction is:

1. Use a black left rail as the stable workspace anchor.
2. Put the active matter and Matter Record in that black rail.
3. Push app-global navigation below the matter-specific record.
4. Rename the old "Find matter" affordance to **All matters**.
5. Keep Matter Home as the main center workspace.
6. Make Matter Story scrollable, because story length depends on matter complexity.
7. Keep Matter Assistant on the right and preserve its current functionality.

## Target Layout

```text
BLACK RAIL
Matter Workbench

Active matter
- Matter Home card

Matter Record
- Add files
- Refresh
- Show technical   [operator only]
- 00_Inbox
- 10_Library
- 20_Workshop
- 30_Drafts
- 40_Dispatch

App
- All matters
- New matter
- Skills
- Activity
- Settings
```

```text
CENTER WORKSPACE
Top quiet status strip

Matter Home
- matter title
- Prepare matter
- Write Matter Story
- Create List of Dates
- scrollable Matter Story card
- Matter details
- preparation/advisory cards as current product requires
```

```text
RIGHT RAIL
Matter Assistant
- current New task reset
- current model/quality control where operator-visible
- current ask/run input
- current command routing
- current active matter context
- current recent activity/status behavior
```

## Non-Negotiable Guardrails

### Matter Assistant is protected

The first production transition must not redesign or rewrite Matter Assistant behavior.

Do not change:

- ask/run input behavior;
- active matter context passed into assistant answers;
- command routing;
- custom skill/session routing;
- New task reset behavior;
- recent activity display behavior;
- operator-only model/quality controls;
- assistant error and readiness copy;
- source-backed answer semantics.

Visual fitting is allowed only if it does not alter behavior.

### Technical files remain operator-only

Default Matter Record must not show technical files such as `matter.json`, extracted JSON, logs, or receipts to normal beta users.

Rules:

- **Show technical** is operator-only.
- Technical rows remain hidden by default.
- Lawyer-facing users see curated record groups, not raw filesystem internals.

### All matters is the escape/open-another-matter affordance

Use **All matters** for the old "Find matter / leave current matter / choose another matter" behavior.

Minimum tooltip/helper copy:

```text
See all matters or open another matter
```

### Story card scrolls

Matter Story is allowed to grow with matter complexity, but the Matter Home header/actions should remain easy to reach.

Minimum behavior:

- story body scrolls inside the story card;
- a full durable story document can still be opened later;
- original intake note and MW provenance rules from [Matter Story Lifecycle](matter-story-lifecycle.md) still apply.

## Assistant Rail Hardening Follow-Up

After Research mode, visible threads, and receipts landed, the Matter Assistant
rail became more than a simple command box. The accepted follow-up hardening is:

- the right Matter Assistant rail may be resized by the user;
- width is a browser-local preference, not a server/user profile setting;
- the header should stay compact: `Matter Assistant`, `New`, and operator-only
  model selector where visible;
- remove large decorative header copy such as `What do you need?` when it causes
  cramped wrapping;
- keep `Skill | Ask | Research` explicit and easy to reach;
- do not change command routing, source-backed answer behavior, or provider
  policy as part of this visual hardening.

## Production Slice Boundary

The first implementation slice is a shell/layout refactor only.

Landed:

- moved black rail layout into the production React shell;
- moved Matter Record controls into the left rail;
- renamed Find matter to All matters;
- widened/rebalanced center workspace width;
- made Matter Story card scrollable;
- reused existing file tree/action handlers;
- preserved existing Matter Assistant component behavior.

Not allowed in the first slice:

- rewrite Matter Assistant internals;
- change command routing or assistant answer flow;
- change matter/file/workflow APIs;
- change storage schema;
- expose technical files to non-operators;
- introduce new provider/model behavior;
- introduce chat memory or multi-turn answer semantics.

## Required Tests Before Production Merge

Current tests prove:

1. Activity/brand click returns to Matter Home without clearing active matter.
2. **All matters** opens the matter browser / clear-current-matter path intentionally.
3. Active matter remains selected after navigating among Matter Home, Skills, Activity, and back.
4. Matter Record renders Add files and Refresh for active matters.
5. Show technical is only visible for operator/superuser surfaces.
6. Technical files are hidden by default.
7. Matter Assistant still renders.
8. Matter Assistant ask/run input still renders.
9. Matter Assistant receives active matter context.
10. Matter Assistant New task reset remains available.
11. User-facing copy does not leak provider/API/billing/quota language.

## Manual Acceptance Checklist

Before enabling the production shell for beta users, manually verify:

- open app with no active matter;
- open an existing matter;
- click Matter Home card;
- click All matters and open another matter;
- add files;
- refresh Matter Record;
- operator toggles Show technical;
- non-operator cannot see Show technical or technical files;
- run Prepare matter;
- run/write Matter Story;
- ask Matter Assistant a matter question;
- start a New task in Matter Assistant;
- navigate to Skills and back without losing active matter unexpectedly.

## Stop Rule

If any Matter Assistant behavior changes or becomes uncertain during implementation, stop and revert the assistant-related part. The shell can ship later; assistant behavior must remain trusted.
