# Skill Modification Contract

Date: 2026-05-12

Audience: main coding session for `matter-workbench`

Status: planning note only. This document records what this repo should borrow
from `matter-workbench-v2` for future configurable skill modification. It does
not add runtime behavior.

## Why This Exists

The current repo is moving toward an Omnibox/Command rail future, but legal
skills cannot be treated like ordinary chat preferences.

A lawyer may naturally say:

```text
make this skill more court-facing
add a limitation section for consumer matters
do not speculate unless there is a cited block
restore the old version of this skill
```

Those are easy sentences for the user. They are risky system changes for the
app. They can change what a lawyer relies on, what sources are considered, what
legal issues are surfaced, and what artifacts are written.

The rule for this repo should be:

```text
casual request from user
  -> formal draft revision lifecycle inside the app
```

## What V2 Proves

The useful v2 lesson is not "edit prompts in chat." The useful lesson is that a
skill modification is a controlled revision.

The v2 flow is:

```text
active configurable skill
  -> Modify
  -> user enters change request
  -> draft revision is created
  -> risk is classified
  -> proposed revised instructions are shown
  -> Test this version
  -> Save or paste expected result
  -> Validate result
  -> Use this version
  -> active slash command points to the new validated version
```

Rollback follows the same discipline:

```text
activated version history
  -> restore old version
  -> rollback draft is created
  -> run / golden / validate / activate
```

It is not a direct live restore.

## Product Rule

Do not mutate the live active skill directly.

The safe default lifecycle is:

```text
active skill remains live
  -> change request is captured
  -> draft revision is proposed
  -> draft revision can be tested
  -> expected result is saved or pasted
  -> validation passes
  -> user activates the revision
  -> slash command keeps same name but points to the new version
```

Until activation, the existing live slash command must continue to run the
previous validated behavior.

## Current Repo Boundary

The current built-in skills are code-backed and protected:

```text
/matter-init
/extract
/describe_sources
/create_listofdates
/doctor
/context_preview
/context_search
```

They must not be modified by a future chat or skill-modification flow.

If the user asks to change one of these, the app should route that as a product
or engineering change request, not as an in-app configurable skill revision.

User-created configurable skills are different. Once this repo has them, those
skills may be revised through the lifecycle in this document.

## Command Rail And Future Omnibox Role

The Command rail or future Omnibox may collect the user's change request.

It may say:

```text
This looks like a change to /weak_facts_analysis.
Create a draft revision for review?
```

It must not:

- rewrite the active skill immediately;
- activate a revision from chat alone;
- silently weaken citation/source rules;
- run a paid provider without visible provider/cost posture;
- hide the draft/test/golden/validation lifecycle.

The supervision surface should be a visible Skills-style screen, not only a
chat transcript.

The current Skills tab is already read-only and can serve as that supervision
anchor later. It does not yet create configurable skills, record revisions, or
activate behavior.

## Required Data Concepts

When configurable skills enter this repo, modification should use a separate
revision store rather than mutating the active skill record in place.

Recommended concepts:

| Concept | Purpose |
| --- | --- |
| `skillId` | Stable configurable skill identity |
| `baseVersion` | Active version the draft was based on |
| `baseSkillSnapshot` | Audit copy of the active behavior at draft time |
| `snapshotHash` | Stale-base detection |
| `changeRequest` | User's reason for the change |
| `risk` / `riskFlags` | Deterministic risk classification |
| `proposedBriefMarkdown` | Proposed revised instructions |
| `proposedArtifactRoute` | Optional revised output lane/kind/folder |
| `latestRun` | Draft test result |
| `golden` | Expected result approved by the user |
| `validation` | Deterministic and AI judge gate |
| `activatedSkillVersion` | Version assigned after activation |
| `revisionKind` | `normal` or `rollback` |

The first runtime implementation does not need every UI affordance from v2, but
it should keep these data concepts in mind.

## Risk Classification

Risk classification should be deterministic first. AI may explain or supplement
the classification, but it must not downgrade a risky request.

Low risk examples:

- shorter headings;
- warmer client-facing tone;
- less repetition;
- bullets instead of paragraphs.

Medium risk examples:

- add a missing-documents table;
- add procedural-defects analysis for criminal matters;
- add limitation/maintainability checks;
- change from internal review to court-facing output.

High risk examples:

- remove or hide citations;
- change source filtering;
- change output schema;
- write, move, rename, delete, or repair matter files;
- replace a code-backed skill;
- change provider/model policy;
- prepare final filing or dispatch-ready material.

High-risk changes should require explicit user review before any draft is even
treated as safe to test.

## Stale Draft Rule

Every draft revision must remember the active skill version and snapshot it was
based on.

If the active skill changes before the draft is run, validated, or activated,
the draft is stale and must fail closed:

```text
Draft revision is stale because the active skill changed.
Create a new draft revision.
```

Do not silently merge two skill changes.

## Validation Rule

Before activation, a draft revision must have:

- a latest test run;
- an expected result/golden;
- valid raw citations if the skill requires citations;
- validation passed;
- score above the accepted threshold;
- no blocking validation issue.

Rerunning a draft after validation must reset validation to pending. A changed
output cannot keep the old approval.

## Rollback Rule

Rollback means:

```text
restore old behavior as draft revision
```

It does not mean:

```text
set old version live immediately
```

The restored draft must still be tested, goldened, validated, and activated.
The version number keeps increasing:

```text
current active v3
restore old v1 behavior as draft
activate after validation
new active v4
```

This keeps the audit story honest: the user made a new present-day decision to
return to old behavior.

## First Implementation Slice

Do not start with full v2 runtime.

Do not start this before saved skill ideas and active configurable skills exist.
The first modify-skill runtime slice in this repo should then be small:

- add revision records for configurable skills only;
- expose draft revisions in the Skills supervision surface;
- support creating a draft revision from an active configurable skill;
- prove active skills do not mutate when a draft is created;
- block draft revisions from slash execution;
- add deterministic risk classification tests;
- defer provider-backed proposal generation if storage/display is not stable.

Only after that should the repo add test run, golden, validation, activation,
and rollback-as-draft.

## Acceptance Criteria

Future runtime work should prove these separately:

- modifying a skill creates a draft revision and leaves the active skill
  unchanged;
- draft revisions have no temporary slash commands;
- active slash commands continue to run only active validated versions;
- stale drafts fail closed;
- high-risk citation/source weakening cannot be downgraded by a provider;
- activation requires golden and validation;
- rollback creates a draft and does not mutate the active skill;
- built-in code-backed skills cannot be modified through this flow.
