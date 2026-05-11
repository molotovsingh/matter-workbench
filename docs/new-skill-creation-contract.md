# New Skill Creation Contract

Date: 2026-05-12

Audience: main coding session for `matter-workbench`

Status: planning note only. This document records what this repo should borrow from `matter-workbench-v2` for future user-created skills. It does not add runtime behavior.

For future changes to an existing configurable skill, use
[Skill Modification Contract](skill-modification-contract.md). Creation and
modification are related, but they must not collapse into one casual chat
operation.

## Why This Exists

The current repo now has:

- built-in skill stubs under `skills/builtins/*/skill.json`;
- a backward-compatible skill registry API;
- a deterministic Command rail;
- matter context packet building;
- local context preview and context search;
- a read-only Skills tab for supervision;
- workspace lanes for Library, Workshop, Drafts, and Dispatch.

Those are the right foundations. The next risk is forgetting the v2 lesson and either:

- keeping skill creation as a developer-only JSON/code task; or
- importing the full v2 configurable-skill runtime too early.

The safe target is in between: first save a supervised idea, then build the
draft/validation ladder in separate PRs.

```text
User describes a reusable legal workflow
  -> app drafts a skill brief
  -> user confirms risky fields
  -> app checks overlap against existing skills
  -> idea is saved in a proposal inbox
  -> draft configurable skill is created later
  -> draft is run and reviewed later
  -> golden is saved later
  -> validation passes later
  -> slash command becomes active later
```

## What V2 Proves

The v2 flow is useful because it is lifecycle-based, not prompt-editing-based.

The useful sequence is:

```text
/new_skill idea
  -> inferred editable skill summary
  -> Check idea
  -> Save idea
  -> Create draft skill
  -> Test draft
  -> Save or paste golden
  -> Validate
  -> Activate
```

Important product lessons:

- **Draft first, ask only what is missing or risky.** Do not make the user walk through an eight-question form when the app can infer a good first brief.
- **Show an editable summary before save.** The user must see the proposed name, inputs, output, workflow stage, audience/tone, citation rule, matter scope, and legal setting.
- **Check overlap before saving.** The router should detect when the idea is really a modification or tuning of an existing skill.
- **Route modification separately.** If the idea is really a change to an existing configurable skill, use the draft-revision lifecycle in the Skill Modification Contract instead of creating a duplicate skill.
- **Saved idea is not runnable.** Saving a skill idea must not create a live slash command.
- **Draft skill is not active.** Draft slash commands must be blocked until the test/golden/validation ladder is complete.
- **Activation requires validation.** Legal workflow behavior should not silently become reusable without evidence that it works.

## What This Repo Should Borrow

Borrow the lifecycle, not the v2 implementation shape.

For this repo, the future flow should be:

```text
Command rail or future Unibox
  -> new skill idea
  -> skill brief draft
  -> overlap check using built-in and configurable skill stubs
  -> saved idea record
  -> draft configurable skill record
  -> draft run against active matter context
  -> golden output
  -> validation
  -> active configurable slash command
```

The current built-in skills remain code-backed and protected:

```text
/matter-init
/extract
/describe_sources
/create_listofdates
/doctor
/context_preview
/context_search
```

User-created skills must be separate configurable skills. The new-skill flow must not mutate code-backed skill stubs.

## Skill Brief Fields

The draft summary should use lawyer-readable labels but map to stable internal fields.

| User label | Internal field | Confirmation rule |
| --- | --- | --- |
| Name | `skill_name` | Editable before save |
| Reads | `source_material` | Confirm when broad or sensitive |
| Produces | `output` | Confirm for drafting or external-facing outputs |
| When to use | `workflow_stage` | Editable default is acceptable |
| Audience/tone | `audience` | Confirm for client/court/opposite-party outputs |
| Source/citation rule | `source_citation_expectation` | Always confirm |
| Matter scope | `matter_dependence` | Always confirm |
| Legal setting | `legal_setting` | Confirm for legal-document drafting or forum-specific work |

The final saved brief must contain every field. The interview can be adaptive, but the saved contract cannot be vague.

## Required Lifecycle Gates

### 1. Idea

The user may start from a future command such as:

```text
/new_skill prepare a filing bundle index
```

or from a button in a future Skills screen.

In the current repo, do not add this until the design and storage contract are accepted.

### 2. Draft Brief

The app may use AI to infer a skill brief, but the summary must be visible and editable before saving.

The app should ask only targeted questions for missing or risky fields. It should not expose internal slot names or ask the same fixed questionnaire for every idea.

### 3. Overlap Check

The app must compare the idea against:

- built-in skill stubs;
- active configurable skills;
- draft configurable skills;
- saved ideas when practical.

If the idea overlaps an existing skill, the user should be guided toward modification or tuning, not a duplicate runnable skill.

That modification path is not direct editing. It should create a draft revision
under [Skill Modification Contract](skill-modification-contract.md).

### 4. Save Idea

Saving an idea creates a proposal-like record only.

It must not:

- create an active slash command;
- write a matter artifact;
- mutate built-in skill stubs;
- mutate an active configurable skill.

### 5. Create Draft Skill

Creating a draft skill allocates a slash command and stores the draft brief.

Draft skills may appear in suggestions, but must be clearly disabled or marked as draft. If a user tries to run one through the Command rail or future Unibox, the app should say:

```text
This skill is still draft. Validate it in Skills before running.
```

### 6. Test Draft

Draft runs should use the active matter context boundary. They may call a provider only with visible provider/cost posture.

Draft output should route to the appropriate lane:

| Output type | Default lane |
| --- | --- |
| analysis, issue notes, fact gaps | `20_Workshop` |
| legal drafts, notices, applications, client emails | `30_Drafts` |
| stable source-backed reference output | `10_Library` |
| final reviewed material | `40_Dispatch` |

### 7. Golden

The user must save or paste a golden output before validation.

The golden should represent what the lawyer considers acceptable for the skill, not merely whatever the provider produced first.

### 8. Validation

Validation must check at least:

- required citations are present when the brief requires them;
- raw `FILE-NNNN pX.bY` citations resolve against the matter context used for validation;
- the output broadly matches the golden;
- required sections or output shape are present;
- unsupported legal conclusions are not silently accepted.

### 9. Activation

Only validation-passed drafts can become active.

Activation makes the configurable slash command runnable. It should not change built-in skill behavior.

## What Not To Copy Yet

Do not import the full v2 runtime in one slice.

Defer:

- full chat transcript dependency;
- `answer once` versus `make reusable` branching;
- configurable skill revision/rollback runtime, except through the separate
  [Skill Modification Contract](skill-modification-contract.md);
- overlays/profiles;
- auto-running AI-routed commands;
- provider-backed Q&A as part of skill creation;
- editing built-in skills from chat.

Those are useful later, but the first implementation should be smaller and auditable.

## First Implementation Slice

The first runtime PR should be a saved-idea/proposal inbox only:

- capture a proposed skill idea from the Command rail or Skills tab;
- run the existing skill-router overlap check as a non-executing review step;
- save the idea only after user confirmation;
- expose saved ideas in the existing read-only Skills tab;
- mark saved ideas clearly as not runnable;
- do not allocate a slash command;
- do not create draft configurable-skill records yet;
- do not add provider-backed draft running.

If an AI brief-drafting provider is added later, it must be gated and tested
with fake providers. It must not make saved ideas runnable.

## Acceptance Criteria For Future Runtime Work

- A simple filing-bundle idea produces a readable editable summary in one turn.
- The summary includes all required brief fields.
- Source/citation rule, matter scope, and legal setting are confirmed for legal drafting.
- `Check idea` is a visible action, not an internal phrase the user must type.
- `Save idea` does not create a runnable skill.
- `Create draft skill` is a later explicit step and creates a draft only.
- Draft slash commands are blocked until validation.
- Built-in skills remain immutable through this flow.
- Tests prove overlap, save, draft, block, golden, validation, and activation gates separately.
