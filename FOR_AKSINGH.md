# Matter Workbench, Explained for Aksingh

This file is the plain-English map of the project. If you come back after a week away, read this before opening random files. It explains what Matter Workbench is, how the pieces fit together, what decisions we made, what went wrong along the way, and what good engineering lessons are hiding inside the work.

## The One-Sentence Version

Matter Workbench turns a messy legal matter folder into a structured, source-backed workspace, then helps produce a lawyer-facing List of Dates where every event remains traceable to raw `FILE-NNNN pX.bY` evidence.

It is not trying to be a magical legal chatbot. It is closer to a disciplined junior chamber clerk:

- preserve the brief;
- number the documents;
- extract the record;
- label the sources;
- prepare a chronology;
- keep every claim tied back to the file.

## The Product Idea

Legal work starts with mess. Clients send PDFs, emails, receipts, photos, Word files, scans, WhatsApp exports, and occasionally a file named something like `final final use this one.pdf`. The first job is not drafting a petition. The first job is turning the mess into a record a lawyer can trust.

Matter Workbench is a local-first legal workbench for that job.

The current pipeline is:

```text
/matter-init
  -> /extract
  -> /describe_sources
  -> /create_listofdates
```

Each step leaves artifacts on disk. That is intentional. A legal workflow should not depend on memory inside a chat window. It should create files a lawyer can inspect, diff, copy, print, and challenge.

For the current codebase diagram, lifecycle map, provider paths, persistent artifacts, and eval tooling, see:

```text
docs/codebase-diagram.md
```

## Home Mode vs Matter Mode

The shell now has two clear modes.

**Home Mode** is the front desk. It is where you find an existing matter, add a new matter, continue the last matter, or start a reusable skill idea. The left navigation stays calm and global. The matter file tree is hidden because there is no active matter to inspect.

**Matter Mode** is the working table. Once a matter is opened, the sidebar becomes a file/workspace panel for that one matter. It should not also behave like a matter switcher. If you want to change matters, go Home and search again.

This split matters because lawyers should always know what context the app is acting on. When there is no matter selected, the app should not pretend that matter-specific files, actions, or outputs are available.

The visual theme is token-based in `styles.css`: dark navigation, warm work surface, quiet borders, restrained cards, and small legal-workbench accents. That lets Home, Skills, Activity, Settings, and matter pages share a design language without rewriting each feature surface.

## The Current Beta State

The project is now beta-ready for supervised use.

That means:

- the core pipeline runs end to end on real local matters;
- extraction is stable on the available matters;
- Mistral OCR can be enabled for scanned PDFs;
- source descriptions can create lawyer-readable labels through OpenRouter;
- List of Dates output now includes lawyer-facing fields;
- meta files like manifests and indexes are filtered before chronology generation;
- repeated chronology rows can be clustered;
- payment discrepancies are explicitly flagged;
- raw citations like `FILE-0001 p1.b2` are preserved.

It does not mean:

- the output is court-ready without review;
- the model never misses an event;
- legal relevance can be trusted blindly;
- all clusters are perfect;
- provider calls will never fail.

The correct status is:

```text
lawyer-review-ready, not lawyer-replacement-ready
```

## How to Run It

Start the app:

```sh
npm start
```

The app runs at:

```text
http://127.0.0.1:4173/
```

The default local matters home is controlled by `services/config-service.mjs` and local `config.json`. On this machine it has been used with:

```text
/Users/aksingh/matters-matter-workbench
```

For direct CLI testing, set `MATTER_ROOT`:

```sh
MATTER_ROOT="/absolute/path/to/matter" node matter-init-engine.mjs --apply
MATTER_ROOT="/absolute/path/to/matter" node extract-engine.mjs --apply
MATTER_ROOT="/absolute/path/to/matter" node source-descriptors-engine.mjs --apply
MATTER_ROOT="/absolute/path/to/matter" node create-listofdates-engine.mjs --apply
```

Run tests:

```sh
npm test
```

Developer attention sweep:

```sh
npm run matter-attention:report -- --only-problems
```

This is a read-only diagnostic view over all matters in the configured matters home. It answers: “which matters are blocked, which need developer review, and what artifact proves it?” Use `--json` when you want machine-readable output, or `--matter "Matter Name"` when you want to inspect one matter without changing the active matter in the app.

The app now uses the same idea in the active matter overview. The **Developer attention** card is a compact matter health board: blocker count, warning count, and a bounded list of evidence-backed items. It is deliberately diagnostic, not a polished lawyer-facing alarm. That distinction matters because developers need paths, source ids, run ids, and log clues; lawyers need calmer readiness language.

The important product boundary is now written down: **Matter Attention** is not
**System Health**. Matter Attention asks, "what is broken in this matter?"
System Health, parked as a future feature, asks, "is the app configured,
connected, writable, and operational?" Keeping those separate prevents a
provider-key failure, unreadable matters home, or global route problem from
masquerading as a defect in one matter's lifecycle.

## Clean-Slate Beta Testing Lesson

On 2026-05-17 we ran a real **Mode A** beta pass: move generated matter artifacts
to backup, keep `matter.json` plus the real source files, then import and run the
matter path again as a beta user would. The detailed report is here:

```text
docs/v1-beta-mode-a-acceptance-2026-05-17.md
```

That test found four useful engineering lessons. After the first fixes, we ran a
fresh clean Mode A pass again and all six real matters passed: `6/6 passed, 0
failed`. That matters because we did not only repair the visible artifacts; we
proved the beta-user path from source files and matter metadata.

First, old artifacts can make the app look healthier than it is. A rerun over
existing `10_Library` files is not the same as a first-run import. Clean-slate
testing exposed source-label timeouts and a model-copied hash mismatch that a
normal rerun could have hidden.

Second, source identity must belong to the backend, not the model. The model is
allowed to suggest labels and dates, but hashes and source paths come from
extraction records. If a model copies a 64-character hash incorrectly, the app
should not treat the real file as corrupt.

Third, long legal jobs need patient infrastructure. Techbeliever generated a
large List of Dates, but the test harness hit Node fetch's default header
timeout before the app responded. The artifact was present on disk; the harness
was impatient. That is why long native-skill acceptance now uses an explicit
`http.request` path instead of relying on default fetch behavior.

Fourth, provider failures need two kinds of precision: retry only where it is
safe, and preserve the real upstream error when it is not. Source Labels now
retries transient per-batch failures, but it still fails closed instead of
quietly pretending another model completed the work. When OpenRouter returns an
upstream provider error, the app keeps enough detail for a developer to diagnose
the real failure class.

## Important Local Config

Copy `.env.example` to `.env` and fill only the keys you intend to use.

For the current beta path:

```text
MISTRAL_OCR_ENABLED=1
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
OPENROUTER_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS=6000
```

Keep provider failures fail-closed. Do not silently fall back to a different model for lawyer-facing work until the fallback model has been tested.

## The Folder Story

A matter folder becomes structured like this:

```text
Matter Name/
  matter.json
  00_Inbox/
    Intake 01 - Initial/
      Source Files/
      Originals/
      By Type/
      File Register.csv
      Intake Log.csv
      Extraction Log.csv
      _extracted/
        FILE-0001.json
        FILE-0001.txt
  10_Library/
    Source Index.json
    List of Dates.json
    List of Dates.csv
    List of Dates.md
  20_Workshop/
  30_Drafts/
  40_Dispatch/
```

The naming is deliberately boring. In legal work, boring structure is power. The folder tree is not decoration; it is the audit trail.

The app now treats these top-level folders as **lanes**:

- `00_Inbox` is where evidence arrives and is preserved.
- `10_Library` is the analysis library: source labels, chronologies, and other source-backed outputs.
- `20_Workshop` is for lawyer thinking: issues, contradictions, fact gaps, and strategy notes.
- `30_Drafts` is for draft legal outputs.
- `40_Dispatch` is for reviewed material that is ready to send or export.

The explorer can show friendly names like **Analysis Library**, but the disk keeps the canonical folder names. That split is intentional: lawyers get readable labels, engineers and audits get stable paths.

## The Engines

The app is split into engines. That is one of the best decisions in the project.

### `matter-init-engine.mjs`

This is the intake clerk.

It:

- validates matter metadata;
- creates the initial matter structure;
- preserves untouched originals;
- creates working copies under `By Type`;
- hashes files with SHA-256;
- assigns stable `FILE-NNNN` ids;
- writes `File Register.csv` and `Intake Log.csv`;
- filters junk like OS metadata and Office lockfiles before registration.

Good lesson: never let AI touch the intake ledger. Intake is deterministic work.

### `extract-engine.mjs`

This is the record extractor.

It reads `File Register.csv`, opens supported working-copy files, and writes `extraction-record/v1` JSON plus a text companion.

Supported routes include:

- PDFs through `pdfjs-dist`;
- DOCX through `mammoth`;
- RTF;
- text and Markdown;
- spreadsheets through `xlsx`;
- EML email through `mailparser`.

For scanned PDFs, extraction can use Mistral OCR, but only when explicitly enabled:

```text
MISTRAL_OCR_ENABLED=1
```

The extraction log now records OCR observability:

- whether OCR was applied;
- provider/model;
- low-confidence page count;
- needs-review page count;
- provider warning count.

Good lesson: add observability before adding fallback logic. If you cannot see what happened, you cannot safely automate the next decision.

### `source-descriptors-engine.mjs`

This is the source-labeling clerk.

It reads extraction records and writes:

```text
10_Library/Source Index.json
```

`Source Index.json` gives each file a lawyer-readable identity:

```text
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026
```

But it does not replace the raw file id. The source descriptor contract preserves:

- `file_id`;
- `sha256`;
- `source_path`;
- evidence citations;
- document type;
- document date;
- parties;
- warnings and confidence.

The engine rejects provider output that cites the wrong file, invents missing required fields, produces impossible dates, or pollutes human labels with `FILE-0001` prefixes.

Good lesson: if AI is allowed to describe a source, it must not be allowed to mutate the source identity.

The provider wiring for this skill now lives in `source-descriptors-provider.mjs`. That file owns the OpenRouter request shape, model-policy resolution, timeout behavior, and fake-provider metadata used by tests.

The bounded packet builder now lives in `source-descriptors-packets.mjs`. That file decides how much source text is safe to show the labeling provider: file identity, extraction summary, selected blocks, and truncation limits.

The Source Index contract now lives in `source-descriptors-validation.mjs`. That module owns the output schema, descriptor validation, evidence checks, lawyer-facing label safety, and normalization into label-governance fields. The engine keeps the legal artifact responsibilities: reading matter files, asking the provider, and writing `Source Index.json`. This is the right split because model-routing risk, source-record integrity, packet budgeting, and matter-folder IO are different kinds of work.

### `create-listofdates-engine.mjs`

This is the chronology builder.

It reads extraction records and source labels, filters out meta/index-style blocks, sends only chronology-eligible material to the AI provider, then writes:

```text
10_Library/List of Dates.json
10_Library/List of Dates.csv
10_Library/List of Dates.md
```

The chronology is now lawyer-facing. Each event includes:

- `date_iso`;
- `event`;
- `event_type`;
- `legal_relevance`;
- `issue_tags`;
- `perspective`;
- raw `citation`;
- source label fields;
- cluster metadata.

The Markdown is intentionally review-friendly:

```text
Date | Event | Legal Relevance | Source
```

The important rule:

```text
Readable label first, raw citation preserved.
```

Example:

```text
Legal Notice from Mehta Legal LLP to Skyline Developers Pvt Ltd, 20 April 2026 (FILE-0001 p1.b2)
```

That is the balance we wanted. The lawyer can read the source name. The audit trail still points to the exact extracted block.

## Clustering: Why It Exists

Legal chronologies often contain repeats:

- bank statement records payment;
- receipt acknowledges the same payment;
- email discusses the same payment;
- agreement schedule names the installment.

If every supporting source becomes a separate row, the List of Dates becomes noisy. If we blindly dedupe, we lose useful corroboration. So the app now classifies clusters.

Cluster types include:

- `single_event`;
- `corroborated_event`;
- `payment_discrepancy`;
- `source_repeat`;
- `true_duplicate`.

For corroborated events, Markdown shows one lead row and lists supporting sources in the Source cell.

For payment discrepancies, the row stays explicit:

```text
Payment discrepancy: same-date sources record inconsistent amounts (Rs.12,25,000 vs Rs.15,70,000)
```

Good lesson: dedupe is often the wrong word in legal work. The real task is classification. Some repeats are noise. Some repeats are corroboration. Some repeats are contradictions.

## The Server

`server.mjs` is the local Node server.

It:

- loads `.env`;
- creates services;
- serves the frontend;
- dispatches API routes;
- tracks active matter state.

Important route files:

```text
routes/api-routes.mjs
routes/app-shell-routes.mjs
routes/matter-workflow-routes.mjs
routes/skill-factory-routes.mjs
```

Think of `routes/api-routes.mjs` as the reception desk. It no longer owns individual endpoint behavior; it hands route families to smaller files:

- `routes/app-shell-routes.mjs` for app settings, matters, workspace, file preview/raw file routes, uploads, overlap checks, and command diagnostics.
- `routes/matter-workflow-routes.mjs` for the matter pipeline: setup, extraction, source labels, list of dates, doctor, status, prepare matter, context preview/search, and rerun advice.
- `routes/skill-factory-routes.mjs` for the skill factory: built-in/custom skills, skill ideas, interview planning, sample output, sample approval, create skill, custom skill runs, run history, and factory health.

Key endpoints include:

- `POST /api/matter-init`;
- `POST /api/extract`;
- `POST /api/describe-sources`;
- `POST /api/create-listofdates`;
- `GET/POST /api/ai-settings`;
- `POST /api/ai-settings/test`;
- `GET /api/skills`;
- `POST /api/skills/check-intent`;
- `GET /api/skill-factory-health`;
- `GET /api/skill-ideas`;
- `POST /api/skill-ideas`;
- `POST /api/skill-ideas/plan-interview`;
- `POST /api/skill-ideas/sample-output`;
- `GET /api/skill-ideas/:ideaId/samples`;
- `POST /api/skill-ideas/:ideaId/design-brief`;
- `POST /api/skill-ideas/:ideaId/samples/:sampleId/approve`;
- `POST /api/skill-ideas/:ideaId/create-skill`;
- `POST /api/skill-ideas/:ideaId/status`;
- `GET /api/configurable-skills`;
- `GET /api/configurable-skills/runs`;
- `POST /api/configurable-skills/run`;
- `POST /api/configurable-skills/runs/cancelled`;
- `POST /api/command-interactions`;
- `GET /api/config`;
- `POST /api/config`;
- `GET /api/matters`;
- `POST /api/switch-matter`;
- `POST /api/matters/new`;
- `POST /api/matters/add-files`;
- `POST /api/doctor/scan`;
- `POST /api/doctor/fix`;
- `POST /api/matters/check-overlap`;
- `GET /api/workspace`;
- `GET /api/matter-status`;
- `GET /api/prepare-matter`;
- `GET /api/matter-context`;
- `GET /api/matter-context/search`;
- `GET /api/rerun-advice`;
- `GET /api/file`;
- `GET /api/file-raw`.

The server is intentionally local-first. This is a confidentiality-friendly architecture: matters live on disk, not in a cloud database.

The custom skill factory follows the same local-first instinct, but uses app-level JSON stores instead of matter folders:

- `skill-ideas.json` stores requests and design briefs.
- `skill-samples.json` stores sample versions, feedback, and approvals.
- `configurable-skills.json` stores the generated configurable skill definitions.
- `configurable-skill-runs.json` stores run receipts, not the full work product.

The core lifecycle service is still `services/configurable-skills-service.mjs`, but the details are now split into helper modules: definition normalization, JSON store access, provider calls, matter-context summarization, and validation. That split matters because skill creation is powerful; good engineers keep the pieces visible instead of letting one file become a fog bank.

## The Frontend

The stable v1 frontend is plain browser JavaScript. The React/Vite UI that was
previously being explored in a separate local repo has now been absorbed into
this repo under `react-ui/`, so there is one product codebase again.

In plain English: we did not move into two houses. We brought the useful React
prototype furniture into the main house, put it in one room, and left the old
prototype house ready to be demolished later.

The current safe arrangement is:

- `/` serves the existing stable plain-JS v1 app.
- `react-ui/` contains the React source for the next frontend track.
- `PORT=4191 npm start` is the usual backend command for React UI work in this repo; keep it running in one terminal.
- `npm run ui:dev` serves the React app on `http://127.0.0.1:5173/` while proxying API calls to the backend.
- `npm run ui:build` type-checks and builds the React app.
- `npm run ui:smoke` checks that the React UI and the live backend still agree on the basic API shapes.
- `npm run ui:accept` runs the build and live smoke together before promoting frontend experiments.
- `react-dist/` is generated output and is ignored by git.
- `/react/` can serve the compiled React build from the same backend.

This means the separate `matter-workbench-react-ui-claude` repo is no longer a
source of truth. Keep it only as a temporary backup until we are comfortable
deleting it.

The React track has also been hardened against the exact kind of drift that
usually makes frontend ports painful. The important fixes were not cosmetic.
They were contract fixes:

- API response shapes now match the real backend instead of the prototype's
  imagined shapes.
- React API errors are parsed in one place, so `{ error: "..." }`,
  `{ message: "..." }`, plain-text failures, and empty responses all become
  readable UI errors.
- thrown values are normalized through `react-ui/src/lib/errors.ts` instead of
  assuming every failure is a normal JavaScript `Error`.
- active views are now a typed union instead of arbitrary strings, which caught
  a real dead route: `/matter-init` was pointing at a nonexistent React view.
  It now opens the preparation workflow, where setup belongs.
- status and severity labels use typed lookup helpers instead of scattered
  inline casts.
- the rerun-confirmation API shape is shared from `react-ui/src/types/index.ts`
  instead of being duplicated in the dialog and API client.
- React native-command labels, sidebar actions, command suggestions, and
  workflow routing now come from `react-ui/src/lib/nativeCommands.ts`. That is
  deliberately boring but important: if we rename `/describe_sources` from a
  technical slash command to a lawyer-facing label like "Label sources," the
  sidebar, command box, and matter overview should not drift into three
  slightly different vocabularies.
- `npm run ui:smoke` now checks that React's native-command registry still
  matches the shared backend built-in command list. This is not a grand
  architecture change; it is a useful tripwire. If someone adds a backend
  native skill and forgets to route it in React, the acceptance check should
  fail before the mismatch reaches a user.
- the React shell no longer treats infrastructure failures as ordinary empty
  outcomes: command router failures say the command check failed, context
  search API failures show an error instead of "No results found," and rerun
  advice failures ask before regenerating instead of auto-running.
- page-level data loads and copy actions now fail visibly in the React track.
  Skills, Activity, and Settings show load failures instead of looking empty;
  report/sample/context copy failures stay on screen or in the activity strip
  instead of disappearing silently.
- React Prepare Matter now consumes the backend `action` contract directly.
  This matters because a stage can have a slash command and still be blocked;
  the UI must not infer runnability from "has a slash." It should run only
  stages whose backend action is `run` or `confirm_paid_run`.
- React's rerun confirmation dialog can now expose safe optional actions. For
  List of Dates, this means `label_refresh_needed` can offer "Refresh labels
  only" instead of forcing a paid chronology regeneration.
- React active-matter state now has one mapper from workspace API responses to
  UI state. Opening a matter, creating a matter, refreshing the file tree, and
  updating List of Dates all use the same conversion path; Add Files also
  refreshes the workspace after upload instead of only saying it will.
- React Skill Factory now asks the backend interview planner for the question
  shape before falling back to the basic local interview. This keeps the React
  port closer to the governed vanilla flow: detailed skill specifications can
  move toward sample review without being forced through the same generic
  three-question script, and model-planned interviews can carry inferred design
  brief fields into the saved idea.
- React skill creation now checks for overlap with existing skills before
  activating a new custom skill from an approved sample. If the router says the
  idea may already be covered, React shows the same governance moment as the
  vanilla app: the sample stays saved, no runnable skill is created, and a
  separate skill needs a short justification.
- React Skill Factory command handling now stays inside the active skill-idea
  session after the questions are answered. Commands such as `generate sample`,
  `regenerate sample`, `copy sample`, `looks useful`, `mark ready`, and
  `open skills` are interpreted as session actions instead of leaking into the
  global command router.
- terminal history is bounded, theme storage is fail-safe, clipboard writes
  have a browser fallback, and AI settings save failures show inline errors.

The engineering lesson is simple: a React port is not "ready" because it
renders. It is ready only when it speaks the backend contract faithfully, fails
readably, and has acceptance checks that catch drift before a lawyer clicks
through a broken workflow. That is why `npm run ui:accept` exists. It builds,
type-checks, and smoke-tests the React app against the live backend shape.

Important files:

- `index.html` - app shell;
- `styles.css` - layout and visual system;
- `frontend/event-wiring.js` - user actions and skill dispatch;
- `frontend/ai-command-box.js` - small Command rail facade;
- `frontend/skill-idea-session-controller.js` - new skill interview state and command-session flow;
- `frontend/skill-idea-session-state.js` - pure session initialization, planner terminal copy, and answer-advancement helpers;
- `frontend/skill-idea-session-action-wiring.js` - button/action wiring for saved skill idea sessions;
- `frontend/skill-idea-sample-actions.js` - sample generation, approval, copying, and sample output display;
- `frontend/skill-idea-creation-actions.js` - approved-sample activation, overlap gating, and skill-ready rendering;
- `frontend/configurable-skill-run-controller.js` - active custom skill run, output replacement, and run review actions;
- `frontend/configurable-skill-improvement-actions.js` - "Improve this skill" ideas that feed back into the sample-review flow without changing the active skill;
- `frontend/created-skill-command-rail-actions.js` - the small "Skill Ready" rail after a custom skill is created;
- `frontend/skill-idea-interview.js` - interview planning, planner fallback, and design-brief normalization;
- `frontend/skill-idea-interview-templates.js` - deterministic interview templates, adjacent-native-skill patterns, and simple output-lane hints;
- `frontend/matter-screens.js` - settings and matter screens;
- `frontend/skills-page-actions.js` - Skills and Activity page copy/open/status button wiring;
- `frontend/workspace-view.js` - workspace tree, lane opening, and generic file preview selection;
- `frontend/listofdates-markdown-preview.js` - List of Dates markdown parsing, scannable chronology rendering, and copy/download actions;
- `frontend/views/skills-page*.js` - Skills page composition, saved ideas, cards, summaries, and health rendering;
- `frontend/api-client.js` - API helper;
- `frontend/state.js` - shared state;
- `frontend/status.js` - status output.
- `react-ui/src/App.tsx` - React shell composition for the imported UI track;
- `react-ui/src/api/client.ts` - React UI API adapter against the same backend contract;
- `react-ui/src/lib/nativeCommands.ts` - one source of truth for native command labels, routing views, sidebar actions, command suggestions, and local-vs-AI badges;
- `react-ui/src/components/command/CommandPanel.tsx` - React version of the command rail;
- `react-ui/src/components/RerunConfirmDialog.tsx` - React rerun confirmation dialog;
- `react-ui/src/views/MatterOverview.tsx` - React matter overview and readiness surface;
- `react-ui/src/views/SettingsPage.tsx` - React settings view using the live backend readiness contract;
- `react-ui/vite.config.ts` - Vite config for dev proxying and `/react/` build output.
- `scripts/react-ui-smoke.mjs` - small live acceptance check before we promote frontend experiments into the main repo.

The frontend should stay quiet and utilitarian. This is not a marketing site. It is an operational tool for repeated legal review.

The important recent frontend lesson is that "one convenient file" becomes a risk once it starts owning different workflows. The Command rail originally carried parsing, routing, skill interviews, sample approval, custom skill running, output replacement, copy reports, and status updates together. It worked, but every new product change had to pass through the same crowded room.

The healthier shape is now:

```text
ai-command-box.js
  -> command facade and dispatch order
  -> deterministic command controller
  -> router-check controller
  -> new-skill mode controller
  -> skill-idea session controller
  -> configurable-skill run controller
  -> report controller
```

That split does not change the user experience. It changes the engineering posture: a future bug in "replace existing output document" should live near custom skill run code, while a future bug in "Looks right -> create skill" should live near the skill idea creation actions. Good refactoring is not about clever abstractions; it is about making the next change easier to locate and safer to test.

The same rule now applies to custom skill runs. A run can finish, ask before replacing an existing output, be accepted for that run, or become an improvement idea. Those are related in the product, but they are not the same responsibility in code. `frontend/configurable-skill-run-controller.js` keeps the run and review state. `frontend/configurable-skill-improvement-actions.js` handles the bridge from "this skill should be better" into a saved, non-running revision idea that must generate a sample before any new version can become active.

The "Skill Ready" rail after a successful custom-skill creation is also separate now. It is small, but conceptually important: post-creation choices like **Run now**, **Open Skills**, and **Start another idea** are not part of overwrite review. Keeping them in `frontend/created-skill-command-rail-actions.js` prevents the run controller from becoming the dumping ground for every custom-skill-adjacent button.

The skill-idea interview planner has the same split. `frontend/skill-idea-interview-templates.js` is the product-policy shelf: limitation review, pleading summary, evidence gaps, weakness review, adjacent native skills, and output-lane hints. `frontend/skill-idea-interview.js` remains the planner engine: choose a template, normalize model-planned interviews, enforce lanes/risk/posture, and produce a design brief. That makes future product tuning less risky because adding a new native-adjacent pattern should not require reading the whole planner algorithm.

On the backend, the model-backed interview planner has a similar boundary. `services/skill-interview-planner-service.mjs` decides whether planning is enabled, summarizes the active matter and skill registry, chooses fallback behavior, and returns the plan envelope. `services/skill-interview-planner-providers.mjs` owns the OpenAI/OpenRouter request bodies, shared legal-workbench system prompt, response parsing, and timeout/error mapping. This matters because provider/model risk should be isolated from the business rule "what context is safe to send for a skill idea interview."

The sample-output generator follows the same pattern. `services/skill-sample-output-service.mjs` owns the matter-context packet, idea normalization, sample envelope, warnings, and no-artifact-write guarantee. `services/skill-sample-output-providers.mjs` owns the OpenAI/OpenRouter request bodies, sample-specific system prompt, response parsing, and timeout/error mapping. That keeps the "show the lawyer a sample before creating a skill" workflow separate from the model plumbing that may change as providers change.

The skill router is also split now. `services/skill-router-service.mjs` owns registry lookup, MECE overlap normalization, user-gate decisions, and legal-setting cleanup. `services/skill-router-providers.mjs` owns the OpenAI request body and router system prompt. That boundary matters because the router is a product-policy decision point; changing provider transport should not require touching the code that decides whether a request is a duplicate, a tuning preference, or a genuinely new workflow.

Custom-skill run artifacts now have their own backend seam as well. `services/configurable-skill-run-artifacts.mjs` resolves the configured Markdown/JSON output paths and writes the paired files. `services/configurable-skills-service.mjs` still decides whether a skill can run, creates ledger records, calls the provider, and marks success or failure. This is a small distinction, but it keeps "where should this output be parked?" separate from "should this lifecycle action happen?"

The same lifecycle split now covers custom-skill activation. `services/configurable-skill-lifecycle.mjs` builds a draft skill from the authored model output, then activates it as version 1 or supersedes a previous active version. The service still controls the important sequence: get approved sample, call authoring model, validate the draft, then mutate the store. The helper owns the pure bookkeeping: family id, previous skill id, version number, active/disabled status, and supersession metadata.

## Shared Contracts

The `shared/` folder is where many important boundaries live.

Key files:

- `shared/matter-contract.mjs` - folder names, headers, file classification, metadata normalization;
- `shared/model-policy.mjs` - AI task policy;
- `shared/ai-provider-policy.mjs` - request-ready provider config;
- `shared/responses-client.mjs` - OpenAI Responses API helper;
- `shared/local-env.mjs` - local `.env` loader;
- `shared/csv.mjs` - CSV parse/write helpers;
- `shared/safe-paths.mjs` - path safety helpers.

Good lesson: centralize contracts before the codebase grows around duplicated assumptions. Headers, folder names, model policy, and provider behavior should not be scattered across UI, routes, and engines.

## AI Provider Shape

The project now treats AI as task-specific policy, not random model calls.

Current AI tasks include:

- `skill_router`;
- `source_description`;
- `source_backed_analysis`.

OpenAI direct remains the default for some paths. OpenRouter is explicit where configured. For legal chronology work, provider behavior should remain visible and fail-closed.

Important rule:

```text
No silent fallback for lawyer-facing artifacts.
```

If a provider fails, the system should say so. It should not quietly swap in another model and write an artifact that looks authoritative.

## Testing Philosophy

The test suite is Node's built-in test runner:

```sh
npm test
```

The tests are not just ceremonial. They lock down the legal workflow rules:

- file intake does not register junk files;
- overlap checks read all intake registers;
- JSON request bodies cannot buffer without size limits;
- OCR provider paths can be tested without live network calls;
- source descriptors reject bad citations and bad labels;
- model policy preserves provider behavior;
- List of Dates preserves raw citations;
- lawyer-facing fields are required;
- unsupported proof language is softened;
- meta sources are filtered before AI;
- clustering avoids false payment discrepancies.

The command-box scenario tests are split by product story:

- `test/ai-command-box.test.mjs` covers core command dispatch, suggestions, lane opening, reports, and paid rerun cancellation;
- `test/ai-command-box-skill-ideas.test.mjs` covers new-skill interview, sample review, overlap gates, and activation;
- `test/ai-command-box-configurable-skills.test.mjs` covers running and improving already-created configurable skills.

Good lesson: tests should protect the professional contract, not only the code mechanics.

## Bugs We Hit and What They Taught

### Reading Only the First Intake

Overlap checks originally looked only at:

```text
00_Inbox/Intake 01 - Initial/File Register.csv
```

That meant matters with multiple intakes could under-report overlaps.

Fix: union hashes across all intake folders.

Lesson: when a product supports multiple batches, every downstream scan must respect the batch model.

### JSON Body Size

`readRequestJson` could buffer arbitrary request bodies.

Fix: add a 1 MB default limit and return HTTP 413 for oversized JSON bodies.

Lesson: local-first does not mean ignore basic server hygiene.

### Sidebar and Preview Scrolling

Some panels expanded instead of scrolling, which made settings and previews hard to use.

Fix: constrain the shell to the viewport, make the sidebar/editor regions own their scrolling, and add `min-height: 0` where nested flex/grid overflow needs it.

Lesson: layout bugs are often missing containment, not missing JavaScript.

### OpenRouter Provider Routing

Provider order and price/latency sorting can conflict. If you pin a provider and also ask OpenRouter to sort by price, the request is ambiguous.

Fix: reject mixed provider pin plus sort/max-price settings.

Lesson: configuration should fail early when it expresses two different strategies.

### Source Labels with `FILE-0001` Prefixes

The AI sometimes put file ids into human labels.

Fix: prompt and validator reject `FILE-NNNN` inside `display_label` and `short_label`.

Lesson: human labels and audit ids are both valuable, but they must stay separate.

### Malformed or Bad Provider Output

OpenRouter can return malformed JSON or semantically bad JSON.

Fix: validate locally and fail closed. The Mehta smoke even hit a `sha256` mismatch once; retry succeeded, and the failed attempt did not write a bad source index.

Lesson: the model is not the contract. The validator is the contract.

### Lawyer-Facing Language Overreach

The AI can drift into proof language like "proves breach."

Fix: add lawyer-facing fields, guardrails, and sanitizers. Keep raw citations out of the Event column. Soften unsupported proof/breach language.

Lesson: "make it more lawyerly" needs structure. Without guardrails, style improvements become legal-risk regressions.

### Payment Clustering False Positives

Same-day payments can be separate legitimate payments. A loose similarity rule could turn them into a fake discrepancy.

Fix: same-day payments only cluster on stronger signals: matching amounts, matching installment/ordinal, or explicit discrepancy language.

Lesson: in legal tools, false contradictions are dangerous. A useful discrepancy row must be reviewable and defensible.

## How Good Engineers Should Think About This Project

The best engineering choices here came from treating the legal workflow as a chain of custody.

Ask these questions before changing behavior:

1. Does this preserve the original file?
2. Does this preserve the raw citation?
3. Does this create a durable artifact?
4. Can a lawyer inspect what happened?
5. Can a test prove the contract?
6. If an AI provider misbehaves, do we fail closed?
7. Is this deterministic work being incorrectly handed to AI?
8. Is this AI work being validated before persistence?

If the answer is fuzzy, slow down.

## What to Watch During Beta

Reviewers should inspect:

- missing legally important events;
- overstated legal relevance;
- duplicate rows that should have clustered;
- clusters that merged unrelated events;
- missing supporting sources inside a cluster;
- broken raw citations;
- weak source labels;
- OCR text quality;
- provider failures that should fail closed.

For payment matters, cluster completeness is especially important. Check whether the discrepancy row includes all relevant supporting sources: bank statement, receipt, email, agreement schedule, and legal notice if they all discuss the same payment issue.

## What Not to Do Next

Do not immediately add automatic fallback. The pipeline is just reaching lawyer-review usefulness. More routing cleverness can wait.

Avoid these moves unless there is a clear PR-sized reason:

- silent model fallback;
- UI toggles for every provider knob;
- broad prompt rewrites without eval evidence;
- changing raw citation format;
- merging source labels into canonical ids;
- moving files or renaming artifact contracts casually.

The next strong work is likely operational:

- run more real matters;
- collect reviewer notes;
- identify repeated quality failures;
- turn those into narrow tests or docs;
- only then tune the algorithm or prompt.

## The Mental Model

Think of Matter Workbench as a table in chambers.

On the left: the messy brief.

In the middle: the clerk's registers, extracted pages, source labels, and chronology.

On the right: the lawyer's judgment.

The software's job is not to jump straight to the right side. Its job is to make the middle reliable enough that the lawyer can move faster without losing the thread back to the original file.

That is why the repeated phrase in this project matters:

```text
raw FILE-NNNN pX.bY citations remain canonical
```

Everything else is help. The citation is the anchor.

## Skills Page Product Rule

The Skills page is now organized for a lawyer's first question, not a developer's audit question.

The top of the page answers:

```text
What can I run?
What is still being developed?
```

That is why the order is:

1. **Your Skills** - active custom skills that can actually run.
2. **Ideas** - saved skill requests that are still not runnable.
3. **Built-in Skills** - code-backed app capabilities for reference.
4. **Skill Factory Health** - a collapsed integrity check for developers and power users.

The important lesson is that technical health is valuable, but it should not become the product's main face. Factory health still exists because it protects the skill system. It is simply no longer the first thing a lawyer has to read.

## Skill Sample Review Product Rule

The new-skill flow has one real payoff moment: the sample.

Before that moment, the lawyer is only describing a possible tool. After that moment, they can judge whether the system understood the job. That is why the app now treats the sample as first-class UI instead of burying it inside an admin-style idea record.

The Skills page surfaces the latest generated sample on the idea itself. The command rail shows when a sample is being generated, warns that it may take a minute, and makes clear that no matter files are being changed. If the sample comes back with warnings, such as omitted evidence blocks, those warnings are visible next to the sample preview.

The wording matters too. `Incomplete` was a bad label for an idea whose checklist was already complete and ready for review. The better lifecycle is:

```text
Draft saved -> Draft complete -> Ready to review -> Sample generated -> Sample approved
```

The product lesson is that trust is earned at the review surface, not in the backend. A powerful generated artifact is only useful if the user can see it, understand its limits, and decide what happens next.

## Activity Page Product Rule

The Activity page should read like a receipt book, not a server log.

The lawyer's questions are:

```text
Did the skill run?
Which matter did it run on?
Where is the output document?
Did anything fail?
Can I copy the run report?
```

That is why completed work now comes first, grouped by day. Cancelled runs are collapsed by default because they did not create work product. Provider/model, metadata paths, and run ids are still available in details, but they do not compete with the main answer.

This is a useful pattern for the whole app: show legal work first, keep technical proof close by, and make debug information available without letting it become the screen's headline.

## Settings Page Product Rule

Settings is technical by nature, but the first user question is still simple:

```text
Is everything configured, and is it working?
```

That is why the Settings page now starts with a plain readiness signal. The editable things a normal user might actually touch stay visible: the matters home folder and the local AI configuration.

The routing tables are still there, but they are collapsed by default. Provider routing and the Skill Router matter for debugging and power-user supervision, but they should not be the first screen a lawyer has to decode.

This follows the same rule as Activity and Skills: put the user-facing answer first, keep the technical proof nearby, and avoid hiding the escape hatches from the people who need them.

## File Preview Product Rule

Generated legal artifacts should open like work product, not like source code.

For a List of Dates, the lawyer's question is:

```text
What happened?
When did it happen?
Why does it matter?
Which source can I check?
```

That is why the file preview renders `List of Dates.md` as a chronology table with date, event, relevance, and source columns. The raw Markdown is still available through Copy Markdown and Download, but the default reading surface is now built for scanning and checking citations.

The broader lesson is simple: machine-readable storage and human-readable review are different jobs. Keep the stored artifact plain and portable, but render it in the app in the shape that matches the lawyer's task.

## New Matter Product Rule

New Matter is not a dashboard. It is a one-time intake form.

That means it should not be clever. It should ask for the few things the system needs, in the order a lawyer naturally thinks:

1. **Matter name** - the folder and case identity.
2. **Parties** - client and opposite party.
3. **Matter details** - type, jurisdiction, and a short description.
4. **Initial files** - the documents that let the app initialize the record.

The important copy detail is that the current app requires at least one file or folder before creation. So the UI should not say "files can be added later" as if the first upload is optional. The truthful version is: attach the first documents now; more files can be added later.

This is a small example of good product engineering: copy must match behavior. Even a beautiful form becomes confusing if its words promise a path the code will reject.

## Command Activity Strip Product Rule

When the user presses the command button, the app must immediately answer:

```text
Did it hear me?
What is it doing now?
Do I need to wait or act?
```

Earlier versions answered that through the bottom terminal. The Home-first shell made the Home page calmer by hiding that developer-style terminal, but that created a new problem: commands could feel silent even though they were still logging internally.

The compromise is a compact activity strip directly under the command input. It shows the last few status lines, with timestamps, next to the action that caused them. The old shell-level bottom terminal is hidden from normal pages because it made every screen feel like a developer console. Longer logs belong inside Activity, where the user is already asking what happened.

The command interaction log follows the same rule with a privacy guard. It keeps only a whitelisted diagnostic record, and retained text fields now redact common provider secrets such as `OPENAI_API_KEY=...`, bearer tokens, and raw `sk-...` keys. Logs should help debug the product, not become another place where credentials can accidentally live forever. The command log service owns both serialized appends and recent-entry reads, so the Matter Attention surface can consume command failures through a service boundary instead of parsing the JSONL file directly.

The copied reports now follow that same boundary. That includes the command report, custom skill run report, context preview/search reports, and skill factory health report. That matters because copied reports are more portable than server logs: they can land in chat, email, or a bug tracker. If the app is going to make diagnostics easy to share, it must make the safe path the default path. The actual redaction rule lives in `shared/secret-redaction.mjs` so server diagnostics and browser copy/report surfaces do not drift apart.

The engineering lesson is that removing clutter is not the same as removing feedback. When you simplify a screen, preserve the user's sense of causality: I clicked, the app heard me, and this is what is happening.

## Matter Attention Architecture Lesson

The Matter Attention surface is the developer's matter health board. It does not create artifacts, run skills, or call providers. It reads the existing record and answers:

```text
What is broken in this matter?
What warning is worth developer review?
Which file or log line proves it?
```

The first working version was useful, but the service started collecting too many jobs in one file: intake setup, extraction logs, Source Index state, List of Dates state, custom skill runs, and command failures. That is exactly how a diagnostic system quietly becomes another hard-to-debug subsystem.

The refactor split the collectors by lifecycle responsibility:

- `frontend/views/matter-attention-card.js` owns the overview card renderer, so the matter overview does not become a mixed renderer for every diagnostic concern.
- `services/matter-attention-service.mjs` is now the orchestrator. It chooses the matter, calls collectors, normalizes items, sorts them, and builds the summary.
- `services/matter-attention-intake.mjs` owns setup, file register, working-copy, extraction-log, OCR-placeholder, and skipped-file warnings.
- `services/matter-attention-source-labels.mjs` owns Source Index existence, schema, label-review, developer-name leak, count mismatch, and Source Labels rerun advice.
- `services/matter-attention-chronology.mjs` owns List of Dates JSON/Markdown presence and chronology dependency-state advice.
- `services/matter-attention-custom-runs.mjs` owns custom skill run failures.
- `services/matter-attention-command-failures.mjs` owns recent command failure signals.
- `services/matter-attention-rerun-advice.mjs` owns the shared conversion from rerun-advice state into attention items.
- `services/matter-attention-items.mjs` owns stable item ids, sorting, and summary counts.

That split is not academic. It means a future bug like "OCR placeholder warnings are too noisy" points to intake. A bug like "label refresh is being treated like regeneration" points to Source Labels or Chronology attention. A bug like "failed custom skill runs are duplicated" points to custom runs. The service no longer requires you to read the whole matter lifecycle before changing one diagnostic rule.

Good engineers do not only add observability. They make observability itself observable: small collectors, explicit item codes, stable evidence fields, and tests around every lifecycle slice.

## Shell Refactor Lesson: Reduce Architectural Depth

After the Home-first visual release, the next risk was not the UI itself. It was where the UI logic lived.

`frontend/matter-screens.js` had become the shell's traffic controller and was also rendering the full Home page. That is a classic depth smell: to understand a simple Home search click, you had to mentally pass through shell state, matter state, DOM rendering, activity logging, and command wiring in one file.

The cleanup split those jobs:

- `frontend/views/home-landing.js` owns the Home page HTML and Home-only event wiring.
- `frontend/matter-search.js` owns matter search normalization/filtering.
- `frontend/activity-log-store.js` owns recent activity state.
- `frontend/status.js` mirrors that activity into the compact command strip and hidden debug terminal.

The important change is not just fewer lines. It is fewer reasons to open the same file. Home can now change without touching Settings. Activity can read recent logs without scraping hidden DOM text. Command reports can ask the activity store for recent lines instead of treating a hidden terminal as the source of truth.

That is what reduced architectural depth means in practice: fewer hops, fewer mixed responsibilities, and fewer surprising dependencies between screens.

## Backend Persistence Lesson: Small Hardening Beats a Big Rewrite

The backend debt report was right about one practical risk: several JSON-backed stores were doing the classic read-modify-write pattern. That is fine for a toy script, but in a server it has two sharp edges:

1. two overlapping requests can read the same old file and accidentally overwrite each other's changes;
2. a process crash in the middle of a write can leave a half-written JSON file behind.

The fix was deliberately modest. Instead of redesigning storage, the app now has one shared JSON persistence helper. It serializes mutations inside the running Node process and writes through a temporary file before renaming it into place. In plain terms: requests line up before editing the same store, and the final file is replaced in one filesystem move.

This is not a database, and it is not a distributed lock for multiple server processes. But that is the point: good engineering does not always mean jumping to the biggest abstraction. For a local workbench that runs as one Node server, this reduces real risk without changing schemas, routes, or user behavior.

The same slice also fixed invalid JSON request bodies. Bad client JSON should be a `400` problem, not a mysterious `500` server failure. That distinction matters because errors should teach the caller what kind of mistake happened.

## Backend Routing Lesson: Make Dispatch Visible

The backend used to route many API requests with long linear chains like:

```text
if method is GET and path is /api/config ...
if method is POST and path is /api/config ...
if method is GET and path is /api/matters ...
```

That works, but it hides the shape of the API in control flow. To see what a route module owned, you had to read every branch. The safer pattern is now a small route dispatcher plus explicit route tables:

```text
GET  /api/config          -> config summary
POST /api/config          -> save matters home
GET  /api/skill-ideas     -> list ideas
POST /api/skill-ideas     -> create idea
```

This does not change schemas or route behavior. It changes maintainability. The route file now reads more like a map, and the branchy matching logic lives in one tested helper.

The top-level API handoff uses the same idea now: `routes/api-routes.mjs` sends a request through ordered route groups instead of repeating three separate `if handled then return` checks. Tiny cleanup, but useful hygiene: when routing gets more surface area, the code still reads as "try workflow routes, then shell routes, then skill-factory routes" rather than another mini-router hidden in control flow.

The same HTTP cleanup changed static file serving from "read the whole file into memory, then send it" to streaming. For a local app this is not glamorous, but it is the right default: large files should flow through the server instead of becoming one big buffer whenever someone opens them.

## Matter Context Lesson: Keep The Facade Thin

`matter-context-service` started as a convenient public entry point for two different jobs:

```text
Build the bounded matter packet from disk.
Search that packet for useful source-backed snippets.
```

Those jobs are related, but they should not be the same module. Packet building cares about filesystem traversal, file registers, extraction records, Source Index trust checks, library artifact summaries, and limits. Search cares about query normalization, term matching, snippets, result counts, and preserving citations.

The context layer now has clearer rooms:

- `services/matter-context-service.mjs` is the facade that the routes use.
- `services/matter-context-packet.mjs` builds the bounded packet shape.
- `services/matter-context-preview.mjs` turns that packet into the small UI preview.
- `services/matter-context-search.mjs` searches packet evidence blocks.
- `services/matter-context-sources.mjs` owns matter JSON loading, intake discovery, file-register parsing, current Source Index trust checks, and extraction-record traversal.
- `services/matter-context-path-policy.mjs` owns the path exclusion rules that keep secrets, logs, dependency folders, machine junk, and temporary Office files out of context packets.
- `services/matter-context-library-artifacts.mjs` owns the small summaries of selected library outputs, such as Source Index and List of Dates artifacts.

The public imports stayed stable, so callers can still import `buildMatterContextPacket`, `summarizeMatterContextPacket`, and `searchMatterContextPacket` from the service module. Internally, the facade no longer owns packet construction and preview shaping. That matters because future work on context packets, source labels, or search ranking can now land in the right file instead of reopening one mixed service.

The lesson is that a good extraction does not need to change behavior to be worthwhile. Sometimes the best refactor is simply moving a self-contained decision into a smaller room where future changes cannot accidentally disturb disk layout or packet schema.

## Persistence Lesson: Small Files Still Need Care

This app stores a lot of useful state in ordinary local files: JSON ledgers, `config.json`, and `.env`. That is one of the reasons the project stays understandable. You can inspect the files, back them up, and reason about them without needing a database server.

But local files still deserve database-like caution at write time. A half-written `config.json` or `.env` can be more annoying than a failed request because the bad file remains on disk. The shared `writeFileAtomic` helper writes to a temporary sibling file first and then renames it into place. On normal filesystems, that rename is the moment the new version becomes visible.

The engineering lesson is simple: local-first does not mean casual. If a file is a source of truth, write it as though the process could be interrupted at the worst possible moment.

## Maintenance Lesson: Keep the Doctor Small at the Door

The app has a "doctor" endpoint that detects and fixes old matter folder layouts. That is maintenance work, not everyday product work. The route-facing service now stays small: scan, apply requested fixes, and report what remains.

The messy legacy details live in `services/doctor-legacy-layout.mjs`: old folder names, old CSV headers, backup behavior, path rewriting, and `matter.json` migration. This is the right shape because legacy migration code tends to accumulate edge cases over time. Keeping it in its own room makes it easier to test without letting migration history leak into the normal matter workflow.

## Matter Store Lesson: Keep State Separate From File Arithmetic

`services/matter-store.mjs` tracks the active matter and validates matter names against the configured matters home. That is stateful shell infrastructure. The arithmetic around intake folders and file-register rows is now in `services/matter-store-intakes.mjs`.

This split matters because file IDs, duplicate hashes, and intake numbering are rules other services depend on. When those rules live behind a small tested helper, upload, overlap checks, and matter status can reuse them without each service quietly inventing its own version.

Upload handling has the same boundary now. `services/multipart-upload.mjs` owns the noisy HTTP mechanics: parse multipart, stream uploaded files into a temporary directory, enforce byte limits, and clean up on failure. `services/upload-file-intake.mjs` owns the next narrow step: parse upload JSON fields, make sure every uploaded file has a matching relative path, reject unsafe paths, and copy staged temp files into the intake folder. `services/upload-service.mjs` owns the legal-workbench domain step: create a new matter or add a new intake, then run the deterministic matter-init path.

That split is boring on purpose. Upload code is where small mistakes become durable disk mistakes. Keeping "which bytes came in", "where may they be copied", and "what legal workflow should run after copy" in separate modules makes future file-import changes easier to test without disturbing matter creation.

One useful bug fell out of that testability work: the oversized-upload path could reject the request and still leave a per-file stream promise rejected without a handler. The fix attaches each file promise to the shared multipart failure path, and the server now lets tests inject a tiny byte limit so the real HTTP route proves oversized uploads return `413` cleanly.

## Test Lesson: Keep Scenarios Clear

The command-box tests cover many real user paths, so they are now split by the kind of story they protect. Basic command routing stays in `test/ai-command-box.test.mjs`; new-skill interview and sample-review behavior lives in `test/ai-command-box-skill-ideas.test.mjs`; configurable custom skill runs live in `test/ai-command-box-configurable-skills.test.mjs`. The fake browser form, fake command rail, and fake status elements live in `test-support/ai-command-box-helpers.mjs`.

That is not just tidiness. Good scenario tests should make the story easy to read: user types this, app routes there, status says this, no skill runs unexpectedly. When fake DOM plumbing sits in a helper and long scenarios are grouped by product surface, each test file can spend more of its space explaining behavior instead of rebuilding the stage.

## Frontend Sample Lesson: Protect the Payoff

The new-skill flow has one moment that matters most: the generated sample. That is where a lawyer decides whether the proposed skill is useful, safe, and worth turning into something runnable.

The session controller still owns the conversation, but the risky work now sits behind smaller helpers. `frontend/skill-idea-sample-actions.js` owns generating, approving, copying, and displaying sample output. `frontend/skill-idea-creation-actions.js` owns the approved-sample activation path: check existing skills for overlap, pause if the idea duplicates a native/custom skill, create the runnable skill only after the gate clears, then show the skill-ready rail. `frontend/skill-idea-sample-ledger.js` does one narrower job: reload persisted sample versions, pick the active sample, preserve important warnings, and fall back to local state if the ledger cannot be read.

This is a useful kind of frontend refactor because it moves the fragile part of the payoff out of the command-session controller and into focused modules. A warning like "evidence blocks were omitted" must not disappear merely because the persisted ledger response is thinner than the optimistic UI state. Good product engineering often means protecting the trust signals, not just rearranging code.

## Native Skill Lesson: Keep The Spine, Fix The Surface

The native skill layer has a working spine:

```text
/matter-init -> /extract -> /describe_sources -> /create_listofdates
```

The mistake would be to throw that away because the Skills page felt too technical. The better fix is to keep the engines and classify the surface properly:

- setup and readiness tools prepare the matter;
- Source Labels / Document Index prepares the source record;
- Create List of Dates is the first hero native legal skill;
- search, context preview, and doctor are utilities.

This is a useful architecture lesson. Sometimes the backend has the right shape, but the product surface tells the wrong story. Refactoring the presentation taxonomy can reduce confusion without destabilizing the runtime.

The Source Index now also carries the beginning of a label-versioning contract: a stable `source_id`, a separate `content_hash`, suggested/confirmed labels, label status, label reason, and confirmation metadata placeholders. That split matters because a label change is cheap, while a document change can affect legal chronology. Good systems do not call both things "stale"; they distinguish label refresh from chronology review and regeneration.

The app now uses that distinction in the List of Dates rerun path. If only source labels changed, the guardrail can offer `Refresh labels only`, which updates `List of Dates.json`, `.csv`, and `.md` without calling an AI provider. The refresh service refuses to run if a source hash, document type, document date, or quality flag changed, because those changes may affect the chronology itself. The engineering lesson is cost and safety are linked: a good workflow should spend the model only when legal judgment may need to change.

The freshness logic now lives in `services/matter-rerun-advice-service.mjs`, separate from `services/matter-status-service.mjs`. That keeps the overview service focused on "what stages exist and what artifacts are present", while rerun advice owns the trickier question of whether a skill is missing, current, stale, label-refresh-only, review-needed, or regeneration-needed. The pure List of Dates dependency classifier is one level smaller again: `services/listofdates-dependency-state.mjs` decides whether a changed input means cheap label refresh, chronology review, or full chronology regeneration. This is the right split because freshness rules will keep evolving with the product contract, while the overview card should remain boring and stable.

The browser has a matching constants module at `frontend/listofdates-dependency-state.js`, so UI affordances like `Refresh labels only` do not depend on hand-typed strings scattered across different views.

The same rule now applies to rerun-advice states. The backend emits `current`, `stale`, `missing`, `failed`, `missing_upstream`, or `unknown` from `shared/rerun-advice-states.mjs`; React keeps a typed mirror, and the React smoke test compares both lists. This is not ceremony. These tiny strings decide whether the lawyer sees "up to date", "needs update", "waiting on earlier step", or a warning dialog before a paid run. If one UI invents a seventh state or misspells one, the app can become confident in the wrong moment.

Prepare Matter action names are now treated the same way. The backend plan emits actions like `run`, `confirm_paid_run`, `blocked`, and `recommend_separate_skill` from `shared/preparation-stage-actions.mjs`; the React port has a typed mirror checked by the smoke test. This protects the orchestrator from the quietest kind of breakage: the backend says "ask before a paid source-labeling run" while one frontend accidentally treats it as an ordinary run.

Native command aliases now follow the same discipline. Vanilla already knew that `prepare matter`, `source labels`, and `chronology` should route directly to `/prepare_matter`, `/describe_sources`, and `/create_listofdates`; React had the visible suggestions but could fall back to intent checking if the user typed the plain-English alias and pressed Enter. The alias list now lives in `shared/builtin-skill-commands.mjs`, React has a checked mirror, and the smoke test compares them. That means obvious lawyer phrases remain fast, deterministic commands instead of accidental AI routing.

React now resolves native commands through one helper, `resolveNativeCommand()`, before it asks the model-powered intent checker. Exact slashes and plain-English aliases go through the same path, and the unit test asserts that the resolver checks aliases. The principle is simple: deterministic product commands should stay deterministic, especially when the visible UI teaches the lawyer to type phrases like `prepare matter`.

Skill-idea session commands now follow the same rule. Vanilla uses the shared `shared/skill-idea-session-commands.mjs` classifier, React has a typed mirror, and the smoke test compares the command sets. This closes a small but nasty UX trap: once a user is inside "new skill" mode, phrases like `generate sample` should advance that conversation, not get reinterpreted as a fresh global request.

The canonical Library artifact paths now live in `shared/matter-artifacts.mjs`. That means status cards, context packets, and rerun advice all agree on `10_Library/Source Index.json` and the List of Dates artifacts from one source of truth.

The source-label rules themselves now live in `shared/source-labels.mjs`. That is a small but important foundation: Source Index readers, List of Dates generation, label refresh, and context packets all resolve labels the same way. A confirmed or overridden lawyer label wins; unsafe labels containing `FILE-0001` style identifiers are not promoted into lawyer-facing fields. This is how you prevent one surface from being polished while another leaks internal names.

The same care now applies to artifact writes. Source Index JSON, List of Dates JSON/CSV/Markdown, and custom-skill output files go through the shared atomic file writer, so a failed process is less likely to leave half-written legal work product on disk. This is boring in the best way: source-backed legal artifacts should fail before replacement, not fail halfway through replacement.

## Preview Lesson: Keep Document Rendering Separate From the Explorer

`frontend/workspace-view.js` decides which matter file is active, highlights it in the tree, opens workspace lanes, and chooses the preview path. The List of Dates markdown preview now lives in `frontend/listofdates-markdown-preview.js`.

That split matters because "show me the file tree" and "turn a legal chronology markdown table into a scannable lawyer surface" are different jobs. The file explorer should stay generic. The List of Dates renderer can now evolve around legal document readability, source fragments, copy/download actions, and chronology summary rules without making the whole workspace sidebar harder to reason about.

The backend has a matching direct-preview guard in `services/workspace-path-policy.mjs`. The tree already hides dotfiles and system folders, but a user could still guess a raw preview URL. The workspace path policy blocks hidden/system paths such as `.env`, `.git`, `node_modules`, app-side hidden folders, and Office temp files before `readFilePreview` or `getRawFile` can serve them.

## Frontend Lesson: Scope Generic Selectors

The command box once had a small but ugly regression: typing `/` opened the slash-command suggestions, but each suggestion row inherited the dark square submit-button styling. The cause was a selector that was too broad:

```css
.ai-command-form button
```

That matched both the arrow submit button and every suggestion button inside the same form. The fix was to scope the submit-button rule to the input row:

```css
.ai-command-form .command-panel-input-row button
```

This is a good frontend lesson because nothing was wrong with the JavaScript. The DOM was rendering the right suggestions, but the CSS contract was too loose. In dense app shells, selectors should name the surface they intend to own; otherwise a later nested control quietly inherits styles meant for a completely different job.

## Product Surface Lesson: Lead With The System's Native Work

The Skills page briefly had the right data but the wrong first impression. It showed custom skills first, so the page looked like the product only had three skills even though the header counted native and built-in capabilities. That is a product hierarchy bug, not a data bug.

The fix was to put `Native Skills` first: Source Labels / Document Index and Create List of Dates. Custom skills now sit below them as user-created extensions, and setup/search/maintenance tools sit lower as supporting tools. This matches the product direction: the app should feel like a staged legal workbench with strong native workflows, not a blank skill registry where every slash command has equal weight.

## Policy Prompt Lesson: Models Are Replaceable, Legal Rules Are Not

As the product starts using more than one model route, prompt discipline becomes part of architecture, not just copywriting. OpenAI direct, OpenRouter, a cheaper router model, a stronger drafting model, or a future firm-configured model may all behave differently by default. The app cannot let those defaults decide whether raw `FILE-0001` citations leak into lawyer-visible Markdown, whether a year-only source becomes a fake exact date, or whether repeated citations turn into duplicate chronology events.

The right shape is an app-owned legal workbench policy prompt. Model routing decides where the request goes; the policy prompt decides the professional rules that travel with it. Custom skills can add workflow-specific instructions, but they should not be allowed to override the baseline rules: do not invent facts, preserve uncertainty, keep internal citations internal, use lawyer-readable source labels, obey schemas, and fail closed when source support is insufficient.

That is a useful engineering lesson. When a system depends on replaceable external intelligence, the product has to carry its own values and constraints in code, tests, and durable contracts. Otherwise changing models quietly changes the profession-facing behavior of the app.

The implementation now lives in `shared/legal-workbench-policy-prompt.mjs`. Provider-backed surfaces compose that shared policy with their own task prompt, and AI run metadata records `policyPromptVersion`. This keeps the policy testable: if a future model route, router provider, or custom skill path omits the baseline rules, tests can catch that as an architecture regression rather than leaving it as a prompt-quality opinion.

The metadata normalization now lives in `shared/ai-run-metadata.mjs`. That may sound like a small housekeeping file, but it matters. Before this refactor, matter status, rerun advice, context packets, custom-skill run ledgers, and sample ledgers each had their own little whitelist of AI-run fields. That is how audit fields go missing: one surface learns about `policyPromptVersion`, another forgets it, and the app starts telling an incomplete story about which policy governed a model result. A shared normalizer turns that into one contract with tests.

## Product Policy Lesson: Native Skills And Co-pilot Are Different Layers

The app is not moving toward "everything is a custom skill." The better shape is a staged workbench.

Native skills do the disciplined, repeatable work: prepare the source record, create readable source labels, build the List of Dates, and preserve audit metadata. They reduce cost because later legal work can consume clean artifacts instead of rereading the whole matter every time.

Matter Co-pilot is a different layer. It is the high-agency working conversation inside an active matter: "where is the addendum agreement?", "what is the best opening hook?", "compare these two positions", or "change para 8 of the grounds to add this case law." That is valuable precisely because it is freeform. But freeform does not mean uncontrolled writes.

The policy boundary is now explicit:

- Co-pilot answers are transient unless the user starts an explicit artifact workflow.
- `30_Drafts` belongs to the lawyer once a draft exists; human edits are authoritative.
- Draft amendments should be surgical: paragraph, section, issue, or selected passage changes with preview/diff or new-version semantics.
- `40_Dispatch` is frozen sent/filed material, not another editable workspace.
- A source-label second pass can improve model-suggested labels, but only a lawyer action can make a label confirmed.

That last point is important. Good source labels from a strong model can remove a lot of busywork, but they should not be confused with lawyer confirmation. A second pass can polish `suggested_label` and mark uncertainty; it should not pretend the lawyer reviewed the source.

## React Port Lesson: Keep The Sample Tied To The Brief

The React skill-idea flow now follows the same contract as the older browser shell: a generated sample belongs to the design brief that created it. If the user edits the interview answers after a sample exists, the app updates the saved idea in place and asks for a fresh sample before skill creation.

This sounds small, but it prevents a real governance bug. Without it, an old sample could remain on screen after the user changed the requested output, lane, inputs, or risk posture. The lawyer would be reviewing one thing while the stored design brief says another. That is exactly how custom-skill systems become confusing: the visible proof and the stored instruction drift apart.

The backend already protects this with design-brief hashes in the sample ledger. The frontend now respects the same rule instead of creating duplicate ideas or silently carrying forward an obsolete sample. The product lesson is simple: in a sample-first skill factory, the sample is the trust moment, so it must always be current with the brief being approved.

## Contract Lesson: State Names Are Architecture Too

The List of Dates freshness states now have a shared home in `shared/listofdates-dependency-states.mjs`. These values look like tiny strings, but they carry a real product distinction:

- `label_refresh_needed` means a cheap re-render can update lawyer-facing source labels.
- `chronology_review_needed` means source metadata changed enough to ask for legal review.
- `chronology_regeneration_needed` means the source set or source content changed enough to rebuild the chronology.

Before this cleanup, the backend, vanilla frontend, and React frontend each carried local copies of those strings. That is exactly the sort of small duplication that causes expensive UI mistakes later: one surface offers "Refresh labels only" while another says the chronology must be regenerated. The React smoke test now checks its typed constants against the shared backend contract, so drift is caught during acceptance instead of by a lawyer seeing contradictory advice.

The same pattern now protects the custom-skill overlap gate. The backend owns the minimum override length and the router decisions/actions that block duplicate skill creation. React has a small typed helper for the UI, but `scripts/react-ui-smoke.mjs` compares those helper constants against `shared/skill-creation-overlap-policy.mjs`.

This is a good example of accepting a small amount of duplication for a practical reason. The React app cannot naturally consume every server-side module without dragging bundling concerns into the browser build. But the contract values can still be treated as shared truth and checked at acceptance time. That gives us most of the safety without turning the build system into the main project.
