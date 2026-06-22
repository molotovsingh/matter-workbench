# Database Transition Scorecard

Status: Current architecture risk tracker

Last reviewed: 2026-06-21

This scorecard exists because "are we on the database yet?" is too blunt a
question for Matter Workbench. The honest question is:

> Which product surfaces are owned by Postgres in runtime DB mode, which
> surfaces are still local beta support ledgers, and which bridge pieces remain
> acceptable only because we are still in supervised private beta?

Use this together with [Database Transition Handoff](database-transition-handoff.md).
The handoff explains how to operate the current transition. This scorecard is
the quick drift detector.

## Current Read

The current line is **runtime DB custody, not hosted DB-worker production**.

In explicit runtime DB mode, Postgres is the legal-workspace custody authority
for matter selection, uploaded source payloads, file reads, workspace trees,
preparation state, advisory reads, Skill Factory state, custom skill definitions,
custom skill run receipts, command interaction history, and foreground workflow
outputs.

That does not yet mean the app is a fully hosted worker system. Long-running
legal work still runs inside the foreground app process. Hosted worker claiming,
heartbeat recovery, object-storage provider policy, and production-grade hosted
auth remain separate future slices.

## Scorecard

| Area | Current authority in runtime DB mode | Remaining bridge / fallback | Proof today | Next retirement step |
| --- | --- | --- | --- | --- |
| Runtime mode selection | Explicit env flags: `MWB_RUNTIME_DB=postgres`, `MWB_RUNTIME_DB_STORAGE=postgres`, `MWB_DB_RUNTIME_CUTOVER_APPROVED=yes`. | Filesystem remains the default local mode when the flags are absent. | `docs/database-transition-handoff.md`; `docs/releases/v1.0.0-beta.24.md`. | Keep filesystem mode as local development fallback, but do not use it for authenticated private-cloud beta sessions. |
| Database schema | Postgres migrations through `019_credit_ledger.sql`. | Migration/admin credentials are still separate from runtime credentials. | `db/migrations/001_control_plane.sql` through `db/migrations/019_credit_ledger.sql`; release beta.24. | Keep migration checks in the release closeout path before deploy. |
| Runtime role safety | Runtime DB adapters prepend safe-role checks and reject superuser / `BYPASSRLS` runtime roles. | `MWB_DATABASE_URL` fallback can still be dangerous if an operator points it at an admin role. | `services/runtime-db-sql-safety.mjs`; runtime write-smoke docs. | Prefer `MWB_RUNTIME_DATABASE_URL` for app runtime everywhere. |
| Matter list and active matter | Runtime matter index is DB-backed and beta auth now requires runtime DB matter index. | Local filesystem matter store remains available only when auth/runtime DB mode is not required. | `server.mjs` startup guard; `services/runtime-db-matter-index.mjs`. | Hosted session middleware must set tenant/user context per request. |
| Upload and add-files intake | Runtime DB upload planners and persistence helpers write matter/document/storage/import rows and payload bytes. | Local folders remain import/hydration sources until hosted upload/object storage exists. | `docs/contracts/upload-intake-contract.md`; runtime write-smoke evidence. | Add hosted direct-upload/object-storage policy before widening beyond single-host private beta. |
| Workspace tree, file preview, raw file reads | Postgres payload custody via `storage_object_payloads`. | Hosted multi-host object storage is not chosen yet. | Runtime browser acceptance and write-smoke evidence. | Decide durable object storage or managed shared volume for hosted production. |
| Matter status, preparation plan, advisory | Runtime DB read models serve current status and advisory snapshots. | Advisory snapshots are evidence of displayed state, not a second legal truth. | `services/runtime-db-preparation-read-model.mjs`; `docs/database-transition-handoff.md`. | Keep incident/advisory writes append-only and test stale/missing artifact states. |
| Foreground preparation workflows | DB-native custody helpers cover setup, extraction, source labels, List of Dates, doctor scan/fix, matter context, story, and custom skill execution. | Engines are not SQL-native. Service-scoped temporary workdirs may still exist where an engine needs files. The old full-matter materialized route bridge is retired from the active surface. | `docs/releases/v1.0.0-beta.24.md`; `services/runtime-db-extract-service.mjs`; `services/runtime-db-materialized-persistence-sql.mjs`. | Convert remaining engine-specific temp work into narrow adapters with contract tests; do not rebuild a generic full-folder bridge. |
| Skill Factory ideas and samples | Runtime DB services own ideas and samples when runtime DB storage mode is enabled. | JSON stores remain local fallback for non-runtime DB mode. | `server.mjs` runtime service selection; `services/runtime-db-skill-ideas-service.mjs`; `services/runtime-db-skill-samples-service.mjs`. | Keep UI/route contracts storage-mode neutral; avoid new JSON-only skill state. |
| Custom skill definitions and run receipts | Runtime DB configurable skill store and run ledger are selected in runtime DB storage mode. | JSON ledgers remain local fallback. | `services/runtime-db-configurable-skill-store.mjs`; `services/runtime-db-configurable-skill-runs-service.mjs`. | Continue de-twinning helpers where filesystem and runtime DB stores share behavior. |
| Command interaction history | Runtime DB command log is selected in runtime DB storage mode. | Local JSON/file log remains fallback. | `services/runtime-db-command-interaction-log-service.mjs`; `server.mjs`. | Keep command history bounded and tenant/user scoped for hosted sessions. |
| Private beta feedback, signals, heartbeat, metrics | Local JSON ledgers plus mothership sync. These are beta observability ledgers, not the legal matter custody authority. | App-local JSON can be lost if the host is lost before sync. | `services/private-beta-*-service.mjs`; mothership docs and services. | Decide whether hosted beta keeps app-local spooling only, with mothership as durable owner. |
| Job status ledger | Local JSON job ledger with observable error codes and metadata. | Not yet a DB-claimed worker queue. | `services/job-status-service.mjs`; System Health and Activity surfaces. | Hosted worker slice should replace local job ledger authority with DB jobs/outbox/recovery. |
| Shadow DB snapshots and restore drills | Evidence and rehearsal artifacts, not live runtime truth. | Snapshots go stale after matter, ledger, or schema changes. | `docs/shadow-db-snapshots/`; `docs/shadow-db-restore-drills/`; `docs/shadow-storage-restore-checks/`. | Refresh only when a handoff or release gate needs current proof. |
| Hosted auth/session model | DB schema can model hosted identities and tenant sessions. | Local beta still uses private beta users/session files for simple access control. | migrations `013` and `014`; `docs/database-transition-handoff.md`. | Add real hosted auth/session middleware before calling this multi-tenant production. |
| Hosted worker recovery | Not implemented as a DB-worker runtime. | Foreground app process owns long-running work today. | Handoff explicitly marks hosted DB worker path pending. | Add worker claim, heartbeat, retry, dead-worker recovery, and operator visibility. |

## What To Watch

### 1. Bridge re-growth

The old generic full-matter materialized bridge should not come back as a
convenience shortcut. Engine-specific temp work is acceptable when tightly
bounded, tested, and followed by explicit DB persistence.

### 2. JSON re-growth

New private beta telemetry can use local JSON as a spool, but new legal workflow
state should not silently choose JSON when runtime DB mode is enabled.

### 3. Runtime service gravity

`services/runtime-db-storage-service.mjs` is smaller than it used to be, but it
is still the natural place engineers reach first. Keep extracting named helpers:
query SQL, object-key policy, artifact policy, upload planning, workspace read
models, and workflow-specific adapters.

### 4. Evidence drift

Runtime DB snapshots, smokes, and restore checks are evidence from one run. They
do not stay true by existing in the repo. Refresh evidence when it is used for a
release, a handoff, or a deployment decision.

## Closure Rule

This workstream is closed for now when future discussions can answer three
questions from this file without re-reading the whole repo:

1. What is DB-owned today?
2. What is deliberately local/private beta support state?
3. What must be retired before hosted production?

If a future change blurs those answers, update this scorecard in the same
change.
