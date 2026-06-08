# Technical Debt Review: Large Files And Accidental Complexity

Date: 2026-05-24
Current refresh: 2026-06-08

Original snapshot reviewed:

- Repo: `/Users/aksingh/matter-workbench`
- Branch: `codex/matter-workbench-checkpoint-2026-05-17`
- HEAD: `dc144a0`
- Worktree state at review start: dirty, ahead of origin by 1 commit
- Review mode: read-only except for this report

Current refresh snapshot:

- HEAD: `32646a5`
- Refresh purpose: update the large-file debt surface after the React-only
  cutover, runtime DB work, and List of Dates engine decomposition.
- Refresh mode: docs plus repo-hygiene guard; no runtime behavior changes.

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
2. The runtime DB bridge is now the largest active service. That is expected
   during transition, but it needs careful boundaries so "temporary bridge"
   does not become a permanent storage monolith.
3. Several large tests are doing valuable regression work, but they are also
   acting as informal fixture libraries because shared builders are thin.
4. Documentation is valuable but now large enough that front-door explanation,
   release evidence, future decisions, and architecture lessons need stricter
   separation.

List of Dates engine decomposition is complete for the first intended slice:
`create-listofdates-engine.mjs` is now an orchestration file of roughly 185
lines, with provider transport, artifact writing, contracts, source-record
loading, rendering, run configuration, metadata merging, and two-pass execution
split under `listofdates/*`. The remaining List of Dates debt is mostly test
fixture bulk, not root-engine size.

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
| `FOR_AKSINGH.md` | 2,441 | Keep large, then curate |
| `services/runtime-db-storage-service.mjs` | 1,705 | Split carefully |
| `test/runtime-db-api.test.mjs` | 1,549 | Split later |
| `test/create-listofdates.test.mjs` | 1,164 | Split later |
| `test/ai-command-box-skill-ideas.test.mjs` | 1,383 | Split later |
| `react-ui/src/styles/global.css` | 1,026 | Split carefully |

Near-threshold watchlist:

| File | Lines | Concern |
| --- | ---: | --- |
| `test/skills-page.test.mjs` | 998 | Legacy view governance tests are bundled together. |
| `scripts/db-hydrate-local-matters.mjs` | 962 | Hydration script is mixing discovery, mapping, and writes. |
| `docs/future-design-decisions/hosted-beta-database-architecture.md` | 942 | Future plan is large enough to need periodic status pruning. |
| `react-ui/src/types/index.ts` | 943 | Type registry is a single bucket for unrelated API domains. |
| `scripts/react-ui-smoke.mjs` | 890 | Browser smoke can become an unreviewable test script. |
| `scripts/db-hydrate-local-skills.mjs` | 881 | Hydration script needs staged helpers if it grows again. |
| `test/api-smoke.test.mjs` | 870 | One smoke file covers too many API contracts. |
| `evals/listofdates/two-pass-model-smoke.mjs` | 842 | Eval script is mixing scenario setup, provider calls, and reporting. |
| `react-ui/src/views/MatterOverview.tsx` | 678 | View includes data loading, pipeline rendering, attention rendering, labels. |
| `react-ui/src/views/SkillsPage.tsx` | 670 | View includes data loading, lifecycle actions, grouping, status copy. |
| `react-ui/src/hooks/useSkillIdeaSessionMachine.ts` | 627 | State machine is near the point where phases should become reducers/actions. |

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

### `test/create-listofdates.test.mjs` - 1,164 lines

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

### `test/runtime-db-api.test.mjs` - 1,549 lines

Verdict: `Split later`

Claimed responsibility: protect the runtime DB bridge API surface while the app
serves React beta flows from Postgres-backed matter state.

Responsibilities absorbed:

- runtime matter index behavior;
- Postgres storage-mode workspace reads;
- file preview/raw-file reads;
- preparation, extraction, source-label, chronology, doctor, copilot, and
  custom-skill route behavior under runtime DB custody;
- runtime DB skill, sample, idea, health, and audit services.

Why could this not have been simpler?

The file is intentionally broad because the DB transition needs one regression
net that proves old filesystem-shaped APIs still work when the matter source is
Postgres-backed. The accidental part was repeated temp-folder, matter, server,
and JSON request setup living inline with route-specific assertions.

Smallest simpler version:

- keep the route assertions in this file while the DB bridge is still settling;
- move common server/matter/request setup into `test-support/` helpers;
- later split by API family only after the shared helpers make each scenario
  small enough to move without hiding coverage.

First cleanup completed:

`test-support/runtime-db-api-fixtures.mjs` now owns the standard runtime DB
matter record, temp path setup, Postgres-mode test server startup, and JSON
request helpers. `test/runtime-db-api-fixtures.test.mjs` proves that fixture
contract independently before the large regression file reuses it.

Risk:

Do not split this file by route until the helper layer has absorbed enough
repeated setup. The current broad regression is still valuable because runtime
DB storage is a bridge, and route-level drift is the practical beta risk.

### `services/runtime-db-storage-service.mjs` - 1,705 lines

Verdict: `Split carefully`

Claimed responsibility: provide filesystem-shaped matter workspace behavior
from runtime DB storage rows.

Responsibilities absorbed:

- workspace tree assembly;
- file preview reads;
- matter status reconstruction;
- artifact and storage-object mapping;
- runtime DB query construction;
- filesystem compatibility behavior;
- source-index/List of Dates freshness checks;
- local-storage object materialization helpers.

Why could this not have been simpler?

This service is intentionally a bridge: it lets the React app and existing
workflow surfaces behave as though they still have a normal matter folder while
the storage source is Postgres plus local object storage. Bridges tend to start
large because they translate two worlds. The risk is that translation,
authorization assumptions, freshness checks, preview reads, and tree rendering
all become one permanent subsystem.

Smallest simpler version:

- keep the current public service surface stable;
- extract query row mappers and tree assembly first;
- extract preview payload reads second;
- leave the high-level service as orchestration over those helpers;
- do not split until runtime DB beta behavior is stable enough to test the
  pieces with confidence.

First safe cleanup:

Add characterization tests before moving code. Then extract pure mappers that
turn DB rows into workspace file/tree objects. That gives size relief without
changing network routes or runtime DB behavior.

Risk:

Do not combine this with schema changes, object-storage policy changes, or
authorization work. A bridge split should reduce file size without changing what
the app can read.

### `create-listofdates-engine.mjs` - 185 lines

Verdict: `Resolved for root-engine size`

List of Dates engine decomposition is complete for the root engine. The file is
now an orchestration shell that delegates to focused modules:

- `listofdates/artifacts.mjs`
- `listofdates/contracts.mjs`
- `listofdates/entries.mjs`
- `listofdates/providers.mjs`
- `listofdates/rendering.mjs`
- `listofdates/run-config.mjs`
- `listofdates/run-metadata.mjs`
- `listofdates/source-records.mjs`
- `listofdates/two-pass-runner.mjs`

What changed:

- prompt/schema and output-contract details moved out of the root engine;
- provider routing/client behavior moved out of the root engine;
- source-record reading and AI-safe block preparation moved out;
- artifact writing and Markdown rendering moved out;
- two-pass candidate/editor orchestration moved out.

Remaining debt:

- `test/create-listofdates.test.mjs` is still large and should get shared
  fixture helpers;
- live eval scripts still mix setup, provider calls, and report formatting;
- the root engine should stay orchestration-sized and should not reabsorb
  prompts, provider transport, or artifact writes.

Guardrail:

`test/repo-hygiene-cleanup.test.mjs` now asserts the root engine remains
orchestration-sized and that this report no longer carries the old 1,497-line
claim.

### `FOR_AKSINGH.md` - 2,441 lines

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
`styles.css`, but it is already 1,026 lines. The first simplification should not
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

The backend is healthier than the large-file list suggests. `server.mjs` is
still small and mostly composes services. Routes are split into visible groups:

- app shell routes;
- matter workflow routes;
- skill factory routes;
- static routes.

Most stable service files remain moderate. The exception is the runtime DB
storage bridge, which has grown above 1,700 lines because it translates DB rows
back into the old matter-folder workspace shape.

The main runtime debt is source-of-truth spread:

1. Built-in command facts live in `shared/builtin-skill-commands.mjs`, built-in
   `skills/builtins/*/skill.json`, React command helpers, route handlers, and
   status/rerun services.
2. Custom skill lifecycle facts live in backend services, React types, React
   views, and legacy view helpers.
3. Provider-routing policy is relatively well-contained in shared policy files,
   and List of Dates provider transport now lives in `listofdates/providers.mjs`
   rather than the root engine.
4. Matter attention is nicely split under `services/matter-attention-*`, but
   React overview still renders too much attention detail in one view.

Recommended runtime simplification order:

1. Keep the runtime DB bridge stable, then extract pure row mappers and tree
   assembly helpers.
2. Add `test-support/listofdates-fixtures.mjs` before splitting the large
   chronology regression file.
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

However, 68 test imports still reference `frontend/*`. That does not mean the
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

1. Extract pure runtime DB row mappers/tree assembly from
   `services/runtime-db-storage-service.mjs`.
2. Add `test-support/listofdates-fixtures.mjs` and shrink the large chronology
   tests without changing assertions.
3. Split React type definitions by API domain once active React work settles.
4. Move stabilized workflow-specific CSS out of the global stylesheet.
5. Migrate one `frontend/*` helper family at a time into `shared/*` or
   `react-ui/src/lib/*`.

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
- `test/create-listofdates.test.mjs`: protects source-backed chronology,
  provider, failure, and legal-language safety.
- `services/runtime-db-storage-service.mjs`: temporarily large bridge from
  runtime DB rows to the existing matter workspace contract.
- `docs/future-design-decisions/hosted-beta-database-architecture.md`: large
  future plan, acceptable if it stays clearly labeled as future/transition.

## Files Large Because Of Accidental Complexity

- `test/ai-command-box-skill-ideas.test.mjs`: legacy facade tests still carry
  current skill-idea product behavior.
- `test/skills-page.test.mjs`: legacy view tests are bundling several product
  contracts.
- `react-ui/src/types/index.ts`: unrelated API domains in one type bucket.
- `react-ui/src/styles/global.css`: active CSS is now above 1,000 lines and
  should not become the new retired `styles.css`.

## Recommended Next PR-Sized Cleanup

Completed cleanup:

- retired root legacy shell files were deleted;
- List of Dates prompts/contracts, provider transport, source-record loading,
  artifact writing, run configuration, metadata merging, and two-pass
  orchestration were extracted from `create-listofdates-engine.mjs`;
- `test-support/listofdates-fixtures.mjs` now owns the first shared List of Dates
  matter/source setup helpers and has its own contract test;
- `test-support/listofdates-fixtures.mjs` also owns standard source-index,
  accepted-entry, and candidate payload builders for the common chronology
  cases;
- `test-support/listofdates-fixtures.mjs` now owns named notice and invalid
  citation payload builders so repeated provider responses read as scenario
  intent instead of raw JSON fixture bulk;
- `test-support/listofdates-fixtures.mjs` now owns named payment, deadline,
  duplicate-notice, separate-payment, and non-merits payload builders used by
  the clustering/filtering scenarios;
- `test-support/runtime-db-api-fixtures.mjs` now owns common runtime DB API
  matter/server/request setup and has its own fixture contract test;
- `test/repo-hygiene-cleanup.test.mjs` now guards the root engine against
  reabsorbing extracted responsibilities.

Next PR-sized cleanup: continue runtime DB fixture extraction only when touching
that route family, then consider pure mapper/tree-assembly extraction from
`services/runtime-db-storage-service.mjs` once characterization tests are in
place. Pause the List of Dates fixture extraction unless new chronology work
needs it.

Expected guardrails:

- Do not change runtime DB API route shapes or storage-mode behavior while
  shrinking the test file.
- Do not change `/api/create-listofdates` behavior.
- Do not reduce scenario coverage around citations, provider policy, failure
  safety, label refresh, or two-pass candidate ledgers.
- Keep the root List of Dates engine under the repo-hygiene guard.

Why now:

- The root List of Dates engine split is done, and the remaining chronology
  test bulk is no longer the highest-risk active transition surface.
- Runtime DB behavior is now the beta-critical bridge; shrinking repeated test
  setup makes future DB fixes easier to review without changing app behavior.
- Service extraction should follow characterization coverage, not lead it.

## Current Caution

Do not treat this report as permission to refactor everything large. The current
pragmatic order is:

1. keep beta deployment boring and observable;
2. preserve runtime DB behavior while testers use the app;
3. shrink high-churn files through characterization tests and pure helper
   extraction, one family at a time.

## Verification Performed

Commands used for the original review:

- `git status --short --branch`
- `git rev-parse --short HEAD`
- `git ls-files ... | xargs wc -l`
- targeted `rg`, `sed`, `find`, `wc`, and `ls`

Commands used for the 2026-06-08 refresh:

- `git status --short --branch`
- `git rev-parse --short HEAD`
- `git ls-files -z ... | xargs -0 wc -l`
- `node --test test/listofdates-fixtures.test.mjs test/create-listofdates.test.mjs test/repo-hygiene-cleanup.test.mjs`
- `node --test test/repo-hygiene-cleanup.test.mjs`
- `npm test --silent`
- `npm run ui:typecheck --silent`
- `npm run ui:build --silent`
- `git diff --check`

Commands used for the 2026-06-08 runtime DB test-helper cleanup:

- `node --test test/runtime-db-api-fixtures.test.mjs`
- `node --test test/runtime-db-api-fixtures.test.mjs test/runtime-db-api.test.mjs`
- `node --test test/runtime-db-api-fixtures.test.mjs test/runtime-db-api.test.mjs test/repo-hygiene-cleanup.test.mjs`
- `git diff --check`
- `npm run ui:typecheck --silent`
- `npm run ui:build --silent`
- `npm test --silent`

The refresh is still a debt-report update, not a runtime behavior change. The
new repo-hygiene test guards both the report freshness and the List of Dates
root-engine boundary. The runtime DB cleanup adds a tested fixture module and
shrinks the regression file without changing product routes or storage
behavior.
