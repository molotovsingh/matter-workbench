# Upload Intake Scheduler

Date: 2026-06-13
Status: Parked future feature; important before high-volume beta matters

## Problem

Today upload is mostly a matter-ingestion surface: files arrive, are registered,
and preparation can start.

That is fine for small matters. It is not enough for large real-world matters:

- ZIP/email containers may expand into many child files;
- criminal matters may contain hundreds of PDFs;
- OCR can be slow, cost-bearing, and provider-limited;
- downstream Source Labels and List of Dates should not start from weak or
  partial extraction;
- a user will lose patience if the app looks frozen or falsely claims readiness.

The future upload module should become an **intake scheduler**, not just a file
receiver.

## Product Principle

The user should be able to upload a large packet without needing to understand
queues, OCR providers, batches, retries, or file-register internals.

The app should be honest:

```text
We received 612 files.
We are reading them in batches.
Some files may need better copies.
The chronology will start after source reading is stable.
```

Do not pretend a large upload is ready merely because the files were copied.

## Intake Classification

After upload, the app should classify the intake before starting expensive or
long-running work.

Inputs:

- file count;
- total uploaded bytes;
- detected file type mix;
- ZIP/container expansion result;
- estimated PDF page count where cheap to determine;
- whether OCR is likely required;
- whether files are duplicates or previous-matter repeats;
- current active jobs and provider capacity.

Suggested classes:

| Class | Example | Behavior |
| --- | --- | --- |
| Small | 1-20 files, modest size | Run preparation immediately with normal progress. |
| Medium | Dozens of files or mixed formats | Run in bounded batches with visible progress. |
| Large | Hundreds of PDFs or heavy OCR | Use queued/background preparation, resumable receipts, and conservative concurrency. |
| Huge / risky | Very large ZIPs, many nested containers, or extreme page count | Ask for confirmation or advise splitting/replacing files before legal processing. |

The exact thresholds should be empirical, based on beta telemetry.

## Intake Head And Fan-Out/Fan-In

Each upload should be treated as one **intake head** even when the app splits
the work internally.

Example:

```text
Intake 03 - Client Dropbox Upload
```

That intake head may fan out into many internal work units:

```text
Intake Head
  - register files and allocate FILE-NNNN identities
  - batch 1: PDFs 1-50
  - batch 2: PDFs 51-100
  - batch 3: emails
  - batch 4: spreadsheets
  - merge extraction receipts
  - refresh advisory
```

But it should fan back in as one coherent intake result. The lawyer should not
see a confusing set of mini-intakes merely because the app parallelized work.

Principle:

```text
Split internally for speed.
Merge externally for clarity.
```

Outputs should retain the same intake provenance:

- original upload/container preserved under the intake head;
- child files get normal matter-scoped `FILE-NNNN` identities;
- per-file/per-batch receipts remain available for diagnostics;
- final matter artifacts still land in the normal matter folders;
- advisory can say which intake head produced or affected the issue.

## Scheduling Rules

The scheduler should enforce sequencing:

```text
upload/register
container expansion
deduplicate and allocate FILE-NNNN identity
extract/OCR in batches
quality/advisory check
source labels
list of dates
matter attention/advisory refresh
```

Rules:

- extraction/OCR can be parallelized per file, with bounded concurrency;
- source labels should wait until extraction is complete enough to trust;
- List of Dates should wait until source labels are current or explicitly
  marked incomplete;
- downstream work should not silently start from partial extraction unless the
  output is clearly marked partial;
- a forced rerun should rebuild the whole mandatory chain, but still obey
  concurrency limits.

## Dependency Matrix

Concurrency needs an explicit dependency matrix. Without it, batching becomes a
race: Source Labels can start from partial extraction, List of Dates can build
from stale source labels, or advisory can claim readiness while downstream work
is still running.

The scheduler should model each work unit as:

```text
unit id
unit type
matter id
intake head id
input dependencies
output artifacts / receipts
status
retry policy
```

Minimum dependency matrix:

| Work unit | Can run concurrently? | Must wait for | Produces | Downstream unlocked |
| --- | --- | --- | --- | --- |
| Container expansion | Per container, bounded | Upload persisted | Child-file manifest, original preserved | File registration |
| File registration | Mostly serial per matter | Container expansion or direct upload | `FILE-NNNN` identities, file register | Extraction/OCR |
| Extraction/OCR | Per file, bounded | File registration | Extraction records, page/text receipts, quality flags | Source Labels |
| Extraction quality/advisory pass | Per intake head | Extraction/OCR receipts | OCR/layout/skipped-file warnings | Source Labels may proceed with warnings, or block if extraction is insufficient |
| Source Labels | Per batch, bounded | Required extraction records | Source descriptors / Source Index candidates | Source Index merge |
| Source Index merge | Serial per matter/intake head | All required label batches validated | Current Source Index | List of Dates |
| List of Dates candidate harvesting | Per source block/batch, bounded | Current Source Index | Candidate events with citations | Chronology merge |
| List of Dates merge/editor | Serial per matter | Candidate harvesting complete | Final List of Dates artifacts | Matter advisory refresh |
| Matter advisory refresh | Serial per matter | Latest receipts/artifacts | Current advisory projection | User review |

Rules:

- parallel units may write receipts, but not final shared artifacts;
- final shared artifacts are written only by merge/finalizer units;
- a downstream unit must know whether upstream output is complete, partial,
  blocked, or stale;
- if an upstream dependency is partial, downstream output must either block or
  clearly mark itself partial;
- retries should rerun failed units, not the whole intake, unless dependency
  integrity requires a full rerun;
- the dependency matrix should be inspectable by operator tooling, but not shown
  as technical machinery to lawyers.

## User-Facing Behavior

Keep the lawyer-facing surface simple.

Good:

```text
Reading documents: 142 of 612
Some scans need review
Preparing source record
Building List of Dates
```

Avoid:

```text
worker queue depth
provider batch id
OCR model retry count
JSON row state
```

Operator/debug views may expose those details.

## System Protection

The scheduler must protect the app from collapse:

- maximum concurrent OCR calls;
- maximum active extraction jobs per matter;
- maximum global provider calls;
- resumable per-file receipts;
- retry only failed/transient units;
- no duplicate `FILE-NNNN` allocation under concurrency;
- no partial final artifacts that look complete;
- advisory when files were skipped, delayed, encrypted, unsupported, or low
  quality.

## Relation To ZIP And Future Email Connectors

ZIP upload and future Gmail/email ingestion are container-intake problems.

The correct abstraction is:

```text
container received
original preserved
child files safely expanded
children enter normal intake scheduler
container provenance retained
```

Do not wire ZIP extraction directly into OCR. It belongs before extraction, in
the upload/intake scheduler.

## Relation To Existing Future Notes

This note complements:

- [Parallel Processing And Latency Strategy](parallel-processing-latency.md)
- [Hosted Beta Database Architecture](hosted-beta-database-architecture.md)
- [Communication Evidence Ingestion](communication-evidence-ingestion.md)

It does not authorize a broad distributed worker rewrite. It parks the product
and engineering shape so the idea is not lost.

## First Slice Recommendation

Do not start with full scheduler complexity.

First slice:

```text
read-only intake sizing report after upload
```

It should compute:

- file count;
- total size;
- type mix;
- estimated PDF count/page count if available;
- ZIP/container child count if ZIP expansion is enabled;
- recommended preparation mode: `immediate`, `batched`, `background`, or
  `needs review before processing`.

No behavior change is required for that first slice. It gives us observability
and lets beta telemetry teach the thresholds.

## Later Acceptance Criteria

Before enabling large-matter scheduling:

- a 600-PDF synthetic matter does not crash the app;
- upload returns quickly with a durable job/progress state;
- OCR concurrency is bounded;
- per-file extraction receipts survive refresh/restart;
- Source Labels do not run from missing extraction records;
- List of Dates does not run from incomplete source labels unless marked
  partial;
- user-visible progress remains simple and honest;
- operator telemetry captures duration, failure, retry, and bottleneck data.

## Non-Goals For Now

- no Gmail connector yet;
- no automatic nested archive expansion beyond a deliberate depth rule;
- no full distributed worker platform in the local beta;
- no lawyer-facing provider/queue internals;
- no hidden paid reruns merely because a large upload arrived.
