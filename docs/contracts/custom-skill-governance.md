# Custom Skill Governance

Status: Current canonical contract

This contract defines how custom/configurable skills move from idea to runnable
tool, and how changes are allowed after a skill exists.

The core rule is:

```text
active skills do not silently mutate
changes go through sample, validation, version, activation
```

Do not treat a prompt edit as a harmless preference change. A custom skill is
durable app behavior.

## Why This Exists

Custom skills are more dangerous than one-off Copilot answers.

A weak Copilot answer is transient. A weak custom skill can keep producing weak
matter artifacts later, for other matters, after the original model choice or
prompt issue has been forgotten.

That is why custom skill creation and modification need a governed path rather
than freeform prompt editing.

## Current Trust Path

The trusted custom-skill path is:

```text
idea / requested workflow
-> design brief / governed interview
-> sample output on a selected matter
-> lawyer/user approves current sample
-> app authors a draft skill definition
-> validation run checks the draft
-> new version activates
-> previous active version is disabled/superseded
```

The active skill is not edited in place.

## Matter Context Requirement

Skill creation should be matter-anchored before the user invests in the
interview.

If the user intends to create a new skill and no matter is selected, the app
should ask them to pick a test matter before proceeding past the opening step.
The reason is practical: the interview ends in sample generation, and a sample is
only meaningful against a real matter record. If the user completes the whole
interview with no matter selected, the flow can feel like it disappears or hits a
dead end at the exact moment they expect a sample.

The preferred behavior is:

- accept the user's new-skill intent;
- immediately surface that a test matter is needed;
- let the user pick or create a matter;
- resume the skill interview with that matter as the sample context.

The app may still allow drafting or parking a raw idea without a matter, but the
primary "make a new skill" path should treat selected matter context as required
before sample generation.

## Skill Ideas

An idea is not a runnable skill.

An idea may contain:

- the user's requested workflow;
- design brief fields;
- target audience and output shape;
- source discipline expectations;
- sample matter choice;
- review status.

Saving an idea should not create or change a runnable skill by itself.

## Samples

A sample is the trust moment.

It shows what the future skill would produce on a real matter before the skill
becomes reusable.

Current rules:

- a sample is tied to a skill idea;
- approving a sample approves only the current design brief;
- if the design brief changes, the previous approved sample becomes stale;
- a stale approved sample cannot be used to create or activate a skill;
- only one current approved sample should be treated as the creation basis for
  an idea.

## Draft Skill Definition

A draft skill definition is generated from an approved current sample and the
idea/design brief.

It may include:

- slash command;
- title and description;
- output artifact;
- target lane;
- source-backed posture;
- run model policy;
- prompt/config contract;
- validation state;
- source idea/sample references.

A draft is not runnable until validation passes and activation succeeds.

## Validation

Validation is a promotion gate.

If validation fails:

- the draft may be stored for review;
- the active skill must not be replaced;
- the previous runnable skill remains the trusted version;
- failure should be visible as a validation problem, not hidden as a normal
  runnable skill.

Validation must not be bypassed because the sample "looked good."

## Version Activation

Activation creates or promotes a runnable version.

For the first version:

- the skill becomes active only after sample approval and validation.

For later versions:

- the new version uses the same skill family;
- the previous active version is disabled/superseded;
- the previous version remains part of version history;
- run receipts and old artifacts should preserve which skill version produced
  them.

This is replacement by version, not mutation in place.

## Improvement And Critique

`Improve this skill`, weak-run critique, or prompt-inspector ideas should feed
the same versioned path.

Allowed:

- capture feedback;
- create a revised design brief or draft version;
- generate a revised sample;
- approve the revised current sample;
- validate and activate a new version.

Not allowed:

- directly editing the active prompt/config in place;
- silently changing the active skill because a user critiqued one run;
- mutating built-in skill stubs;
- bypassing sample approval;
- bypassing validation;
- treating a run-result critique as permission to overwrite matter artifacts.

## Run Again Versus Change Skill

`Run again` and `Improve this skill` are different actions.

`Run again` reruns the current active skill version against the selected matter,
subject to normal overwrite/replacement guardrails for that matter's output.

`Improve this skill` starts a skill-change path. It should not replace the
active skill until a new sample, validation, and activation succeed.

## Relationship To Model Policy

Skill creation and skill modification are durable product behavior.

They should not inherit arbitrary transient Copilot model choices. A cheap or
experimental model used for chat must not silently author or modify durable
skill behavior.

Provider/model metadata should be recorded with the authored skill and run
metadata where available.

## Non-Goals

- This contract does not expose live prompt editing.
- This contract does not define every future prompt-inspector UI.
- This contract does not make built-in native skills editable as custom skills.
- This contract does not authorize automatic skill repair from bad outputs.
- This contract does not change current slash-command names.

## Implementation Pointers

Current code and tests connected to this contract include:

- `services/skill-ideas-service.mjs`;
- `services/skill-samples-service.mjs`;
- `services/skill-sample-output-service.mjs`;
- `services/configurable-skills-service.mjs`;
- `services/configurable-skill-lifecycle.mjs`;
- `services/configurable-skill-run-metadata.mjs`;
- `frontend/skill-idea-session-controller.js`;
- `react-ui/src/components/command/SkillIdeaSession.tsx`;
- `test/skill-samples-service.test.mjs`;
- `test/configurable-skill-lifecycle.test.mjs`;
- `test/ai-command-box.test.mjs`.
