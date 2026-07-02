# Future Design Decision: Native Skill Runner Posture

Date: 2026-07-01
Status: Implementation contract draft
Priority: High

## Why This Exists

Two sibling documents already cover the layers above and below this one:

- [Native Skill Implementation Contract](native-skill-implementation-contract.md) defines the
  **product and data contracts** each native skill owns (Source Labels vs Document Index, the
  staleness taxonomy, visibility rules, the `40_Dispatch` boundary).
- [Preparation Planner V2 and Procedural Diagnosis Robustness](preparation-planner-v2-and-diagnosis-robustness.md)
  defines the **orchestration layer**: what to run, why, in what order, with what cost/overwrite
  implications, and a diagnosis failure taxonomy.

Neither of those defines the **execution layer**: *how every native skill actually runs*. Today that
layer is bespoke per skill. This document defines one uniform **runner posture** for all native
skills — deterministic, AI-only, or hybrid — and the plan to migrate onto it.

The thesis is simple:

```text
Every native skill is a contracted executable unit that follows one lifecycle:

  request -> preflight -> durable job -> staged progress -> validate -> persist -> receipt

The core app orchestrates runners. It does not contain per-skill business glue.
```

This both hardens robustness (the diagnosis failure that prompted this) and shrinks the core engine.
But route cleanup is a consequence, not the purpose. The purpose is to make native skills into a
stable execution substrate for legal-workbench capabilities that can survive product and
infrastructure pivots.

The important discovery came from a throwaway latency/probe script: outside the main app route, a
script-style operation could reproduce the failure, expose duration, inspect job state, and make the
missing stage/receipt boundary obvious. That is the clue. Serious native skill work should have the
posture of an **auditable operation runner**, not an inline request handler.

## Architectural Stance: Current State Is Evidence, Not Destination

This document is grounded in the current codebase because implementation has to start somewhere,
but the current repo shape is **not** the target architecture. Treat today's routes, local ledgers,
JSON stores, runtime-DB adapters, and service filenames as evidence of existing pressure — not as
design authority.

The runner contract should survive these pivots:

- local filesystem -> runtime DB -> object store / worker-backed storage;
- synchronous HTTP route -> background worker -> queue/outbox execution;
- React polling -> progress stream -> operator console;
- OpenAI/OpenRouter/provider-specific JSON modes -> model-agnostic stage adapters;
- native-only runners -> native/configurable/generated skill convergence;
- one matter/workbench shape -> multi-tenant hosted matters and firm-level policies;
- today's legal artifacts -> future drafting, review, dispatch, and research artifacts.

The invariant is not `routes/matter-workflow-routes.mjs`, `services/job-status-service.mjs`, or a
particular folder layout. The invariant is:

```text
A skill operation is an auditable job over matter context:
typed request -> decision basis -> staged execution -> validated outputs -> durable receipt.
```

Everything else is replaceable scaffolding.

## Relationship To The Sibling Docs

| Layer | Owner document | Question it answers |
| --- | --- | --- |
| Product / data contract | Native Skill Implementation Contract | What does each skill semantically own and produce? |
| Orchestration / planner | Preparation Planner V2 | What should run, why, and in what order? |
| **Execution / runner** | **This document** | **How does a skill run, fail, recover, and report?** |
| Provider / API boundary | First-Class API And Provider Service Boundaries | Where do model/OCR calls and matter context live? |

This document depends on the others but does not duplicate them. When this runner contract needs a
staleness reason, it reads it from the planner. When it needs source-label semantics, it reads it
from the implementation contract. When it calls a model, it goes through the app-owned provider
service.

## Design Invariants

These are the principles implementation should protect even if the current storage, routes, model
providers, UI, or skill catalog pivot.

1. **Skills are app-owned capabilities, not routes.** A route can trigger a skill; it is not the
   skill. A React component can display progress; it is not the skill. A prompt can power a stage;
   it is not the skill.
2. **Planner and runner stay separate.** The planner decides *what should run and why*. The runner
   executes *one governed unit of work* and reports what happened. Do not bury dependency planning
   inside each skill runner.
3. **Every durable operation has its own runner job.** A legal-workbench action that consumes
   matter context, writes artifacts, or calls a paid/model provider must run as its own auditable
   operation with its own job id, typed request, staged trace, and durable receipt.
4. **Every durable run has a receipt.** The receipt records inputs, decision basis, stages,
   model/provider metadata, outputs, warnings, failure/recovery hints, and audit references.
5. **Stages are resumable boundaries.** Stage boundaries are not UI labels. They are the units that
   can be timed, audited, retried, skipped, salvaged, or blamed.
6. **Artifacts are written through policy.** A skill runner never hand-rolls filesystem/DB writes.
   It asks the artifact layer to persist, archive, version, or refuse writes according to product
   policy.
7. **Provider calls are adapters, not business logic.** Model/provider-specific JSON modes, retry
   behavior, token limits, and error codes are wrapped by stage/provider adapters. Legal reasoning
   remains in the skill contract, not in route glue.
8. **Latency is matter-dependent.** Native skill duration is a function of the underlying matter:
   source count, evidence quality, chronology density, context size, provider stages, validation,
   and persistence. Long latency is not an exception path; it is a normal property of sophisticated
   legal operations.
9. **Human authority remains explicit.** Generated artifacts can be source-backed and useful, but
   legal confirmation, override, dispatch, and lawyer-owned draft edits remain explicit boundaries.
10. **Current code is a migration substrate.** Reusing `job-status-service`, `skill.json`, or
   existing routes is a practical first slice, not a commitment that those shapes are permanent.

## Wrong Success Metrics

Do not treat this work as successful merely because:

- route handlers are shorter;
- one more service file exists;
- posture diagnosis gets a narrower retry button;
- the current local JSON job ledger has a `stages[]` field;
- today's provider invalid-JSON incident is patched.

Those are useful symptoms, not the goal. The real success metric is:

```text
A lawyer-visible or operator-visible skill run can be explained, resumed, retried, audited,
charged/costed, and evolved without rewriting the UI, route layer, storage adapter, or provider
strategy for each skill.
```

If an implementation makes today's code cleaner but hard-codes today's routes, storage, provider
sequence, or artifact shape as permanent truth, it is the wrong implementation.

## Script-Style Operation Runner Posture

"Move it to scripts" should not mean fragile shell scripts or untyped one-off utilities. It means
native skill operations should have the posture of **script-style executable jobs**:

```text
native-skill-operation-runner
  --request <typed request / JSON>
  --matter <matter identity>
  --run-id <idempotency / job id>
  -> emits progress events
  -> writes artifacts only through policy
  -> writes/returns a durable receipt
```

The main app should schedule, authorize, observe, and display these operations. It should not
contain the operation's long-running domain flow inline.

The boundary should feel like this:

```text
Main app / route / UI
  -> authorize user and matter
  -> ask planner what should run
  -> enqueue/start skill operation runner
  -> stream/poll progress
  -> read receipt and artifacts

Skill operation runner
  -> load typed request and matter context
  -> preflight dependencies and budget/context limits
  -> execute staged deterministic/provider work
  -> validate and persist artifacts
  -> emit auditable receipt
```

This gives the best of both worlds:

- **script-like isolation**: can run from CLI, worker, test harness, or route-triggered job;
- **app-owned governance**: uses the same artifact policy, provider policy, matter identity,
  redaction, audit, and receipt schema;
- **operational auditability**: every meaningful run has a job id, request, stages, timings,
  outputs, warnings, failure code, and recovery hint;
- **complexity tolerance**: long-running legal operations stop pretending to be ordinary HTTP
  handlers.

The throwaway probe was valuable because it accidentally behaved like this: it treated diagnosis as
an operation to run, observe, and summarize. The production design should make that posture real,
typed, durable, and governed.

## Problem Statement

### The concrete failure that exposed the gap

A hosted beta run of `/procedural_posture_diagnosis` on the matter **Taori vs Roma Builder** produced
this job (read from the hosted beta job ledger via the beta API probe, not the local checkout):

```text
id           job_f4097a59-8a04-4fde-b89a-21b5c2b4f41d
matterName   Taori vs Roma Builder
status       failed
durationMs   215752            (~3 min 36 s)
errorCode    provider.invalid_json
failureClass unknown
```

The user saw a generic "Assistant unavailable" style failure. Internally the diagnosis engine had
run its three sequential model stages — proposer, critic, finalizer — and the finalizer returned
truncated JSON. Because the engine validates only after all three calls, the whole skill died, the
~3.5 minutes of provider work was discarded, and nothing in the receipt said "proposer done, critic
done, finalizer failed."

This is not a posture-diagnosis bug. It is the symptom of a missing execution layer.

### Latency is a product of matter complexity

Native legal skills are not uniformly fast. Their latency depends on the matter they operate on:

- number and size of source files;
- quality of extraction/OCR and source labels;
- density of the Case Timeline / List of Dates;
- size and shape of the Matter Story and context packet;
- number of provider/model stages;
- schema/validation/repair attempts;
- artifact persistence and currentness checks;
- provider availability, output limits, and retry policy.

Therefore a native skill operation should be treated like a sophisticated matter-bound job from the
start. A long run is not just "a slow route"; it is evidence that the unit of work belongs behind a
runner boundary with progress, audit, recovery, and operator diagnostics.

### Why the current architecture produces this

Native skills today are wired as bespoke route handlers in `routes/matter-workflow-routes.mjs`. The
posture route (`exactRoute("POST", "/api/procedural-posture-diagnosis", ...)`) is representative:

1. The handler reads the request body.
2. It branches on filesystem vs runtime-DB storage (`usesRuntimeDbStorage(...)`).
3. In the runtime-DB branch it resolves the matter, reads a context packet and matter JSON, then
   calls `proceduralPostureDiagnosisService.runDiagnosis(...)` passing eight storage/context
   overrides: `matterRootOverride`, `matterRecordOverride`, `matterContextPacketOverride`,
   `matterJsonOverride`, `artifactExistsOverride`, `artifactReader`, `artifactStatReader`,
   `artifactWriter` (plus `matterName` and `overwrite`).
4. It strips `artifactPersistence` from the result and reshapes the response.
5. The whole thing is wrapped in `runTrackedWorkflow(...)`, which calls
   `jobStatusService.runTrackedJob(...)`.

Every provider-backed native skill (`/create_listofdates`, `/the_story`, `/describe_sources`,
`/procedural_posture_diagnosis`) repeats a shape close to this. The consequences are:

- **No stage model.** `runTrackedWorkflow` records one whole-job status (`running | succeeded |
  failed`) with a single `errorCode` and `failureClass`. There is no notion of "proposer done,
  critic done, finalizer failed." Progress is opaque for the entire 3+ minutes.
- **No stage attribution of an already-precise code.** The provider HTTP layer (`shared/provider-http.mjs`,
  `shared/openrouter-response.mjs`) already throws `provider.invalid_json` / `provider.timeout` inside
  `invoke`, and that code is already stored on the job as `errorCode` — the incident above had
  `errorCode: provider.invalid_json`. What is missing is attributing that code to a **stage**
  (`finalizer`, not just "the skill"), and the fact that `failureClass` came back `unknown` despite
  the precise code: `classifyFailure` derives the class from the error *message text*, not from
  `errorCode`, so a precise provider code can still surface as a coarse `unknown` class. (A cheap,
  low-risk win available before any runner: derive `failureClass` from `errorCode` when present.)
- **No partial-stage persistence.** Three model calls run; if the last one fails, the first two
  valid `.parsed` outputs are discarded (they live only in memory and are never persisted). A retry
  reruns all three — including the per-stage model calls that already carry their own `label`,
  configured model, and `.aiRun` metadata.
- **No per-stage retry or repair.** A truncated-JSON finalizer cannot be retried alone, nor run
  through a JSON-repair stage, without rerunning the whole skill.
- **Bespoke storage branching per route.** The filesystem-vs-runtime-DB branching and the
  override plumbing live in the route, copy-pasted across skills. This is core-engine bloat, not
  business logic.
- **Generic UX.** Because the receipt carries only one coarse failure class, the UI cannot say
  "finalizer failed after proposer/critic succeeded; retry diagnosis only." It says the skill
  failed.

In short: the planner can already decide *that* diagnosis should run; the product contract already
says *what* diagnosis owns; but nothing owns *stage-level* execution, recovery, or partial
persistence. `runTrackedWorkflow`/`runTrackedJob` already give a whole-job wrapper; what is missing
is the stage model inside it.

### What we are not changing

- Slash commands, routes, and on-disk artifact contracts stay stable (per the implementation
  contract's first foundation slice). The runner sits behind existing routes.
- The planner remains the authority on *what* to run. The runner is the authority on *how* a single
  skill run executes.
- The job ledger (`job-status-service`) is not replaced. The runner extends it with stages, not
  supersedes it.
- Configurable (user-authored) skills already have a runs/receipt model
  (`configurable-skill-runs-service`, `deriveConfigurableSkillRunReceipt`). Native skills should
  align to that same shape, not invent a third one.

## Target Runner Posture

### One lifecycle for every native skill

```text
SkillRequest
  -> validate / preflight        (deterministic; can refuse before any paid call)
  -> create durable job          (idempotent by matter + skill + input fingerprint)
  -> run in observable stages    (each stage emits progress + timing)
  -> validate outputs            (schema + legal-output rules)
  -> persist artifacts           (atomic writes / runtime-DB persistence)
  -> return receipt              (state, outputs, failure taxonomy, recovery hint)
```

Deterministic skills, AI-only skills, and hybrid skills differ only in what their stages do. The
lifecycle, receipt, and failure taxonomy are identical.

### Scope: which native skills

The thesis is **all native skills**. All 10 built-in skills (`matter-init`, `prepare_matter`,
`extract`, `describe_sources`, `context_preview`, `context_search`, `create_listofdates`,
`the_story`, `procedural_posture_diagnosis`, `doctor`) adopt the runner. They differ only in which
stages they use:

- **Artifact-producing skills** (the 8 that write to `10_Library` / `20_Workshop`) use the full
  lifecycle including `create durable job` and `persist`.
- **Read-only query utilities** (`context_preview`, `context_search`: non-provider, no persisted
  output) use the same validate + receipt contract but run a single read stage and **skip** the
  durable-job and `persist` steps. Forcing an ephemeral query through a durable-job + persist
  lifecycle adds overhead without value; the boundary is which stages run, not a second posture.

### The runner contract

Each native skill keeps its existing `built-in-skill/v1` manifest
(`skills/builtins/<id>/skill.json`) for identity and adds a `runner.mjs` that speaks this
lifecycle. The block below is illustrative: the identity fields are read from the manifest; the
methods live in `runner.mjs`.

```text
NativeSkillRunner {
  // identity (from the manifest, already present)
  id, slash, runner_key, version
  category, display{...}
  inputs[], outputs[], upstream[], downstream[]
  matter_required, paid_provider_call, rerun_guarded
  default_lane

  // execution contract
  preflight(request)   -> PreflightResult        // refuse early; never paid
  estimate(request)    -> CostHint               // credit/time class, overwrite scope
  stages()             -> Stage[]                // ordered, named, typed stages
  run(job, request)    -> Receipt                // orchestrates stages, persists, returns receipt
  validate(result)     -> ValidationResult       // schema + legal-output rules
  recover(failure)     -> RecoveryHint           // which stage, retryable?, salvageable outputs?
}
```

### Stage model

A run is a sequence of named stages. Each stage:

- has a stable id (e.g. `proposer`, `critic`, `finalizer`, or for deterministic skills
  `register`, `extract`, `build`);
- emits `started` / `progress` / `succeeded` / `failed` with timing;
- on failure records a taxonomy code (below);
- may declare its outputs **salvageable** so a later retry does not rerun it.

Example stages for posture diagnosis:

```text
build_packet    (deterministic)   gather Case Timeline / Story / Source Index / profile
proposer        (provider)        propose provisional diagnosis
critic          (provider)        critique the proposal
finalizer       (provider)        finalize + structure
validate        (deterministic)   schema + legal-output validation
persist         (deterministic)   write Case Analysis artifacts
```

When `finalizer` fails with `provider.invalid_json`, the receipt says exactly that, marks
`build_packet`, `proposer`, and `critic` as salvageable, and offers retry-of-`finalizer`-only.

### Receipt contract

Every run returns a structured receipt aligned to the existing configurable-skill run receipt
(`configurable-skill-runs-service`'s `deriveConfigurableSkillRunReceipt`):

```text
Receipt {
  runId, slash, skillVersion
  matterName, matterFolder
  state: succeeded | failed | insufficient_record | cancelled
  stages: [ { id, status, durationMs, model?, failureCode? } ]
  outputPaths: { markdown, json, ... }      // from outputs[]
  outputAvailability: { markdown, json }    // present | missing | not_recorded
  failure: { code, class, stageId, message, retryable, salvageableStageIds[] }?
  recovery: { action, retryStageId?, reason }?
  aiRun: {...}                              // provider/model/token metadata per stage
  warnings: [...]
  overwrite: not_needed | prompted | approved | cancelled
  job                       // the existing job-status handle, for compatibility
}
```

`state` is a receipt-level enum, distinct from the job `status`
(`running | succeeded | failed | cancelled`). In particular `insufficient_record` is a **success** —
it maps to job `status: succeeded` and produces a safe Case Analysis artifact with lawyer questions
instead of a brittle over-confident diagnosis (per Planner V2). Do not add `insufficient_record` to
the job-status enum.

### Failure taxonomy (canonical, shared with the planner)

Planner V2 already proposes a diagnosis failure taxonomy (nine codes). This runner **extends** it
into the **native skill failure taxonomy** (not diagnosis-only) and writes every code in the repo's
existing **dotted** convention (`provider.invalid_json`, `provider.timeout`, `job.stale_running`,
`workflow.<stage>.failed`). The first nine below come from Planner V2; the last three are added for
non-diagnosis skills:

```text
dependency.blocked
preflight.not_ready
provider.timeout
provider.invalid_json
schema.validation_failed
insufficient.record_written
assistant.temporarily_unavailable
operator.configuration_needed
internal.error
provider.truncated_output        // added
context.too_large                 // added
missing.upstream_artifact         // added
```

(`provider.empty_output` already exists in the repo and may be reused where relevant.)
Most of these codes are **already produced** by the provider HTTP layer (`shared/provider-http.mjs`,
`shared/openrouter-response.mjs`) and stored on the job as `errorCode` today — that is why the
incident already carried `errorCode: provider.invalid_json`. What `classifyFailure` and
`workflowFailureErrorCode` are too coarse to do is (a) **attribute** the code to a stage and
(b) **derive `failureClass` from `errorCode`** instead of from message text. The runner does both:
it records the existing precise code on the failing `stage`, derives the job `failureClass` from it,
and the existing `job-status-service` `errorCode` field (whose `safeErrorCode` already validates the
dotted form) keeps storing it.

## How This Unifies The Existing Primitives

The runner is mostly composition of things that already exist:

| Existing primitive | Role in the runner |
| --- | --- |
| `skills/builtins/<id>/skill.json` (`built-in-skill/v1`) | Skill identity, inputs/outputs/upstream/downstream, paid/rerun flags. Already the manifest. |
| `job-status-service.runTrackedJob` | The durable job. Extended to carry a `stages[]` array and per-stage progress, not replaced. |
| `configurable-skill-runs-service` / `deriveConfigurableSkillRunReceipt` | The receipt shape native runs align to. Same `outputPaths`, `outputAvailability`, `overwrite`, `aiRun`, `warnings` fields. |
| `aiProviderService.invoke` | Each provider stage is one or more `invoke` calls with a `label`, wrapped to emit stage progress and capture per-stage `aiRun` metadata. |
| Planner V2 stage states | The runner consumes the planner's decision; it does not re-decide dependencies. |
| `40_Dispatch` / visibility rules | The runner never bypasses them; persistence stages write through the existing artifact policy. |

The net new surface is a small orchestration layer plus executable operation runners and one shared
stage/receipt schema. Native skills lose their bespoke route glue, but more importantly their
long-running operation logic moves out of the main app path.

## Desired Shape After Migration

The exact filesystem layout is not the architecture. The architectural split is:

```text
main app orchestration
  registry / authorization / planner / scheduler / progress API / receipt reader

operation runner substrate
  stage lifecycle / provider adapters / artifact policy / receipt writer / audit trail

skill operation runners
  one executable runner per native skill operation
```

A first local slice can map that split onto today's repo like this:

```text
services/
  skill-runner-service.mjs     // orchestration adapter: start/observe a skill operation job
  skill-stage-service.mjs      // stage lifecycle, salvage marking, per-stage aiRun capture
  artifact-service.mjs         // one write path (filesystem + runtime-DB), no per-route branching
  job-status-service.mjs       // existing migration ledger, extended with stages[]

skills/builtins/<id>/
  skill.json                   // existing built-in-skill/v1 manifest (unchanged)
  runner.mjs                   // executable operation runner for this skill
```

If the team wants a more explicitly script-style path, `scripts/native-skill-runners/<id>.mjs` is a
valid later/parallel layout. The runner contract must not depend on whether the executable lives
under `skills/builtins/<id>/runner.mjs`, `scripts/native-skill-runners/<id>.mjs`, a worker bundle,
or a container entrypoint. The manifest's existing `runner_key` can resolve the executable without
requiring a directory rename. Any move to `skills/native/` or `scripts/native-skill-runners/` should
be explicit migration work, not accidental cleanup.

Routes become thin: authorize/validate the request, start or enqueue the operation runner, return a
job/receipt handle, and later read progress/receipt. The filesystem-vs-runtime-DB branching moves
into artifact policy, owned once. The unified entrypoint uses the singular `/api/skill/:slash/run`
(distinct from the existing plural `/api/skills` skill factory routes):

```text
POST /api/skill/:slash/run
  -> resolve runner by slash / runner_key
  -> create or reuse operation job by idempotency key
  -> start inline only for safe short operations, otherwise enqueue/dispatch runner
  -> return job handle immediately

GET /api/skill-runs/:runId
  -> return progress, stages, receipt if terminal, artifact handles
```

For a local first slice, the route may still execute inline and return the terminal receipt for
compatibility. That is migration scaffolding only; the contract should assume long-running native
skills become background operation jobs.

## Current Slice Status

As of the `feature/native-skill-runner-posture` implementation slice:

- `job-status-service` records durable staged jobs, stage durations, stale-stage failures, and scoped
  native receipts.
- `/procedural_posture_diagnosis` runs through a script-style native runner with durable stage state
  and actual retry-from-`finalizer` reuse of proposer/critic outputs.
- `/the_story` and `/create_listofdates` run through native runner wrappers while preserving legacy
  route response shapes and runtime-DB custody.
- `/create_listofdates` now records `build_packet`, one-pass `generate`, two-pass
  `candidate_pass`/`editor_pass`, `validate`, and `persist` stages; stage retry is deliberately
  marked unsupported until candidate-ledger reuse semantics are promoted to the runner contract.
- `/describe_sources` runs through a native runner with `label_pass` progress and total-batch failure
  attribution while preserving existing Source Index output semantics.
- `POST /api/skill/:slash/run` exists as a thin native alias for the migrated skills, and Activity can
  copy metadata-only reports or retry failed native runs/stages according to runner capability.

## Implementation Plan

### Phase 0 — Accept, bound, and protect the invariants

- Accept/revise this contract.
- Mark what is invariant (`request`, `preflight`, `stage`, `artifact write`, `receipt`, `recovery`)
  and what is migration scaffolding (`routes/matter-workflow-routes.mjs`, local JSON ledgers,
  current service filenames, current provider sequence).
- Decide explicitly: native runners sit **behind** existing `/api/...` routes during migration
  (no route rename), and a unified `/api/skill/:slash/run` is added later as a thin alias.
- Confirm the failure taxonomy extends Planner V2's and uses the repo's dotted `errorCode`
  convention.
- Before coding the first slice, answer these pivot checks:
  - If execution moves from HTTP request lifetime to a queue/worker, does the contract still hold?
  - If the local job ledger is replaced by Postgres/outbox rows, does the receipt still hold?
  - If storage moves from filesystem/runtime-DB to object-store-backed artifacts, does persistence
    still go through one artifact policy?
  - If the three-call proposer/critic/finalizer sequence becomes a different model strategy, do
    stage attribution, salvage, and recovery still work?
  - If native and configurable skills converge later, can they share the receipt shape?

### Phase 1 — Stage + receipt schema (no behavior change yet)

Add the shared schema without rewiring skills:

- Extend the `job-status` record with an optional `stages[]` array
  (`{ id, status, startedAt, finishedAt, durationMs, model?, failureCode? }`).
- Add a `native-skill-receipt` shared module that produces the `Receipt` shape above, reusing
  `deriveConfigurableSkillRunReceipt` internals where possible.
- Add `skill-stage-service` helpers: mark stage started/succeeded/failed, mark salvageable,
  capture per-stage `aiRun`.
- Low-risk robustness win that can land here independently of the runner: make `classifyFailure`
  derive `failureClass` from `errorCode` when present (so a `provider.*` code never surfaces as
  `unknown`). This alone would have made the incident read `failureClass: provider`.

Acceptance: schema lands; existing routes/behaviors unchanged; unit tests cover the schema and
receipt derivation from a synthetic staged job.

### Phase 2 — Runner service skeleton + stage capture

Build `skill-runner-service` as a thin orchestrator, not as the place where skill business logic
moves:

- `start({ slash, request, idempotencyKey })` resolves the manifest, calls an optional preflight,
  creates/reuses the operation job, and dispatches the executable runner.
- `execute({ runId })` is the local/worker entrypoint that invokes the skill operation runner with
  stage helpers, artifact policy, provider adapters, and receipt writer.
- For the local first slice, `start` may call `execute` inline for compatibility, but the API shape
  must not require inline execution.
- The orchestrator owns the **single** filesystem-vs-runtime-DB persistence dispatch (the old
  per-route branching), so skill operations receive a uniform artifact policy instead of route-local
  `artifactWriter`/`artifactReader` plumbing.
- Failure mapping: a thrown provider/schema error is attributed to the failing stage and propagates
  to the receipt, the stage trace, and the job `errorCode`/`failureClass`.

Acceptance: a synthetic executable runner flows through the full lifecycle and emits a receipt with
stages, timing, and a precise failure code; the same test can run inline or through a fake queued
worker; the persistence dispatch is exercised for both storage backends without any skill-specific
route code.

### Phase 3 — Migrate posture diagnosis onto the runner (the proving skill)

Convert `procedural-posture-diagnosis-service` into a runner whose stages are
`build_packet`, `proposer`, `critic`, `finalizer`, `validate`, `persist`:

- The three `aiProviderService.invoke` calls each become a provider stage that emits progress.
  The service already collects `aiRuns: { proposer, critic, finalizer }` internally; the runner
  surfaces that per-stage metadata into the receipt and the job `stages[]`.
- Each provider stage wraps `invoke` so that when `invoke` throws (it already throws
  `provider.invalid_json` / `provider.timeout` at the HTTP layer), the failure is **attributed to
  that stage** (`failure.stageId: finalizer`), earlier valid stages are marked salvageable, and the
  job `failureClass` is derived from the `errorCode` rather than from message text.
- Proposer/critic outputs become salvageable: a retry skips stages that already have valid output
  unless the input fingerprint changed.
- `validate` produces either a diagnosis artifact or an `insufficient_record` receipt (success),
  per Planner V2.
- The route handler shrinks to: resolve/authorize request, start the operation job, return the job
  handle; terminal receipt is read from the run endpoint. Inline terminal-return can remain only as
  a compatibility shim during migration.

Acceptance (maps directly to the incident):

- A finalizer returning invalid JSON yields `state: failed`, `failure.code:
  provider.invalid_json`, `failure.stageId: finalizer`, `recovery.retryStageId: finalizer`,
  salvageable `[build_packet, proposer, critic]`.
- A retry reruns `finalizer` (and `validate`/`persist`) only.
- A genuinely thin record yields `state: insufficient_record` and a safe artifact, not a failure.
- The UX can render "finalizer failed; retry diagnosis only" from the receipt.
- The route handler no longer contains storage branching or override plumbing.

### Phase 4 — Fold the remaining provider-backed skills

Migrate `/the_story`, `/create_listofdates`, `/describe_sources` onto the same runner. Each becomes
stages (e.g. describe_sources: `build_source_packet` -> `label_pass` -> `validate` -> `persist`;
optionally a `label_second_pass` stage). Reuse Planner V2's staleness taxonomy to decide salvage vs
regenerate.

Acceptance: each skill's route handler is reduced to request-resolve + start/enqueue operation +
job handle; all emit the same receipt and failure taxonomy; existing on-disk outputs are
byte-compatible.

### Phase 5 — Fold deterministic skills, the doctor, and query utilities

`/extract`, `/matter-init`, `/doctor`, `/prepare_matter`, `/context_preview`, and
`/context_search` go through the runner with deterministic stages only (no provider stages). This
standardizes progress/receipts for the non-AI spine too, and is what lets `/prepare_matter` become
a pure planner-driven runner-of-runners. After this phase all 10 built-in skills use the runner.

`/context_preview` and `/context_search` are read-only, non-provider query utilities that produce
no persisted workspace artifact (their outputs are copyable reports). They use the runner's
validate + receipt contract with a single read stage and skip the durable-job `persist` stage
(see Scope below).

Acceptance: deterministic skills emit the same receipt shape; `paid_provider_call: false` is
enforced (no `aiRun`); query utilities return a receipt with no `outputPaths` and no persisted
artifact; `/prepare_matter` delegates per-stage execution to other runners per the planner
decision.

### Phase 6 — Collapse routes + unify entrypoint

Introduce `POST /api/skill/:slash/run` as the thin unified entrypoint. Keep the legacy
`/api/procedural-posture-diagnosis` etc. as aliases that delegate to it (stable contracts per the
implementation contract). Delete the bespoke per-skill handlers once all callers (React client,
planner, tests) use the unified path.

Acceptance: `routes/matter-workflow-routes.mjs` no longer contains per-skill storage branching or
override plumbing; one runner entrypoint serves every native skill; the legacy aliases pass the
same acceptance tests as before.

### Phase 7 — Planner integration and observability

- The planner emits run decisions; the runner executes them and returns receipts; the planner reads
  the receipt's `failure`/`recovery` to decide retry-only vs blocked vs needs-operator (closing the
  loop with Planner V2 Phases 3 and 5).
- Surface stage-level progress and the precise failure code in Activity / operator diagnostics and
  the private-beta signal service (which already carries `job_failed:<kind>:<failureClass>:<code>`).

Acceptance: a failed finalizer in beta produces a `job_failed:posture_diagnosis:provider:provider.invalid_json`
signal with a retry-diagnosis-only recovery hint, not a generic unknown failure.

## Testing Strategy

- **Schema/receipt:** unit tests derive receipts from synthetic staged jobs (success, partial
  failure, insufficient record, cancelled).
- **Posture incident reproduction:** an integration fixture where the finalizer returns truncated
  JSON must attribute `provider.invalid_json` to `finalizer` (the code is already thrown by `invoke`;
  the runner adds stage attribution), mark earlier stages salvageable, and emit a
  retry-finalizer-only recovery hint.
- **failureClass derivation:** a job whose `errorCode` is `provider.*` must read `failureClass:
  provider`, never `unknown` (regression test for the incident).
- **Retry isolation:** retrying a failed stage reruns only that stage (and downstream
  validate/persist) when the input fingerprint is unchanged; it reruns upstream stages only when
  the planner says inputs changed.
- **Insufficient record:** a thin record yields a success receipt with a safe artifact and lawyer
  questions, never a provider failure.
- **Persistence parity:** outputs written through the runner are byte-identical to the pre-migration
  artifacts for both filesystem and runtime-DB backends.
- **Deterministic skills:** receipts carry no `aiRun`; `paid_provider_call` is honored.
- **Route compatibility:** legacy `/api/<skill>` aliases and `/api/skill/:slash/run` return
  equivalent job handles/progress/terminal receipts and pass the existing acceptance packs.
- **Stage progress timing:** each stage records `durationMs`; per-stage `aiRun` token/model metadata
  is captured for provider stages.

## Tradeoffs

### One runner contract vs per-skill freedom

A single lifecycle is more constraining, but it is what makes robustness (retries, receipts, stage
timing, partial recovery) uniform instead of skill-by-skill. The constraint is the benefit.

### Stages vs a single operation

Staged runs add bookkeeping, but they are the only way to (a) report progress during 3+ minute runs,
(b) salvage valid upstream work, and (c) retry a single failed stage. The posture incident is
exactly the cost of not having them.

### Aligning native and configurable skill receipts vs two models

Native and configurable skills could keep separate run models. Aligning them (sharing the receipt
shape and overwrite/availability vocabulary) costs a small schema refactor up front and removes a
third model later.

### Extending job-status vs a new ledger

Extending `job-status-service` with `stages[]` is the lowest-risk local migration because the
private-beta signal and observability services already read it. But `job-status-service` is not the
architecture. The architectural object is an operation job + receipt. A future Postgres/outbox/queue
ledger should be able to store the same stage and receipt contract.

### Script-style runners vs service methods

Moving long-running skill operations out of route/service glue adds an executable boundary, typed
request handling, and more tests. That is extra ceremony for small skills, but it is what makes
large matter-dependent operations auditable, replayable, and eventually worker/queue friendly.

### Precise failure taxonomy vs generic buckets

Precise codes (`provider.invalid_json`) expose more internals into receipts. We keep user-facing
copy sanitized (per the implementation contract's visibility rules) while Activity and operator
diagnostics see the precise category.

## Open Questions

1. Should `preflight` and `estimate` live on the runner or be read from manifest metadata the
   planner already computes? (Likely: runner executes; planner still decides.)
2. Should salvageable stage outputs be persisted as intermediate artifacts (audit/reuse) or kept
   only in memory for the retry window? Persisting helps long retry gaps but adds artifact surface.
3. Should the unified `/api/skill/:slash/run` also serve configurable skills, or remain native-only
   with configurable skills keeping their own runs service (aligned receipt, separate store)?
4. Should stage progress be pushed to the UI (SSE/WebSocket) or polled via the existing job status
   route? Polling is the lower-risk first slice.
5. How should the runner record `provider.truncated_output` vs `provider.invalid_json` distinctly —
   by finish-reason, by JSON-parse failure, or both?
6. Does `/prepare_matter` become a runner whose stages are *other runners* (runner-of-runners), and
   does that require a nested-receipt shape?
7. Where should executable operation runners live for the first production slice: next to
   `skills/builtins/<id>/skill.json`, under `scripts/native-skill-runners/`, or as worker bundles?
   The contract should allow all three; the first implementation should choose the least disruptive
   path.

## Recommended Next Slice

Do not migrate all skills at once, and do not start by beautifying route handlers. The recommended
first slice is:

```text
operation request + stage + receipt schema
  + failureClass-from-errorCode regression fix
  + executable runner harness that can run inline or through a fake queued worker
  + procedural posture diagnosis as the proving operation
```

This is the smallest slice that turns the concrete beta incident (`provider.invalid_json` on a
3-stage skill, generic UX, no retry) into a precise, recoverable, stage-level operation receipt —
and proves the contract is not tied to HTTP request lifetime, current service filenames, or today's
provider sequence before the other native skills are folded in.
