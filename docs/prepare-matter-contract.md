# Prepare Matter Contract

Date: 2026-05-13

Status: design contract only. This document defines the intended `/prepare_matter` workflow before implementation. It does not add a runnable command, route, prompt, provider call, file write, or orchestration layer in the current app.

## Decision

The next foundation workflow should be:

```text
/prepare_matter
```

Its job is to make the beginning of a matter understandable and to offer a guarded way to move through the preparation pipeline.

This is not a new analysis skill. It is a guided preparation workflow that helps the operator answer:

```text
What is ready, what is missing, and what should run next?
```

Future `/prepare_matter` may orchestrate existing stages, but only through the existing stage runners and guardrails. It must not become a hidden replacement for the pipeline.

## Why This Comes Before More Runtime Skills

The app now has a real beta chain:

```text
/matter-init -> /extract -> /describe_sources -> /create_listofdates
```

It also has a Command rail, read-only Skills tab, workspace lanes, context preview/search, saved skill ideas, and implementation briefs. That is enough power that the first five minutes of a matter should be calmer.

`/prepare_matter` should reduce setup friction without adding legal analysis. It gives future skills a cleaner foundation because metadata, source files, lane state, and pipeline readiness are easier to inspect before a provider-backed workflow runs.

## Goal

Provide a deterministic matter-preparation plan and a guarded composite workflow.

The workflow should help the user:

- confirm an active matter is selected;
- confirm required metadata is present;
- see whether source files are staged for intake;
- understand whether `/matter-init` has run;
- understand whether `/extract`, `/describe_sources`, and `/create_listofdates` are missing, stale, or current;
- identify the safest next stage;
- skip stages that are already current;
- run eligible stages in order when the user explicitly chooses to proceed;
- ask before paid source labeling;
- stop on failure without writing misleading downstream artifacts;
- resume from the first incomplete or stale stage after the problem is fixed;
- preserve each stage's separate artifacts and status;
- avoid accidental paid reruns or duplicate setup work.

Good output sounds like:

```text
Matter selected. Metadata is complete. Intake is current. Extraction is missing.
Next safe step: run Extract documents.
```

Bad output sounds like:

```text
I analyzed the case and prepared your strategy.
```

## Non-Goals

Do not include any of these in the first runtime slice:

- hidden provider calls;
- legal Q&A;
- source description generation without explicit user confirmation;
- List of Dates generation;
- client email drafting;
- skill generation;
- prompt generation;
- matter merits analysis;
- hidden automatic extraction;
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
  "paid_provider_call": true,
  "rerun_guarded": true,
  "source_backed": "optional",
  "default_lane": "",
  "runner_key": "/prepare_matter"
}
```

Do not add this to the live built-in registry until the runtime and UI behavior are implemented.

The `paid_provider_call` flag is `true` because this workflow may offer to run `/describe_sources`. The first screen must still be free and read-only; the paid step needs a clear confirmation before it runs.

## Relationship To Existing Commands

`/prepare_matter` should not replace `/matter-init`.

The split should be:

| Command | Responsibility |
| --- | --- |
| `/prepare_matter` | Guarded preparation plan and optional orchestration through existing stage runners. |
| `/matter-init` | Deterministic intake: preserve originals, classify working copies, write registers, and update `matter.json`. |
| `/extract` | Build extraction records from registered working copies. |
| `/describe_sources` | Create readable source labels in `10_Library/Source Index.json`. |
| `/create_listofdates` | Create lawyer-facing chronology artifacts. |

The preparation workflow may recommend or run `/matter-init`, `/extract`, and `/describe_sources`, but only when the user explicitly starts the guarded plan. It must call the same underlying runners those skills already use. It should not create a parallel intake, extraction, or source-labeling implementation.

`/create_listofdates` is outside the V0 orchestration path. The report may recommend it after source labels are ready, but the chronology skill keeps its own dedicated run surface and paid rerun guard.

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

V0 should render a preparation report in the app before any action runs. It should not write a durable preparation artifact by default.

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
Preparation Plan
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
- Plan:
  - Set up matter: skip / run / blocked
  - Extract documents: skip / run / blocked
  - Label sources: skip / confirm paid run / blocked
- Next safe step: ...

## Warnings

- ...
```

If a durable artifact is later useful, it should be a separate reviewed decision. The first runtime should not write `Prepare Matter.md` just because the report exists on screen.

Each child stage must continue writing only its own existing artifacts:

| Stage | Existing output owner |
| --- | --- |
| `/matter-init` | `matter.json`, `00_Inbox/.../File Register.csv`, `Intake Log.csv`, organized intake folders. |
| `/extract` | `_extracted` records and `Extraction Log.csv`. |
| `/describe_sources` | `10_Library/Source Index.json`. |

`/prepare_matter` should never blend these into one new status file. The status panel remains derived from disk facts.

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
| `skipped_current` | Stage was skipped because current artifacts already exist. |
| `ready_to_run` | Stage can run after user confirmation. |
| `blocked` | Stage cannot run until an earlier requirement is fixed. |
| `failed` | The latest attempted stage returned an error. |
| `resumable` | The workflow can continue from the first missing or stale stage after failure. |
| `needs_review` | The workflow found ambiguity that requires user judgment. |

Missing artifacts should not be described as failed. They are simply not run.

## Orchestration Rules

The V0 guarded plan should use this stage order:

```text
1. Set up matter      -> /matter-init
2. Extract documents  -> /extract
3. Label sources      -> /describe_sources
```

Rules:

- Always compute the plan from disk before running anything.
- Show the plan before starting.
- Skip stages whose artifacts are current.
- Do not rerun current stages by default.
- Do not run a downstream stage if the required upstream stage is missing, stale, or failed.
- Run one stage at a time and update the report after each stage.
- Use the same API path and frontend guardrails as the existing individual skill.
- Keep stage logs and artifact paths separate in the UI.
- If the user cancels a confirmation, stop the plan without treating cancellation as failure.
- If a stage fails, stop immediately and show the failed stage, error summary, preserved artifacts, and resume point.

The user-facing actions should be explicit:

```text
Review plan
Run preparation
Run next stage
Keep current
Cancel
```

Do not use copy like:

```text
Auto-fix matter
Run everything silently
Complete preparation
```

## Paid Source Labeling

`/describe_sources` is the only paid/provider-backed stage in the V0 preparation path.

Before it runs, the UI must show a confirmation that names:

- the stage: `Label sources`;
- the output artifact: `10_Library/Source Index.json`;
- provider/model if known from settings;
- whether the existing Source Index is missing, stale, or current;
- that this may make an AI provider call.

Default behavior:

- if Source Index is current, skip it;
- if Source Index is missing, ask before running;
- if Source Index is stale, ask before rerunning;
- if the user declines, stop the plan and leave existing artifacts untouched.

This confirmation should reuse the same rerun-advice facts and safety posture already used by `/describe_sources`.

## Failure And Resume

`/prepare_matter` should be resumable without a new durable workflow database.

Resume logic should be derived from the same disk facts:

- if `/matter-init` completed but `/extract` did not, resume at `/extract`;
- if `/extract` completed but `/describe_sources` failed or is missing, resume at `/describe_sources`;
- if `/describe_sources` failed closed, do not create or overwrite a partial `Source Index.json`;
- if an upstream artifact changes after failure, recompute the plan and mark downstream stages stale or blocked as appropriate.

The report should include:

```text
Last attempted stage: ...
Result: failed / cancelled / completed
Resume from: ...
Artifacts preserved: ...
```

The runtime should not pretend a failed preparation run is a failed matter. It is a failed stage attempt.

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
- Is `List of Dates.md` or `.json` present for downstream readiness?
- Are source labels/List of Dates stale relative to upstream extraction records?
- What is the safest next stage?
- Which preparation stages will be skipped because they are current?
- Which preparation stage requires paid confirmation?

## Next-Step Guidance

The workflow should recommend one next action and show the larger plan separately.

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

The first screen is read-only. Confirmations are needed only after the user chooses to run a stage or the guarded plan.

The runtime must preserve the existing safeguards:

- `/matter-init` should show what files will be preserved and registered before it writes intake artifacts;
- `/extract` should show that it will read registered working copies and write extraction records;
- `/describe_sources` should keep paid confirmation when missing or stale and paid rerun confirmation when current;
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

- render the preparation report in the central pane or Command rail with explicit run controls;
- no provider call merely from opening the report;
- no matter artifact write merely from opening the report;
- no paid rerun merely from opening the report;
- no skill idea creation;
- no router/check fallback for exact aliases.

## Skills Tab Behavior

After implementation, the Skills tab may show `/prepare_matter` as:

```text
Mode: deterministic
Provider: conditional
Matter: optional
Runner: /prepare_matter
Output: preparation report and guarded stage plan
Default lane: none
```

It should be clear that this is a preparation workflow, not an analysis artifact.

## Acceptance Tests

The first runtime PR should include tests proving:

- no active matter renders a clear "pick or create a matter" state;
- missing metadata is reported without running `/matter-init`;
- a matter with metadata but no intake recommends `/matter-init`;
- a matter with intake but no extraction recommends `/extract`;
- a matter with extraction but no Source Index recommends `/describe_sources`;
- a matter with Source Index but no List of Dates recommends `/create_listofdates`;
- current `/matter-init`, `/extract`, and `/describe_sources` stages are skipped instead of rerun;
- `/describe_sources` asks before paid source labeling when missing or stale;
- cancellation before `/describe_sources` stops the plan without marking the matter failed;
- failure in `/extract` stops before `/describe_sources`;
- rerunning after a failed `/extract` resumes from `/extract` after disk facts are recomputed;
- current artifacts recommend review, library navigation, or context search instead of rerun;
- missing artifacts are not described as failures;
- opening the preparation report does not call OpenAI, OpenRouter, Mistral, or any provider;
- opening the preparation report does not write matter artifacts;
- stage execution writes only the child stage's normal artifacts;
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
- does not run it merely from opening the report.

```text
Matter with intake current and extraction missing
```

Expected:

- skips setup;
- offers to run extraction;
- does not run source labels before extraction succeeds.

```text
Beta matter with extraction/source/List of Dates artifacts
```

Expected:

- shows core stages as present/current when disk facts support it;
- recommends review or local search;
- no paid call;
- no artifact writes.

```text
Matter with extraction current and Source Index missing
```

Expected:

- shows `Label sources` as the next stage;
- asks before the paid provider-backed step;
- if cancelled, no Source Index is written.

## Boundary

`/prepare_matter` should make the beginning of the workflow easier. It should not become hidden orchestration.

The principle is:

```text
Show the plan first. Run actions only when the user explicitly chooses them through the existing guarded paths.
```
