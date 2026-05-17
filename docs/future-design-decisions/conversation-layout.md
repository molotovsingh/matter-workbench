# Future Design Decision: Conversation Layout

Date: 2026-05-13
Status: Parked for later product decision

## Why This Exists

The Command rail has grown from a command launcher into the beginning of a
copilot-style interaction surface. It can now run deterministic commands, search
matter context, interview the user about future skill ideas, save design briefs,
and copy review packets.

That raises a layout question:

Should conversational work remain in the right rail, or should longer copilot
and skill-design sessions move into the central work area?

This is not a decision to implement immediately. The purpose of this note is to
keep the idea visible without interrupting the current skill-interview work.

## Current Layout

```text
Left: matter explorer and workspace tree
Center: matter overview, files, status, skill outputs, previews
Right: Command rail
Bottom: compact output console and status strip
```

This layout works well for:

- slash commands;
- lane navigation;
- context search;
- status checks;
- short skill idea interviews;
- copyable command reports.

The weakness is that longer legal conversations feel compressed in the rail.
Skill idea interviews, review packets, future Q&A, and strategy discussion need
more reading room than ordinary commands.

## Option A: Keep The Right Rail As The Main Conversation Surface

Keep all Command and future Copilot interactions in the right rail.

Benefits:

- preserves the current matter workspace;
- keeps the app from becoming chat-first too early;
- works well for short commands and short interviews;
- minimal layout churn.

Risks:

- longer legal reasoning is cramped;
- review packets are harder to read;
- multi-turn interactions can feel like forms inside a narrow panel;
- the central work area may feel disconnected from the conversation.

## Option B: Put Conversation In The Center

Make the central pane the primary conversation or copilot surface, with matter
context and artifacts shown elsewhere.

Benefits:

- enough space for legal reasoning, questions, answers, and packets;
- makes copilot/Q&A feel first-class;
- better for strategy discussion and longer skill-design sessions.

Risks:

- risks making the app chat-first before the foundations are ready;
- pushes matter preview/output surfaces away from the primary work area;
- could make simple commands feel heavier than necessary.

## Option C: Mode-Based Expansion

Keep the Command rail for compact command work, but allow longer interactions to
expand into the center when the user chooses or when the task clearly becomes
conversational.

Example:

```text
Normal mode:
Left explorer | Center matter/work surface | Right Command rail

Conversation mode:
Left explorer | Center conversation/interview | Right context/actions
```

This is the preferred future direction unless real usage proves otherwise.

Benefits:

- preserves the current workbench layout for ordinary work;
- gives serious legal conversations enough space;
- avoids abrupt page jumps;
- lets the user decide when to expand;
- keeps command interpretation and immediate responses in the rail.

Risks:

- more layout states to test;
- needs careful wording so users understand when they are in conversation mode;
- requires a clear return path to the matter/work surface.

## Product Rule To Preserve

Immediate responses to Command rail input should stay in the Command rail.

The central pane should change only when:

- the user explicitly opens a full result;
- the user expands a conversation;
- a skill output or file preview is intentionally opened;
- a matter/status/library view is intentionally selected.

This rule prevents the app from feeling jumpy.

## When To Revisit

Revisit this decision when at least two of these are true:

- skill idea interviews regularly exceed three turns;
- users need to read or edit long review packets in the app;
- Matter Co-pilot is added;
- strategy/pairing conversations become part of the product;
- copied interaction logs show repeated confusion about where the answer went;
- users ask for a larger conversation surface.

## Possible First Slice

Do not start with a full redesign.

Start with:

- an `Expand conversation` action in the Command rail;
- center-pane rendering for the current interview or review packet;
- right-side context/actions kept compact;
- no backend changes;
- no provider changes;
- no new memory or chat history.

The first implementation should be reversible and layout-only.

## Non-Goals

This parked decision does not authorize:

- full chat memory;
- provider-backed Q&A;
- skill generation;
- changing saved idea schemas;
- replacing the Skills governance tab;
- moving all commands into the center;
- broad responsive redesign.

The near-term product should still prefer small, reviewable slices.
