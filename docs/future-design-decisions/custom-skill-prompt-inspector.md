# Future Design Decision: Custom Skill Prompt Inspector

Date: 2026-05-14
Status: Parked for later product decision

## Why This Exists

Custom skills are now real runnable app objects. A skill is not only the user's
original request or the approved sample. The runnable skill also contains a
stored prompt/config contract that tells the app how to repeat the work.

Power users should eventually be able to inspect that contract. If a lawyer has
approved a skill and is relying on it across matters, the app should be able to
answer a simple question:

```text
What instructions is this skill actually following?
```

That transparency matters. It helps users trust the skill, debug weak outputs,
and decide whether they want to improve the skill instead of rerunning it.

This note parks the future feature. It does not authorize prompt editing yet.

## Current Shape

For configurable skills, the prompt/config currently lives in the app-level
skill store:

```text
configurable-skills.json
```

Each active skill has fields like:

```json
{
  "schema_version": "configurable-skill/v1",
  "slash": "/party_officer_map",
  "title": "Party and Officer Map",
  "status": "active",
  "targetLane": "20_Workshop",
  "outputArtifact": "20_Workshop/Party and Officer Map.md",
  "promptConfig": {
    "prompt": "...",
    "citationPolicy": "..."
  },
  "modelPolicy": {
    "task": "configurable_skill_run",
    "provider": "openai-direct",
    "model": "gpt-5.4"
  }
}
```

In plain language:

- the skill idea explains why the skill exists;
- the approved sample shows what good output looked like;
- the prompt/config explains how the app repeats the work;
- the run ledger records what happened each time it ran.

## Proposed User Experience

Add a read-only `Inspect` action under each active custom skill.

Example path:

```text
Skills
  -> Custom Skills
    -> Party and Officer Map
      -> Inspect
```

The inspector should show:

- skill title and slash command;
- current status and version;
- output lane and artifact path;
- model/provider policy;
- prompt text;
- citation policy;
- source idea id;
- approved sample id;
- validation result;
- latest run metadata;
- `Copy prompt config`.

The user-facing label should be simple:

```text
Inspect skill instructions
```

Avoid making the main UI sound like a developer console.

## Product Rules

### Read-Only First

The first version must be read-only.

It may show and copy the prompt/config, but it must not let the user edit the
active skill in place.

### No Silent Mutation

Prompt edits, when eventually added, must create a draft version.

They must not mutate the live active skill.

### Approval Still Matters

If a prompt changes, the skill should go through the same trust path:

```text
edit draft instructions
-> generate sample output
-> user feedback
-> user approves sample
-> validate
-> activate new version
```

The app must not show:

```text
Skill Ready
```

unless the new version is actually active and runnable.

### Preserve Lawyer-Facing Simplicity

Normal users should not be forced to understand prompts.

The inspector is for power users, debugging, and transparency. The default
lawyer flow should remain:

```text
describe skill
-> review sample
-> approve
-> run skill
```

## Staged Path

### Stage 1: Read-Only Prompt Inspector

Show the active skill's instructions and metadata.

Allowed:

- view prompt;
- view citation policy;
- view model policy;
- view source idea/sample references;
- copy prompt config.

Not allowed:

- edit prompt;
- change model;
- activate/deactivate;
- regenerate skill;
- write matter artifacts.

### Stage 2: Version-Aware Inspector

Add skill version history and connect each version to:

- approved sample;
- validation result;
- activation time;
- latest runs.

This helps answer:

```text
Which version produced this output?
```

### Stage 3: Draft Prompt Editing

Only after versioning and sample re-approval are reliable, allow edits that
create a draft version.

The draft must be non-runnable until it passes sample approval and validation.

## Non-Goals

This parked decision does not authorize:

- editing active prompts;
- changing provider/model from the inspector;
- bypassing sample approval;
- bypassing validation;
- exposing raw matter context;
- exposing API keys or `.env`;
- turning the Skills tab into a full developer console;
- changing built-in skill stubs.

## Acceptance Rule

The product should be transparent but not fragile.

Allowed now:

```text
Inspect the instructions this active skill follows.
```

Not allowed until versioned editing exists:

```text
Edit the live prompt and keep using the same active skill.
```

The prompt is part of the skill. Showing it is useful. Editing it is a separate
product surface that needs versioning, samples, validation, and rollback.
