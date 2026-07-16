# Durable Execution And `pg_durable` Fit

Date: 2026-07-11
Status: Parked for later product decision; tool adoption rejected for current implementation
Priority: Medium

## Decision Summary

The **durable-execution pattern survives review** and remains relevant to Matter
Workbench: long-running work should have durable stage boundaries, idempotent
external effects, bounded retries, observable state, and restart recovery.

Adopting **`pg_durable` now does not survive review**. Matter Workbench should not
replace its current job, upload-session, or native-run machinery with
`pg_durable`, and this note is not implementation permission.

The reasons are:

1. Runtime-DB mode already has a substantial durable substrate:
   `processing_jobs`, unique idempotency keys, execution leases, retry metadata,
   upload sessions, and a worker that advances the preparation chain one
   persisted stage at a time.
2. Native skill runs already persist stage state used by targeted retry.
3. Filesystem mode still exists and cannot use a PostgreSQL-only orchestrator.
4. Much of extraction, OCR, legal-model execution, and artifact handling is Node
   or filesystem logic rather than SQL-shaped work.
5. `pg_durable` is in preview and requires a PostgreSQL extension, background
   worker, and `shared_preload_libraries`; current deployment compatibility has
   not been established.
6. Durable replay does **not** make paid APIs, email, file writes, or other
   non-idempotent effects exactly-once. Those effects still require
   application-owned idempotency and reconciliation.

The current decision is therefore:

```text
keep the pattern; keep hardening the existing runner/job contracts;
do not adopt pg_durable without a later isolated spike and explicit cutover decision
```

## What Was Verified

### Upstream facts that survived

Microsoft's current documentation describes `pg_durable` as a PostgreSQL
extension backed by a background worker and the Duroxide runtime. A workflow is
a persisted graph of SQL-shaped steps. Completed steps are checkpointed, and an
instance can resume after database restart or failover without rerunning those
completed steps.

The documented capabilities include sequencing, parallel joins, races,
conditions, durable timers, signals, scheduling, and HTTP activities. Workflow
state is stored in PostgreSQL and is observable through SQL.

The important qualifications are also explicit:

- the product is **preview**;
- the extension currently targets PostgreSQL 17 and 18;
- it must be loaded through `shared_preload_libraries` and runs a database
  background worker;
- the programming model is intentionally SQL-shaped;
- arbitrary application logic may need a SQL wrapper, HTTP activity, or a
  different orchestrator;
- non-idempotent external effects are **not** made safe automatically;
- preview upgrades do not promise portability of running function definitions
  and execution state across major `pg_durable` versions;
- the published evaluation Docker image is explicitly not a production image.

Primary sources:

- [Microsoft `pg_durable` repository](https://github.com/microsoft/pg_durable)
- [Microsoft Learn: Durable functions with `pg_durable` for Azure HorizonDB (Preview)](https://learn.microsoft.com/en-us/azure/horizondb/development/durable-functions)
- [Microsoft: Introducing Durable Functions in PostgreSQL](https://techcommunity.microsoft.com/blog/adforpostgresql/introducing-durable-functions-in-postgresql/4526821)

### Matter Workbench facts that survived

The repository already contains the core pieces of a coarse-grained durable
preparation pipeline in runtime-DB mode:

- `db/migrations/001_control_plane.sql` creates `processing_jobs` with a unique
  `(tenant_id, idempotency_key)` constraint.
- `db/migrations/006_job_execution_leases.sql` adds attempt limits, execution
  leases, lock expiry, run-after scheduling, progress state, and outbox retry
  metadata.
- `services/runtime-db-storage-service.mjs` claims jobs with
  `FOR UPDATE SKIP LOCKED`, records attempt/lease state, and persists terminal or
  retrying status.
- `services/runtime-db-processing-worker-service.mjs` runs one preparation
  stage, commits its job outcome, reads the resulting plan, and idempotently
  queues the next stage.
- First-class upload sessions persist receipt/commit state and recover a missing
  post-upload extraction enqueue through an idempotent job key.
- `services/native-skill-run-state-service.mjs` persists stage outputs used by
  native-skill retry; procedural-posture diagnosis can reuse successful earlier
  stages after a later-stage failure.

Focused tests for the runtime worker, upload-session recovery, native run state,
posture-stage retry, and skill runner passed on 2026-07-11 (`19/19`). These are
mocked/local tests, not a database-crash qualification of either the current
queue or `pg_durable`.

## Claims Rejected Or Narrowed

The source note contained several useful intuitions but also claims that should
not become design authority.

| Original claim | Verdict | Corrected rule |
| --- | --- | --- |
| Matter preparation currently restarts from scratch or requires manual reconstruction after any Node crash. | Rejected as a general statement. | Runtime-DB mode already persists jobs and advances the preparation chain at stage boundaries. Filesystem/inline runs and failures *inside* a stage still have weaker automatic recovery. |
| `pg_durable` would eliminate the source-removal replay and upload lost-intake defects. | Rejected. | Those defects were application idempotency and concurrency bugs. Durable orchestration does not replace row locking, atomic mutation design, idempotency keys, or replay tests. Both defects were fixed in application code first. |
| External API calls, email, and file writes fire only once because they are inside durable steps. | Rejected. | Official documentation says non-idempotent external effects remain the application's responsibility. Every paid or externally visible effect needs a stable idempotency key and reconciliation path. |
| Adopting `pg_durable` means all workflow logic must be rewritten into SQL. | Narrowed. | Coordination becomes SQL-shaped, but existing Node work could remain behind HTTP/SQL activity boundaries. That avoids a total rewrite but adds another security, deployment, observability, and failure boundary. |
| Upload sessions are a direct medium-fit migration target. | Rejected for now. | Their critical receive/validate/commit semantics are already transactional application/database operations. A new orchestrator does not remove the need for atomic commit, matter-scoped serialization, payload cleanup, or idempotent enqueue. |
| Native skills are a direct queue-replacement target. | Rejected for now. | The durable runner/receipt contract is valuable, but current skills depend on rich JS, provider adapters, matter context, and artifact policy. Moving coordination alone would create two orchestration systems before proving a concrete operational benefit. |

## Fit By Workload

### Possible later fit

The narrowest credible candidate is the **hosted runtime-DB preparation chain**:

```text
matter_init -> extract -> source_labels -> case_timeline
```

Even here, a future spike should initially orchestrate only coarse stage
boundaries. It must not assume that `pg_durable` gives per-file OCR recovery or
exactly-once provider calls. Those require finer application checkpoints and
idempotent activities regardless of orchestrator.

Durable signals may also be relevant later for explicit human approval steps,
but only after the product defines authorization, expiry, cancellation, and
audit semantics for those approvals.

### Poor current fit

Do not target these surfaces in a first evaluation:

- filesystem-mode execution;
- browser upload byte receipt or atomic upload commit;
- source-removal custody mutations;
- per-file extraction/OCR internals that rely on Node libraries and files;
- configurable/native legal skill business logic;
- Copilot Research or telemetry sync;
- single transactional database mutations.

## Relationship To Existing Decisions

This note does not replace:

- [Hosted Beta Database Architecture](hosted-beta-database-architecture.md),
  which owns the current jobs/outbox/provider-run model;
- [Native Skill Runner Posture](native-skill-runner-posture.md), which owns the
  request, stage, persistence, recovery, and receipt contract;
- [Upload Intake Scheduler](upload-intake-scheduler.md), which owns future
  intake sizing and dependency scheduling;
- application-level concurrency, idempotency, custody, and artifact contracts.

A future orchestrator may implement the runner contract. It must not redefine
that contract or bypass its legal/audit boundaries.

## Revisit Triggers

Revisit `pg_durable` only when all of the following are true:

1. Hosted runtime-DB mode is the selected production execution path for the
   target workflow; filesystem parity is no longer required for that slice.
2. Real incidents show that the existing job/lease/worker design is materially
   failing despite bounded retries, crash recovery, idempotency, and operational
   tests.
3. The target PostgreSQL service supports the required version, extension,
   `shared_preload_libraries`, background worker, backup/restore, and least-
   privilege model.
4. One coarse workflow is selected with explicit activity boundaries and no
   implied migration of all skills or uploads.
5. External effects have stable idempotency keys independent of `pg_durable`.
6. Upgrade, rollback, tenant isolation, egress policy, observability, and cost
   are testable in an isolated environment.

## Required Spike Before Any Adoption

A later spike must use a disposable PostgreSQL environment and compare
`pg_durable` with the existing `processing_jobs` implementation. It must prove:

1. A three-stage preparation fixture resumes after terminating both the worker
   and PostgreSQL between stages.
2. A crash during a stage does not duplicate a paid/external effect when the
   activity uses the Workbench idempotency key.
3. Retry exhaustion, cancellation, timeout, and manual intervention are
   observable and bounded.
4. Two tenants cannot inspect, signal, cancel, or influence each other's
   workflow instances under the intended runtime role model.
5. Backup/restore and failover preserve useful workflow state.
6. A pinned extension upgrade and rollback procedure is credible; running
   preview instances are drained or cancelled as required.
7. The spike reduces application complexity compared with the current queue; it
   does not merely add SQL orchestration beside the existing runner.
8. The current artifact, custody, source identity, currentness, and receipt
   contracts remain unchanged.

Failure of any acceptance item rejects adoption for that workflow. Passing the
spike permits a separate implementation decision; it does not authorize a broad
rewrite.
