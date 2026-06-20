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

The visual theme is token-based in `react-ui/src/styles/global.css`: dark navigation, warm work surface, quiet borders, restrained cards, and small legal-workbench accents. That lets Home, Skills, Activity, Settings, and matter pages share a design language without rewriting each feature surface.

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
MISTRAL_API_KEY=...
GEMINI_API_KEY=... # optional OCR repair pass
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

- PDFs through Mistral OCR when `MISTRAL_API_KEY` is configured, with
  `pdfjs-dist` retained for page-count, text-layer diagnostics, and fallback;
- DOCX through `mammoth`;
- RTF;
- text and Markdown;
- spreadsheets through `xlsx`;
- EML email through `mailparser`.

For PDFs, key presence controls the OCR provider path:

```text
MISTRAL_API_KEY=...
GEMINI_API_KEY=... # optional OCR repair pass
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

The first database migrations now exist, but they are deliberately a
control-plane baseline rather than a runtime rewrite:

```text
db/migrations/001_control_plane.sql
db/migrations/002_tenant_rls.sql
db/migrations/003_tenant_reference_integrity.sql
db/migrations/004_user_membership_integrity.sql
db/migrations/005_storage_object_lifecycle.sql
db/migrations/006_job_execution_leases.sql
db/migrations/007_local_matter_import_ledger.sql
db/migrations/008_job_worker_functions.sql
db/migrations/009_incident_helper_functions.sql
db/migrations/010_advisory_snapshot_functions.sql
db/migrations/011_custom_skill_lifecycle_functions.sql
db/migrations/012_tenant_org_profile.sql
```

The baseline sketches the hosted beta backbone: tenants, matters, document
identity, object pointers, extraction records, jobs, provider runs, artifacts,
incidents, advisory snapshots, cost events, audit events, skill ideas, skill
samples, and configurable-skill ledgers. It also adds one shared `updated_at`
trigger helper so mutable rows keep honest modification timestamps without every
future service remembering to set them by hand. Notice what it does not do: it
does not store PDFs or generated legal work inline, and it does not make the
local engines read from Postgres yet.

The later preparatory migrations add the hosted safety rails around that
backbone: tenant row-level security, tenant-consistent parent references, and
tenant-member user references. They also add a storage-object custody ledger so
hosted files and generated artifacts can be tracked as pending, uploaded,
verified, failed, orphaned, or deleted without stuffing legal documents into
Postgres. In plainer terms, a row cannot say "I belong to Tenant A" while
pointing at Tenant B's matter, artifact, skill, or user, and an object cannot
float around object storage without a database lifecycle record.

The second migration enables and forces row-level security on tenant-scoped
tables. In plain English: a hosted database session must set `app.tenant_id`
before it can see or write tenant legal data. If that context is missing, the
database should deny access rather than hoping application code remembered every
filter.

The third migration closes a quieter hosted-data bug. RLS checks the tenant on
the row being read or written, but a child row could still point at a parent row
from another tenant unless the database forbids that relationship. The
tenant-reference migration adds composite parent links like `(matter_id,
tenant_id) -> matters(id, tenant_id)` and equivalent links for jobs, artifacts,
incidents, skill ideas, skill versions, and custom-skill runs.

The fourth migration applies the same discipline to user references. A hosted
matter, upload, job, label confirmation, acknowledgement, audit actor, or custom
skill lifecycle change should not be able to name a user who is outside the
tenant. It also makes cost/provider approvals point at tenant-local audit
events, so "who approved this spend?" has a database-enforced answer.

The twelfth migration adds a small but important product signal to the tenant
row itself. Earlier migrations already had `tenant_memberships` and
`matter_memberships`, so the database was technically multi-user capable. But
that capability was easy to miss. `012_tenant_org_profile.sql` adds
`account_scope`, `organization_slug`, `max_member_count`, and
`primary_owner_user_id`. That lets the system later distinguish "one lawyer's
private beta account" from "a firm or organization account with more seats"
without rebuilding matter tables. The lesson is subtle: if the product will
grow from solo users to organizations, make that shape explicit early, even if
the first beta still behaves like one user on one machine.

The fifth migration handles the object-storage transaction boundary. The app
already knows large files and legal artifacts should live outside Postgres. The
database still needs custody records for those objects: what was expected, what
was uploaded, what was verified, what failed, and what became orphaned after an
interruption. That is what `storage_objects` provides.

The sixth migration handles the worker transaction boundary. Long-running
hosted work cannot depend on a browser tab staying open or a single process
remembering what it was doing. Jobs and outbox events now have lease, heartbeat,
retry, and expired-claim fields. That lets a future worker say "I have claimed
this job for the next few minutes," and lets another worker recover it if the
first one disappears.

The seventh migration handles a practical beta reality: existing local matter
folders will not magically appear in hosted Postgres. `matter_import_batches`
and `matter_import_items` create a disciplined ledger for importing those
folders later. The important rule is that old source identities are not silently
renumbered. If an import collides or looks unsafe, the batch has somewhere to
record that instead of hiding it.

The eighth and ninth migrations prepare the hosted worker loop. The eighth adds
atomic claim, heartbeat, completion, and retry functions so a future worker can
take a job without two processes accidentally doing the same legal work. The
ninth adds canonical incident helpers, so failed jobs, failed model calls, and
artifact-validation warnings all become the same kind of tenant-scoped advisory
evidence. That matters because Matter Attention should be a projection over
real failures and validation results, not a second diary that drifts away from
what actually happened.

The tenth migration gives that projection a memory. A Preparation Advisory
snapshot is append-only: it records the open incidents and validation warnings
that existed at the end of a preparation run. Later, if a user fixes the problem
or a worker resolves an incident, the old snapshot does not rewrite history. The
system can still answer, "what did we warn the beta user about at that time?"

The eleventh migration applies the same idea to custom skills. Local V1 already
lets a user pause, resume, archive, restore, or soft-delete custom skills. The
hosted database should not leave that as a pile of handwritten `UPDATE`
statements. `update_configurable_skill_lifecycle()` owns the allowed
transitions, preserves the previous status and reason, blocks previous-version
rows, and rejects a resume if another active custom skill already owns the same
slash.

The eighth migration turns the job tables from passive ledgers into a usable
worker queue foundation. A future worker can atomically claim the next job,
heartbeat while it is running, complete it, or put it back for retry. The same
pattern applies to outbox events. This avoids the classic distributed-systems
mistake where two workers both think they own the same legal extraction job.

This is the right migration posture. First make identity, jobs, audit, and
receipts durable, then make file custody, worker custody, and import custody
observable, then make worker claims atomic; only then move legal engines onto
hosted workers.

The migration runner is intentionally boring:

```sh
npm run db:migrations:list
npm run db:migrations:check
npm run db:doctor
npm run db:shadow:preflight
npm run db:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:migrate
MWB_DATABASE_URL="postgres://..." npm run db:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:shadow:inspect
npm run db:skills:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:skills:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:skills:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:skills:shadow:inspect
npm run db:advisory:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:advisory:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:advisory:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:advisory:shadow:inspect
npm run db:storage:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:storage:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:storage:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:storage:shadow:inspect
npm run db:provider-runs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:provider-runs:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:provider-runs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:provider-runs:shadow:inspect
npm run db:jobs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:jobs:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:jobs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:jobs:shadow:inspect
npm run db:costs:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:costs:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:costs:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:costs:shadow:inspect
npm run db:audit:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:audit:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:audit:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:audit:shadow:inspect
npm run db:shadow:hydrate:dry-run
MWB_DATABASE_URL="postgres://..." npm run db:shadow:hydrate
MWB_DATABASE_URL="postgres://..." npm run db:shadow:hydrate:verify
MWB_DATABASE_URL="postgres://..." npm run db:shadow:report
MWB_DATABASE_URL="postgres://..." npm run db:shadow:snapshot
```

It uses `psql` rather than adding a Postgres client library to the app runtime.
That keeps the local workbench dependency-light while still giving deployment a
repeatable migration path. If no database URL is present, the check command
lists migrations with `unknown` status instead of pretending it inspected a
database. `db:doctor` is the handover-friendly command: it is read-only, checks
whether `psql` is available, says whether a database URL is configured, and
redacts the URL before printing anything. When a migration is applied, the
runner records a SHA-256 checksum in `schema_migrations` and uses a Postgres
advisory lock inside the migration transaction. In plain English: if someone
edits an already-applied migration, the deploy should stop and ask for a new
migration instead of quietly pretending the database is still in a known state.
It also refuses gaps in the numbering sequence. That small rule matters because
missing `002` while applying `003` is exactly the kind of quiet deployment
mistake that creates "the app worked on my machine" confusion later.

The database tools also learned a small deployment lesson: a good schema can
still feel broken if the operator cannot find the `psql` binary. On this Mac,
Homebrew's PostgreSQL client lived under `libpq`, not on the normal shell
`PATH`. The tools now honor `MWB_PSQL_BIN`, auto-discover common `psql`
locations, and load local `.env` values before resolving the database URL. The
DB tools also load an ignored `.env.shadow` file after `.env`; shell values and
main `.env` values still win, but `.env.shadow` gives the operator a cleaner
place to keep rehearsal database credentials. This does not move the app to
Postgres, but it removes a needless handoff trap. Good infrastructure work often
looks like this: not a grand architecture rewrite, but one fewer "why does this
work for you but not for me?" failure.

The DB track now has a one-command preflight as well:
`npm run db:shadow:preflight`. It is deliberately read-only. It runs the
doctor, then runs the full shadow hydration dry-run, and gives a plain status:
database URL missing or configured, `psql` available or not, dry-run works or
not, migrations ready to apply or already ready to hydrate. This is the
operator equivalent of checking the tyres and fuel before starting a long drive.
It does not move the car; it tells you whether the next action is code, schema,
credentials, or hydration.

The shadow hydration commands are the next rehearsal layer. `db:hydrate:dry-run`
walks the local matter folders and counts only control-plane metadata: matter
JSON, file registers, extraction logs, source labels, and List of Dates metadata.
It deliberately does not read original document bodies or generated work-product
bodies. `db:hydrate` writes deterministic rows into a migrated shadow database,
and `db:hydrate:verify` asks whether those database row counts still match the
filesystem plan. `db:shadow:inspect` is the human-friendly read-only query: it
shows which matters are in the shadow database and how many documents,
extractions, source descriptors, and artifact pointers they have.

The important lesson is sequencing. We are not "moving to database" in one
heroic rewrite. We are first proving that the database can mirror identity and
workflow metadata without touching the running app. That gives us learning with
low blast radius.

The next rehearsal mirrors the custom-skill factory. `db:skills:hydrate:dry-run`
reads the app-level skill JSON stores, `db:skills:hydrate` writes ideas,
samples, configurable skills, versions, and run receipts into the shadow
database, and `db:skills:hydrate:verify` checks that row counts match. This
matters because custom skills are not just UI preferences; they are user-shaped
workflow behavior. The database should learn to preserve them before the app
ever depends on it.

The advisory rehearsal is the same idea applied to QA warnings. Local
Preparation Advisory items are not copied into a new "attention table." Instead,
`db:advisory:hydrate` turns them into canonical incident rows and then creates
append-only advisory snapshots. That is an important design choice: the database
stores what happened and what was open at the time, while "attention" remains a
view over those facts.

`db:shadow:report` is the useful operator shortcut once these tracks have been
hydrated. It asks the shadow database two questions in one pass: do the row
counts still match the local plans, and what matter, skill, advisory,
storage-custody, provider-run, and cost summaries are actually visible through
the tenant-scoped database reads? Think of it as the dashboard check before a
developer says "the database mirror is sane."

`db:shadow:snapshot` is the handoff version of that dashboard check. It writes
the combined report into timestamped Markdown and JSON files under
`docs/shadow-db-snapshots/`. That sounds small, but it is a useful habit: when a
database rehearsal matters, do not leave the evidence trapped in yesterday's
terminal scrollback. Preserve a dated snapshot so the next developer can see
what matched, what did not, and which mirror state you were talking about.

There is one subtle trap here. The commit recorded inside a checked-in
`db:shadow:snapshot` is the **source repo state** that produced the report,
before the snapshot files themselves are committed. If you keep refreshing the
snapshot just to make it cite the commit that contains that same snapshot, you
create a self-referential loop. That is not stronger evidence; it is just a
perpetual-motion machine made out of Git commits. The right rule is: refresh
after meaningful repo, matter-folder, skill-ledger, or shadow-hydration changes,
then commit the snapshot as evidence of that source state.

`docs/database-transition-handoff.md` is the practical next-person note for
this track. It says what to run, what the current snapshot means, and where the
stop line is. The key lesson is that handoff is not only "here are the commands."
It is also "here is what these commands do not prove yet." A good handoff
protects the next engineer from accidentally treating a shadow mirror as a
runtime database cutover.

The storage rehearsal is the bridge from "database knows the matter" to
"database knows where the matter's files live." `db:storage:hydrate:dry-run`
does not open the original PDFs, emails, or spreadsheets. It reads the existing
registers and ledgers, then plans custody rows for source originals, working
copies, extraction payloads, matter artifacts, and skill samples. The write and
verify commands prove those pointers can be inserted idempotently. That is the
right order: first prove the custody ledger, then later decide how actual cloud
object storage should be mounted.

One design choice is worth noticing: sample Markdown is not inserted as a giant
inline blob. The shadow row stores a hash and object-key style pointer. That is
the same discipline we want for matter artifacts: the database owns identity,
relationships, status, and receipts; bulky legal work product remains a file or
object-storage payload.

The provider-run rehearsal extends the same discipline to AI calls. The shadow
database now learns "which provider/model/task ran, what status it had, and what
artifact/sample/run it belongs to." It does not learn the prompt, the bounded
matter packet, the model's full output, or the generated legal work product. In
plain language: Postgres is learning the flight log, not swallowing the case
file.

The job rehearsal is narrower than a full hosted worker system, and that is
intentional. Local V1 did not have a durable job queue; it ran many things in the
foreground. So `db:jobs:hydrate` only creates shadow `processing_jobs` where a
provider run already proves that a unit of work happened. Source labels, List of
Dates, skill samples, and custom-skill runs can get job rows. The app does not
invent historical outbox events. Good engineers are careful with history: when
the record is strong, mirror it; when the record is weak, mark the gap instead
of making up a neat story.

The cost-event rehearsal is one layer above that flight log. For every mirrored
provider run, the shadow database records a cost event with the known token and
spend values, or marks the confidence as `unknown` when the local run metadata
does not know the spend. That is not a billing system yet. It is the first
honest budget ledger: "we know this model call happened; here is what we know,
and here is what we do not."

The audit-event rehearsal adds the next important boundary: the database should
learn that a command happened without turning into a transcript vault. The local
command interaction log can contain typed user text, terminal snippets, router
reasoning, and error detail. `db:audit:hydrate` does not copy those fields. It
keeps a whitelisted event record: action, matched matter when known,
provider-invoked flag, status, planner source/model, and small routing metadata.
Think of it as a courtroom diary entry that says "hearing held, issue noted,"
not a verbatim recording of every privileged conversation.

Once all these individual rehearsals existed, the next engineering move was to
remove operator friction. `db:shadow:hydrate:dry-run` runs every planner in the
right order. `db:shadow:hydrate` writes every shadow track and then runs the
combined report. `db:shadow:hydrate:verify` runs every count check and then the
same report. This is a good example of a small automation that does not change
product behavior: the command is a checklist executor, not a new architecture.
`db:shadow:acceptance` is the final read-only gate for this rehearsal. It asks,
"is the migrated shadow database ready to hydrate, and does every mirrored
track still verify?" If the answer is yes, the shadow database is acceptable as
handoff evidence. If the answer is no, it fails closed before anyone can confuse
the mirror with a runtime cutover. This is the right mental model for the DB
transition: prove the mirror, preserve evidence, then only later decide whether
the app should depend on it.
`db:shadow:backup` adds the next operational habit: before a future migration or
handoff, take a local ignored `pg_dump` backup under `.local/shadow-db-backups/`.
That backup is not product storage and it is not checked into Git. It is the
"do not be clever with the only copy" rule in concrete form.
`db:shadow:restore-drill` then tests whether that backup is real. It restores
the dump into a temporary database whose name must start with
`matter_workbench_shadow_restore_`, runs the same combined shadow report, and
drops the temporary database unless the operator explicitly keeps it. This is
how a serious engineer treats backups: a backup you have not restored is only a
hopeful file.
The next lesson is that a database backup is not a matter backup when the
database only stores file pointers. The shadow DB first learned
`storage_objects` and `document_blobs` rows that say "this PDF should exist
here, with this hash." That exposed the real risk: the DB could restore cleanly
while the PDF bytes were gone. The first answer was
`db:shadow:storage-backup`, which copied DB-referenced local PDFs into an
ignored `.local` backup folder and proved those copied files were hash-matching.
That was good single-host evidence, but still not true DB custody.

The stronger local/private answer is `storage_object_payloads`. In explicit DB
payload mode, the hydrator copies source, artifact, and sample bytes into
Postgres with size and SHA-256 checks. That means a DB runtime smoke can prove
that workspace rows, text previews, and raw file streams are coming from
Postgres payload rows, not from the live matter folder. This still does not
decide the cloud object-storage provider. It says that for this machine and
this private beta path, the database can now hold the bytes it points at.
Multi-host or cloud hosting still needs durable object storage or a managed
shared volume.
The next subtle blocker was Postgres outage behavior. For the local beta, the
answer is now deliberately boring: the app does not use Postgres as live storage
yet, so a dead shadow database should not stop the lawyer-facing app. The
acceptance check proves that by starting the local React/server path with a
bogus database URL. DB scripts still fail closed when they need a database, but
the product remains filesystem-backed. That is a good lesson: the safest
fallback is often not a clever fallback at all; it is refusing to make an
experimental mirror part of the live path too early.
The first runtime DB slice changed that carefully, not dramatically. With
`MWB_RUNTIME_DB=postgres` and explicit approval, Postgres first owned the matter
index and active-matter resolution. The app could ask the database, "which
matters exist?" while the existing filesystem path still opened the documents.
That was the front desk becoming database-backed.

The next runtime slice moved the read/file-custody surfaces too. With
`MWB_RUNTIME_DB_STORAGE=postgres`, the workspace tree, text file previews, raw
file downloads, matter status, prepare plan, and advisory snapshot can all come
from Postgres. The app then learned a safer write bridge: materialize a
temporary matter folder from DB payloads, run the existing engine, and persist
the changed outputs back into Postgres. That temporary folder is not truth; it
is a workbench. A direct write path that pretends `postgres:Some Matter` is a
normal folder would be a future bug factory.
The worker blocker got the same treatment. The local beta does not have a
separate job worker; preparation still runs in the foreground app flow. The DB
does have the future worker ingredients: `processing_jobs`, `job_outbox`, and
claim/heartbeat/complete functions. So the local rehearsal can close the worker
policy blocker without pretending a hosted worker supervisor exists. The lesson
is precision: "we know how local foreground work behaves" is true; "we have a
production background-worker system" would be false.
Finally, the DB now has the bare hosted auth/session model that was missing
from the tenant story. `auth_identities` says "this external login belongs to
this app user." `tenant_sessions` says "this user is operating inside this
tenant right now, with this session hash and expiry." That matters because a
firm account is not just a larger personal account; it needs a way to decide
which tenant the request belongs to. We also tightened session row visibility
to tenant plus user, because a firm tenant may contain many lawyers and a normal
request should not see another lawyer's sessions. This still does not choose an
auth product or issue cookies. It only gives a future hosted runtime the
database contract it needs.
The same cleanup happened for local matter import and advisory preservation.
Those were originally kept as runtime cutover blockers, which was cautious but
eventually too vague. The shadow DB now has import batches/items for existing
matter folders, and it has canonical incidents plus append-only advisory
snapshots for Matter Attention. Once those are verified in the shadow report,
they are no longer open policy questions for the rehearsal. Good engineering
does not keep old blockers forever; it turns them into evidence, then narrows
the remaining stop rule to the decisions that are genuinely still open.

The custom skill factory follows the same local-first instinct, but uses app-level JSON stores instead of matter folders:

- `skill-ideas.json` stores requests and design briefs.
- `skill-samples.json` stores sample versions, feedback, and approvals.
- `configurable-skills.json` stores the generated configurable skill definitions.
- `configurable-skill-runs.json` stores run receipts, not the full work product.

The core lifecycle service is still `services/configurable-skills-service.mjs`, but the details are now split into helper modules: definition normalization, JSON store access, provider calls, matter-context summarization, and validation. That split matters because skill creation is powerful; good engineers keep the pieces visible instead of letting one file become a fog bank.

## The Frontend

The v1 frontend is now the React/Vite shell in `react-ui/`. The older plain
browser JavaScript shell still exists in the repository, but it is retired as a
product surface. Treat the remaining old files as migration material: useful
helpers can be promoted, old browser UX can be deleted.

The React/Vite UI that was previously being explored in a separate local repo
has now been absorbed into this repo under `react-ui/`, so there is one product
codebase again.

In plain English: we did not move into two houses. We brought the useful React
prototype furniture into the main house, made that the front door, and started
marking the old rooms for careful demolition.

The current safe arrangement is:

- `/` serves the compiled React shell by default.
- `/react/` also serves the compiled React shell, so older test links keep working.
- `react-ui/` contains the React source.
- `react-dist/` is generated output and is ignored by git.
- `npm start` first builds `react-dist/`, then starts `server.mjs`.
- `npm run start:server` starts the backend without rebuilding when `react-dist/` is already current.
- `npm run ui:dev` serves the React app on `http://127.0.0.1:5173/react/` while proxying API calls to the backend.
- `npm run ui:build` type-checks and builds the React app.
- `npm run ui:smoke` checks that the production React root and the live backend still agree on the API shapes React renders.
- `npm run ui:accept` runs the build and live smoke together before promoting frontend experiments.

This means the separate `matter-workbench-react-ui-prototype` repo is no longer a
source of truth. Keep it only as a temporary backup until we are comfortable
deleting it.

The most important cutover lesson was not "switch `/` to React." It was
"production must be bootable from a clean checkout." Because `react-dist/` is
ignored, a fresh repo will not contain the compiled UI. If `npm start` only ran
`node server.mjs`, the production root could point at a missing build. That is
why `npm start` now builds React before starting the server, while
`npm run start:server` remains available for fast local restarts.

The old shell flag is gone from the product path. React is the served browser
surface at `/` and `/react/`; old plain-JS files now survive only when a tested
helper has not yet moved to React, shared code, or a backend service.

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
- The same smoke now also checks read-only matter surfaces that React depends
  on: workspace tree, matter readiness, matter attention, context preview,
  context search, doctor scan, and text file preview. This is the boring but
  valuable migration work: a route rename or response-shape drift should break
  the acceptance check before it breaks the React screen.
- React TypeScript types are being corrected against live backend shapes as we
  find drift. For example, `MatterStatus` is a stage-based readiness payload; it
  does not promise aggregate completion fields that the backend never sends.
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
- React matter-scoped read views now ignore stale async responses after a matter
  switch. That protects Matter readiness, Developer attention, Context Preview,
  and Prepare Matter from painting an old matter's response into the new matter
  screen if a request finishes late.
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
- React Skill Factory also mirrors the backend readiness gate before marking an
  idea ready for review. If the design brief is incomplete, React now explains
  that locally instead of sending a doomed status update and surfacing a raw API
  rejection. When the backend accepts the status change, React keeps the
  normalized idea record returned by the server.
- React and vanilla now recognize explicit skill-idea phrasing from the same
  pattern contract. That matters for the messy real inputs people type:
  `new skill to...`, `build a skill which...`, and even the common typo
  `skil` should enter the skill-idea workflow instead of getting pushed through
  unrelated command routing.
- terminal history is bounded, theme storage is fail-safe, clipboard writes
  have a browser fallback, and AI settings save failures show inline errors.

The engineering lesson is simple: a React port is not "ready" because it
renders. It is ready only when it speaks the backend contract faithfully, fails
readably, and has acceptance checks that catch drift before a lawyer clicks
through a broken workflow. That is why `npm run ui:accept` exists. It builds,
type-checks, and smoke-tests the React app against the live backend shape.

Important files:

- `react-ui/src/App.tsx` - default React shell composition;
- `react-ui/src/store/AppContext.tsx` - active matter, matter switching, and workspace refresh owner;
- `react-ui/src/api/client.ts` - React UI API adapter against the same backend contract;
- `react-ui/src/lib/nativeCommands.ts` - native command labels, routing views, sidebar actions, command suggestions, and local-vs-AI badges;
- `react-ui/src/components/command/CommandPanel.tsx` - React command panel and compact activity strip;
- `react-ui/src/components/RerunConfirmDialog.tsx` - React rerun confirmation dialog;
- `react-ui/src/views/MatterOverview.tsx` - React matter overview and readiness surface;
- `react-ui/src/views/SettingsPage.tsx` - React settings view using the live backend readiness contract;
- `react-ui/vite.config.ts` - Vite config for dev proxying and `/react/` build output.
- `scripts/react-ui-smoke.mjs` - live acceptance check for React/backend contract drift.
- `frontend/ai-command-box.js` - retired plain-JS Command rail facade kept only while helper/parity tests migrate;
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
- `frontend/skills-page-actions.js` - Skills and Activity page copy/open/status button wiring;
- `frontend/workspace-view.js` - workspace tree, lane opening, and generic file preview selection;
- `frontend/listofdates-markdown-preview.js` - List of Dates markdown parsing, scannable chronology rendering, and copy/download actions;
- `frontend/views/skills-page*.js` - Skills page composition, saved ideas, cards, summaries, and health rendering;
- `frontend/api-client.js` - API helper;
- `frontend/status.js` - status output.

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

1. **Your Skills** - active and paused custom skills the user controls.
2. **Skills in Progress** - saved ideas and draft skills that are not yet normal runnable tools.
3. **Built-in Workflows** - app-owned legal workflows, collapsed by default.
4. **History** - archived skills, previous versions, and dismissed ideas.

The important lesson is that technical health is valuable, but it should not become the product's main face. Skill factory health is now a small status signal, not the thing a lawyer has to parse before knowing what to do.

The Skills page also learned a small but important loading lesson. It briefly
had the right backend data but showed stale `Failed to fetch` messages in Recent
Activity because transient page-load failures were logged globally. That is a
bad first impression: a one-time refresh gap should not look like the skill
system is permanently broken. Skills-page load errors now stay local to the
page, show a **Try again** button, and disappear after a successful reload.

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

The browser imports the same canonical constants from `shared/listofdates-dependency-states.mjs`, so UI affordances like `Refresh labels only` do not depend on hand-typed strings scattered across different views.

The same rule now applies to rerun-advice states. The backend emits `current`, `stale`, `missing`, `failed`, `missing_upstream`, or `unknown` from `shared/rerun-advice-states.mjs`; React keeps a typed mirror, and the React smoke test compares both lists. This is not ceremony. These tiny strings decide whether the lawyer sees "up to date", "needs update", "waiting on earlier step", or a warning dialog before a paid run. If one UI invents a seventh state or misspells one, the app can become confident in the wrong moment.

Prepare Matter action names are now treated the same way. The backend plan emits actions like `run`, `confirm_paid_run`, `blocked`, and `recommend_separate_skill` from `shared/preparation-stage-actions.mjs`; the React port has a typed mirror checked by the smoke test. This protects the orchestrator from the quietest kind of breakage: the backend says "ask before a paid source-labeling run" while one frontend accidentally treats it as an ordinary run.

Native command aliases now follow the same discipline. Vanilla already knew that `prepare matter`, `source labels`, and `chronology` should route directly to `/prepare_matter`, `/describe_sources`, and `/create_listofdates`; React had the visible suggestions but could fall back to intent checking if the user typed the plain-English alias and pressed Enter. The alias list now lives in `shared/builtin-skill-commands.mjs`, React has a checked mirror, and the smoke test compares them. That means obvious lawyer phrases remain fast, deterministic commands instead of accidental AI routing.

React now resolves native commands through one helper, `resolveNativeCommand()`, before it asks the model-powered intent checker. Exact slashes and plain-English aliases go through the same path, and the unit test asserts that the resolver checks aliases. The principle is simple: deterministic product commands should stay deterministic, especially when the visible UI teaches the lawyer to type phrases like `prepare matter`.

Skill-idea session commands now follow the same rule. Vanilla uses the shared `shared/skill-idea-session-commands.mjs` classifier, React has a typed mirror, and the smoke test compares the command sets. This closes a small but nasty UX trap: once a user is inside "new skill" mode, phrases like `generate sample` should advance that conversation, not get reinterpreted as a fresh global request.

The entry point into that workflow also has a shared contract now. `shared/skill-idea-input.mjs` owns the explicit "I want a skill..." patterns, and React mirrors them under smoke-test protection. The practical lesson is that command parsing is product behavior. If one shell accepts `new skil for limitation review` and another does not, users experience it as the app being moody, not as an implementation detail.

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

## Product Surface Lesson: Group By User Decision, Not Internal Type

The Skills page briefly had the right data but the wrong first impression. One version led with custom skills and hid the breadth of app-owned workflows; another made native workflows too prominent for a user who simply wanted to manage their own reusable tools.

The better rule is MECE and action-first: show user-controlled custom skills at
the top, keep unfinished ideas separate, collapse built-in workflows as
app-owned reference material, and move archives and old versions into History.
This matches the actual decisions a lawyer has to make: "what can I run now?",
"what am I still creating?", "what does the app already provide?", and "what did
I retire?"

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

The React flow also now keeps the sample tied to a real test matter. If no matter is selected, it does not save the idea and then discover the problem through a failed sample-generation call. It stops at the UI boundary and says to pick a test matter first. That mirrors the older browser shell and avoids a subtle cost/trust issue: sample generation is the first expensive proof step, so the app should not enter it without the context that makes the sample meaningful.

The supporting helpers moved into `react-ui/src/lib/skillIdeaSession.ts`. That is a small architectural cleanup with a practical purpose. The component still owns the conversation UI, but pure things like "is there a selected test matter?", "how do we normalize a planned interview?", and "how do we build the design brief from answers?" now live in one testable place. Good refactors often look like this: no new feature parade, just fewer reasons for one component to know everything.

The same helper now owns React-side review packet and sample-copy formatting for the command-session flow. This closes a small "I typed the supported command but got redirected elsewhere" problem: `copy review packet` and `copy sample v2` are real local copy actions in React, not vague instructions to leave the conversation and open another screen. That matters because the skill factory is already a delicate workflow. A user should not have to remember which surface owns a saved idea while they are reviewing whether the sample is good enough.

React now also has its own small `secretRedaction` helper, tested against the shared backend redaction policy. That may sound like plumbing, but it is the kind of boring guardrail that matters in a legal AI product: copied review packets, sample packets, and future diagnostics should be useful to a developer without accidentally carrying `OPENAI_API_KEY`, bearer tokens, or provider-style `sk-...` keys into chat, email, or screenshots.

The copied React review packet now carries the same basic governance shape as the vanilla Skills page packet: status, readiness checklist, suggested classification, open questions, and the "not runnable yet" boundary. That avoids a subtle trap where two frontends both support `copy review packet`, but one gives the implementation reviewer less context than the other.

React Activity now uses a dedicated custom-skill run report helper instead of building a tiny ad hoc clipboard string in the component. The helper mirrors the vanilla report boundary: metadata only, redacted secrets, no generated work product body. Activity also refuses to open a run output unless the active matter is the same matter that owns the run. That guard matters because run output paths are matter-relative; opening `20_Workshop/Party Map.md` while another matter is active can show the wrong file or fail in a confusing way.

The next React parity bug was even more concrete: the Activity page could navigate to an output preview shell without loading the file content, so the lawyer saw a title and an empty body. React now has a small `filePreview` helper that the Workspace tree and Activity page both use. The lesson is simple but important: navigation state and data state are different. A UI can point at the right file and still be wrong if it never reads the file.

Custom skill run context hit the same kind of boundary bug, but on the backend. A skill that asks for a Statute and Section Reading Guide timed out on the Techbeliever GST matter even though the skill definition itself was valid. The problem was that configurable skill runs were being handed the full List of Dates JSON plus the full List of Dates Markdown as library artifacts. That made the model payload enormous and duplicated the same chronology in two forms before the skill even started reasoning.

The fix was not to make the timeout bigger. It was to shape the context better. `services/configurable-skill-context.mjs` now sends compact library-artifact summaries for custom skill runs: source inventory metadata, a bounded slice of chronology entries, and proof that the List of Dates Markdown exists, but not the whole Markdown body. The canonical matter context packet still keeps the richer artifact summaries for preview/search, and Copilot still has its own List-of-Dates-first behavior. The engineering lesson is important: when a legal AI feature fails, "give the model more" is not always safer. The right context is bounded, intentional, and task-specific.

The Workspace tree now also checks matter identity before applying a late text-preview response. That may sound like an edge case, but it is exactly the kind of edge case React ports create: click a file, switch matters quickly, and an old promise can try to fill the new screen. The fix is the same boring invariant everywhere else in this migration: capture the matter at the start of the action, and ignore the result if that is no longer the active matter.

The command fallback follows that rule too. If a freeform command has to ask the backend intent checker, React captures the active matter name before sending the request. If the lawyer switches matter before the answer comes back, the shell ignores that old answer instead of navigating the new matter based on stale context. This keeps deterministic command routing and model-backed intent checking under the same matter-identity discipline.

Matter switching itself now follows a stricter rule: requests are serialized and only the latest requested matter is allowed to update the shell. Without that, a quick click from Matter A to Matter B could let the slower Matter A response arrive last and quietly overwrite the newer choice. The fix uses a small sequence number and a promise chain, which is the plain engineering version of "the last deliberate user action wins."

The backend workflow routes now honor an explicit `matterName` in React POST requests. This fixed an important migration contract mismatch: React was already sending the selected matter for extraction, source labels, List of Dates, label refresh, doctor checks, and preparation stages, but some route handlers still used the server's global active matter. In a single-page React shell, the safest rule is to carry the selected matter through the request itself. The server can then run the action for that matter without silently switching the whole app.

The same explicit-matter discipline now applies to read-side React APIs: matter status, developer attention, prepare-matter plans, matter context preview/search, and rerun advice can all be requested for a named matter. This matters because React screens can stay mounted while state changes around them. Passing the matter name through the API call makes the backend answer the question the screen actually asked, not merely "whatever matter is active right now."

React workspace reads now follow that rule too. `/api/workspace`, `/api/file`, and `/api/file-raw` still work for the active matter, but they can also take an explicit `matter` query. The React tree, file preview, raw PDF/image preview, Activity output opener, and shared workspace refresh owner now pass the selected matter through the request. That is a guard against one of the most dangerous UI bugs in a matter system: showing a correct relative path from the wrong matter folder.

React matter switching now also clears matter-scoped preview state. Before this, the shell could keep `activeView: file-preview` and a stale `filePreview` payload while the active matter changed. That is the kind of migration bug that looks small in code but feels serious in a legal workspace: a lawyer could believe they are looking inside one matter while the preview is still from another. The fix is not a feature; it is state ownership discipline.

The Prepare Matter React view also stopped using the rerun guard as a generic paid-action confirmation. That mattered because the rerun guard is allowed to auto-run when no previous artifact exists; that is correct for rerun safety, but wrong for a stage whose backend action says `confirm_paid_run`. Paid-provider confirmation is now a plain explicit confirmation card in the Prepare Matter view. The lesson is that similar-looking dialogs can have different contracts: "is it safe to replace an existing artifact?" is not the same question as "may I start a paid AI call?"

Artifact-writing React workflows now refresh the active matter workspace through the same context owner after successful writes. Extract, Source Labels, Prepare Matter, and Doctor fixes can all change the files or generated records underneath the shell. If the UI keeps showing the old file tree after that, the backend may be correct but the lawyer still sees stale workspace state. This is the React migration theme in miniature: every write path needs an explicit state-refresh story.

That refresh owner now also checks the expected matter before applying async results. A workflow can start against one matter and finish after the user has switched to another; without a guard, the old task could ask the shell to refresh whichever matter is currently active. The fix is to pass the matter name captured at run start and skip the refresh if the workspace returned by the backend no longer matches. It is a small defensive pattern, but it protects the most important invariant in this app: the UI must never casually mix matter identities.

The workflow views now apply the same idea to their own result panels. Extract, Source Labels, List of Dates, Prepare Matter, Doctor, and context search keep a ref to the latest active matter name and ignore late responses from a matter that is no longer active. This is defensive React work, not a new feature. It prevents an old request from filling the current screen with the previous matter's rows, warnings, or generated chronology after a fast matter switch.

The same guard now covers Add Files and Activity output previews. Add Files captures the matter that started duplicate checking/upload and ignores overlap or upload responses if the active matter changes. Activity waits for the file preview payload before changing the file-preview state, then checks that the same matter is still active. That preserves a simple rule: a visible matter page should only be updated by responses that still belong to that matter.

Add Files now carries that selected matter all the way into the multipart upload request. The backend still supports the old "add to active matter" path, but React sends `matterName`, and the upload service writes the new intake into that named matter without switching the whole server active matter. This closes the write-side version of the same bug: a slow upload should not accidentally land in whichever matter happens to be active when the server receives it.

The same explicit matter summary now covers React-created skill ideas and command diagnostics. React was already sending `matterName`; the server now uses that requested matter when recording the idea or appending the command-interaction JSONL entry. That keeps review packets and developer diagnostics tied to the matter the user was working on, not merely the matter that happened to be active at log time.

The React skill-idea interview planner now follows the same rule. The planner prompt may include a compact matter summary, so the route and service now accept the matter selected by the React shell instead of always reading the server-active matter. This does not change what the product does; it keeps the planner's context aligned with the screen that opened the interview.

The skill-idea overlap check now carries the selected matter as well. Today the overlap decision is mostly app-level, but the frontend contract is cleaner when every skill-idea backend call carries the matter identity it was opened under. That keeps future backend use of matter context from becoming another migration surprise.

The skill-idea session now also rejects late interview, save, and overlap responses after a matter switch. This is the same bug class in a more subtle place: the command rail can remain open while the matter changes. A long-running planner or overlap check should not quietly update the current session if it was started under another matter. Generated samples also remember the matter folder they were created for, so React will ask the user to return to that matter before turning the sample into a runnable skill.

The React port also no longer suppresses hook dependency checks in source. Where a component intentionally needs "latest callback, but do not restart this request," it now uses a ref; where a request should cancel on unmount or matter change, the effect owns a cancellation flag. This is less about lint neatness and more about making async behavior explicit before React becomes the primary shell.

React Skill Factory now has the same explicit boundary around edited skill ideas. A generated sample belongs to the saved design brief and the selected test matter. If the user edits answers after saving, React marks the old sample path as dirty, saves the updated brief before generating the next sample, and refuses to create a skill from a stale sample. It also ignores a late sample response if the active matter changed while the provider call was running. The lesson is that "Looks useful" is not just a button click; it is a contract between a specific brief, a specific sample, and a specific matter context.

Settings now follows the same page-load cancellation pattern as Skills and Activity. Loading configuration, AI routing, and skill registry data is harmless work, but harmless work can still be sloppy: if the user navigates away before those requests finish, the page should not set state into a screen that no longer exists. This is a small React migration cleanup, but it makes the app shell more predictable under fast navigation and slow local servers.

## Contract Lesson: State Names Are Architecture Too

The List of Dates freshness states now have a shared home in `shared/listofdates-dependency-states.mjs`. These values look like tiny strings, but they carry a real product distinction:

- `label_refresh_needed` means a cheap re-render can update lawyer-facing source labels.
- `chronology_review_needed` means source metadata changed enough to ask for legal review.
- `chronology_regeneration_needed` means the source set or source content changed enough to rebuild the chronology.

Before this cleanup, the backend, vanilla frontend, and React frontend each carried local copies of those strings. That is exactly the sort of small duplication that causes expensive UI mistakes later: one surface offers "Refresh labels only" while another says the chronology must be regenerated. The React smoke test now checks its typed constants against the shared backend contract, so drift is caught during acceptance instead of by a lawyer seeing contradictory advice.

The same pattern now protects the custom-skill overlap gate. The backend owns the minimum override length and the router decisions/actions that block duplicate skill creation. React has a small typed helper for the UI, but `scripts/react-ui-smoke.mjs` compares those helper constants against `shared/skill-creation-overlap-policy.mjs`.

The skill-idea inbox now follows the same rule. `shared/skill-idea-statuses.mjs` owns the four real states: incomplete, ready for review, parked, and dismissed, plus the old legacy names that may still exist in older JSON. React keeps a typed mirror, and the smoke test compares that mirror against the shared contract. This is deliberately boring engineering, but it prevents a very human bug: one screen telling a lawyer an idea is "ready" while another screen treats the same record as an incomplete draft.

Generated skill samples have their own shared state contract now too. `shared/skill-sample-states.mjs` owns current, stale, approved-current, and approved-stale. That protects the "sample is the trust moment" workflow: the app can distinguish a sample that is merely old from a sample that was previously approved but became stale after the design brief changed. Those two states need different user guidance, and they should not depend on each screen remembering the same string literals.

The skill-idea session command classifier now has explicit React parity coverage as well. React still keeps a typed browser-side copy because importing every server-side helper into the Vite bundle would create avoidable bundling friction, but the test suite transpiles that React classifier and compares its decisions with the shared backend/vanilla classifier. That is a pragmatic migration pattern: reduce the chance of contract drift now, and defer the deeper source-of-truth refactor until the bundling boundary is worth changing.

The React shell also now has a single owner for refreshing the active matter workspace: `refreshActiveMatterWorkspace` in `react-ui/src/store/AppContext.tsx`. Before that cleanup, the sidebar refresh button, Add Files completion, and List of Dates workflow each rebuilt the active matter in their own way. Centralizing this is not glamorous, but it is how UI state stays honest after a file upload or generated artifact: every screen asks the same owner to reload the same workspace shape.

That refresh owner now checks the current matter again after the workspace response returns. Matching the returned workspace to the requested matter is not enough; if the user switched away while the request was in flight, applying the old refresh would silently pull them back to the previous matter. The context keeps a small latest-active-matter ref so stale refreshes are skipped instead of reselecting old work.

The same idea now applies when React switches matters. `switchActiveMatter` lives in the same context and owns the full sequence: call the backend, adapt the workspace tree, set the active matter, update the header/breadcrumb/status state, and write the small activity-strip messages. Before this, Home, the matter picker, and New Matter each repeated that sequence. That kind of repetition is easy to miss because all three copies are short, but it is exactly where subtle app-shell bugs begin: one path updates the breadcrumb, another forgets the activity line, a third builds the active matter from a slightly different fallback name. A legal workbench needs matter identity to feel boring and reliable, so there should be one front-end owner for changing it.

The React workflow pages also got a small but important language cleanup. Default lawyer-facing pages now say things like `Library workflow`, `Document reading`, and `Matter search` instead of leading with slash-command names such as `/create_listofdates` or `/context_search`. The Source Labels and Extract tables no longer show `File ID` as an ordinary column. The internal IDs still matter to the backend, but they should not be the first thing a lawyer sees. This is the difference between preserving provenance and leaking implementation detail.

Testing the opt-in React root shell exposed a useful parity bug: React could open `10_Library/List of Dates.md`, but it showed the raw Markdown table instead of the scannable chronology preview that the legacy shell already had. That is the sort of issue a build test will not catch because the API is technically working. The fix moved the List of Dates Markdown parser into the React file-preview helper and renders chronology rows with lawyer-facing source fragments, while keeping the raw Markdown available through the copy/download actions.

The next root-shell test caught a more expensive bug class: paid AI workflow buttons must ask before replacing an existing work product, even on the first click after opening the React component. React originally only showed the rerun guard after that component had generated something in the current session. That meant a matter with an existing Source Index or List of Dates could still jump straight to the provider call from the fresh React workflow view. The fix makes Source Labels and List of Dates enter the rerun-advice guard first every time; if no current artifact exists, the guard auto-continues, but if an artifact exists, the lawyer sees the same "keep current" boundary as the legacy shell. The engineering lesson is that local component state like `done` is not a reliable proxy for disk state. When the question is "would this replace real work?", ask the backend.

The same browser pass caught a smaller but very visible React detail: button badge text was being concatenated into labels like `GenerateUses AI`. CSS spacing can make something look acceptable, but accessibility names and test locators still read the raw text. The fix adds real whitespace in the JSX and pins it with a small regression test. It is a good reminder that polish is not only visual; the DOM text is part of the product contract too.

Activity output opening taught the same migration lesson from another angle. A run receipt can say it created `20_Workshop/Party and Officer Map.md`, but the current matter workspace may no longer contain that file after a clean-slate reset or artifact cleanup. React now checks the active workspace tree before showing `Open output`. If the receipt points to a missing file, the user sees `Output missing` rather than a button that fails into a command-rail error. The receipt is still useful as history, but the UI should not offer a broken action for an artifact that is not actually on disk.

The compact command activity strip now uses the same activity stream as the terminal instead of keeping a separate local-only log inside the command panel. That matters because the old shell trained us to expect "I clicked something, now I can see what happened." A React component-local strip can disappear after reloads or miss activity triggered by matter switching, workspace refreshes, or workflow buttons. The safer model is one shared stream: append terminal/status activity once, show the detailed version in the bottom panel, and show a small readable window under the command box.

The left activity rail also has a proper compact mode now. React already reserved a 48px rail at narrower widths, but the full logo, labels, and padding still assumed the wide layout. That mismatch can make a rail look broken even when the DOM is technically mounted. The compact CSS now deliberately centers icon buttons and hides the labels, which is the difference between "responsive layout happened by accident" and "responsive layout has a contract."

The React local-beta QA pass caught two useful polish lessons that normal API smoke could not catch on its own. First, a custom-skill `Run` button is only a good button when a matter is selected; otherwise it is a dead-end click. The Skills page now says `Pick matter first` and disables the action until that precondition is true. Second, a page can pass every contract test and still feel broken on a phone-width viewport if desktop columns keep forcing horizontal scroll. The fix was not a redesign; it was a small responsive contract for the app shell, sidebar, titlebar, and command panel.

The release-closure lesson after `v1.0.0-beta.3` is that "beta passed" should become an operating contract, not just a happy chat message. The release note records the exact accepted checkpoint, while `docs/beta-operator-checklist.md` says how to run the local beta, what keys and checks matter, what write paths are safe, what to report, and when to stop relying on an output. That is how a project moves from "we have a promising app" to "we can operate this app without re-deciding the rules every morning."

The private-beta tester handoff drill is the same lesson applied to access.
Creating a username is not proof that a lawyer can actually use the app. The
handoff drill creates a disposable tester, logs in through the real auth gate,
loads the React root, reads the matters list, submits a disposable feedback
note, checks the feedback/signal/metrics path, then restores the account file and
feedback ledger. In plain English: before giving a real person the URL, we make
the app prove that the front door opens, the hallway leads somewhere, and the
"tell us what went wrong" button reaches the operator. Then we clean up the test
visitor.

The release-closure lesson after `v1.0.0-beta.4` is narrower but just as
important: a database migration is not real because tables exist. It becomes
real when the app can use a safe runtime role, perform a live write through the
actual API, read the resulting payloads back, prove rollback, and leave
checked-in evidence that another developer can inspect. That is why the beta.4
release note points to the runtime DB write-smoke artifact instead of merely
listing migrations.

The v2 model-tier work added a future lesson for this repo too: model choice should be governed by task risk, not by one global dropdown. A cheap model may eventually be fine for transient copilot answers, but durable skill design, skill modification, validation, and source-backed artifact generation must stay under app-owned model policy. That idea is now parked in `docs/future-design-decisions/model-to-app-task-policy.md` so future model-selector work starts from the right boundary.

The deeper review found the practical bug that proves why this matters: the List of Dates API route still accepted a request-body `model` value on the OpenAI-direct path. The current UI did not use it, but the route boundary was too permissive for a durable artifact. We removed that bypass and added a smoke test proving `/api/create-listofdates` now ignores body-level model overrides and resolves the model from central task policy. This is how good policy docs earn trust: they must point back into the code and close the loopholes they reveal.

This is a good example of accepting a small amount of duplication for a practical reason. The React app cannot naturally consume every server-side module without dragging bundling concerns into the browser build. But the contract values can still be treated as shared truth and checked at acceptance time. That gives us most of the safety without turning the build system into the main project.

## Database Cutover Lesson: A Pointer Is Not Custody

The first database track was deliberately a shadow mirror. Postgres knew about
matters, documents, artifacts, jobs, provider runs, incidents, custom skills,
and run receipts, but it mostly held pointers and hashes. That was useful for
planning, but it carried a serious trap: if the database backup survived and
the local files did not, the restored database would faithfully point at
missing PDFs. In legal software, that is not "storage"; that is a broken audit
trail wearing a storage costume.

The next slice fixed that specific problem for local/private runtime testing.
`db/migrations/015_storage_object_payloads.sql` adds a table where Postgres can
hold the actual bytes for storage objects. The hydrator now has an explicit
payload mode, so a local matter file, generated artifact, or skill sample can be
copied into the database with its size and SHA-256 hash. In DB storage mode the
React shell can read the matter list, workspace tree, file previews, raw file
downloads, matter status, prepare plan, and advisory snapshot from Postgres
instead of live matter folders.

But this is still not the same as saying "the whole app is DB-native." The legal
engines that write work product - setup, extraction, source labels, List of
Dates, copilot/context, doctor fixes, and custom skill execution - were built to
operate on a real matter folder. If we let them run against a fake path such as
`postgres:Atlas`, they could fail in confusing ways or silently write to the
wrong place. So DB storage mode does the disciplined thing: it materializes a
temporary folder from Postgres payloads, lets the existing engine work there,
and then stores the results back into Postgres.

That is the engineering lesson: a migration is not one switch. It is a chain of
ownership decisions. First the DB learned the shape of the app. Then it learned
custody of file bytes. Then it learned a foreground materialization bridge for
new artifacts and receipts. Next it must learn how to run long legal jobs as
hosted workers and recover from failures without falling back to the old folder
as hidden truth. Moving slowly here is not hesitation; it is how you avoid
building a system where half the app believes the database and the other half
still obeys the filesystem.

The next runtime slice taught a useful migration trick: instead of rewriting
every legal engine at once, the server can materialize a temporary matter folder
from Postgres payload rows, run the existing engine, then persist only the new or
changed files back into Postgres. That keeps the old deterministic engines
usable while making the database the source of file custody. The bridge now
covers setup, extraction, source labels, List of Dates, label refresh, matter
context, copilot answers, rerun advice, and doctor scan/fix routes in DB storage
mode. The temporary folder is a workbench, not truth; Postgres remains the place
where the resulting artifacts are stored.

The important remaining warning is custom skills. A configurable skill run is
not just a markdown file. It also creates a run receipt, overwrite state, output
availability, warnings, and activity history. Those receipts still have their
own filesystem JSON ledger today. So the correct next database slice is not "let
custom skills write through the temporary folder and hope"; it is to move the
custom-skill run ledger into the runtime DB path as well. Otherwise we would
have DB-owned artifacts but filesystem-owned proof of how they were generated,
which is exactly the kind of split-brain migration this project is trying to
avoid.

That next slice is now underway. Custom skill runs in DB storage mode use the
same temporary-folder bridge for the matter files, but their run receipts are
owned by Postgres through `configurable_skill_runs`. The service keeps the same
API shape that React already understands - status, output paths, output
availability, and the canonical receipt - while writing the durable run row into
the database. `/api/configurable-skills/run` and `/api/matter-story` now run
against materialized DB matter folders instead of trying to treat
`postgres:Matter Name` as a real path.

The subtle bug here was about names and roots. The engine needs the temporary
folder to check whether `The Story.md` was actually written, but the user and
the receipt must see the durable matter root: `postgres:Actual Matter`. We added
an internal "availability root" for that check. A good migration often needs
two names for the same thing: the temporary work surface used by legacy code,
and the durable identity that the rest of the product should trust.

The next DB runtime checkpoint moved the rest of the high-value local ledgers
out of JSON files when Postgres storage mode is enabled. Skill ideas now come
from `skill_ideas`, sample outputs from `skill_samples`, custom skill
definitions from `configurable_skills` and `configurable_skill_versions`, custom
skill run receipts from `configurable_skill_runs`, and command-box interaction
history from `audit_events`. That matters because these are not decoration.
They are the product memory around reusable legal tools: what the user asked
for, what sample they approved, what skill exists, what run happened, and what
the app showed as the receipt.

Uploads also became a real DB-runtime path. Creating a matter or adding files in
Postgres storage mode no longer creates a live matter folder as the source of
truth. The upload path writes payload bytes into `storage_object_payloads`,
custody rows into `storage_objects`, source-document identity into `documents`
and `document_blobs`, and import history into `matter_import_batches` and
`matter_import_items`. The app can now create a DB-backed matter even when no
local `MATTERS_HOME` is configured. That is a small line of code with a big
architectural meaning: the product can start acting like a database runtime,
not merely a filesystem app with a reporting database attached.

The duplicate-file warning had the same hidden assumption. The old check read
`File Register.csv` from every local matter folder. In DB mode that silently
missed duplicates because there might be no folder to scan. The DB runtime path
now checks incoming SHA-256 values against `documents.sha256`. It deliberately
preserves the count of selected files rather than collapsing duplicate hashes,
because the user-facing question is "how many of the files I am uploading
overlap?", not "how many unique hashes did a set operation find?"

Generated workflow outputs now leave normalized DB breadcrumbs too. When a
temporary materialized run writes files back, the storage service records
`matter_artifacts` for Library/Draft/Workshop outputs, `extraction_records` for
`_extracted/FILE-0001.json` payloads, and `source_descriptors` for
`10_Library/Source Index.json`. The payload bytes remain in
`storage_object_payloads`, but these normalized rows let the database answer
future product questions without reparsing every file each time: what artifacts
are current, which extraction output belongs to which document, and which source
label was suggested or needs review.

So the honest state is this: in Postgres storage mode, runtime matter custody,
uploads, workspace/file reads, mandatory workflow materialization, custom skill
ideas/samples/definitions/runs, command activity, and advisory snapshots are now
DB-owned. The old filesystem engines still run through a temporary folder
bridge, because rewriting extraction, source labels, List of Dates, doctor, and
skill execution engines directly against SQL would be a much larger and riskier
project. That bridge is acceptable only because it is temporary and because the
changed files are persisted back into Postgres. The old matter folder is no
longer supposed to be live truth in DB mode; it is either absent or a scratch
surface used inside one operation.

A later review forced an important correction: saying "the DB owns the write
path" is too strong unless the write path is atomic and the runtime role is not
able to bypass row-level security. The first runtime DB bridge used `psql` with
`ON_ERROR_STOP`, but without an explicit transaction. In PostgreSQL that means
statement 1 can commit even if statement 20 fails. That is not good enough for a
legal workbench; half a matter is worse than no matter. The runtime DB adapters
now wrap logical writes in `BEGIN`/`COMMIT`, and each DB script checks that
`current_user` is not a superuser and does not have `BYPASSRLS`. The lesson is
simple: RLS is not a magic sticker. It is a contract between schema, role, and
runtime. If the app connects as a superuser, the contract is gone.

The next correction was to split "admin DB credentials" from "runtime DB
credentials". Migrations and hydration may need an administrative role. The app
runtime should not. The runtime now prefers `MWB_RUNTIME_DATABASE_URL`, while
`MWB_DATABASE_URL` can remain the migration/hydration URL. We added a runtime
role setup command that creates or updates a normal PostgreSQL role with table
and function grants but no superuser and no `BYPASSRLS`.

Then we added the missing acceptance proof. The live runtime write smoke creates
a disposable matter through the actual upload API, reads the resulting workspace
and source file from Postgres payload bytes, verifies matter/document/storage/
payload/import rows, deliberately runs a failing transaction and proves rollback,
then deletes the disposable smoke matter so it does not pollute either the
active matter list or the exact shadow-hydration verification counts.
That is the difference between "the code looks right" and "the runtime path
actually worked against Postgres". The checked-in evidence is under
`docs/runtime-db-write-smokes/`.

The browser rehearsal came next because script proof and product proof are not
the same thing. We started the React app with explicit runtime DB flags, opened
it at `127.0.0.1:4191`, selected a DB-backed matter, opened a DB-backed file
preview, checked Activity, Settings, Skills, and Home navigation, and then ran a
controlled write smoke outside the repo. We also started a second server with DB
mode off to prove the filesystem local beta still works. That rehearsal is now
recorded in `docs/runtime-db-cutover-rehearsal.md`. The main lesson: a database
cutover is not only "can SQL rows be written?" It is "can the user still move
through the actual app without feeling the storage layer changed underneath
them?"

This completes the local/private runtime DB slice, not the hosted deployment
story. Hosted auth, object storage, background workers, restart recovery, and
degraded-mode policy remain separate. Good engineering is not only making
progress; it is naming exactly which kind of progress was made.

The private VM rehearsal made that boundary even sharper. We copied the current
app checkpoint to the Debian VM, built it there, pointed it at the runtime
Postgres database, and opened it from the Mac at the VM IP. The app listed
DB-backed matters, showed the React screens, previewed extracted JSON, streamed
a PDF, and passed the runtime write smoke from inside the VM. That is a real
deployment rehearsal, not just a local script succeeding on the development
machine.

The private beta auth layer then taught a sharper lesson: login is not tenancy
by itself. A username and password only prove who is at the door. They do not
prove that each lawyer sees only their own matters unless the matter index and
active-matter state are scoped by that identity. We now fail server startup when
`MWB_PRIVATE_BETA_AUTH=required` is used without the runtime matter index,
because that combination would look private while still behaving like a shared
filesystem workspace. The filesystem fallback also keeps active matter state
separate by authenticated username as a defense-in-depth, but the product rule
is stricter: private beta auth and scoped runtime storage must travel together.

The same review caught the mirror-image frontend bug. The server treated
auth-disabled local mode as full operator mode, but one React helper only
allowed `role === "superuser"`. That made local development hide operator
surfaces such as Settings even though there is no login in local mode. The fix
was not to scatter `!authEnabled` checks through components. The fix was to put
the rule in one helper: operator surfaces are visible when auth is off, and when
auth is on they are visible only to a superuser. A small predicate bug can feel
like "the app is broken" because it removes the controls needed to repair
configuration.

It also exposed a healthy discomfort: the old shadow verifier failed because it
expected `/home/aks/matters-matter-workbench` to exist on the VM. That does not
mean the runtime DB app failed. It means the verifier was still comparing the
database to original source folders, which is the wrong proof once the VM is
supposed to run from database payload custody. This is a classic migration
lesson. A tool that was correct in one phase can become misleading in the next
phase if you forget what question it was designed to answer.

The deployment claim is therefore precise: Matter Workbench can run as a private
single-host VM app backed by Postgres runtime custody. It is not yet a
production cloud service. Before that claim, the app still needs HTTPS,
authentication, persistent service management, backup/restore runbooks, object
storage or an accepted durable-volume policy, and hosted worker recovery.

The next lesson was operational: a working process is not the same thing as an
operator-safe service. `nohup node ...` is fine for proving a VM can run the app,
but a beta operator needs boring commands: start, stop, restart, status, logs,
and smoke. So the service pack adds a proper runtime entrypoint, a running-app
service check, and a user-level `systemd` template. The shape is deliberately
plain: a protected env file, a `current` deployment symlink, one unit file, and
one smoke command. Deployment work is often best when it becomes less clever.

Once `rsync` was available on the VM, the next improvement was to stop treating
deployment as a remembered sequence of tarball and scp commands. The
`private-vm:rsync-deploy` command now creates a clean release folder, syncs only
Git-tracked source files into it, builds before switching `current`, restarts the
user-level service, and runs the service/UI checks from inside the VM. It also
learned to preflight the VM before changing anything: does SSH work, is `rsync`
installed, are `node` and `npm` present, can user-level `systemd` respond, is
the protected runtime env readable, and is the deployment root writable? The
small but important lesson is that "copy my folder" is not the same as "deploy
this commit." A development folder always contains scratch files, review
folders, and local artifacts. A beta deployment should carry a known commit and
leave the scratch behind.

The matching rollback lesson is the same lesson in reverse. If deployment is a
button, rollback cannot be a half-remembered SSH command typed under pressure.
`private-vm:rollback` now requires an explicit `--to <previous-commit>`, checks
that release exists, switches `current`, restarts the user service, and reruns
the same VM-local service/UI checks from the restored app. It deliberately does
not guess which release you meant. A rollback should feel boring, but it should
also feel solemn: you are changing the running system, so the target must be
named.

This also teaches a useful distinction between "managed" and "production." A
user-level service can restart after failure and be checked by `systemctl`, but
that still does not make the app safe for the public internet. Production needs
auth, TLS, network hardening, backup restore drills, and worker recovery. The VM
service pack closes the private-operator gap; it does not pretend to close the
cloud gap.

The backup rehearsal exposed the same verifier lesson in a second place. The
VM made a large Postgres backup and restored it into a temporary database, but
the restore drill's final verification failed because the verifier wanted the
old source folder tree. In plain language: the backup could be restored, but the
old comparison tool still wanted to inspect files that are no longer part of
the VM runtime truth. That is not a reason to distrust the service. It is a
reason to write a DB-payload-native restore verifier next.

The recoverability pack is that correction. It asks the practical operator
question in one command: "if this VM breaks, do I have the database rows, the
file bytes, and proof that both still match?" The command runs a Postgres
backup, restores it into a temporary database using a DB-only summary check,
copies the local PDF storage objects, verifies their hashes, and checks the live
VM service. That is much closer to how a real beta operator thinks. A backup is
not a prayer; it is a rehearsed recovery path.

The engineering lesson is simple and important: when storage is split, recovery
must be split-aware. If Postgres contains rows that point at local files, a DB
backup alone is not enough. Either the bytes must live in Postgres payload
custody, or the storage backup must travel with the DB backup. Anything else can
restore a beautiful database full of pointers to files that are gone.

The next private-VM lesson is security posture. A service can be recoverable and
still not be safe to expose broadly. The access/security check is deliberately
boring: is the URL private, is `runtime.env` locked to `0600`, is the service
using a protected env file instead of inline secrets, does it restart on failure,
does the runtime DB role avoid superuser and `BYPASSRLS`, and does npm audit
need a disposition? This is the "front door" counterpart to the backup pack.
One proves we can recover the house; the other checks that we have not left the
door open.

The practical takeaway: never let a successful deployment rehearsal inflate
the product claim. Today the honest claim is private VM local beta with runtime
Postgres custody, recoverability evidence, and access/security checks. Public
cloud production still needs HTTPS, authentication, session policy, hosted
authorization, object-storage custody, and worker recovery.

The access gate adds the next obvious lock. Until now, the VM was protected
mostly by being on a private network. That is useful, but it is not the same as
app-level access control. The private beta gate makes the app ask for credentials
before product APIs load. It started intentionally small: one protected env
username/password, an HttpOnly session cookie, logout, and tests that prove
anonymous API calls are blocked. That was enough for one operator, but not enough
for a handful of firm testers.

The next slice keeps the same private-beta honesty while making access practical.
`MWB_PRIVATE_BETA_USERS_FILE` points to an operator-managed account file, and
`npm run private-beta:users` can add, list, disable, enable, or reset tester
passwords. The file stores password hashes instead of plain passwords. If that
file is configured, it becomes the login authority; the old single env
username/password remains only as a compatibility fallback when no users file is
configured. This is still not enterprise auth. It is named access for a trusted
private beta.

The lesson is to match the security mechanism to the claim. For a private VM,
an operator-managed tester file is a reasonable next step. For public cloud, it
would not be enough. Public cloud needs durable sessions, identity provider
support, tenant membership checks on every request, HTTPS, rate limiting, audit
logs, password-reset/account recovery flows, and proper secret rotation. Small
does not mean sloppy. It means honest about scope.

The next operator lesson is that backups and incident reports are not the same
tool. When a beta user says "something broke," the first thing you need is not
always a half-gigabyte database backup. You need a clean snapshot of the live
state: which deployment is running, whether the service can still answer, how
much disk is left, what recent logs say, and what rollback candidate exists.
That is what `private-vm:ops-pack` does.

Think of it like two different bags in a car. The recoverability pack is the
spare tyre and jack: it proves you can recover after a serious failure. The ops
pack is the dashboard and incident notebook: it tells you what is happening
right now and gives you a reviewed rollback script without automatically
touching the running service. This matters because rollback should be a human
operator decision, not a side effect of "collect diagnostics." Good operations
tools gather evidence first and mutate later.

The intake reliability pack adds the same kind of discipline to file ingestion.
It is a small acceptance harness that creates a disposable matter and feeds the
app the awkward file types lawyers actually bring in: PDFs, weak scans, EML
emails, CSV/XLSX spreadsheets, WhatsApp-style text exports, screenshots,
archives, and Outlook MSG files. The point is not to pretend the app understands
everything. The point is to say, with evidence, which files are read, which are
read but need review, and which are merely preserved.

The most important product lesson is this: preserved is not the same as
understood. A screenshot sitting in the file tree is useful custody, but it is
not source-backed context until an extraction path reads it. A flattened
spreadsheet can help, but formula logic, hidden rows, and visual grouping still
need lawyer review. An EML email body can enter the record, but material
attachments still need their own source-file handling. This is how good beta
software earns trust: it names its limits in the same place it proves its
capabilities.

The engineering lesson is equally practical. Intake reliability should be a
repeatable command, not a feeling after manually trying a few files. The command
`npm run intake:reliability-pack` runs the current setup, extraction, advisory,
preview-policy, and runtime-DB evidence boundary against a representative
fixture. That gives us a regression target for future work on spreadsheets,
WhatsApp parsing, screenshots, archive unpacking, and email attachments. When
one of those future slices lands, the support matrix should change because the
app really changed, not because the wording got more optimistic.

The runtime DB browser acceptance pack closes another evidence gap. Unit tests
can prove the storage adapters, and API smoke can prove routes, but neither one
answers the beta-user question: "does the React app actually render and navigate
while DB custody is on?" The command `npm run db:runtime:browser-accept` starts
a temporary runtime-DB server, runs the existing write-smoke, then opens the
React app through a browser driver. It checks login when needed, the React root,
DB matter listing, matter selection, workspace preview, Matter Attention,
Activity, Settings, and console errors.

The lesson is not that browser tests replace unit tests. They catch a different
class of failure. A route can return correct JSON while the page is blank, a DB
matter can exist while the sidebar cannot navigate to it, and a storage payload
can be valid while the preview affordance is broken. The acceptance pack is the
bridge between "the backend works" and "a beta operator can use the thing."

The private beta RC closure pack is the final layer in that same pattern. It is
not another feature and it is not magic certification. It is a conductor's
clipboard. One command, `npm run private-beta:rc-closure-pack`, asks the local
code, runtime DB browser path, private VM service, ops pack, security check, and
recoverability pack to show their papers in one place. If any of those pieces
fail, the pack fails. That is healthier than having confidence scattered across
old terminal scrollback and memory.

The lesson is that beta readiness should become repeatable before it becomes
ambitious. A team can argue forever about whether the app "feels ready." It is
much harder to argue with a closure bundle that records the commit, branch,
local tests, browser behavior, service health, rollback posture, and recovery
proof. This is how good engineers turn a release from a mood into an artifact.

The private beta bug evidence pack is the next, smaller loop. Release closure
answers, "Can we ship this checkpoint?" Bug evidence answers, "What exactly
happened when the tester hit this one problem?" That is why
`npm run private-beta:bug-evidence-pack` is intentionally narrower than the RC
closure pack. It captures the operator note, target matter name, live service
smoke, runtime DB posture, current deployment, rollback candidate, and recent
command-panel interactions. It also nests the ops pack so the developer can see
service health without asking the tester to rerun five separate commands.

One more runtime DB lesson landed after the React titlebar fix: acceptance
evidence should survive the terminal. The browser acceptance pack already wrote
Markdown and JSON, but by default it wrote them under `.local/`, which is
correct for ordinary operator runs and wrong for a release-readiness claim we
want future developers to inspect. The latest clean pack is now checked in
under `docs/runtime-db-browser-acceptance-packs/`.

That small move matters. It turns "I saw it pass" into "here is the exact
artifact that records what passed." The useful engineering habit is to preserve
evidence at the same level as the claim. A transient smoke run is enough for
day-to-day confidence. A beta milestone deserves a durable artifact.

The product lesson is that a private beta should not depend on heroic memory.
When someone reports "the skill output disappeared" or "the page got stuck,"
we need more than a screenshot and vibes. We need enough evidence to reproduce
the route, inspect the service posture, and decide whether this is UI state,
runtime DB custody, file preview, command routing, or provider behavior. But we
also need restraint: do not attach raw client files, `.env`, provider keys, or
legal work product unless there is a clear trusted reason. Good beta operations
collect the minimum useful evidence and avoid turning every bug report into a
client-data dump.

The durable job-status first slice adds one more practical layer to that same
beta story. Until now, many important actions were foreground operations: click
`Run preparation again`, call Set Up Matter, extraction, Source Labels, List of
Dates, or a custom skill, and then hope the current page, terminal strip, and
artifact files tell the whole story. That works while everything is fast and
visible. It becomes weak the moment a run fails halfway, the user switches
pages, or a custom skill says "output exists" without explaining whether the
underlying run actually happened.

The new `job-status-service` is deliberately modest. It is not the hosted worker
queue, and it does not pretend the app can recover a half-finished job after the
process dies. It writes a local, redacted ledger that says: this long-running
operation started, this matter owned it, this kind of work ran, and it either
succeeded or failed with this sanitized reason. The Activity page now shows
those records under `Matter Jobs`, while custom-skill receipt cards continue to
own the separate question of output files and whether they can be opened.

That distinction is a good engineering lesson. "What happened operationally?"
and "what legal work product exists?" are related, but they are not the same
question. Mixing them creates the kind of receipt bugs we saw earlier, where the
UI tried to reconstruct run truth from output paths and status flags. Splitting
them lets the app become more honest. A failed job can be visible even when it
created no artifact. A completed skill can still have a receipt and output path.
Later, when hosted workers arrive, the product already has a user-facing place
for job state instead of inventing it under pressure.

The next private beta hardening pass fixed two small but important truth gaps.
First, the login gate learned a modest lockout rule. If the same client keeps
submitting bad credentials, the app now answers with a temporary "too many
attempts" response instead of letting the login form be hammered endlessly. The
cookie also became deployment-aware: it stays usable on private HTTP VM URLs,
but turns `Secure` on when the runtime is explicitly configured for HTTPS. That
is a good example of security engineering with context. A rule that is correct
for public HTTPS can break a private local beta if applied blindly.

Second, runtime DB matter status stopped pretending that Source Labels and List
of Dates are current merely because the files exist in Postgres custody. The DB
workspace query now carries each object's hash and modification timestamp into
the runtime status reader. That lets the prepare plan see the same practical
problem a lawyer would see: if extracted source text is newer than Source
Index, or Source Index is newer than List of Dates, the downstream artifact
needs attention instead of a green "current" badge. The lesson is not "use a
database and all freshness problems disappear." The lesson is that a database
must preserve the dependency evidence that the filesystem used to imply through
file timestamps and paths.

The follow-up browser QA found a smaller but very real product-truth problem:
the app was running from DB custody, but the React title bar still said `Local
workspace`. The backend knew the runtime storage mode, the routes were serving
matter files from Postgres custody, and the tests could prove DB reads and
writes. But the visible shell still carried an old hardcoded label. That is how
systems become confusing even when the core plumbing is correct.

The fix was not to make React guess from matter names or paths. The server now
exposes `runtimeStorageMode` and `workspaceModeLabel` through `/api/config`, and
the title bar renders that label. The lesson is simple: when a product mode
matters to the user's trust, make it an explicit contract. Do not leave the UI
to infer it from side effects.

The supervised beta handover adds a different kind of clarity. Operator docs
and tester docs should not be the same document. The operator needs commands,
evidence packs, backup posture, database mode, and recovery instructions. The
tester needs a much shorter brief: what to try, what not to trust, when to stop,
and what to report. If those are mixed together, the lawyer gets overwhelmed
and the operator loses the exact checklist that keeps the beta safe.

That is why the repo now has a separate `private-beta-tester-brief.md`. It does
not make the app more "production." It makes the current boundary easier to
use honestly. A private beta is allowed to be supervised and limited. The key is
that everyone knows the same boundary: useful legal-workbench testing, yes;
public SaaS, hosted multi-user auth, cloud object storage, and unsupervised
legal reliance, no.

The beta bug-fix loop is the next guardrail after handover. Once trusted testers
start using the app, the danger is not only "bugs exist." The bigger danger is
that every bug becomes an excuse to add a new feature, re-open the roadmap, or
change architecture midstream. That is how a beta becomes noisy and hard to
trust.

The new `private-beta-bug-fix-loop.md` keeps the operating rule simple: capture
what the tester saw, preserve enough evidence, reproduce the smallest real
case, fix the owner path, add the focused test, and rerun the gates. New public
deployment, broad model experiments, hosted multi-user work, and product-roadmap
ideas stay parked unless the bug truly proves they are needed. Good engineering
does not mean doing everything quickly. It means keeping the current promise
honest before making a larger promise.

The next handoff lesson came from a release tool, not from a lawyer-facing
screen. The RC closure pack correctly joined local tests, runtime DB browser
acceptance, VM service health, ops, security, and recoverability. But the first
VM run exposed two ordinary deployment truths: the pack needed Playwright
available in the deployed Node install, and its default release label had drifted
behind the current beta note. Both are small issues, but they matter because a
release tool is part of the product promise.

The fix was to make Playwright an explicit development/tooling dependency and
to teach the VM install path to use the system Chromium binary instead of
silently depending on a lucky local browser setup. The next release-marker pass
then found an even more mundane trap: the `v1.0.0-beta.7` tag already existed on
an older commit. Rather than force-moving a published tag, the current release
marker moved forward to `v1.0.0-beta.8`. That is the right release habit. Tags
are promises; if a promise was made too early, make a clearer next promise
instead of silently rewriting the old one.

The RC pack default now follows the current release marker, and representative
VM closure evidence is checked into `docs/private-beta-rc-closure-packs/`. The
engineering lesson is that handoff tools deserve the same honesty as application
code. If an acceptance command needs a browser driver, make that dependency
visible. If a release note says beta.9, the release pack should not quietly print
beta.5.

The next handoff lesson is smaller but very beta-real: once the app has a
**Have a problem? Tell us what happened** feedback flow, the tester brief should
not still ask people to manually reconstruct bug reports for the operator. Good
beta systems make the desired behavior the easy behavior. The tester clicks the
plain button and writes what happened; the operator reads Activity feedback and
only then runs the heavier bug evidence pack if deeper developer context is
needed. That correction became `v1.0.0-beta.9`, because release tags should also
capture how the product is meant to be operated by humans.

The next release lesson was about access. Shared passwords are acceptable for a
tiny private experiment, but they do not scale even to a modest trusted beta.
`v1.0.0-beta.10` introduced an operator-managed tester account file, so each
tester can have their own login while the app stays private, local, and
deliberately short of public SaaS auth. The important engineering lesson is not
"build a full identity platform early." It is the opposite: add the smallest
access-control step that matches the current promise, then prove it with the
same release closure pack that proves the VM, runtime DB, browser path, security
posture, and recoverability.

The follow-up access lesson was about operator friction. If a trusted tester
needs to be added or disabled, the operator should not have to remember a
service restart ritual. The auth service now re-reads the tester account file
when someone logs in, and it re-checks active sessions against that file. That
means a disabled tester is actually cut off without waiting for a restart or
for someone to remember a hidden deployment step. This is the practical version
of good beta engineering: remove the boring mistakes before they become support
messages.

The next tightening was to stop treating tester handoff as a remembered side
ritual. The standalone tester handoff drill is still useful when you just want
to check one URL or account file, but the RC closure pack now runs it as a
required gate. That means a release cannot be called closed unless a disposable
tester can log in, see matters, file feedback, reach the sync/signal endpoints,
and then be removed cleanly. The lesson is simple: if a step would embarrass
you when forgotten, do not leave it as tribal knowledge. Put it inside the
acceptance command.

The same release run exposed another wonderfully boring failure: the runtime
env said one operator password, but the protected account file had another hash.
Nothing was wrong with React, Postgres, or the legal workflow; the operator
credential simply drifted. That became `private-beta:auth-preflight`, a small
command that logs in with the configured runtime username/password before the
deeper RC checks run. If it fails, the repair is explicit:
`private-beta:users -- set-password`. Good beta engineering is often this
unglamorous: make the common human mistake visible early, then give the operator
one clean repair command.

The next hardening lesson was about secrets in error messages. Matter Workbench
already avoided deliberately returning API keys from settings responses, but a
different path was still risky: a provider client, proxy, or transport layer can
throw an error string that includes the Authorization header it saw. If the
service simply rethrows that error, the central API handler will faithfully send
the secret back to the browser. The fix was not a big security framework. It was
the boring right move: redact Copilot model-check errors at the AI settings
service boundary, then prove both the service and `/api/ai-settings` response
hide the submitted key. Good engineers think about the whole failure path, not
only the happy response object.

The next filesystem lesson was about races that only appear when two ordinary
people do ordinary things at the same time. Adding files to a matter used to ask
"what is the next intake?" and "what is the next FILE number?" before writing
the new intake. Two near-simultaneous uploads could ask those questions before
either one finished writing, so both could believe they owned the same next
slot. The fix was a per-matter write queue around the allocation, file write,
and `matter-init` refresh. The important idea is that identifiers are not just
labels; they are source identity. If two requests can mint source identity, that
minting step needs to be serialized.

The next rerun-advice lesson was about stale work product hiding behind clean
timestamps. Source Index and List of Dates used to ask a simple question: "is
any upstream file newer than this artifact?" That is a useful fallback, but it
is not a legal-workbench contract. A copy, restore, cache write, or operator
repair can leave an old-looking timestamp on source text whose hash has changed.
The safer question is now content-aware: does the current extraction hash still
match the Source Index, and does the current Source Index/source snapshot still
match the List of Dates? If source content changes, the downstream artifact is
stale even when the mtime says otherwise. If only lawyer-facing labels changed,
the app can still choose the cheap label-refresh path. The engineering lesson:
mtime is a weather report; source hashes and snapshots are the audit trail.

The List of Dates engine then got its first careful monolith split. The wrong
way to shrink a legal engine is to cut it by line count and hope the pieces make
sense. The safer first cut was by responsibility: provider/network code moved
into `listofdates/providers.mjs`, while the root engine kept orchestration,
validation, clustering, source hydration, and artifact writing. Old imports from
`create-listofdates-engine.mjs` still work through re-exports, so tests and
routes do not need to learn a new public API. The lesson is how mature refactors
start: peel off the concern that changes for a different reason, preserve the
contract, prove the behavior with focused tests, then leave the next split for a
separate pass.

The next split was the List of Dates artifact contract: JSON schemas and CSV
headers moved into `listofdates/contracts.mjs`. That is not just tidying. Those
objects define what the provider must return and what downstream surfaces can
read from `List of Dates.csv` and `List of Dates.json`. Keeping them in a small
contract module makes future changes easier to review: a column, enum, or
required field change is visibly a contract change, not a random edit buried
inside orchestration. After this pass the root engine dropped below 1000 lines,
but the more important result is conceptual: providers, contracts, and
orchestration are now separate reasons to change.

The third split was presentation: Markdown rendering moved into
`listofdates/rendering.mjs`. That keeps the engine from owning both "decide the
chronology" and "display the chronology as a lawyer-readable table." The engine
still writes the artifacts and re-exports `renderListOfDatesMarkdown` for older
imports, but the source-label display rules, readable path fallback, and
Markdown-cell escaping now live in the module whose only job is presentation.
This is a small refactor with a useful lesson: even when the output is "just a
file," rendering is a contract. If you separate it early, later improvements to
readability do not have to disturb provider calls, validation, clustering, or
artifact writes.

The fourth split was source-record preparation:
`listofdates/source-records.mjs` now owns reading matter metadata, collecting
extraction records, turning extracted blocks into bounded AI input, applying
Source Index labels, filtering obvious meta/index sources, and creating source
snapshots for freshness checks. That leaves the root engine closer to its real
job: orchestrate the chronology run. The lesson is that "prepare the evidence
packet" is not the same thing as "ask the model for dates." Once those are
separate, OCR/source-label/file-register bugs can be tested without dragging
provider calls or chronology writing into every test.

The fifth split was entry normalization: `listofdates/entries.mjs` now owns
turning model output into accepted chronology entries and first-pass candidate
rows. That includes date validation, client-perspective filtering, source-label
hydration, tag cleanup, confidence clamping, raw-citation stripping, and the
careful softening of unsupported legal conclusions. This is exactly the kind of
logic that should not be hidden in a giant engine function. It is policy-heavy,
but not network-heavy. By isolating it, we can test legal-output discipline
without making an AI call, writing a file, or running the whole chronology
pipeline.

The sixth split was run metadata: `listofdates/run-metadata.mjs` now owns
provider usage aggregation, two-pass run metadata, and the candidate-ledger
envelope. This matters because "what did the AI run cost and return?" is not
the same problem as "which dates belong in the chronology?" Keeping that ledger
construction separate makes audit metadata easier to test and safer to evolve,
especially as the app moves toward database-backed provider-run records.

The seventh split was artifact writing: `listofdates/artifacts.mjs` now owns
the `10_Library` output paths, the `List of Dates.json` envelope, CSV/Markdown
writes, and the two-pass candidate-ledger file. This is the boring plumbing that
lawyers never want to think about, but it is exactly where silent drift can
become painful: one helper now defines where the artifacts live and how their
metadata envelope is shaped. The engine can therefore read more like a conductor
of the run instead of a clerk hand-writing every receipt.

The eighth split was run configuration: `listofdates/run-config.mjs` now owns
the two-pass feature flag and the model-policy/provider wiring for List of Dates
runs. That keeps the engine from knowing how OpenAI/OpenRouter routing is
assembled, while still leaving the legal task policy intact. The useful lesson
is that "which model/provider should this task use?" is a policy/configuration
question, not chronology logic. Pulling it aside makes future route changes
easier to test without disturbing the date-extraction workflow.

The ninth split was the two-pass runner:
`listofdates/two-pass-runner.mjs` now owns the candidate-ledger pass and the
editor pass as one coherent workflow. This was the last large chunk sitting
inside the root List of Dates engine. The important distinction is that
two-pass generation is not merely "normal generation with another provider
call"; it has its own ledger, failure behavior, and final editing contract. By
giving it a home, the root engine can stay focused on preparing the source
blocks and dispatching to the chosen mode.

## The Beta Mothership: Turning Ten Testers Into One Development Queue

The private beta now has a small central telemetry service, called the
**mothership**. The name sounds grander than the code. Think of it as the firm's
shared in-tray for two kinds of evidence:

- what a tester deliberately reports through **Have a problem?**;
- what a Workbench installation observes through its existing diagnostic
  signals, such as failed jobs or matter warnings;
- what the deployment reports about backend suitability, portability, restore
  confidence, capacity headroom, and user patience risk.

Each installation still keeps its local JSON delivery ledger. That ledger is
not the source of truth for product development; it is the outbox. If the
receiver is unavailable, the item waits there. Workbench retries immediately
on startup and every five minutes while it is running. A receiver outage must
therefore delay evidence, not lose it or block legal work.

The mothership itself is deliberately separate from legal matter storage:

```text
Matter Workbench :4191
  -> local feedback/signal/metrics outbox
  -> authenticated loopback POST
  -> mothership :4192
  -> matter_workbench_mothership PostgreSQL database
  -> operator report for triage
```

This separation is a useful safety boundary. A bug-reporting service should not
need access to source PDFs, chronologies, custom-skill artifacts, or the main
matter database. Its PostgreSQL role is restricted to its own database. Its
HTTP service listens only on `127.0.0.1` on the current VM. When the product
moves to a cloud host, the same receiver contract can sit behind HTTPS without
changing what the Workbench sender means.

Every installation has one active ingestion token. The raw token is shown once
when the operator registers the installation; PostgreSQL stores only its
SHA-256 digest. Registering the installation again rotates the token by revoking
the prior active token in the same transaction. Tokens and database URLs live
only in mode-`0600` VM environment files, never in the repository or deploy
command.

The operator surface is intentionally a CLI, not another dashboard:

```sh
set -a; . "$HOME/.config/matter-workbench/mothership.env"; set +a
npm run mothership:operator -- health
npm run mothership:report -- --since-days 30
npm run mothership:operator -- prune --retention-days 180
```

The report sorts evidence in development order: blocker/error signals first,
then repeated warnings, tester bugs, confusing UX, and feature ideas. That does
not mean Codex should blindly edit the first item. The report is an intake map,
not a verdict. The correct loop is still: verify the evidence against the live
runtime and current repository, reproduce the smallest real case, fix the owner
path, and add the focused regression test.

The live acceptance run found two bugs that unit tests alone had not exposed.
First, repeated signals were deduplicated locally but never sent again, so the
central report could not know that a warning had happened three times. The
sender now resends the updated occurrence count, and the receiver upserts the
new count without creating duplicate rows. Second, `systemctl enable --now`
did not restart an already-running mothership after a deployment, so it could
remain on old code. The deploy step now enables the service and explicitly
restarts it before checking `/health`.

That is a good engineering story in miniature. Unit tests proved the pieces.
The live drill proved the hand-offs. The controlled outage proved failure
semantics: feedback was created while the receiver was down, stayed queued,
and was sent automatically when Workbench restarted after the receiver
returned. Synthetic acceptance rows were then removed, leaving the central
report clean for real beta evidence.

The mothership now also keeps a third stream: **operator metrics**. This is not
analytics in the product-growth sense. It is an honesty gauge for deployment.
Every Workbench instance can send small snapshots that answer questions like:

- is this backend still suitable for the current beta load?
- are users waiting silently long enough to lose interest?
- do we have enough disk and runtime headroom for larger matters?
- could this installation move to a bigger VM or another provider without
  losing Postgres rows, files, secrets, or rollback history?

The useful mental model is a cockpit, not a courtroom exhibit. Lawyers do not
need to see these numbers, and the numbers do not decide legal quality. They
tell the operator when the machine is starting to sweat. A slow List of Dates
run is acceptable if the app shows progress and the backend has headroom. A
silent 30-second wait, low disk space, no restore drill, and no storage backup
is a very different story. That is why the report separates **Backend
Suitability**, **Deployment Portability**, **Restore Confidence**, **Capacity
Headroom**, and **User Patience Risk**.

This is also why "runs on DigitalOcean" is not enough as a release claim. A
serious beta claim is closer to: this commit is deployed, the runtime database
is reachable, files are backed up, the restore drill has passed, request
latency is within tolerance, the mothership is receiving signals, and rollback
is known. Those are engineering facts we can verify, not vibes.

The feedback form taught the same lesson from a human angle. The first version
looked simple to us, but it still required a tester to pick a category and fill
the "trying to do" field before Save became clickable. A lawyer who typed the
actual problem into the other box saw only a blocked cursor. Worse, because the
button was disabled in the browser, no feedback row, signal, or request metric
was created. The operator learned about the bug by phone, not through the
mothership.

The fix was to make feedback intake forgiving. One plain sentence is enough.
If the tester does not pick a category, the app assumes "Something did not
work." If they only describe what happened, that text becomes the required
summary. The backend accepts the same sparse shape too, so future UI mistakes
do not silently discard beta evidence. A bug collector should be stricter about
secrets than about form etiquette.

The next review pass was a useful example of how to use second-model reports
without becoming obedient to them. Two high-severity auth findings were already
fixed by the time we read the report, so we did not re-fix stale claims. The
remaining live problem was telemetry egress: feedback, signals, and metrics all
had their own little HTTP sync code, and repeated signals could wait for the
mothership inside a user-facing request path.

The fix was to create `services/telemetry-sync-client.mjs`, a shared sender
that always attaches an abort signal and preserves the same sent/queued/not
configured receipt shape. Repeated signals now update the local occurrence
count and mark the row queued; the background retry loop sends it later. That
means a slow or hung mothership can delay telemetry, but it should not make a
lawyer's polling request wait on network I/O. The broader lesson is familiar:
when three services copy the same boundary code, the bug is not in any one
copy. The boundary wants a name, a module, and one regression test per caller.

### The mothership operator console

The next step was to give the mothership a real operator console. This is not
the same thing as adding another page to the lawyer-facing Workbench app. The
Workbench remains the legal workspace. The mothership console is the control
room above it: a separate web UI served by the mothership service itself, backed
by the mothership database, and intended for the person running the beta.

The console answers the questions that were previously scattered across CLI
commands and report files:

- which installations are alive, stale, or revoked?
- which firms or testers are producing feedback?
- which warnings are isolated noise, and which are becoming repeated signals?
- what needs a fix now, what needs investigation, what is a product decision,
  and what can be watched?

That is why the frontend lives under `mothership/console/` instead of
`react-ui/`. It has its own Vite + React + TypeScript entrypoint, but it uses
the same general toolchain as the main app. The backend changes are similarly
contained: `mothership/server.mjs` now serves `/api/*` read/action routes and
static console assets, `mothership/store.mjs` exposes fleet and
installation-filtered queries, `mothership/console-auth.mjs` owns operator
login, and `mothership/http.mjs` contains the small HTTP helpers for cookies and
static files.

Think of it as adding a window to the warehouse, not rearranging the desks in
the law office. The Workbench sends feedback, signals, metrics, and heartbeats
as before. The console reads the central receipt book and lets the operator
triage it. That separation matters because the operator dashboard should not be
able to accidentally change the lawyer workflow. Its write actions are narrow:
change feedback triage status, or revoke an installation's ingestion path.

Authentication is intentionally simple for V1: one operator login, one full
fleet view, PBKDF2 password hash in the environment, and an HTTP-only session
cookie. There is no firm-owner role yet. That is a deliberate tradeoff. A
firm-scoped role needs a durable installation-to-organization relationship and
different authorization semantics. Adding a fake role now would create more
confidence than safety. Good engineers do not add roles because the UI wants a
dropdown; they add roles when the data model can enforce the boundary.

Two security bugs were found before merge-readiness and are worth remembering.
The first was a username timing oracle. A tempting login check is:

```js
usernameMatches && verifyPassword(password)
```

That reads naturally, but it leaks work. If the username is wrong, PBKDF2 never
runs; if the username is right and the password is wrong, PBKDF2 does run. An
attacker can measure the difference. The fixed version always runs the password
hash check, then combines the two boolean results. The error message is also the
same for wrong username and wrong password.

The second bug was a brute-force throttle bypass. If a login throttle keys on
`X-Forwarded-For`, a client can rotate that header and appear to be a new
address on every attempt unless a trusted reverse proxy has already normalized
the request. The console now keys the throttle on `socket.remoteAddress`. Behind
the current loopback/private-VM setup, that is the honest network peer. If we
later put the console behind a public proxy, proxy trust should be configured at
the edge, not improvised in the login function.

The merge-readiness pass found one more ordinary UI bug: fleet triage form state
was keyed only by feedback id. Feedback ids are local facts from installations,
so two installations can plausibly send the same id. The visible list key used
`installationId:feedbackId`, but the note/status draft state used only
`feedbackId`. That could make a status draft or note bleed from one firm's row
into another. The fix was to use the same composite key for React state. This is
a small example of a large rule: if identity is composite in the data model, it
must stay composite in the UI state too.

Operationally, there is one sharp switch: when `MOTHERSHIP_CONSOLE=required`,
the console read/action API requires the operator session. When auth is not
enabled, the local development API is open by design. That is useful for demos
and tests, but production must use the VM environment file with
`MOTHERSHIP_CONSOLE=required`, a real `MOTHERSHIP_CONSOLE_PASSWORD_HASH`, and
an HTTPS public URL when the cookie should be `Secure`.

The useful lesson is that dashboards are not harmless just because they are
"internal." A dashboard can become the most privileged product surface in the
system. It sees every tester, every installation, every repeated warning, and it
can revoke ingestion. Treating it as its own app, with its own auth boundary and
its own tests, is the boring choice. Boring is exactly what we want here.

### Shared settings, stored paths, and truthful release labels

Three small-looking review findings exposed the same engineering rule: values
crossing a trust boundary must be checked where they become authoritative.

The Copilot strength selector changes one shared server configuration. It is
therefore an operator control, even though it appears inside every user's chat
panel. Tester accounts may see the current strength, but only a superuser may
change or test the shared provider route. The backend enforces this rule; the
disabled tester control is only the user-facing explanation. This distinction
matters because hiding a button is not authorization.

PostgreSQL object keys are also data, not filesystem permission. Before a
stored object key becomes a path in a temporary matter directory, every path
segment is validated and traversal such as `../` fails closed. The same check
is repeated at materialization boundaries. Defense in depth is appropriate
here because a malformed database row must never become permission to write
outside the temporary matter root.

Finally, deployment names now come from the checked-out Git `HEAD`. Supplying a
different `--commit` label is rejected rather than creating a release directory
whose name lies about its contents. Rollback roots are absolute paths derived
from the remote user, not a literal `$HOME` string whose expansion depends on
which shell layer happens to interpret it. Reliable operations are mostly the
practice of removing this kind of ambiguity before an emergency.

### The Copilot chronology race

Shivangi's Copilot report exposed a subtle runtime-DB bug. The List of Dates
was in Postgres, and the temporary matter folder could materialize it, but
Copilot sometimes answered as if the chronology did not exist. The cause was a
JavaScript async cleanup trap: `runMaterializedMatterRead` returned the
operation's promise without awaiting it inside the `try` block. That allowed
the `finally` block to remove the temporary matter folder while the context
builder was still reading files from it.

The fix was tiny, but important: `return await operation(...)`. The `await`
keeps cleanup waiting until the read operation is truly finished. The
regression test deliberately waits before reading `10_Library/List of
Dates.md`; before the fix the file disappeared, after the fix it remains
available until the read completes.

The lesson is that temporary files and async callbacks are a dangerous pair.
If a function creates a temporary workspace and accepts an async operation, the
cleanup owner must `await` that operation before deleting the workspace. This
is exactly the kind of bug that feels like "the model ignored context" but is
actually "the app removed the context while the model packet was being built."

### HTTPS is not a checkbox

The DigitalOcean deployment made another operational point concrete. Running on
a public VM and running as a private beta are not the same thing. A public IP
with `http://...` is useful for operator smoke testing, but it is not the URL to
hand to lawyers. Once beta testers are involved, the app needs a real hostname,
DNS pointing at the VM, and an HTTPS reverse proxy in front of the Node service.

The deployment pack now says this plainly. The missing manual fact is the
hostname. After that, the boring path is Caddy: install it, write a tiny
`Caddyfile` that proxies the beta hostname to `127.0.0.1:4191`, enable Caddy,
set `MWB_PRIVATE_BETA_PUBLIC_URL=https://...`, and rerun the readiness check.
That last environment variable is not just documentation; it lets the auth
service mark cookies as `Secure`. Without that, a login gate exists, but the
browser security posture is weaker than the product claim.

This is different from the mothership receiver running on the same VM. The app
can send feedback and diagnostic summaries to `http://127.0.0.1:4192` because
that traffic never leaves the machine. Public browser traffic needs HTTPS;
loopback service traffic needs to stay loopback-only.

The engineering lesson is to make deployment instructions executable wherever
possible, and brutally explicit where they cannot be executable. Codex cannot
invent DNS for you, but it can make the remaining steps repeatable enough that
"put it on the web" stops being a vague ritual and becomes a checklist with
clear stop rules.

### Feedback is a product surface, not just a form

The first useful beta feedback was not a crash report. It was a lawyer asking,
in effect: "When I add a matter, should the List of Dates appear
automatically, or do I need to run a skill?" That is exactly the kind of signal
an early beta should collect. It shows a mismatch between the product's mental
model and the user's mental model.

The important implementation detail is that feedback needs context to become
actionable. A note that says "I got confused" is helpful, but a note that also
says who sent it, which matter was active, which screen they were on, which
recent actions happened, and whether it reached the mothership is much more
useful. It lets us reproduce the problem without calling the lawyer back for
basic facts.

The app now treats the feedback inbox as an operator surface. Lawyers can send
simple feedback from the assistant panel, but only a superuser sees the review
inbox in Activity. The backend attaches the authenticated sender to the feedback
packet instead of trusting the browser to provide it. That distinction matters:
the browser may help describe the page, but the server owns identity.

The broader lesson is that beta operations are part of the product. If we want
to improve quickly with real lawyers, the feedback loop must be boring,
trustworthy, and easy to read. A private beta does not need Jira on day one. It
does need a reliable cockpit where the operator can see what happened, who it
happened to, and whether the report reached the development mothership.

### Three small beta bugs, one larger lesson

Shivangi's early feedback produced three different-looking issues that all had
the same product shape: the app was technically doing something defensible, but
the lawyer experience felt broken.

First, Copilot could reject its own answer with an "unsupported citation" error
even when the cited handle came from List of Dates. The cause was a bounded
context design choice. We only sent a slice of chronology entries to the model,
and the server only validated citations against that same slice. If the answer
referred to a valid chronology citation just outside the slice, the server
treated it like an invented source. The fix was to keep the readable chronology
slice bounded, but add a full lightweight citation index from the List of Dates
artifact. That keeps the closed-world guardrail without pretending that omitted
chronology rows do not exist.

Second, feedback saved successfully but left a "Saved. You can keep working."
message sitting inside the assistant panel. That is fine for a developer form;
it is annoying inside a workbench where the assistant panel is the next action
surface. The form now closes after a successful save and leaves the activity log
as the confirmation.

Third, stale sessions could show up as repeated "Login required" messages
inside ordinary workflows. The API client already knew about `authRequired`, but
the React shell was not using it as a global state transition. The fix was to
make only explicit `authRequired: true` responses move the app back to sign-in.
Plain bad-password 401s stay as login errors; expired-session 401s become one
clear sign-in screen.

The lesson is that private beta hardening is mostly about removing confusing
states. A lawyer should not need to distinguish "valid source omitted from the
packet", "feedback queued but panel did not close", or "session expired while a
workflow tried to read a file". The system can keep strict internal rules, but
the surface must collapse them into clear next steps.

### Telemetry must be local-first

Once the beta app started sending feedback, diagnostic signals, and deployment
health snapshots to the mothership, a new rule became important: the lawyer's
click must never wait on the mothership. If the receiver is slow, down, or
temporarily unreachable, the app should still save the user's feedback locally
and let them keep working.

The telemetry services now follow that rule. Creating feedback, capturing a
matter-warning signal, and taking a runtime metrics snapshot all write a local
ledger row first and mark it `queued`. The retry worker and operator sync
endpoints are responsible for sending queued rows to the mothership. In other
words, the workbench behaves like an outbox: put the letter safely in the tray
now, let the courier deal with traffic later.

This avoids a subtle but serious beta failure mode. A feedback form that waits
on a remote HTTP request can look broken even when the local save succeeded.
Worse, if the sync happens while holding the JSON ledger write lock, one slow
network call can block later feedback or signal writes. Moving remote sync out
of the capture path keeps the product responsive and makes failures easier to
reason about: unsent items show as "Queued for sync" in the operator view, and
the retry service can resend them without asking the lawyer to do anything.

The engineering lesson is that observability should protect the user
experience, not compete with it. For beta, the local ledger is the source of
truth that the signal was captured. The mothership is the collector. If the
collector is unavailable, that is an operations problem, not a reason to make a
lawyer's workflow fail.
