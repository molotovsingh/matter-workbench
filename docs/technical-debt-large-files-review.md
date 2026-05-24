# Technical Debt Review: Large Files And Accidental Complexity

Date: 2026-05-24

Snapshot reviewed:

- Repo: `/Users/aksingh/matter-workbench`
- Branch: `codex/matter-workbench-checkpoint-2026-05-17`
- HEAD: `dc144a0`
- Worktree state at review start: dirty, ahead of origin by 1 commit
- Review mode: read-only except for this report

Important dirty or untracked paths already present before this report:

- `FOR_AKSINGH.md`
- `README.md`
- `docs/TECHNICAL_APPRECIATION.md`
- `docs/codebase-diagram.md`
- `docs/future-design-decisions/README.md`
- `docs/releases/v1.0.0-beta.2.md`
- `package.json`
- `react-ui/src/views/ActivityPage.tsx`
- `react-ui/src/views/SettingsPage.tsx`
- `react-ui/src/views/SkillsPage.tsx`
- `routes/static-routes.mjs`
- `server.mjs`
- several tests under `test/`
- untracked `db/`
- untracked `docs/future-design-decisions/react-only-cutover-database-transition.md`

This review intentionally does not judge the untracked database work or the
active React/static-route edits as final architecture. It records them as
active work and focuses on the current large-file debt surface.

## Executive Verdict

The repo's biggest accidental complexity is no longer the core legal workflow.
The deterministic spine is comparatively understandable:

```text
/matter-init -> /extract -> /describe_sources -> /create_listofdates
```

The bigger debt is transitional:

1. The app is now React-only, but the retired plain-JS UX still occupies a large
   amount of tracked code and test surface.
2. `create-listofdates-engine.mjs` is legitimately domain-heavy, but it has
   absorbed prompts, provider clients, filesystem reads, validation, hydration,
   artifact writing, and markdown rendering into one file.
3. Several large tests are doing valuable regression work, but they are also
   acting as informal fixture libraries because shared builders are thin.
4. Documentation is valuable but now large enough that front-door explanation,
   release evidence, future decisions, and architecture lessons need stricter
   separation.

Large files are not automatically bad here. A legal workbench has real domain
weight. The useful distinction is:

- necessary complexity: legal chronology rules, source-backed outputs, provider
  safety, matter-folder compatibility;
- accidental complexity: retired UI still tracked, duplicated React/vanilla
  contracts, giant CSS, tests that repeat setup instead of naming reusable
  scenarios.

## Line-Count Surface

Current tracked files over 1,000 lines:

| File | Lines | Verdict |
| --- | ---: | --- |
| `test/create-listofdates.test.mjs` | 1,599 | Split later |
| `create-listofdates-engine.mjs` | 1,497 | Split later |
| `FOR_AKSINGH.md` | 1,395 | Keep large, then curate |
| `test/ai-command-box-skill-ideas.test.mjs` | 1,383 | Split later |

Near-threshold watchlist:

| File | Lines | Concern |
| --- | ---: | --- |
| `test/skills-page.test.mjs` | 998 | Legacy view governance tests are bundled together. |
| `react-ui/src/styles/global.css` | 965 | Active CSS is close to becoming the next monolith. |
| `docs/future-design-decisions/hosted-beta-database-architecture.md` | 942 | Future plan is large enough to need periodic status pruning. |
| `test/api-smoke.test.mjs` | 870 | One smoke file covers too many API contracts. |
| `react-ui/src/types/index.ts` | 847 | Type registry is a single bucket for unrelated API domains. |
| `evals/listofdates/two-pass-model-smoke.mjs` | 842 | Eval script is mixing scenario setup, provider calls, and reporting. |
| `scripts/react-ui-smoke.mjs` | 766 | Browser smoke can become an unreviewable test script. |
| `test/source-descriptors-engine.test.mjs` | 754 | Provider/client behavior and source-label validation are coupled. |
| `react-ui/src/views/MatterOverview.tsx` | 678 | View includes data loading, pipeline rendering, attention rendering, labels. |
| `react-ui/src/views/SkillsPage.tsx` | 614 | View includes data loading, lifecycle actions, grouping, status copy. |
| `react-ui/src/hooks/useSkillIdeaSessionMachine.ts` | 607 | State machine is near the point where phases should become reducers/actions. |

## Large-File Tribunal

### Root Legacy Shell Files - Deleted In The React-Only Cutover

Verdict: `Deleted`

Deleted files:

- `index.html`
- `app.js`
- `styles.css`

Why could this not have been simpler?

It can be simpler now because the backend no longer serves these files. Current
static routing resolves `/` and `/react/` to `react-dist/index.html`, rejects
`/styles.css`, `/index.html`, and `/app.js`, and `server.mjs` reports `uiShell`
as `react`.

Smallest simpler version:

- no root-level legacy stylesheet;
- active styles live in `react-ui/src/styles/global.css` until component-level
  extraction is worth it;
- tests keep asserting that legacy shell files are not served.

First cleanup completed:

Deleted `styles.css`, `index.html`, and `app.js` in the React-only cutover. Keep
`test/static-routes.test.mjs`,
`test/server-ui-shell.test.mjs`, and `test/repo-hygiene-cleanup.test.mjs`
assertions that the legacy shell is retired.

Risk:

Some tests still import legacy `frontend/*` helpers. Do not delete the whole
`frontend/` folder in the same PR. Separate retired browser entrypoints from
pure helpers that tests still use.

### `test/create-listofdates.test.mjs` - 1,599 lines

Verdict: `Split later`

Claimed responsibility: protect `/create_listofdates` behavior.

Responsibilities absorbed:

- fixture matter creation;
- intake and extraction setup;
- source-index fixture writing;
- one-pass list-of-dates behavior;
- two-pass candidate-ledger behavior;
- failure safety;
- label refresh safety;
- source-label filtering;
- clustering behavior;
- provider request-shape tests for OpenAI and OpenRouter;
- model-policy override behavior.

Why could this not have been simpler?

The behavior under test is genuinely important, but the file is doing two jobs:
scenario coverage and fixture framework. Every new chronology rule adds more
matter setup, provider payloads, and artifact assertions in the same file.

Smallest simpler version:

- `test-support/listofdates-fixtures.mjs` owns matter setup, extraction records,
  source indexes, provider stubs, and common lawyer-field rows;
- one test file covers engine/artifact behavior;
- one test file covers provider request shapes;
- one test file covers legal normalization and filtering.

First safe cleanup:

Extract only fixture helpers first. Do not split assertions until the helper
module has no behavior of its own and the current tests still read clearly.

Risk:

This file is protecting paid-provider safety, source-backed citation discipline,
and failure behavior. A cosmetic split that weakens scenario readability would
be worse than the current size.

### `create-listofdates-engine.mjs` - 1,497 lines

Verdict: `Split later`

Claimed responsibility: run `/create_listofdates`.

Responsibilities absorbed:

- prompt text and JSON schemas;
- one-pass and two-pass orchestration;
- OpenAI and OpenRouter provider clients;
- provider policy resolution;
- matter and intake reads;
- extraction-record loading;
- source-index loading;
- source block chunking;
- meta/index source filtering;
- candidate validation;
- final entry validation;
- legal-language normalization;
- high-risk conclusion softening;
- clustering handoff;
- artifact writing;
- markdown rendering.

Why could this not have been simpler?

Some of this belongs together because chronology output is source-backed and
lawyer-facing. But provider transport, prompt/schema definitions, filesystem
record reads, validation/hydration, and markdown rendering do not need to live
in the same file forever.

Smallest simpler version:

- `listofdates/prompts.mjs`: system prompts and schemas;
- `listofdates/providers.mjs`: OpenAI/OpenRouter provider clients;
- `listofdates/source-blocks.mjs`: read extraction records, source index, chunk
  blocks, filter meta/index sources;
- `listofdates/validation.mjs`: candidate and entry validation/hydration plus
  legal-language normalization;
- `listofdates/artifacts.mjs`: JSON/CSV/Markdown output assembly and writes;
- `create-listofdates-engine.mjs`: orchestration only.

First safe cleanup:

Extract prompts and schemas first. That is the least behavior-sensitive move
and immediately makes the engine easier to scan. Extract provider clients
second, because provider request-shape tests already exist.

Risk:

Do not split the one-pass/two-pass orchestration before beta behavior is stable.
The failure-safe candidate ledger path and final artifact overwrite behavior
are too important to scatter prematurely.

### `FOR_AKSINGH.md` - 1,395 lines

Verdict: `Keep large, then curate`

Claimed responsibility: explain the whole project plainly.

Responsibilities absorbed:

- product narrative;
- runtime setup;
- folder model;
- engine explanations;
- server and frontend architecture;
- bug history;
- beta lessons;
- React migration lessons;
- product policy lessons.

Why could this not have been simpler?

This file is intentionally a teaching artifact, and the user-level instructions
explicitly ask for a detailed `FOR_AKSINGH.md`. Its size is not the same kind of
debt as a 1,500-line engine file.

Smallest simpler version:

- keep this as the readable front door;
- move dense reference material into focused docs once a section becomes more
  reference than explanation;
- keep links from `FOR_AKSINGH.md` to those focused docs.

First safe cleanup:

Do not shrink it mechanically. Instead, when the React-only cutover settles,
move stale legacy-frontend inventories and old migration lessons into a
dedicated archive/reference doc, then keep a short explanation and link here.

Risk:

Over-pruning this file would remove the project's learning layer. The problem
is not length by itself; the problem is stale or duplicate lessons living beside
current architecture.

### `test/ai-command-box-skill-ideas.test.mjs` - 1,383 lines

Verdict: `Split later`

Claimed responsibility: protect the legacy command-box skill-idea flow.

Responsibilities absorbed:

- explicit new-skill mode;
- deterministic planner fallback;
- model-planned interviews;
- save/design-brief behavior;
- sample generation;
- sample approval;
- skill creation;
- overlap gates;
- matter-switch attribution;
- adjacent native-skill improvement detection.

Why could this not have been simpler?

It is testing a complex conversation state machine through a retired plain-JS
facade. The tests are valuable because React parity depends on these contracts,
but their current home makes legacy UI look more alive than it is.

Smallest simpler version:

- move shared behavior fixtures into `test-support/ai-command-box-helpers.mjs`
  or a new `test-support/skill-idea-flow-fixtures.mjs`;
- split tests by product phase: intent/planning, interview/save, sample/review,
  creation/overlap;
- add React parity tests for the contracts that still matter;
- retire legacy-facade tests once React owns the behavior.

First safe cleanup:

Extract repeated flow setup and sample payload builders. Then create a smaller
React parity target before deleting legacy facade assertions.

Risk:

The wrong deletion would remove coverage around paid custom-skill creation and
sample approval. Keep behavior tests until React has equivalent coverage.

## Near-Threshold Findings

### Active React CSS: `react-ui/src/styles/global.css`

Verdict: watch closely.

The file is organized with section comments and is far smaller than retired
`styles.css`, but it is already 965 lines. The first simplification should not
be a styling rewrite. Instead, prevent it from becoming another 4,000-line
catch-all:

- move workflow-specific styles beside workflow components only when those
  components stabilize;
- keep app shell, tokens, and global layout in the global file;
- do not copy legacy CSS classes forward unless React uses them.

### React types: `react-ui/src/types/index.ts`

Verdict: split later by API domain.

This file is a single typed mirror for matters, skills, AI settings, commands,
extraction, source descriptors, chronology, doctor, context, copilot, and
preparation. That is tolerable during migration, but the simpler shape is:

- `types/matter.ts`;
- `types/skills.ts`;
- `types/workflows.ts`;
- `types/ai.ts`;
- `types/context.ts`;
- `types/ui.ts`;
- index barrel exports only.

Do this after active React work settles, because type movement touches many
imports and can create churn without product benefit.

### `test/skills-page.test.mjs`

Verdict: split later.

This is a bundled governance test for legacy Skills and Activity views. It has
useful assertions around receipts, secrets, review packets, implementation
briefs, and no-matter planning. The debt is that it mixes unrelated product
concerns because those concerns historically lived in the same legacy page.

Recommended split:

- skill registry/governance rendering;
- custom skill version lineage and receipts;
- skill idea implementation brief/review packet;
- activity page receipt behavior.

### `test/api-smoke.test.mjs`

Verdict: split later.

The first smoke test alone spans a large public-route acceptance path, and later
tests cover provider model routing and overlap checks. Keep the top-level smoke,
but move provider-specific and overlap-specific checks to narrower route tests
once active API work pauses.

### `react-ui/src/views/MatterOverview.tsx`

Verdict: split later.

This view owns metadata display, preparation pipeline loading, preparation
progress rendering, rerun advice copy, matter-attention loading, evidence
formatting, and native skill button state. The obvious extraction is:

- `MatterPipelineCard`;
- `MatterAttentionCard`;
- `MatterMetadataSummary`;
- `NativeSkillActions`.

Do not split while the other Codex app is touching React views.

### `react-ui/src/views/SkillsPage.tsx`

Verdict: split later.

This view owns data fetching, lifecycle calls, custom skill runs, built-in
grouping, intro persistence, and row rendering. It is not yet above 1,000 lines,
but it is a future bloat candidate. The first extraction should be low-risk:

- keep API loading in the page;
- move row/card rendering into pure components;
- move lifecycle labels into `react-ui/src/lib/`.

### `react-ui/src/hooks/useSkillIdeaSessionMachine.ts`

Verdict: split later.

The hook is a real state machine but still uses hook-local callbacks and phase
flags. It will get hard to reason about if more phases are added. The next
simpler shape is a reducer plus action helpers, not more hook-local branching.

## Runtime Complexity Map

The backend is healthier than the large-file list suggests. `server.mjs` is only
202 lines and mostly composes services. Routes are split into visible groups:

- app shell routes;
- matter workflow routes;
- skill factory routes;
- static routes.

Service file sizes are mostly below 450 lines. The largest service,
`services/prepare-matter-service.mjs`, is 430 lines and not a crisis.

The main runtime debt is source-of-truth spread:

1. Built-in command facts live in `shared/builtin-skill-commands.mjs`, built-in
   `skills/builtins/*/skill.json`, React command helpers, route handlers, and
   status/rerun services.
2. Custom skill lifecycle facts live in backend services, React types, React
   views, and legacy view helpers.
3. Provider-routing policy is relatively well-contained in shared policy files,
   but list-of-dates still embeds provider clients locally.
4. Matter attention is nicely split under `services/matter-attention-*`, but
   React overview still renders too much attention detail in one view.

Recommended runtime simplification order:

1. Finish React-only cleanup before deeper service movement.
2. Extract list-of-dates prompts/schemas and providers.
3. Split React type domains.
4. Consolidate command metadata so UI labels, route availability, and skill
   registry cards drift less often.

## Frontend Duplication Map

The current product shell is React-only:

- `server.mjs` hard-codes `uiShell = "react"`;
- `routes/static-routes.mjs` serves `react-dist/index.html` for `/` and
  `/react/`;
- `test/static-routes.test.mjs` asserts `/index.html`, `/app.js`, and
  `/styles.css` are not served;
- `test/server-ui-shell.test.mjs` asserts even `MWB_UI_SHELL=legacy` resolves
  to React.

That leaves named retired `frontend/*` entrypoints as the next accidental bloat.
The root shell files have already been removed, along with unimported legacy
browser wiring files `frontend/event-wiring.js` and `frontend/state.js`. The
unimported `frontend/skills/*.js` browser workflow modules have also been
deleted; React workflow views and backend routes are now the live path. The old
plain-JS Add Files and Extract result views were removed in the same cleanup
because React owns those screens and no tests or product imports referenced the
legacy files. The legacy matter-screen facade and old Settings renderer have
also been retired; React owns matter landing, navigation, and Settings as product
surfaces.

However, 65 test imports still reference `frontend/*`. That does not mean the
legacy browser shell is alive. It means useful pure helpers and legacy parity
tests have not all moved to React/shared owners yet.

Do not delete `frontend/` wholesale. Use three buckets:

1. Migrate valuable helpers: escaping, command parsing, markdown preview,
   receipt formatting, sample review, skill idea classification.
2. Keep temporary legacy tests only until React/shared replacements protect the
   same contract.

## Test Debt Review

The test suite is carrying product memory. That is good for a legal workflow,
but it creates big files when tests are also responsible for fixture setup.

Priority test debt:

1. `test/create-listofdates.test.mjs` needs a list-of-dates fixture module.
2. `test/ai-command-box-skill-ideas.test.mjs` needs phase-based split and React
   parity targets.
3. `test/skills-page.test.mjs` needs governance, receipt, and skill-idea packet
   separation.
4. `test/api-smoke.test.mjs` should remain a smoke, not become the home for all
   route/provider edge cases.
5. `test/source-descriptors-engine.test.mjs` should separate provider transport
   tests from source-label validation tests.

Do not start by deleting tests. Start by extracting fixtures that make the
current tests shorter without changing behavior.

## Docs And Artifact Bloat

Tracked generated artifacts are not currently the main problem. `.gitignore`
already ignores `react-dist/`, `.local/`, `output/`, `tmp/`, local config JSON,
and runtime ledgers. `git ls-files` showed no tracked files under `.local`,
`output`, `tmp`, or `react-dist`.

Documentation bloat is real but mostly productive:

- `docs/README.md` gives a useful authority map.
- `docs/archive/` clearly marks historical planning notes.
- `docs/future-design-decisions/README.md` is the right ledger for future work.
- `FOR_AKSINGH.md` is intentionally a teaching front door.

The risk is stale current-vs-future signaling. Large future notes should not
silently become implementation authority. Keep the current pattern:

- current contracts in `docs/contracts/` or focused current docs;
- future decisions in `docs/future-design-decisions/`;
- superseded plans in `docs/archive/`;
- `FOR_AKSINGH.md` as explanation, not the canonical contract.

## Top 5 Simplification Opportunities

1. Delete retired root legacy shell files: `styles.css`, `index.html`, `app.js`.
2. Extract list-of-dates prompts/schemas from `create-listofdates-engine.mjs`.
3. Extract list-of-dates provider clients from `create-listofdates-engine.mjs`.
4. Add `test-support/listofdates-fixtures.mjs` and shrink the large chronology
   tests without changing assertions.
5. Split React type definitions by API domain once active React work settles.

## Top 5 Refactors To Avoid For Now

1. Do not delete all of `frontend/`; many tests still depend on useful helpers.
2. Do not split one-pass/two-pass list-of-dates orchestration while beta
   chronology behavior is still moving.
3. Do not rewrite `react-ui/src/styles/global.css` into component CSS during
   active React feature work.
4. Do not combine React-only cleanup with database transition work.
5. Do not prune `FOR_AKSINGH.md` mechanically; curate stale sections only.

## Files Large But Probably Justified

- `FOR_AKSINGH.md`: intentional teaching artifact.
- `create-listofdates-engine.mjs`: domain-heavy, though it should be split
  later.
- `test/create-listofdates.test.mjs`: protects source-backed chronology,
  provider, failure, and legal-language safety.
- `docs/future-design-decisions/hosted-beta-database-architecture.md`: large
  future plan, acceptable if it stays clearly labeled as future/transition.

## Files Large Because Of Accidental Complexity

- `test/ai-command-box-skill-ideas.test.mjs`: legacy facade tests still carry
  current skill-idea product behavior.
- `test/skills-page.test.mjs`: legacy view tests are bundling several product
  contracts.
- `react-ui/src/types/index.ts`: unrelated API domains in one type bucket.

## Recommended First PR-Sized Cleanup

First cleanup completed: the retired root legacy shell files have been deleted.

Next PR-sized cleanup: migrate one `frontend/*` helper family at a time into
`shared/*` or `react-ui/src/lib/*`, then delete the corresponding retired
legacy facade once React/shared tests cover the same contract.

Expected guardrails:

- Keep `routes/static-routes.mjs` serving only `react-dist`.
- Keep `test/static-routes.test.mjs` assertions that legacy files are not
  served.
- Keep `test/server-ui-shell.test.mjs` assertion that legacy shell opt-in no
  longer changes the product shell.
- Keep `frontend/*` untouched in this first cleanup.

Why first:

- It removes the single largest file in the repo.
- It aligns code with existing React-only routing.
- It does not disturb backend legal engines.
- It is easy to revert if some hidden script unexpectedly depends on the files.

## Do Not Touch During Active Codex App Work

Avoid touching these until the active app session lands or is explicitly paused:

- `server.mjs`
- `routes/static-routes.mjs`
- `react-ui/src/views/ActivityPage.tsx`
- `react-ui/src/views/SettingsPage.tsx`
- `react-ui/src/views/SkillsPage.tsx`
- `package.json`
- `docs/future-design-decisions/react-only-cutover-database-transition.md`
- `db/`
- current release/docs files already modified in the dirty worktree

## Verification Performed

Commands used for this review:

- `git status --short --branch`
- `git rev-parse --short HEAD`
- `git ls-files ... | xargs wc -l`
- targeted `rg`, `sed`, `find`, `wc`, and `ls`

No app tests were run for this report. This was a static architecture/debt
review, and the worktree was already dirty from a parallel Codex app session.
