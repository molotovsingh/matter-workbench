# Prepare Matter Contract

Date: 2026-05-13

Status: design contract only. This document defines the intended `/prepare_matter` workflow before implementation. It does not add a runnable command, route, prompt, provider call, file write, or orchestration layer.

## Decision

The next foundation workflow should be:

```text
/prepare_matter
```

Its job is to make the beginning of a matter understandable before the user runs the heavier pipeline.

This is not a new analysis skill. It is a guided preparation and readiness workflow that helps the operator answer:

```text
Is this matter ready for intake, extraction, source labels, and List of Dates?
```

## Why This Comes Before More Runtime Skills

The app now has a real beta chain:

```text
/matter-init -> /extract -> /describe_sources -> /create_listofdates
```

It also has a Command rail, read-only Skills tab, workspace lanes, context preview/search, saved skill ideas, and implementation briefs. That is enough power that the first five minutes of a matter should be calmer.

`/prepare_matter` should reduce setup friction without adding legal analysis. It gives future skills a cleaner foundation because metadata, source files, lane state, and pipeline readiness are easier to inspect before a provider-backed workflow runs.

## Goal

Provide a deterministic matter-preparation checklist and next-action guide.

The workflow should help the user:

- confirm an active matter is selected;
- confirm required metadata is present;
- see whether source files are staged for intake;
- understand whether `/matter-init` has run;
- understand whether `/extract`, `/describe_sources`, and `/create_listofdates` are missing, stale, or current;
- identify the safest next command;
- avoid accidental paid reruns or duplicate setup work.

Good output sounds like:

```text
Matter selected. Metadata is complete. Intake has run. Extraction is missing. Next safe step: run /extract.
```

Bad output sounds like:

```text
I analyzed the case and prepared your strategy.
```

## Non-Goals

Do not include any of these in the first runtime slice:

- provider calls;
- legal Q&A;
- source description generation;
- List of Dates generation;
- client email drafting;
- skill generation;
- prompt generation;
- matter merits analysis;
- automatic extraction;
- automatic paid reruns;
- moving or deleting source files;
- editing built-in skill stubs;
- writing a new durable status database.

## Proposed Skill Stub

This is a future built-in workflow candidate, not active yet.

```json
{
  "schema_version": "built-in-skill-contract/v0",
  "id": "prepare_matter",
  "slash": "/prepare_matter",
  "title": "Prepare Matter",
  "category": "Prepare",
  "mode": "deterministic",
  "matter_required": false,
  "paid_provider_call": false,
  "rerun_guarded": false,
  "source_backed": "none",
  "default_lane": "",
  "runner_key": "/prepare_matter"
}
```

Do not add this to the live built-in registry until the runtime and UI behavior are implemented.

## Relationship To Existing Commands

`/prepare_matter` should not replace `/matter-init`.

The split should be:

| Command | Responsibility |
| --- | --- |
| `/prepare_matter` | Read-only preparation checklist and safest-next-step guidance. |
| `/matter-init` | Deterministic intake: preserve originals, classify working copies, write registers, and update `matter.json`. |
| `/extract` | Build extraction records from registered working copies. |
| `/describe_sources` | Create readable source labels in `10_Library/Source Index.json`. |
| `/create_listofdates` | Create lawyer-facing chronology artifacts. |

The preparation workflow may recommend `/matter-init`, but it should not silently run it.

## Inputs

The runtime may read:

- app config for matters home;
- active matter folder name;
- `matter.json`, if present;
- existing intake folders under `00_Inbox`;
- `File Register.csv`;
- `Intake Log.csv`;
- `Extraction Log.csv`;
- `_extracted` record counts;
- `10_Library/Source Index.json`;
- `10_Library/List of Dates.json`;
- `10_Library/List of Dates.md`;
- workspace lane folder existence:
  - `00_Inbox`;
  - `10_Library`;
  - `20_Workshop`;
  - `30_Drafts`;
  - `40_Dispatch`.

The runtime must not read:

- `.env`;
- API keys;
- raw source document text;
- full extraction record bodies;
- Command rail interaction logs;
- unrelated draft files;
- prior chat history;
- provider request/response payloads.

## Output Contract

V0 should render a read-only preparation report in the app. It should not write a durable artifact by default.

Suggested display sections:

```text
Matter
Metadata
Source Files
Intake
Extraction
Source Labels
List of Dates
Workspace Lanes
Next Safe Step
Warnings
```

Suggested copy/report shape:

```markdown
# Prepare Matter Report

- Matter: ...
- Matter folder: ...
- Metadata: complete / missing fields
- Intake: current / missing / needs review
- Extraction: current / missing / stale
- Source labels: current / missing / stale
- List of Dates: current / missing / stale
- Next safe step: ...

## Warnings

- ...
```

If a durable artifact is later useful, it should be a separate reviewed decision. The first runtime should not write `Prepare Matter.md` just because the report exists on screen.

## Status Rules

Use disk-derived facts only.

Do not infer status from button clicks, browser memory, local UI state, or terminal output.

Recommended statuses:

| Status | Meaning |
| --- | --- |
| `not_selected` | No active matter. |
| `missing` | Required artifact or folder is absent. |
| `incomplete` | Some required metadata or files are missing. |
| `present` | Artifact exists, but freshness is not known. |
| `current` | Artifact exists and known upstream inputs have not changed. |
| `stale` | Newer upstream inputs exist. |
| `needs_review` | The workflow found ambiguity that requires user judgment. |

Missing artifacts should not be described as failed. They are simply not run.

## Readiness Checklist

V0 should answer these questions:

- Is there an active matter?
- Does `matter.json` exist?
- Are required metadata fields present?
  - client;
  - matter name;
  - opposite party;
  - matter type;
  - jurisdiction.
- Do canonical lane folders exist?
- Are there loose source files that have not been staged into an intake?
- Does at least one `File Register.csv` exist?
- Are extraction records present for registered supported files?
- Is `Source Index.json` present?
- Is `List of Dates.md` or `.json` present?
- Are source labels/List of Dates stale relative to upstream extraction records?
- What is the safest next command?

## Next-Step Guidance

The workflow should recommend one next action, not a long menu.

Examples:

```text
No active matter. Pick or create a matter first.
```

```text
Metadata is incomplete. Fill client, opposite party, matter type, and jurisdiction before intake.
```

```text
Source files are staged but intake has not run. Next safe step: /matter-init.
```

```text
Intake is present and extraction is missing. Next safe step: /extract.
```

```text
Extraction exists and source labels are missing. Next safe step: /describe_sources.
```

```text
Source labels exist and List of Dates is missing. Next safe step: /create_listofdates.
```

```text
All core artifacts are present. Review Analysis Library or run context search.
```

## User Confirmations

V0 is read-only, so it should not need destructive confirmations.

If a later version offers to run another command, it must preserve the existing safeguards:

- `/matter-init` should show what files will be preserved and registered;
- `/describe_sources` should keep paid rerun confirmation when current;
- `/create_listofdates` should keep paid rerun confirmation when current;
- no paid action should run merely because `/prepare_matter` was opened;
- no source file should be moved or deleted from preparation alone.

## Command Rail Behavior

Proposed deterministic inputs:

```text
/prepare_matter
prepare matter
prepare this matter
matter prep
setup matter
```

Expected behavior:

- render the preparation report in the central pane or Command rail with an explicit open action;
- no provider call;
- no matter artifact write;
- no paid rerun;
- no skill idea creation;
- no router/check fallback for exact aliases.

## Skills Tab Behavior

After implementation, the Skills tab may show `/prepare_matter` as:

```text
Mode: deterministic
Provider: none
Matter: optional
Runner: /prepare_matter
Output: read-only preparation report
Default lane: none
```

It should be clear that this is a guide, not an analysis artifact.

## Acceptance Tests

The first runtime PR should include tests proving:

- no active matter renders a clear "pick or create a matter" state;
- missing metadata is reported without running `/matter-init`;
- a matter with metadata but no intake recommends `/matter-init`;
- a matter with intake but no extraction recommends `/extract`;
- a matter with extraction but no Source Index recommends `/describe_sources`;
- a matter with Source Index but no List of Dates recommends `/create_listofdates`;
- current artifacts recommend review, library navigation, or context search instead of rerun;
- missing artifacts are not described as failures;
- the workflow does not call OpenAI, OpenRouter, Mistral, or any provider;
- the workflow does not write matter artifacts;
- Command rail aliases route deterministically and do not call `/api/skills/check-intent`;
- paid rerun guardrails for `/describe_sources` and `/create_listofdates` remain unchanged.

## Manual Smoke

Use three matter states:

```text
No active matter
```

Expected:

- shows "Pick or create a matter first";
- no error;
- no provider call.

```text
Fresh matter with metadata but no intake
```

Expected:

- reports metadata completeness;
- recommends `/matter-init`;
- does not run it.

```text
Beta matter with extraction/source/List of Dates artifacts
```

Expected:

- shows core stages as present/current when disk facts support it;
- recommends review or local search;
- no paid call;
- no artifact writes.

## Boundary

`/prepare_matter` should make the beginning of the workflow easier. It should not become hidden orchestration.

The principle is:

```text
Show readiness first. Run actions only when the user explicitly chooses them through the existing guarded paths.
```
