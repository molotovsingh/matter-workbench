# Future Design Decision: Skill Workspace UX

Date: 2026-06-14
Status: Working product note

## Decision

Skill creation and skill modification should not live inside the command box
after intent is detected.

The command box should start or invoke skill work. The Skills page should own
the stateful skill-building workspace.

In short:

```text
Command box = quick intent and quick invocation
Skills page = build, continue, preview, approve, manage
```

## Why This Exists

The current skill flow can feel jumpy:

- the user starts in the command box;
- the interview appears in the assistant rail;
- saved ideas appear on the Skills page;
- sample preview appears back in the rail;
- approval or validation errors appear in the rail;
- the final runnable skill appears in a different Skills-page section.

The mental object is "my skill", but the UI keeps moving that object between
surfaces.

That violates the North Star design principle:

```text
simple surface, rigorous spine
```

The rigorous spine is correct: skill ideas, interviews, sample output, approval,
validation, versioning, and lifecycle controls are all real governance steps.
The problem is the user-facing home for those steps.

## Product Split

### Command Box

The command box should remain the fast, lightweight entry point.

It is for:

- one-off Copilot questions;
- running a known skill by slash or name;
- starting skill creation from natural language;
- starting skill modification from natural language.

It should not be the place where long interviews, sample previews, approval,
validation, or lifecycle management happen.

When it detects a skill-creation or skill-modification intent, it should hand
off clearly:

```text
Let's build this skill. Continue on the Skills page.
```

### Skills Page

The Skills page should become the stateful workspace for one skill at a time.

It should own:

- current skill idea or modification;
- interview questions and answers;
- inferred intent;
- suggested skill names;
- sample output;
- approval;
- validation result;
- created skill;
- pause, resume, archive, restore, and delete controls.

It should support "continue where you left off" for saved skill ideas and
in-progress skill modifications.

### Matter Page

The matter page remains for matter preparation, advisory, source record, List of
Dates, and matter outputs.

Skill creation may use a selected matter for sample output, but the matter page
should not become the skill factory.

### Activity

Activity remains the receipt and failure surface.

It should explain what happened, but it should not become the main place to
continue skill creation.

## Skill Creation Flow

Preferred flow:

1. User types `new skill` or describes a reusable workflow in the command box.
2. The app detects skill intent.
3. If no matter is selected, the app asks the user to select a matter before
   continuing.
4. The app opens the Skills page with a visible `Skill in progress` workspace.
5. The interview happens on the Skills page.
6. The final interview question asks what the user would like to name the skill.
7. Name suggestions are generated from the inferred intent, not from a crude
   mechanical text transformation.
8. Sample output appears on the Skills page.
9. The user approves or revises there.
10. The created skill moves into `Your Skills`.

## Skill Modification Flow

Preferred flow:

1. User says something like `improve The Story...` in the command box, or clicks
   `Modify` from the Skills page.
2. The app identifies the target skill.
3. The app opens the Skills page with a modification workspace for that skill.
4. The user confirms the change intent and answers any missing questions.
5. The app generates a sample or preview for the revised skill.
6. The user approves the change.
7. The revised skill is activated through the existing governed version path.

Modification should feel familiar to a user, but it must remain governed. It is
not a casual prompt edit.

## Running Skills

Skills should be runnable from both places:

- **Command box:** fastest route for repeat users who know the skill name.
- **Skills page:** safer discovery route for users who want to browse,
  understand, inspect status, or manage the skill.

The command box is a power shortcut. The Skills page is the canonical home.

## Matter Selection Rule

Skill creation should require a selected matter before the user reaches the
sample/approval stage.

Reason: sample output, validation, and user confidence depend on a concrete
matter. Without a selected matter, the user can finish an interview and then
feel as if the idea disappeared or dead-ended.

The app should make the requirement explicit early:

```text
Pick a matter first so we can test the skill on real matter material.
```

This is a UX rule, not a weakening of skill governance.

## Naming Rule

The last interview question should be:

```text
What would you like to name this skill?
```

The app should offer 2-3 suggestions based on the inferred legal task and output
shape.

Good suggestions are intent-aware:

- `Limitation Risk Review`;
- `Client Update Email`;
- `Filing Route Plan`;
- `Issue Discovery Note`.

Bad suggestions are mechanical:

- `review_limitation_risk_for_a_consumer_complaint`;
- `Skill 1`;
- `New Skill`;
- `discover_issues` without context.

## Non-Goals

This note does not propose:

- turning the Skills page into a general chat interface;
- removing the command box;
- weakening sample approval or validation;
- allowing silent prompt mutation;
- changing native-skill ownership;
- changing Copilot memory behavior;
- removing Activity receipts.

The Skills page should feel stateful, but scoped. It is a guided skill-building
workspace, not open-ended chat.

## Implementation Direction

When implemented, the first slice should be presentation and flow ownership:

- command box starts skill creation/modification, then navigates to Skills;
- Skills page renders a focused `Skill in progress` workspace;
- saved ideas have visible `Continue` actions;
- sample preview and approval happen on the Skills page;
- command rail remains available for Copilot and quick skill runs;
- existing backend governance stays intact.

Do not rewrite the skill governance spine merely to move the UI.

## Relationship To Contracts

This note must stay aligned with:

- [Matter Workbench North Star Design Philosophy](../design-philosophy.md);
- [Custom Skill Governance](../contracts/custom-skill-governance.md);
- [Model Task Boundaries](../contracts/model-task-boundaries.md);
- [Copilot Q&A](../copilot-qna-contract.md).

If there is a conflict, the contracts win. This note describes the preferred
user-facing home for the governed skill flow.
