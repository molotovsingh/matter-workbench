# Parallel Processing And Latency Strategy

Date: 2026-05-19
Status: Parked future feature; local/V1 runtime path

## Problem

V1 beta proved the core matter path, but it also exposed a predictable product
limit: some native skills take a long time.

Large matters can spend meaningful time in:

- OCR;
- extraction across many files;
- Source Labels provider batches;
- List of Dates source-block processing;
- future drafting or Co-pilot workflows that read a large matter context.

If this is handled only by increasing timeouts, the app will feel fragile. The
right future direction is not just "wait longer." It is:

```text
parallelize safe work
show progress
record receipts
resume or retry cleanly
keep legal artifacts deterministic and auditable
```

## Product Promise

The user should not have to stare at a frozen app while a large matter runs.

For time-intensive work, the app should be able to say:

```text
Reading 18 source files...
Labeling sources batch 2 of 3...
Building chronology from 88 source chunks...
Retrying one transient provider failure...
```

The important product promise is not raw speed alone. It is predictable progress
and recoverability.

## Candidate Work That Can Run In Parallel

### Extraction

Many source files can be extracted independently.

Parallel extraction is attractive because file-level work is naturally isolated,
but it needs guardrails:

- cap concurrency so large PDFs or OCR jobs do not overload the machine;
- preserve deterministic `FILE-NNNN` ordering in output records;
- write per-file receipts before updating matter-level summaries;
- keep duplicate detection and file-register identity stable.

### OCR

OCR is one of the clearest latency sources.

Future OCR parallelism should be bounded separately from normal extraction
because OCR may call a provider and may be slower or cost-bearing. OCR should
also report page/file-level progress rather than blocking the whole matter with
one opaque spinner.

### Source Labels

Source Labels already runs in bounded batches. That makes it a good first
candidate for safe parallelism.

The future implementation could run several independent source-label batches at
once, then merge them into one `Source Index.json` only after all accepted
batches validate locally.

Rules:

- keep stable source identity server-owned;
- validate each batch before merge;
- retry transient provider failures per batch;
- fail closed if any required source cannot be safely labeled;
- do not write a partial successful `Source Index.json` that looks complete.

### List Of Dates

Chronology work can be chunked, but this is more legally sensitive than source
labeling.

Source-block candidate harvesting may be parallelizable because each chunk can
produce candidate events independently. The final chronology editor/merge step
should remain a controlled consolidation step so duplicate handling,
corroboration, payment discrepancies, and legal relevance stay coherent.

Rules:

- raw chunk outputs are internal audit/candidate material;
- final lawyer-facing chronology is written only after validation;
- chunk order must not decide legal priority;
- final output must preserve source citations and dependency metadata;
- failures should preserve enough receipts to retry only failed chunks later.

## Background Jobs Versus Parallel Requests

Parallel processing and background jobs are related but not identical.

Parallel processing asks:

```text
Can independent units of work run at the same time?
```

Background jobs ask:

```text
Can the user leave the screen and come back to a durable receipt?
```

The future architecture probably needs both, but they should not be mixed in one
large first slice.

Hosted beta has a stricter foundation order. The hosted path should first prove
tenant-scoped upload, object lifecycle, durable jobs, and canonical incidents as
defined in [Hosted Beta Database Architecture](hosted-beta-database-architecture.md).
This note's Source Labels parallelism slice is a local/V1 runtime improvement,
not permission to move Source Labels or List of Dates into hosted workers before
the hosted foundation is safe.

Suggested order:

1. Add clearer progress receipts for long current operations.
2. Parallelize the safest batchable stage first, likely Source Labels.
3. Add a small job ledger for long native skills.
4. Move List of Dates chunk work into a resumable job only after Source Labels
   proves the pattern.

## First Slice Recommendation

The first implementation slice should be:

```text
parallel Source Labels batches with bounded concurrency and progress receipts
```

Why this first:

- Source Label batches are already bounded.
- Batch output can validate independently.
- The merge target is one JSON artifact.
- It improves latency without changing legal reasoning.
- It exercises retry/progress/job semantics on a lower-risk AI task than List of
  Dates.

Acceptance criteria:

- configurable concurrency, default conservative;
- deterministic final `Source Index.json`;
- no partial final source index on failed batch;
- batch-level retry and error details preserved;
- command activity shows current batch progress;
- tests cover success, one transient retry, one hard failure, and stable output
  order.

## Non-Goals For First Slice

Do not start with:

- fully distributed workers;
- a database-backed queue;
- parallel final chronology editing;
- automatic model fallback;
- hidden retries that change provider/model identity;
- global app-wide scheduler complexity.

Those may come later, but V1 beta needs a small reliability upgrade, not a new
platform.

## Design Constraint

Legal artifacts must remain boring.

Parallelism may make the run faster, but it must not make outputs harder to
audit. Final artifacts should still be written in the same lanes, with the same
schema versions, same source identities, same provider metadata, and same
fail-closed posture.
