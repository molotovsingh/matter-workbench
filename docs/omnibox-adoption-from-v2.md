# Omnibox Adoption From V2

Date: 2026-05-11

Audience: main coding session for `matter-workbench`

Status: planning note only. This document compares the current repo with the working Unibox ideas in `matter-workbench-v2` and `matter-workbench-opencode-unibox`. It does not propose a wholesale migration.

## Executive Summary

The next product direction should be an **incremental omnibox** over the current explicit skill system.

That means:

```text
User types or clicks one command surface
  -> app explains the matched action
  -> app applies status and rerun/cost guardrails
  -> app invokes the same explicit skill runner
  -> existing engines write the same durable artifacts
```

The omnibox should be the front desk. The existing engines remain the engine room.

The current repo is now strong enough to support this because it already has:

- visible slash skills;
- `/describe_sources` as a first-class app skill;
- matter pipeline status derived from files;
- rerun guardrails for paid AI skills;
- rerun hints before the user clicks;
- source-backed `List of Dates` artifacts with readable labels and raw citations;
- a skill registry and AI skill-router service.

The v2/opencode repos prove useful UX and routing patterns. They should inform this repo, not replace its foundations.

## Source Files Inspected

### Current Repo

```text
/Users/aksingh/matter-workbench/app.js
/Users/aksingh/matter-workbench/index.html
/Users/aksingh/matter-workbench/frontend/ai-command-box.js
/Users/aksingh/matter-workbench/frontend/event-wiring.js
/Users/aksingh/matter-workbench/frontend/views/matter-overview.js
/Users/aksingh/matter-workbench/frontend/skill-router-panel.js
/Users/aksingh/matter-workbench/services/skill-router-service.mjs
/Users/aksingh/matter-workbench/services/matter-status-service.mjs
/Users/aksingh/matter-workbench/skills/registry.json
/Users/aksingh/matter-workbench/docs/selective-unibox-adoption.md
/Users/aksingh/matter-workbench/docs/codebase-diagram.md
```

### V2 Repo

```text
/Users/aksingh/matter-workbench-v2/app.js
/Users/aksingh/matter-workbench-v2/index.html
/Users/aksingh/matter-workbench-v2/frontend/unibox.js
/Users/aksingh/matter-workbench-v2/frontend/unibox-suggestions.js
/Users/aksingh/matter-workbench-v2/frontend/unibox-input.js
/Users/aksingh/matter-workbench-v2/frontend/unibox-result-rendering.js
/Users/aksingh/matter-workbench-v2/frontend/unibox-status.js
/Users/aksingh/matter-workbench-v2/services/unibox-service.mjs
/Users/aksingh/matter-workbench-v2/services/intent-classifier-service.mjs
/Users/aksingh/matter-workbench-v2/services/skill-router-service.mjs
/Users/aksingh/matter-workbench-v2/services/skill-router-decision.mjs
/Users/aksingh/matter-workbench-v2/docs/codebase-diagram.md
/Users/aksingh/matter-workbench-v2/docs/ai-native-skill-router.md
/Users/aksingh/matter-workbench-v2/docs/configurable-skill-modification-approaches.md
/Users/aksingh/matter-workbench-v2/docs/new-skill-adaptive-interview-plan.md
/Users/aksingh/Desktop/Matter_Workbench_Walkthrough_mehta_full.pdf
```

### Opencode Unibox Repo

```text
/Users/aksingh/matter-workbench-opencode-unibox/app.js
/Users/aksingh/matter-workbench-opencode-unibox/index.html
/Users/aksingh/matter-workbench-opencode-unibox/frontend/unibox.js
/Users/aksingh/matter-workbench-opencode-unibox/frontend/skill-router-panel.js
/Users/aksingh/matter-workbench-opencode-unibox/services/unibox-service.mjs
```

## V2 Walkthrough PDF: What It Adds

`/Users/aksingh/Desktop/Matter_Workbench_Walkthrough_mehta_full.pdf` is useful because it is not only a repo map. It is a product teaching artifact.

The important lesson is the order in which it teaches the app:

```text
pick matter
  -> understand overview
  -> inspect files and generated outputs
  -> understand skills
  -> treat settings carefully
  -> use the Unibox inside active matter context
```

That sequence should influence this repo's selective adoption work more than the exact v2 file layout.

Product ideas worth borrowing from the PDF:

- start with a one-page product summary before diagrams;
- explain Matter Workbench as a local legal workspace, not as an AI chat app;
- make "pick the right matter first" the first rule;
- treat Files as the review surface for source folders and generated legal outputs;
- treat Skills as reusable supervised legal workflows;
- treat Settings as app-wide configuration, not day-to-day matter notes;
- frame the Unibox as "ask, search, or run skills" inside the active matter.

Architecture ideas worth borrowing from the PDF:

- use simple layer diagrams for browser workspace, Node API server, routes/services, engines, AI, and local matter folders;
- show user action flowing to frontend, routes, services, and matter-folder artifacts;
- make the safety habit visible: matter-bound actions should confirm an active matter before expensive work or writes.

Important constraint:

> The PDF is a v2 artifact. Its diagram pages should inform this repo's direction, but they should not be copied as the current architecture map for `matter-workbench`.

Several diagram labels are v2-specific, including `frontend/unibox.js`, `routes/unibox-routes.mjs`, `services/unibox-service.mjs`, and the broader Q&A/search/configurable-skill runtime. Those are future/reference ideas here, not current checkout facts.

For this repo, the adoption note should therefore separate:

```text
current architecture
  = files that exist and behavior that works now

selective adoption
  = v2 product patterns to borrow in small PRs

future state
  = ask/search/copilot/configurable-skill behavior after guardrails exist
```

## Current Repo Baseline

This repo now has a small command surface:

```text
index.html
  -> right-side Command panel
  -> form #aiCommandForm
app.js
  -> createAiCommandBox(ctx)
frontend/ai-command-box.js
  -> deterministic slash command parser
  -> static alias parser
  -> slash suggestions
  -> Copy Report
  -> POST /api/skills/check-intent
services/skill-router-service.mjs
  -> MECE skill-router decision
```

This is currently a **Command rail**, not a chat surface.

It can run known commands:

```text
/matter-init
/extract
/describe_sources
/context_preview
/context_search
/create_listofdates
/doctor
status
open inbox
open library
open workshop
open drafts
open dispatch
open skills
find <term>
search <term>
```

It can also route unsupported proposed-skill text to the existing registry overlap check:

```text
Does this proposed skill overlap with an existing skill?
```

That is good news. We do not need to graft v2's whole Unibox runtime into this repo. We can evolve the current Command rail carefully.

## Current Command Rail Contract

As of the merged Command V0 slices, the right-side rail has six responsibilities:

1. **Deterministic command execution.**
   Exact slash commands and a tiny static alias map dispatch to the same frontend skill runners used by sidebar and overview buttons.

2. **Safety-preserving rerun behavior.**
   `/describe_sources` and `/create_listofdates` still use the existing rerun guardrails. The Command rail may not bypass paid-call confirmation.

3. **Shareable command reports.**
   `Copy Report` exports a bounded Markdown report for the latest command interaction: matter name, matter folder, typed input, matched command or router/check result, status, timestamp, provider/model when available, artifact paths, visible status, and recent terminal lines.

4. **Slash discoverability.**
   Typing `/` shows the known slash skills with short descriptions. Selecting a suggestion simply fills and runs that deterministic command path.

5. **Local matter inspection.**
   `context`, `show context`, `find <term>`, and `search <term>` inspect the bounded matter context packet. They do not read raw files, call a provider, or write matter artifacts.

6. **Workspace and skill supervision navigation.**
   Lane commands such as `open library` and `open drafts`, plus `open skills`, move the user through existing read-only surfaces without changing matter state.

The rail deliberately does **not** do these things yet:

- chat transcript;
- provider-backed copilot Q&A;
- semantic/vector search or raw-file search;
- fuzzy paid-skill matching;
- conversation memory;
- configurable skill creation or editing;
- direct AI intent execution beyond the existing non-running router/check path.

The rule for future work:

> If it can spend money, mutate artifacts, or claim facts about a matter, it must go through the same explicit skill, artifact, and confirmation contracts as the sidebar buttons.

## What V2 Does Well

### 1. One Surface For Questions, Search, Skills, And Skill Ideas

V2's `frontend/unibox.js` accepts a broad input:

```text
Ask about your matter, run a skill, or search documents.
```

Its backend `services/unibox-service.mjs` classifies into:

```text
copilot_qa
run_skill
search
skill_request
greeting
casual
```

This is a useful future shape. It lets the user stay in one surface instead of hunting through separate panels.

Do not copy it immediately. This repo should first prove command execution deterministically.

### 2. Slash Suggestions

V2's `frontend/unibox-suggestions.js` is the most directly reusable UX pattern.

It builds suggestion items from:

- built-in registry skills;
- configurable skills;
- proposed skills;
- `/new_skill`.

It also marks some suggestions as not selectable, with a reason such as `Validate in Skills`.

For this repo, a first version should only use built-in skills from `skills/registry.json` and local frontend dispatch. No configurable skills yet.

Useful behavior to borrow:

- show slash suggestions when the input starts with `/`;
- support keyboard navigation;
- show skill purpose and category;
- disable commands that are not runnable in the current app;
- cache registry reads briefly, then invalidate after skill registry changes.

### 3. Placeholder Copy That Tracks Intent

V2's `frontend/unibox-input.js` changes the placeholder based on the input shape:

```text
/...       -> Run a skill, e.g. /extract
what/why   -> Ask about the current matter
find       -> Search across matter documents
default    -> Ask, search, or run a skill
```

This is small but good. It teaches the user what the box can do without a manual.

For this repo, use a narrower version:

```text
Type /extract, /describe_sources, /create_listofdates, or show status
```

### 4. Matched Skill Explanation

V2 keeps the router decision explicit through `renderRouterDecision(...)`:

- decision;
- recommended action;
- matched skill;
- confidence;
- MECE violation;
- user gate;
- reason;
- next action;
- legal setting;
- override requirements.

This is better than a magic assistant because the user can see why the app matched something.

For this repo, apply that idea to both deterministic and AI-routed commands:

```text
Matched: /create_listofdates
Reason: exact slash command
This may call OpenRouter.
Existing artifact is current, so confirmation will appear.
```

### 5. Auto-Run Only When Safe

V2's `frontend/unibox-result-rendering.js` has a useful rule:

```text
auto-run only if decision === run_existing_skill
and user_gate_required is false
and the matched skill has a frontend dispatch function
```

That is a sound pattern, but this repo needs one more constraint:

```text
auto-run must still pass rerun advice for paid skills
```

If `/create_listofdates` is current, an omnibox command must not bypass the confirmation introduced in PR #55.

### 6. Conversation Export

V2's `frontend/unibox-export.js` and conversation model let the user export a chat. This is useful later for audit and handoff.

Do not include it in the next runtime PR. It is a later polish once the command surface is real.

## What Opencode Adds

The opencode repo is a useful earlier version of the same idea:

- simpler `frontend/unibox.js`;
- simpler `services/unibox-service.mjs`;
- no heavier configurable-skill runtime;
- same broad product instinct: ask, search, run skills, design skills.

The practical lesson is that Unibox can begin small. The first version does not need v2's full configurable-skill lifecycle.

## Folder Lane Pattern Worth Borrowing

V2 has a stronger matter-folder lane model than this repo currently uses.

In `/Users/aksingh/matter-workbench-v2/shared/matter-contract.mjs`, the top-level matter lanes are:

```text
00_Inbox
10_Library
20_Workshop
30_Drafts
40_Dispatch
```

This is worth adopting because it gives both the lawyer and the omnibox a clear mental model:

```text
Inbox    = what came in
Library  = what we know and can rely on
Workshop = what we are thinking through
Drafts   = what we are preparing
Dispatch = what is ready to send
```

Current repo posture:

- `00_Inbox` is already real and heavily used by `/matter-init` and `/extract`;
- `10_Library` is already real and used for `Source Index.json` and `List of Dates.*`;
- `20_Workshop`, `30_Drafts`, and `40_Dispatch` are now created by `/matter-init` as empty lanes for future work.

Adoption rule:

> Borrow the lane philosophy before borrowing the v2 configurable-skill machinery.

Lane adoption is intentionally conservative:

- define the lane names in this repo's shared matter contract;
- create empty `20_Workshop`, `30_Drafts`, and `40_Dispatch` folders during `/matter-init`;
- keep existing `Source Index.json` and `List of Dates.*` in `10_Library`;
- do not move existing artifacts;
- do not add configurable-skill routing just to justify the folders.

Later, new skills can route outputs naturally:

| Lane | Best use |
|---|---|
| `10_Library` | stable source-backed knowledge: source labels, chronologies, summaries |
| `20_Workshop` | review work: issue notes, fact gaps, contradictions, strategy memos |
| `30_Drafts` | lawyer-facing drafts: notices, pleadings, client emails, applications |
| `40_Dispatch` | final reviewed material ready to send or export |

The Command rail now understands simple lane navigation:

```text
open inbox
open library
open workshop
open drafts
open dispatch
show library
show drafts
open skills
```

Future provider-backed commands may later build on the same lane vocabulary:

```text
prepare a notice draft
what is ready for dispatch?
```

But lane navigation is not document generation. It should stay read-only until a separate draft or dispatch workflow defines what it writes, validates, and overwrites.

## Other V2 Patterns I Initially Underweighted

### 1. Workspace Presentation Is A Product Boundary

V2 has `services/workspace-presentation.mjs`, which keeps the file tree lawyer-readable:

- hides machine files such as `matter.json`, extraction logs, and JSON internals in normal browsing;
- humanizes folders such as `00_Inbox` to `Inbox` and `10_Library` to `Analysis Library`;
- strips `FILE-NNNN__` machine prefixes for display;
- keeps previewability rules in one place.

This matters for omnibox because commands like `open library`, `show drafts`, or `copy chronology` need the same human-facing names the user sees in the file tree.

Adoption guidance:

- when folder lanes are introduced, add or extract a small workspace-presentation helper in this repo;
- do not scatter display-name rules across the tree renderer, command box, and artifact actions;
- keep canonical paths machine-stable while making UI labels lawyer-readable.

### 2. Matter Context Is The Missing Boundary Before Copilot Q&A

V2's `services/matter-context-service.mjs` and `services/matter-context-helpers.mjs` are a useful preview of the future Q&A layer.

They build context from:

- `matter.json`;
- File Registers;
- extraction records;
- selected non-inbox library/work-product records;
- bounded context formatting.

The current repo should not jump straight to Q&A, but it should eventually add a similar **matter context reader** before allowing the omnibox to answer factual questions about the matter.

The contract for that reader now lives in [`docs/matter-context-reader-contract.md`](matter-context-reader-contract.md). Treat that document as the next boundary before implementing any Q&A/search runtime.

Adoption guidance:

- create a source-backed context boundary before adding broad copilot Q&A;
- make citations mandatory for matter-specific factual answers;
- distinguish chat-only answers from durable artifacts;
- keep context collection testable and separate from the model prompt.

### 3. Skills Need A Visible Supervision Surface, Not Just Chat

V2's Skills page is more than configuration UI. It is a supervision surface for:

- saved ideas;
- draft skills;
- active skills;
- draft revisions;
- validation;
- activation;
- restore-as-draft history.

That matters because the omnibox should be allowed to start a skill idea or modification, but it should not hide the lifecycle inside chat.

Adoption guidance:

- let the omnibox collect or route the idea;
- use a visible Skills-style screen later for review, test run, golden, validation, activation, and rollback;
- do not activate reusable skill behavior from a single chat answer.

### 4. No-Matter Gating Should Be Visible Before The Click

V2's Skills smoke notes caught a practical UX bug: matter-required actions looked available even when no matter was active, then failed only after click.

The lesson applies directly to the command box:

- if no matter is selected, commands like `/extract`, `/describe_sources`, `/create_listofdates`, and matter Q&A should say that up front;
- non-matter actions such as settings, skill-idea review, or help can remain available;
- avoid making the user discover context requirements by triggering failed runs.

### 5. Route And Helper Modularity Becomes Valuable Later

V2 split broad route and UI responsibilities into focused modules:

- `routes/workflow-routes.mjs`;
- `routes/skill-router-routes.mjs`;
- `routes/unibox-routes.mjs`;
- `routes/settings-routes.mjs`;
- `routes/matter-routes.mjs`;
- pure frontend helpers such as `unibox-input`, `unibox-suggestions`, `unibox-status`, and `unibox-result-rendering`.

This repo should not refactor just to look like v2. But as Command rail logic
grows, the same pressure will appear.

Adoption guidance:

- start small inside existing files;
- extract pure parser/suggestion/status helpers once tests need direct access;
- split API routes only when route responsibilities become crowded;
- keep business rules in services/engines, not HTTP handlers.

## What Not To Copy

Do not copy these into this repo yet:

- the full v2 right-side Unibox panel layout;
- central Unibox orchestration as the main runtime path;
- configurable skill creation or revision runtime;
- `/new_skill` adaptive interview;
- configurable skill rollback;
- search/Q&A over matter documents;
- auto-running AI-classified commands without local confirmation;
- any durable state that competes with matter files on disk.

These are valuable later, but importing them now would make the stable beta harder to reason about.

## Product Rule For This Repo

The omnibox may make the app easier to operate. It may not make the app less auditable.

Every command should resolve to one of these outcomes:

```text
run an existing explicit skill
show status
open or copy an existing artifact
explain that the command is not supported yet
route a proposed skill/change request for review
```

Every paid or artifact-overwriting action must respect:

- matter pipeline status;
- rerun advice;
- explicit confirmation when current;
- fail-closed provider behavior;
- existing frontend skill runners.

## Recommended Milestones

### Milestone 0: Explicit App Foundation

Mostly complete.

Already landed:

- `/describe_sources` visible in the app;
- matter pipeline status panel;
- paid rerun guardrails;
- rerun status hints;
- List of Dates copy/download actions.

Why this matters:

> A command box is only useful when it can point to reliable underlying actions.

### Milestone 1: Deterministic Command Box V0

Status: implemented in the current Command rail.

Goal:

```text
Use the right-side Command panel to run known commands deterministically.
```

Supported inputs:

```text
/matter-init
/extract
/describe_sources
/create_listofdates
/doctor
show status
status
```

Optional plain-language aliases may be included only if they are static and obvious:

```text
extract
describe sources
source labels
list of dates
chronology
doctor
```

No AI intent classification in this milestone.

The command box should:

1. parse the input locally;
2. show the matched command briefly in the editor/status area;
3. dispatch to the same frontend skill function used by sidebar buttons;
4. let each skill's existing rerun guardrail run normally;
5. show a clear unsupported-command message when there is no deterministic match.

### Milestone 2: Slash Suggestions

Status: implemented for built-in slash skills only.

Add:

- suggestions when input starts with `/`;
- skill purpose/category from `/api/skills`;
- keyboard navigation;
- disabled reason if a command is listed but not runnable;
- no configurable-skill or proposed-skill entries yet.

This should be a separate PR because suggestions are mostly UI behavior and keyboard handling.

### Milestone 3: Status-Aware Command Preview

Use `/api/matter-status` and `/api/rerun-advice` before dispatch.

Example:

```text
Matched: /create_listofdates
Status: current
Existing artifact: 10_Library/List of Dates.md
Clicking run will ask before a paid provider call.
```

For stale:

```text
Matched: /describe_sources
Status: stale
Newer extraction records were found.
Rerun is recommended and will not show overwrite confirmation.
```

This makes the command box feel intelligent without adding AI.

### Milestone 4: AI Intent Routing With Approval

Only after deterministic commands and status preview are boring.

Then allow:

```text
make a chronology
refresh source labels
check this matter
```

The AI router may propose a match, but it should not secretly run.

Required output:

```text
Matched: /create_listofdates
Reason: user asked for a chronology from the current matter
Cost/risk: may call OpenRouter and overwrite List of Dates artifacts
Action: Run /create_listofdates
```

Run only after explicit click/confirm, and still respect rerun advice.

### Milestone 5: Multi-Step Plan Suggestions

After AI routing is safe, the box can propose workflows:

```text
This matter has extraction records but no Source Index.
Suggested plan:
1. Run /describe_sources
2. Run /create_listofdates
```

The first version should not auto-run the whole chain. Each paid step should require the same confirmation rules as direct clicks.

### Milestone 6: Folder Lanes As First-Class Matter Destinations

Adopt v2's folder-lane model as a small repo-foundation slice.

Scope:

- add shared constants for `00_Inbox`, `10_Library`, `20_Workshop`, `30_Drafts`, and `40_Dispatch`;
- create missing lane folders during `/matter-init`;
- update workspace presentation so the lane labels are lawyer-readable;
- centralize hidden-machine-file and display-name rules instead of scattering them through UI code;
- do not move existing artifacts;
- do not add configurable skills in the same PR.

This gives later omnibox commands better destinations:

```text
show workshop
open drafts
prepare this for dispatch
```

### Milestone 7: Matter Context Boundary

Before Q&A/search, create a tested reader for source-backed matter context.

Scope:

- collect matter metadata, file registers, extraction records, and stable library artifacts;
- bound the context size;
- preserve raw `FILE-NNNN pX.bY` citation handles;
- keep context collection separate from the model call;
- add tests for which files are included and excluded.

This gives later copilot mode a safe source boundary.

### Milestone 8: Matter Q&A And Search

V2 has `matter-qa-service.mjs` and `matter-search-service.mjs`.

This repo should not import that yet. Add provider-backed Q&A only after the
context packet and local context search are solid, because Q&A needs a separate
answer contract:

- what sources are searched;
- how citations are displayed;
- whether answers are written to disk;
- whether outputs are chat-only or artifacts.

The first Q&A contract now lives in
[`docs/copilot-qna-contract.md`](copilot-qna-contract.md). Use that document
before implementing `/ask`, `ask <question>`, provider-backed matter answers,
conversation export for Q&A, or citation validation for model answers.

Borrow the v2 idea of answer + sources + confidence, but do not borrow the full
free-text intent classifier as the first step. In this repo, Q&A should start as
an explicit command:

```text
/ask what compensation can Mehta claim?
ask what compensation can Mehta claim?
```

Local context search stays separate:

```text
find payment
search legal notice
```

Search is provider-free retrieval. Q&A is provider-backed synthesis and must
validate citations against `matter-context-packet/v1`.

### Milestone 9: Configurable Skills

This remains later.

The contract for borrowing v2's new-skill creation flow now lives in
[`docs/new-skill-creation-contract.md`](new-skill-creation-contract.md).
Use that document before implementing `/new_skill`, saved ideas, draft
configurable skills, golden validation, or activation.

The contract for changing existing configurable skills now lives in
[`docs/skill-modification-contract.md`](skill-modification-contract.md). Use
that document before implementing `modify skill`, draft revisions, version
activation, stale-draft handling, or rollback.

Before configurable skills enter this repo, require:

- output contracts;
- goldens;
- validation gates;
- draft revisions;
- rollback-as-draft;
- visible applied preferences;
- no mutation of code-backed skills like `/matter-init`, `/extract`, `/describe_sources`, `/create_listofdates`, or `/doctor`.

V2's configurable-skill docs are a useful future map, but this repo should not
copy the full runtime in one slice. Borrow the lifecycle: draft brief, overlap
check, saved idea, draft skill, test, golden, validation, activation. Do not
make a saved idea runnable.

For modification, borrow the revision lifecycle: active skill stays live, change
request creates a draft revision, draft runs by internal revision id, validation
is required, activation keeps the slash stable, and rollback restores old
behavior as a draft rather than live behavior.

## Current Runtime Checkpoint

The deterministic Command rail work has now landed.

Implemented:

- right-side Command rail, not a chat transcript;
- deterministic slash commands and static aliases;
- paid rerun guardrails for `/describe_sources` and `/create_listofdates`;
- slash suggestions;
- `Copy Report`;
- workspace lane navigation;
- local context preview and local context search;
- read-only Skills tab powered by built-in skill stubs.

Not implemented:

- provider-backed Copilot Q&A;
- broad AI intent execution;
- saved skill ideas or proposal inbox;
- draft configurable skills;
- skill modification/revision activation;
- golden validation for user-created skills;
- chat memory.

This is the correct stopping point for Command V0. The next work should add one governance capability at a time, without turning the rail into half-chat.

## Suggested Next Runtime PR

Title:

```text
Add saved skill ideas / proposal inbox
```

Scope:

- let the Command rail capture text such as `I want a skill that...` as a proposed skill idea;
- run the existing skill-router overlap check as a non-executing review step;
- save the idea/proposal only after user confirmation;
- show saved ideas in the read-only Skills tab as a proposal inbox;
- make it clear that saved ideas are not runnable slash commands;
- do not create draft configurable skills yet;
- do not call a provider to run or test the idea;
- do not mutate built-in skill stubs.

Acceptance criteria:

- saving an idea writes only the proposal record or future agreed storage artifact;
- saved ideas appear under a clearly labeled proposal section in Skills;
- built-in Skills tab behavior remains read-only;
- overlap results are visible but cannot directly activate a skill;
- no new provider-backed Q&A or drafting path is introduced.

## Guardrails For Future Command Work

The Command rail must not become a shortcut around safety.

Rules:

- If a skill button would show rerun confirmation, the Command rail must show it too.
- If a skill requires a loaded matter, the Command rail must enforce that through the same skill runner.
- If a provider fails closed, the Command rail must display that failure instead of pretending the command succeeded.
- If the input is ambiguous, do not guess. Show possible commands or route to skill-router as a non-executing check.
- Do not write a separate command execution backend unless the frontend dispatch path becomes unmaintainable.
- Do not let saved ideas, draft skills, or Q&A answers become durable legal artifacts without explicit artifact contracts.

## Decision

Keep borrowing v2 product patterns selectively.

Do not jump to a full v2 Unibox. The current Command rail is useful precisely because it preserves everything that made the beta stable.
