# Mothership Signal Lifecycle — Agreed Fix

Status: implemented in this branch; deploy only after migration/tests pass.
Confidence: medium-high for the posture/job-status class; other signal classes
may still need follow-up lifecycle rules.

## Problem recap

The noisy posture incidents were not live failures. They were old
`job_status` signals derived from failed jobs that remained in the job ledger.
Every `/api/jobs` read re-observed those failed rows, so the local signal ledger
bumped `occurrenceCount` and re-synced to Mothership. Mothership then treated the
same old evidence as still-open because signals had no lifecycle.

Verified facts:

- The posture rows were `source: "job_status"`.
- `captureJobSignals` is called from `GET /api/jobs`.
- `captureJobSignals` previously emitted every `status === "failed"` job.
- The affected matters later had same-kind successful jobs.
- Failed jobs are useful forensic evidence and should not be pruned just to
  quiet reports.

## Fix direction

We are fixing the signal lifecycle first, plus a narrow job-status supersede
rule. We are **not** relying on broad `last_seen_at` stale logic as the primary
mechanism.

### 1. Server-side signal lifecycle

`mothership_signal_events` now gets lifecycle fields:

- `status`: `active`, `resolved`, `superseded`, or `suppressed`
- `status_updated_at`

Report behavior:

- Default reports include only `active` signals.
- Non-active signals remain queryable with `includeResolved=true` for audit.
- Non-active signals are rendered as closed/watch evidence, not live fix-now
  incidents.

Ingest behavior:

- Active recurrence updates occurrence and last-seen evidence idempotently.
- `resolved` and `superseded` non-job signals reopen on a later active
  recurrence; the Mothership row and local ledger both return to `active`.
- A repeated observation of the same historical `job_status` row does not
  reopen it. A genuinely new failed job has a new job-bound fingerprint and
  creates new active evidence.
- `suppressed` signals retain suppression while still recording recurrence
  counts and last-seen time; suppression must be lifted explicitly or by a
  later accepted expiry policy.
- Lifecycle updates can match by `signal_id` or by `fingerprint`, so a local
  client can supersede an already-synced server row even if the local signal id
  differs.

Operator behavior:

- Feedback-style status update support exists for signals via
  `updateSignalStatus` / `POST /api/signals/:installationId/:signalId/status`.

### 2. Job-status supersede-on-later-success

For `job_status` signals only, `captureJobSignals` now treats failed jobs as
historical events:

- If a failed job has a later `succeeded` job with the same matter and kind, the
  failed-job signal becomes `superseded`.
- The local signal occurrence count is not incremented for this lifecycle
  update.
- The superseded signal is queued for Mothership sync, carrying
  `status: "superseded"` and `statusUpdatedAt` from the later successful job.

This is deliberately narrow:

- Same matter.
- Same job kind.
- Success timestamp must be later than the failed job timestamp.
- A new failure after the later success is not suppressed, because there is no
  later success after that new failure.

### 3. Time-based stale handling is fallback only

A broad time-based auto-resolve rule remains a fallback idea, not the first
ship. For job-status signals, `last_seen_at` can mean "old failed job observed
again," not "failure happened again." If we add time-based cleanup later, it
should use source-event time where possible (`finishedAt`, `updatedAt`, etc.),
not just `last_seen_at`.

## Validation checklist

- Migration is idempotent and existing rows default to `active`.
- Store tests cover:
  - active-signal ingest guard,
  - lifecycle updates by id/fingerprint,
  - operator status audit metadata.
- Report tests cover:
  - default hiding of non-active signals,
  - `includeResolvedSignals` audit view,
  - status filters for active signals.
- Signal-service tests cover:
  - failed job initially emits an active signal,
  - later same-kind success supersedes it without incrementing occurrences,
  - the superseded lifecycle update is synced.

## Remaining follow-up questions

1. Do non-`job_status` sources need automatic lifecycle rules, or is manual
   resolve/suppress enough?
2. Should Mothership expose a first-class console control for signal status, not
   just the API/store path?
3. Should failed-job retention be revisited separately as a product/forensics
   decision?
4. Should future time-based cleanup use per-source event timestamps and only
   mark `resolved`, never `superseded`?
