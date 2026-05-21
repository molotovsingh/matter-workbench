# New Skill Creation Contract

Date: 2026-05-12

Audience: main coding session for `matter-workbench`

Status: planning note only. This document records what this repo should borrow from `matter-workbench-v2` for future user-created skills. It does not add runtime behavior.

For future changes to an existing configurable skill, use
[Skill Modification Contract](skill-modification-contract.md). Creation and
modification are related, but they must not collapse into one casual chat
operation.

The first proposed runtime candidate is documented separately in
[Client Update Email Skill Contract](client-update-email-skill-contract.md).
That contract is intentionally design-only until the runtime, rerun guard,
model policy, and review boundaries are implemented.

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

The product end-state is simpler than the current development vocabulary:

```text
I described the skill.
I approved a sample output.
Now I can use the skill.
```

Implementation briefs, handoff packs, proposal packets, readiness gates, and
coder notes are useful while building the system. They are not the lawyer-facing
end-state.

The safe implementation target is still staged: first build the sample-review
loop, then the configurable runtime foundation, then automatic build and
activation from an approved sample. But the user-facing language should aim at
the direct product flow above, not at developer handoff.

## Critical Truth Rule

Never tell the user:

```text
You can use /<skill_name>
```

unless the skill is actually runnable.

That means the backend must already have:

- created a configurable skill definition;
- registered the slash command;
- stored the approved sample/reference;
- generated or stored the prompt/config;
- passed required validation;
- activated the skill;
- made the command visible in Skills and Command rail suggestions.

Until that runtime exists, the only truthful approval message is:

```text
Sample approved.
Skill creation is not available yet.
```

## End-State Lawyer Flow

The intended product flow is:

```text
new skill
  -> describe idea
  -> answer adaptive questions
  -> choose test matter
  -> generate sample output
  -> revise sample until it feels right
  -> approve sample
  -> app creates and activates the skill
  -> user sees: You can use this skill with /<skill_name>
```

Detailed UX:

1. The user types `new skill`.
2. The app asks: `Tell me what skill you want to build.`
3. The user describes the workflow in normal language.
4. The app asks legally relevant adaptive questions.
5. The app asks for a test matter.
6. The app generates a sample output in the central pane.
7. The user gives feedback in the Command rail.
8. The app regenerates the sample. This may repeat through `Sample v1`,
   `Sample v2`, `Sample v3`, and so on.
9. The user clicks `Looks right`.
10. The app confirms: `Create this skill?`
11. The app creates, validates, and activates the configurable skill.
12. The final screen says:

```text
Skill Ready

You can use this skill by typing:

/<skill_name>
```

This final screen is allowed only after real runtime activation.

## Lawyer-Facing Language

Avoid these terms in the main skill-builder flow:

```text
implementation brief
handoff pack
coder
proposal
readiness
activation
schema
prompt config
MECE
router
```

Those words may appear in internal docs, tests, debug reports, or developer
surfaces. They should not be the ordinary lawyer-facing path.

Use:

```text
Skill request
Sample output
Make changes
Looks right
Create skill
Skill ready
Use /<skill_name>
```

## Near-Term Staged Path

### Stage 1: Product Contract

This document is the contract update. It records that the end-state is
sample-approved skill creation, not developer handoff.

### Stage 2: Sample Output Review Loop

Before building runnable skills, add:

- choose test matter;
- generate sample output;
- show the sample in the central pane;
- accept feedback;
- regenerate sample;
- approve sample.

The truthful post-approval state before runtime exists is:

```text
Sample approved.
Skill creation is not available yet.
```

There must be no fake slash command.

### Stage 3: Configurable Skill Runtime Foundation

Add backend concepts without automatic generation first:

- configurable skill record;
- draft/active state;
- slash command registration;
- skill definition format;
- disabled draft skills in the Skills tab;
- versioning;
- deactivation and rollback path;
- provider/model policy per skill;
- rerun and artifact guardrails.

### Stage 4: Build From Approved Sample

Only after the runtime foundation exists:

- generate skill config from approved sample;
- validate against approved sample;
- activate slash command;
- show `/skill_name` to the user.

## What V2 Proves

The v2 flow is useful because it is lifecycle-based, not prompt-editing-based.

The useful sequence is:

```text
/new_skill idea
  -> inferred editable skill summary
  -> Check idea
  -> Generate sample output
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

Translate this lesson into the end-state language carefully. The lawyer should
not see a permanent developer ladder. The system should still enforce the
ladder behind the scenes.

## What This Repo Should Borrow

Borrow the lifecycle, not the v2 implementation shape.

For this repo, the future flow should be:

```text
Command rail or future Unibox
  -> new skill idea
  -> adaptive interview
  -> test matter selection
  -> sample output
  -> feedback and sample revision loop
  -> approved sample
  -> overlap check using built-in and configurable skill stubs
  -> draft configurable skill record
  -> validation against approved sample
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

The current app can capture explicit skill-idea phrases from the Command rail
and save them as non-running ideas in the Skills tab.

Examples:

```text
create a skill to prepare a filing bundle index
make a new skill that summarises the best case pleadings for the lawyer
```

This stage records intent only. It does not allocate a slash command, generate
a prompt, run a provider, or create a matter artifact.

### 2. Adaptive Interview

The current app supports a skill interview path. Future iterations should ask
as many questions as the skill needs, but keep the interaction humane:

- questions must be legally relevant and specific to the requested skill;
- the user can skip, answer, or generate a sample early;
- around ten questions, pause and ask permission to continue;
- do not expose internal slot names, router language, or generic governance
  vocabulary.

The interview may use the model-backed skill design planner once enabled by
policy. It must still send only allowed planning inputs, not raw matter records.

If a later slice adds AI-assisted design review or brief drafting, the summary
must be visible and editable before saving. That later work must follow the
model policy in [Model Routing Design](../../model-routing.md), not ad hoc model
selection inside the Command rail.

Current model boundary:

- skill idea capture: deterministic, no model;
- skill interview V0: deterministic, no model;
- readiness gate: deterministic, no model;
- router or overlap check: cheap/fast model is acceptable;
- future skill design review: strong model;
- future prompt/schema authoring: highest available model, fail closed, human
  review required;
- future runnable skill execution: use the skill's own task policy, not always
  the highest model.

Do not add a visible model selector to this flow until task names and policies
are stable. A lawyer should describe the workflow they need; the app policy
should decide which model posture applies.

### 3. Test Matter

Before a skill can be approved, the user should choose a test matter:

```text
Use Ayesha Vs Japan Airlines to test this skill?

[Use this matter] [Pick another] [Skip sample]
```

Skipping a sample may be useful while brainstorming, but it cannot lead to an
active skill. Activation requires an approved reference sample.

### 4. Sample Output

The app should generate a sample output and render it in the central pane. The
Command rail remains conversational:

```text
Make it India-specific.
Do not assume the Limitation Act always applies.
Show special statute limitation separately.
```

The app should regenerate the sample until the user clicks:

```text
Looks right
```

The approved sample becomes the reference for validation and future build work.
It is not itself a runnable skill.

### 5. Overlap Check

The app must compare the idea against:

- built-in skill stubs;
- active configurable skills;
- draft configurable skills;
- saved ideas when practical.

If the idea overlaps an existing skill, the user should be guided toward modification or tuning, not a duplicate runnable skill.

That modification path is not direct editing. It should create a draft revision
under [Skill Modification Contract](skill-modification-contract.md).

### 6. Save Skill Request

Saving a skill request creates a non-running record only.

It must not:

- create an active slash command;
- write a matter artifact;
- mutate built-in skill stubs;
- mutate an active configurable skill.

### 7. Create Draft Skill

Creating a draft skill allocates a slash command and stores the draft
definition, approved sample, and validation contract.

Draft skills may appear in suggestions, but must be clearly disabled or marked as draft. If a user tries to run one through the Command rail or future Unibox, the app should say:

```text
This skill is still draft. Validate it in Skills before running.
```

### 8. Test Draft

Draft runs should use the active matter context boundary. They may call a provider only with visible provider/cost posture.

Draft output should route to the appropriate lane:

| Output type | Default lane |
| --- | --- |
| analysis, issue notes, fact gaps | `20_Workshop` |
| legal drafts, notices, applications, client emails | `30_Drafts` |
| stable source-backed reference output | `10_Library` |
| final reviewed material | `40_Dispatch` |

### 9. Approved Sample

The user must approve a sample output before validation.

The approved sample should represent what the lawyer considers acceptable for
the skill, not merely whatever the provider produced first.

### 10. Validation

Validation must check at least:

- required citations are present when the brief requires them;
- raw `FILE-NNNN pX.bY` citations resolve against the matter context used for validation;
- the output broadly matches the golden;
- required sections or output shape are present;
- unsupported legal conclusions are not silently accepted.

### 11. Activation

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

Those are useful later, but each implementation should remain small and auditable.

## Current Implemented Governance Slice

The current runtime supports the safe front half of this lifecycle:

- capture an explicit skill idea from the Command rail;
- open a deterministic interview session;
- save the idea and design brief in the Skills tab;
- calculate readiness from completed design-brief fields;
- mark ideas as proposed, parked, dismissed, or ready for review;
- keep every saved idea clearly marked as not runnable.

It still does not allocate a slash command, generate prompts, create draft
configurable-skill records, call a provider, run a draft, or write matter
artifacts.

This is development scaffolding, not the intended lawyer-facing endpoint. The
next product-facing step should be the sample output review loop. Until the
runtime build/activation machinery exists, approval must stop at:

```text
Sample approved.
Skill creation is not available yet.
```

If an AI design-review or brief-drafting provider is added later, it must be
gated by model policy and tested with fake providers. It must not make saved
ideas runnable.

## Acceptance Criteria For Future Runtime Work

- A simple filing-bundle idea produces legally apt follow-up questions.
- The user can choose a test matter or explicitly skip sample generation.
- Sample output appears in the central pane.
- Feedback regenerates a revised sample without leaving the skill-builder flow.
- `Looks right` approves a sample but does not claim a slash command exists
  before runtime activation exists.
- Before runtime exists, the post-approval message is exactly truthful:
  `Sample approved. Skill creation is not available yet.`
- After runtime exists, `Skill Ready` appears only if the slash command is
  registered, validated, active, and visible in Command rail suggestions.
- Source/citation rule, matter scope, and legal setting are confirmed for legal drafting.
- `Check idea` is a visible action, not an internal phrase the user must type.
- Saving a skill request does not create a runnable skill.
- `Create draft skill` is a later explicit step and creates a draft only.
- Draft slash commands are blocked until validation.
- Built-in skills remain immutable through this flow.
- Tests prove overlap, save, draft, block, approved-sample validation, and activation gates separately.
