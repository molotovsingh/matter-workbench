# Selective Unibox Adoption Plan

Date: 2026-05-11

Audience: main coding session for `matter-workbench`

Status: planning note only. Do not treat this as a runtime change.

## Executive Summary

The current `matter-workbench` repo is stable enough to preserve as a beta checkpoint before beginning the next product direction. The next direction should be selective adoption of useful Unibox/v2 ideas, not a wholesale migration to the v2 or prototype architecture.

The important distinction:

- **This repo remains the foundation.**
- **v2 and Unibox are reference material.**
- **We borrow proven workflow patterns, not code shape by default.**

The current repo has hard-won strengths that should not be disrupted:

- deterministic `/matter-init` intake;
- deterministic `/extract` with opt-in OCR;
- durable on-disk matter artifacts;
- source descriptor validation through `Source Index.json`;
- lawyer-facing `/create_listofdates`;
- raw `FILE-NNNN pX.bY` citations kept canonical;
- fail-closed AI provider handling;
- focused tests and smoke evidence.

Unibox/v2 can improve the user experience, but it should not replace these boundaries.

## First Safety Step: Preserve the Current Beta

Before any selective-adoption work starts, tag the current stable beta commit.

At the time of this note, local `main` is:

```text
0fb28e7 Filter Vakalatnama chronology rows regardless of wording (#50)
```

Recommended tag:

```bash
git switch main
git pull --ff-only
git tag -a beta-listofdates-2026-05-11 -m "Stable list-of-dates beta before selective Unibox adoption"
git push origin beta-listofdates-2026-05-11
```

Why this matters:

- A branch moves as work continues.
- A tag is a frozen checkpoint.
- If the Unibox-inspired branch gets messy, we can always return to this exact beta.

For a beginner-friendly mental model:

- **Commit**: a saved photograph of the repo.
- **Branch**: a movable bookmark where work continues.
- **Tag/release**: a permanent label on one saved photograph.
- **Pull request**: a proposed change for review.
- **Main**: the current accepted line of work.

## Working Branch

After tagging the beta, continue on a distinct branch:

```bash
git switch -c codex/selective-unibox-adoption
git push -u origin codex/selective-unibox-adoption
```

Do not do broad work directly on `main`.

## Guiding Rule

Use this rule for every proposed migration:

> If the idea improves the user's workflow without weakening deterministic artifacts, local validation, or source traceability, consider adopting it. If it requires replacing the current engine/artifact foundation, reject it or defer it.

## What We Should Borrow

### 1. Artifact Actions

Unibox-style systems are good at turning generated artifacts into immediate actions. This repo should borrow that.

First candidate:

- Add `Copy Markdown` and `Download Markdown` to the `/create_listofdates` result screen.
- Use existing `10_Library/List of Dates.md`.
- Reuse existing `/api/file-raw`.
- Do not create a new export engine.

Why:

- It helps beta testers share outputs quickly.
- It turns the generated artifact into something a lawyer can immediately use.
- It is low risk and UI-only.

### 2. Workflow Status Surface

Users should not need to inspect folders to know where a matter stands.

Future candidate:

- Show a matter pipeline status panel:
  - intake present;
  - extraction records present;
  - OCR applied or required;
  - `Source Index.json` present;
  - `List of Dates.md` present;
  - latest provider and model used where available.

Important constraint:

- Read existing artifacts and logs.
- Do not introduce a separate state database.
- Do not let UI status become more authoritative than the files on disk.

### 3. First-Class `/describe_sources`

Current beta flow is:

```text
/extract -> /describe_sources -> /create_listofdates
```

But `/describe_sources` is currently engine-facing rather than fully app-facing.

Future candidate:

- Add an API route for source descriptors.
- Add a frontend skill module.
- Add the visible sidebar action.
- Show `Source Index.json` result summary.

Important constraint:

- The source descriptor engine remains the validation owner.
- The UI should call the engine through a route, not duplicate the rules.

### 4. Better Run Feedback

Unibox-style UX often tells the user what happened, what failed, and what they can do next.

This repo should improve:

- failed provider messages;
- retry guidance;
- visible model/provider metadata;
- blocked-state explanations;
- "next step" actions after each successful run.

Important constraint:

- Keep messages factual.
- Do not hide fail-closed behavior behind optimistic UI.

### 5. Rerun Guardrails For Paid Or Durable Skills

The app should eventually protect users from accidentally rerunning expensive or durable skills when the existing artifact is still current.

This is not just a generic "Are you sure?" prompt. It should be staleness-aware.

Future behavior:

```text
/create_listofdates was last run on 2026-05-11 at 18:42.
It used openai/gpt-4.1 via OpenRouter and wrote 36 chronology rows.
No newer extraction records or Source Index changes were found.

Run it again anyway?
```

Skills that should get this treatment:

- `/describe_sources`, because it can spend provider tokens and overwrites `Source Index.json`;
- `/create_listofdates`, because it can spend provider tokens and overwrites chronology artifacts;
- OCR-backed `/extract`, when OCR is enabled and cached extraction records already exist;
- future drafting or dispatch skills that create lawyer-facing artifacts.

The check should distinguish:

- **current**: all upstream inputs are older than the generated artifact;
- **stale**: upstream inputs changed after the artifact was generated;
- **missing**: the artifact does not exist yet;
- **failed**: the last run failed and no valid artifact was written;
- **forced rerun**: the user intentionally chose to regenerate.

Do not implement this as ad hoc prompts inside each button handler. The status panel or a small shared rerun-advice service should compute it from durable artifacts, source hashes, extraction record timestamps, and artifact metadata. The UI can then show a consistent confirmation only when the skill is current and rerunning would spend money or overwrite a valid artifact.

This belongs after the matter pipeline status panel, because the status panel provides most of the read-side facts needed for a good rerun decision.

### 6. Configurable Skill Ideas, But Later

Configurable skills are promising, but they are dangerous if added too early.

Do not start with runtime configurable skills in this repo.

Prerequisites before configurable skills:

- contract for each skill output;
- golden examples;
- validation gates;
- versioned revisions;
- rollback-as-draft behavior;
- clear separation between active skill and proposed draft;
- test coverage proving bad drafts cannot overwrite good active behavior.

This repo can learn from v2's rollback and revision approach later, but only after simpler UI/workflow adoption is done.

## What We Should Not Borrow

Do not migrate wholesale:

- v2 service structure;
- Unibox orchestration as the central runtime;
- configurable skill mutation without gates;
- prototype code that bypasses current tests;
- UI abstractions that require a frontend rewrite;
- any state layer that competes with matter artifacts on disk.

Also do not change these foundations without a separate design review:

- raw citations remain canonical;
- source labels are additive display metadata;
- provider output is untrusted until locally validated;
- AI failures fail closed;
- matter files remain the durable source of truth.

## Proposed Adoption Table

| v2 / Unibox idea | Adopt? | How this repo should express it | First PR |
|---|---:|---|---|
| Share/export result affordance | Yes | Buttons on existing artifact result screens | Copy/Download List of Dates |
| Workflow status surface | Yes | Read existing artifacts/logs | Matter pipeline status panel |
| `/describe_sources` as visible step | Yes | Add route plus frontend skill wrapper | First-class source labels |
| Provider/run visibility | Yes | Read `ai_run` metadata from artifacts | Run metadata panel |
| Paid/durable rerun guardrails | Yes, later | Staleness-aware confirmation from artifacts | After status panel |
| Configurable skill revisions | Later | Require contracts, goldens, validation, rollback | Design note only |
| Unibox central orchestration | No for now | Keep engines and routes explicit | None |
| Frontend rewrite | No | Increment current shell | None |

## Recommended First PR

### PR 1: Copy/Download List of Dates

Scope:

- frontend only unless an existing file route is insufficient;
- add result-screen actions after `/create_listofdates`;
- primary action: `Copy Markdown`;
- secondary action: `Download Markdown`;
- optional secondary action: `Download CSV`;
- no engine changes;
- no provider changes;
- no schema changes.

Files likely involved:

```text
frontend/views/listofdates-result.js
frontend/skills/create-listofdates.js
styles.css
test/listofdates-result-view.test.mjs
```

Acceptance criteria:

- User can copy the full `10_Library/List of Dates.md` content after a successful run.
- User can download `10_Library/List of Dates.md`.
- Button is only shown when `outputPaths.markdown` exists.
- Copy failure shows a clear status message.
- Existing result table remains unchanged.
- `npm test` passes.

Recommended test:

- Add a focused frontend view/action test proving the Markdown action is rendered when `outputPaths.markdown` exists.
- If copy logic is easy to isolate, test URL/path handling separately.

Manual smoke:

```text
Run /create_listofdates on Mehta vs Skyline.
Click Copy Markdown.
Paste into a text editor or chat.
Confirm the pasted text starts with "# List of Dates".
Confirm raw FILE-NNNN pX.bY citations are preserved.
Click Download Markdown.
Confirm the downloaded/opened file is List of Dates.md.
```

## Recommended Second PR

### PR 2: First-Class `/describe_sources` In The App

Scope:

- add `POST /api/describe-sources`;
- add `frontend/skills/describe-sources.js`;
- add sidebar skill button;
- render a result summary for `Source Index.json`.

Acceptance criteria:

- User can run the full visible flow in the app:

```text
/extract -> /describe_sources -> /create_listofdates
```

- Bad provider output still fails closed.
- UI does not fabricate success if `Source Index.json` is missing.
- Existing CLI engine still works.

## Recommended Third PR

### PR 3: Matter Pipeline Status Panel

Scope:

- read existing matter artifacts;
- show status for intake, extraction, source index, list of dates;
- show latest known provider/model where artifact metadata exists.

Acceptance criteria:

- No new durable state file.
- Status derives from actual files.
- Missing artifacts are shown as missing, not failed.
- Failed runs are surfaced from logs where available.

## Recommended Later PR

### PR 4: Staleness-Aware Rerun Guardrails

Scope:

- add shared rerun advice for costly or durable skills;
- start with `/describe_sources` and `/create_listofdates`;
- use existing artifacts, extraction records, source hashes, and generated artifact metadata;
- show a confirmation only when a valid artifact already exists and upstream inputs have not changed;
- allow explicit rerun when the user confirms;
- do not silently block a stale rerun when fresh intake or new source material exists.

Acceptance criteria:

- Existing first runs do not gain extra prompts.
- Stale artifacts clearly invite regeneration.
- Current artifacts warn before paid regeneration.
- Confirmation text names the skill, last run time, provider/model where known, and generated artifact.
- The decision is derived from durable files, not from browser memory.
- Tests cover current, stale, missing, and failed artifact states.

## Branch And PR Discipline

Keep each PR small.

Each PR should answer:

1. What user friction does this remove?
2. Which existing artifact or contract does it rely on?
3. What does it not change?
4. How was it tested?

Every PR should include:

```text
node --check <changed-js-or-mjs-files>
node --test <focused-tests>
npm test
git diff --check
```

If the change is UI-facing, also include a browser smoke on:

```text
http://127.0.0.1:4173/
```

Note: avoid port `4174` for this repo because v2 may use it locally. If `4173` is occupied, pick another free port explicitly.

## Beta Config To Preserve

The current preferred beta config for source-backed List of Dates is:

```text
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL=openai/gpt-4.1
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS=8000
```

Premium/high-stakes comparison mode:

```text
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL=anthropic/claude-opus-4.7
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_ORDER=Anthropic
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=
OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS=8000
```

Do not silently enable fallback routing for lawyer-facing artifacts.

## Final Instruction To Main Coder

Start with preservation, then proceed in small slices.

Do this first:

1. Tag the current beta.
2. Work on `codex/selective-unibox-adoption`.
3. Open a doc-only or frontend-only PR for Copy/Download List of Dates.

Do not start with configurable skills.

The correct posture is:

> Make the current beta easier to use before making it more configurable.
