# Matter Workbench

Standalone local workbench for initializing, extracting, source-labeling, and
reviewing legal matter folders. This app is intentionally outside any single
matter folder. Point it at a matter with `MATTER_ROOT` when you want
server-backed reads and writes.

## Architecture Map

For a reading order across current contracts, future decisions, releases, and
archive material, see [docs/README.md](docs/README.md).

For the current codebase map, lifecycle diagram, provider paths, persistent
artifacts, and eval tooling, see
[docs/codebase-diagram.md](docs/codebase-diagram.md).

## Beta Workflow

Current release checkpoint: [Matter Workbench v1.0.0-beta.6](docs/releases/v1.0.0-beta.6.md).

For the practical supervised local/private beta runbook, see
[docs/beta-operator-checklist.md](docs/beta-operator-checklist.md).
For the private beta release-candidate closure command,
`npm run private-beta:rc-closure-pack`, see
[docs/private-beta-rc-closure-pack.md](docs/private-beta-rc-closure-pack.md).
For one-bug private beta handoff evidence,
`npm run private-beta:bug-evidence-pack`, see
[docs/private-beta-bug-evidence-pack.md](docs/private-beta-bug-evidence-pack.md).
For runtime DB browser acceptance evidence, see
[docs/runtime-db-browser-acceptance-pack.md](docs/runtime-db-browser-acceptance-pack.md).
For representative intake/file-type acceptance evidence, see
[docs/intake-reliability-pack.md](docs/intake-reliability-pack.md).

For the current tester-facing workflow, command panel inputs, recommended
local env, paid rerun behavior, and review checklist, see
[docs/beta-testing-list-of-dates.md](docs/beta-testing-list-of-dates.md).
For a plain-language product feature and differentiation brief, see
[docs/product-features-and-differentiation.md](docs/product-features-and-differentiation.md).

For the product strategy behind a reusable built-in skill library that reduces
custom skill demand and AI spend, see
[docs/future-design-decisions/native-skill-library-strategy.md](docs/future-design-decisions/native-skill-library-strategy.md).
For the shared legal-output prompt contract that keeps source, citation,
visibility, and model-risk rules stable across providers, see
[docs/future-design-decisions/legal-workbench-policy-prompt.md](docs/future-design-decisions/legal-workbench-policy-prompt.md).
For the parked future model-to-app task policy that keeps copilot model choice
from controlling durable skill design or artifact-writing work, see
[docs/future-design-decisions/model-to-app-task-policy.md](docs/future-design-decisions/model-to-app-task-policy.md).
For the parked future distinction between matter-level diagnostics and
app-wide readiness, see
[docs/future-design-decisions/system-health-surface.md](docs/future-design-decisions/system-health-surface.md).
For the parked future latency strategy around parallel processing, progress
receipts, and long-running native skills, see
[docs/future-design-decisions/parallel-processing-latency.md](docs/future-design-decisions/parallel-processing-latency.md).
For the future hosted beta database and tenancy architecture, see
[docs/future-design-decisions/hosted-beta-database-architecture.md](docs/future-design-decisions/hosted-beta-database-architecture.md).
The Postgres migration track lives in [db/migrations](db/migrations):

- [001_control_plane.sql](db/migrations/001_control_plane.sql) - hosted control-plane tables and ledgers.
- [002_tenant_rls.sql](db/migrations/002_tenant_rls.sql) - tenant row-level security policies for hosted beta.
- [003_tenant_reference_integrity.sql](db/migrations/003_tenant_reference_integrity.sql) - cross-tenant parent-link protection.
- [004_user_membership_integrity.sql](db/migrations/004_user_membership_integrity.sql) - tenant-member user references and approval audit links.
- [005_storage_object_lifecycle.sql](db/migrations/005_storage_object_lifecycle.sql) - object custody ledger for hosted files and artifacts.
- [006_job_execution_leases.sql](db/migrations/006_job_execution_leases.sql) - worker lease and retry metadata for durable hosted jobs.
- [007_local_matter_import_ledger.sql](db/migrations/007_local_matter_import_ledger.sql) - batch and per-file ledger for importing existing local matter folders.
- [008_job_worker_functions.sql](db/migrations/008_job_worker_functions.sql) - atomic claim, heartbeat, and completion functions for hosted workers.
- [009_incident_helper_functions.sql](db/migrations/009_incident_helper_functions.sql) - canonical incident recording and resolution helpers for hosted advisory projection.
- [010_advisory_snapshot_functions.sql](db/migrations/010_advisory_snapshot_functions.sql) - append-only Preparation Advisory snapshot helper.
- [011_custom_skill_lifecycle_functions.sql](db/migrations/011_custom_skill_lifecycle_functions.sql) - tenant-scoped custom skill lifecycle transitions.
- [012_tenant_org_profile.sql](db/migrations/012_tenant_org_profile.sql) - explicit single-user vs organization tenant profile fields.
- [013_hosted_auth_session_model.sql](db/migrations/013_hosted_auth_session_model.sql) - provider-neutral auth identity and tenant session rows.
- [014_tenant_sessions_user_rls.sql](db/migrations/014_tenant_sessions_user_rls.sql) - tenant/user-scoped session RLS tightening.
- [015_storage_object_payloads.sql](db/migrations/015_storage_object_payloads.sql) - optional byte custody for local/private runtime DB mode.

See [db/README.md](db/README.md) for the migration commands and runtime cutover
stop rule.

To inspect or apply database migrations:

```bash
npm run db:migrations:list
npm run db:migrations:check
npm run db:doctor
MWB_DATABASE_URL="postgres://..." npm run db:migrate
```

Applying migrations uses the local `psql` command-line client. The check command
can still list migrations without a database URL. `db:doctor` is read-only: it
checks whether a database URL is configured, whether `psql` is available, and
what the migration plan looks like without printing connection secrets. Applied
migrations are recorded with a SHA-256 checksum so edited migration files fail
closed instead of being treated as already applied. The runner also rejects
missing migration numbers, so a deployment cannot silently skip from `001` to
`003`. The baseline migration adds one shared `updated_at` trigger helper for
mutable control-plane rows, so future hosted state has reliable modification
timestamps without app-side copy/paste.
The tenant RLS migration enables and forces row-level security for tenant-scoped
tables; hosted DB sessions must set `app.tenant_id` before tenant legal data is
visible. The tenant-reference migration then prevents a row from claiming one
tenant while pointing at a parent matter, job, artifact, incident, or custom
skill owned by another tenant. The object-lifecycle migration adds a tenant
scoped custody ledger for pending, uploaded, verified, failed, orphaned, and
deleted objects without moving large legal files into Postgres. The job-lease
migration gives hosted workers claim, heartbeat, retry, and expired-lock fields
for long-running preparation stages without changing the local filesystem
runtime. The local-import migration adds a controlled batch ledger for moving
existing matter folders later without silent source renumbering or dropped
warnings. The worker-functions migration adds database-side claim, heartbeat,
completion, and retry primitives so future workers do not invent their own
non-atomic queue behavior in application code. The incident-helper migration
then gives those future workers one canonical way to record job, provider-run,
and artifact-validation failures as Matter Attention evidence instead of
inventing separate advisory write paths. The advisory-snapshot migration creates
an append-only record of what the Preparation Advisory showed after a run,
derived from incidents and validation rows rather than a second mutable source
of truth. The custom-skill lifecycle migration adds one database-owned pause,
resume, archive, restore, and soft-delete transition helper for configurable
skills, keeping native skills app-owned and untouched. The tenant org-profile
migration then makes the account shape explicit with `account_scope`,
`organization_slug`, `max_member_count`, and `primary_owner_user_id`, so the
schema visibly supports both single-user beta tenants and future firm or
organization tenants. The hosted auth/session migrations add provider-neutral
identity and tenant-session rows for future hosted middleware. The storage
payload migration adds optional Postgres byte custody for local/private runtime
DB mode, which is now accepted behind explicit runtime flags and a non-superuser
runtime role. This is still distinct from hosted cloud deployment and durable
background workers.

For guided preparation, use `prepare matter` or `/prepare_matter` in the app.
It plans and runs existing preparation stages while keeping paid source labeling
behind an explicit confirmation. Superseded planning contracts now live under
[docs/archive/2026-05-13](docs/archive/2026-05-13).

## Scope

- Local legal matter workbench with a Matter Explorer, command panel, and durable matter artifacts
- Current built-in actions: `/prepare_matter`, `/matter-init`, `/extract`, `/describe_sources`, `/create_listofdates`, `/context_preview`, `/context_search`, and `/doctor`
- Approved configurable skills can be created from reviewed samples and then run as their own slash commands
- One active matter at a time, selected from the in-app Matters list or pinned by `MATTER_ROOT`
- Matter context is read from the active matter's `matter.json` in filesystem mode, or from materialized DB custody when runtime DB storage mode is explicitly enabled
- The right-side command panel runs deterministic slash commands, opens workspace lanes, shows status, and keeps paid rerun guardrails
- Matter metadata is captured before `/matter-init` runs
- `server.mjs` enables local filesystem writes for deterministic intake, extraction, source labeling, and chronology engines; in runtime DB storage mode it materializes a scratch folder and persists changed outputs back into Postgres
- The Matter Explorer reflects the current matter root from disk in normal local mode, or DB payload custody in explicit runtime DB mode

## Matter Intake Behavior

`/matter-init` is responsible for:

- validating required matter metadata
- confirming the matter scaffold
- previewing `matter.json`
- preserving the originals under `00_Inbox/.../Originals`
- arranging working copies under `00_Inbox/.../By Type`
- writing inbox load and normalization logs

The intended skill shape is:

```text
/matter-init
  folder + matter metadata -> preserved raw source -> arranged inbox -> review logs
```

Other document-specific skills follow the same pattern: explicit verb, bounded
input, durable output, and lawyer review before downstream use.

In the UI, the right-side command panel accepts exact commands such as
`/matter-init`, `/extract`, `open library`, or `status`, and shows command
suggestions when useful. Paid AI skills keep the rerun confirmation guardrails
when current artifacts already exist.

The Matter Explorer loads the current matter from the local Node server, reads
metadata from `matter.json`, and renders the visible workspace tree. Text files
such as `.md`, `.csv`, `.json`, and `.txt` can be opened directly from the
explorer. After `/matter-init` completes, the explorer refreshes so the operator
can inspect generated paths such as:

- `00_Inbox/Intake 01 - Initial/Originals`
- `00_Inbox/Intake 01 - Initial/By Type`
- `00_Inbox/Intake 01 - Initial/Intake Log.csv`
- `00_Inbox/Intake 01 - Initial/File Register.csv`

Required metadata:

- Client name
- Matter name
- Opposite party
- Matter type
- Jurisdiction

The brief description is optional.

## Folder loading

The active matter is whichever folder you point `MATTER_ROOT` at when starting
the server, or whatever you select from the in-app Matters list. The Matter
Explorer reads that folder and renders its tree. Fill or inspect matter
metadata in the inspector, then run `/matter-init`.

## Adding more files later

Real matters keep accumulating documents — client emails, opposite-party
productions, etc. With a matter loaded, click `+ Add Files` above the workspace
tree to upload another batch. Each batch becomes its own folder under
`00_Inbox/`:

```
Naveen vs Mohit/
  00_Inbox/
    Intake 01 - Initial/                 (first batch — contains its own
                                          Source Files, Originals, By Type,
                                          File Register.csv, Intake Log.csv)
    Intake 02 - 2026-05-08 client email/ (second batch with optional label)
    Intake 03 - 2026-05-15/               (third batch, no label)
  10_Library/                             (source-backed analysis artifacts)
  20_Workshop/                            (issue notes and review work)
  30_Drafts/                              (draft legal outputs)
  40_Dispatch/                            (reviewed sendable material)
  matter.json                             (intakes: [...] array)
```

The folder names stay canonical on disk. The explorer may show friendlier labels
such as `Analysis Library` for `10_Library`, but file paths and artifacts keep
using the stable folder names.

`FILE-NNNN` ids continue across batches (so you'll see FILE-0051 in Intake 02
if Intake 01 had 50 files). Files whose SHA-256 already appears in a prior
batch are recorded in the new batch's `File Register.csv` with
`status: duplicate-of-prior-intake` and `duplicate_of: FILE-0001`, but not
re-copied to that batch's `Originals/` or `By Type/` — the original
preservation remains in the prior batch.

When served through the local Node server, `/matter-init` runs a deterministic
copy-only intake operation:

- copies loose top-level matter files into `00_Inbox/Intake 01 - Initial/Source Files`
  when they are not already staged there
- reads source files from `00_Inbox/Intake 01 - Initial/Source Files`
- hashes every source file with SHA-256
- copies untouched originals into `00_Inbox/Intake 01 - Initial/Originals`
- copies working files into `00_Inbox/Intake 01 - Initial/By Type/<category>`
- classifies files by extension only (`PDFs`, `Word Documents`, `Spreadsheets`, `Images`, `Emails`, `Archives`, `Text Notes`, `Needs Review`)
- marks exact duplicates by checksum
- writes `Intake Log.csv`, `File Register.csv`, and `matter.json`

The source files are not moved or modified.
After intake exists, the Matter Explorer hides loose top-level source files that
already have staged copies in the Inbox, keeping the workspace focused on the
structured intake tree.

## Run locally

```bash
cd /path/to/matter-workbench
npm start
```

`npm start` builds the React UI and starts the backend. Then open
`http://127.0.0.1:4173/`. On first launch the app asks where your matters
should live and creates that folder for you. Use **+ New Matter** in the sidebar
to create a matter, or pick an existing one from the **Matters** list.

The React shell is now the only product UI. `/` and `/react/` both serve the
compiled React app. The previous plain-JS browser shell is retired as a product
fallback; its remaining files are kept only while tested helpers are migrated or
deleted safely.

### React UI track

The React/Vite interface now lives inside this repo under `react-ui/`; the old
separate prototype repo is no longer required as a source of truth.

For iterative frontend work against the local backend:

Terminal 1:

```bash
PORT=4191 npm start
```

Terminal 2:

```bash
npm run ui:dev
```

This explicitly starts the backend on `http://127.0.0.1:4191` for the React dev
server. Plain `npm start` still uses the server default port (`4173`) unless
`PORT` is set. Vite then serves the React UI at `http://127.0.0.1:5173/react/`
and proxies `/api` to the selected backend. If you run the backend on a
different port, set `VITE_API_TARGET` before `npm run ui:dev`.

To build the React UI inside the main repo:

```bash
npm run ui:build
```

The build output goes to ignored `react-dist/`. The backend serves that compiled
UI at both `/` and `/react/`.

Before accepting changes from a frontend experiment repo, run:

```bash
npm run ui:accept
```

`ui:smoke` follows the plain `npm start` default backend at
`http://127.0.0.1:4173/`. If you started the backend on `4191`, run:

```bash
MWB_BACKEND_URL=http://127.0.0.1:4191 MWB_UI_URL=http://127.0.0.1:4191/ npm run ui:smoke
```

For Vite dev-server testing, run:

```bash
MWB_UI_URL=http://127.0.0.1:5173/react/ npm run ui:smoke
```

Override `MWB_BACKEND_URL` and `MWB_UI_URL` when testing another local port. If
no matter is active, the smoke check skips matter-specific workspace,
readiness, attention, context, file preview, doctor-scan, and rerun-advice
checks and still validates the shared app contract.

## Switching matters

The sidebar shows every matter under your matters home. Click any entry in the
**Matters** list to switch to it. The workspace tree, metadata, and breadcrumb
update in place — no server restart required. Use **+ New Matter** to add
another.

## Developer fallback: pinning a single matter at startup

For scripted runs or when iterating on a specific case folder, point the server
at one matter root with the `MATTER_ROOT` environment variable:

```bash
MATTER_ROOT=/Users/aks/case_naveen npm start
```

The same engine can also be invoked directly from the terminal without the UI:

```bash
MATTER_ROOT=/absolute/path/to/matter npm run matter-init:dry-run
MATTER_ROOT=/absolute/path/to/matter npm run matter-init
MATTER_ROOT=/absolute/path/to/matter npm run extract:dry-run
MATTER_ROOT=/absolute/path/to/matter npm run extract
MATTER_ROOT=/absolute/path/to/matter npm run create-listofdates:dry-run
MATTER_ROOT=/absolute/path/to/matter npm run create-listofdates
npm run matter-attention:report -- --only-problems
```

The active matter overview also renders a read-only Developer attention card from `/api/matter-attention`, so blocker and warning counts are visible without opening the terminal report first. A separate app-wide System Health surface is parked as a future feature in [docs/future-design-decisions/system-health-surface.md](docs/future-design-decisions/system-health-surface.md).

## Files

- `react-ui/` - default React/Vite UI source
- `react-dist/` - ignored generated build output for the React UI, served at `/` and `/react/`
- `frontend/` - retired plain-JS UX plus temporary helper modules still covered by tests while they are migrated or deleted
- Retired root shell files `index.html`, `styles.css`, and `app.js` have been removed; React is the only served product shell
- `server.mjs` - local server bootstrap and service wiring
- `routes/api-routes.mjs` - top-level HTTP API dispatcher for local app endpoints
- `routes/app-shell-routes.mjs` - app settings, matters, workspace, uploads, files, overlap checks, and command diagnostics
- `routes/matter-workflow-routes.mjs` - matter setup, extraction, source labeling, chronology, status, attention, context, and rerun advice routes
- `routes/skill-factory-routes.mjs` - skills registry, skill ideas, sample output, configurable skill creation/runs, and factory health routes
- `services/` - matter store, workspace, upload, status, preparation, skill governance, and logging services
- `scripts/matter-attention-report.mjs` - read-only developer sweep over matter-level blockers and warnings
- `services/configurable-skill-*.mjs` - custom skill definition, store, provider, context, validation, and run-ledger helpers
- `matter-init-engine.mjs` - deterministic copy-only intake engine
- `extract-engine.mjs` - deterministic extraction engine with optional OCR provider integration
- `source-descriptors-engine.mjs` - source descriptor engine for `10_Library/Source Index.json`
- `create-listofdates-engine.mjs` - AI-backed chronology engine for List of Dates artifacts
- `test/` - regression and contract tests run via `npm test`
- `package.json` - local run scripts
