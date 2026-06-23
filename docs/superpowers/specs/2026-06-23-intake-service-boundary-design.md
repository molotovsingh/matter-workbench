# Intake Service Boundary Design

Status: Draft design for user review

Date: 2026-06-23

Branch: `codex/intake-service-boundary`

## Plain-English Summary

Matter Workbench needs a first-class intake layer.

Today, upload is still too close to the product app. A lawyer selects files, the
browser posts them, the app parses the multipart request, writes custody rows,
stores bytes, creates matter files, and then starts preparation. That is fine
for controlled beta batches. It is not the right long-term shape for a serious
matter with thousands of files, many folders, ZIPs, emails, WhatsApp exports,
Drive folders, or later Gmail/Dropbox connectors.

The new boundary should treat intake like an airport cargo terminal:

```text
source adapter -> intake core -> durable custody -> import jobs -> Matter Workbench handoff
```

The terminal does not decide legal strategy. It makes the incoming file universe
safe, traceable, deduplicated, and ready for legal work.

## Why This Matters

A Reliance vs Amazon scale matter is not "one upload." It is a stream of
evidence arriving from different places, with bad filenames, duplicate folders,
oversized PDFs, archives, emails, and follow-up batches. The risk is not only
technical. It is legal custody risk:

- Did we preserve the original file names?
- Did two same-named files overwrite each other?
- Did we reject anything silently?
- Did we know which batch produced which source number?
- Can the lawyer retry without starting over?
- Can we explain why a file was excluded?
- Can preparation start only after the intake batch is stable?

The current upload path already has important pieces: shared upload planning,
path validation, duplicate-path rejection, runtime DB custody rows, payload
storage, source registers, and stable error codes. The next step is not to throw
that away. The next step is to name the larger boundary and move responsibility
there gradually.

## Recommended Architecture Choice

Start as a module inside this repo, on a separate worktree/branch.

Do not start with a separate Python service. Do not start with a second Node
service. Those options may become right later, but they would add deployment,
auth, logging, DB, and operational complexity before the boundary is proven.

The first version should be:

```text
same repo
same Node runtime
same Postgres runtime DB
same auth and telemetry
new intake boundary
service-shaped contracts
```

This gives us the benefit of service thinking without the cost of distributed
systems too early.

## Relationship To Current Upload Code

Current canonical contract:

- `docs/contracts/upload-intake-contract.md`
- `shared/upload-intake-planner.mjs`
- `shared/upload-path-policy.mjs`
- `services/upload-service.mjs`
- runtime DB upload persistence helpers

Those are Phase 1 assets. They already prove a key idea:

```text
same submitted matter + files + browser paths -> same intake plan
```

The new Intake Service boundary should preserve that rule but expand it beyond
browser multipart upload.

## Core Boundary

### Source Adapters

Source adapters answer one question:

```text
Where did the candidate files come from?
```

Examples:

- browser file/folder upload;
- ZIP upload;
- `.eml` upload;
- email thread import;
- Gmail or Drive connector later;
- WhatsApp export later;
- Dropbox or local sync folder later.

Adapters should not decide source numbering, legal labels, extraction strategy,
or duplicate policy. They should convert an outside source into a common intake
candidate shape.

### Intake Core

The intake core answers:

```text
Which candidates are acceptable, duplicate, too large, unsafe, or ready?
```

Responsibilities:

- validate relative paths;
- normalize display names and safe object keys;
- compute hashes;
- detect duplicate paths within the batch;
- detect duplicate bytes within the batch;
- detect duplicates against prior matter custody records;
- classify rejected files with stable reasons;
- plan batches;
- plan source numbering;
- produce a custody manifest;
- emit stable error codes.

The intake core should be deterministic and testable without provider calls.

### Durable Custody

Durable custody answers:

```text
Where are the bytes, and can we prove what happened?
```

Responsibilities:

- persist original file bytes or object references;
- store hashes, sizes, MIME/type guesses, and original source metadata;
- keep immutable intake batch records;
- preserve container lineage, such as ZIP path or email attachment metadata;
- record rejected items instead of losing them silently;
- support replay or retry without duplicate imports.

In the current runtime DB mode, Postgres owns payload bytes. Later hosted
production may move large bytes to object storage while Postgres owns metadata.

### Import Jobs

Import jobs answer:

```text
How does a stable intake batch become a Matter Workbench source inventory?
```

Responsibilities:

- run in the background when needed;
- move candidate rows through states;
- write/import source records;
- allocate source file numbers;
- mark successes and failures;
- support retry/cancel/resume;
- expose progress to the UI;
- emit telemetry and stable failure codes.

### Matter Workbench Handoff

Matter Workbench should receive a clean event:

```text
intake_batch_ready
matter_id
intake_batch_id
files_imported
files_rejected
duplicates_detected
source_inventory_ready
```

Preparation, extraction, source labels, List of Dates, and skills should start
from the clean inventory, not from a raw browser upload stream.

## Phased Work Plan

### Phase 1: Name The Boundary

Goal: make intake a clear internal subsystem without changing product behavior.

Deliverables:

- `services/intake/` or equivalent module boundary;
- shared contract types for candidates, batches, rejected items, and handoff;
- tests proving current browser upload still behaves the same;
- no new service, no connector, no Python runtime.

Success means a developer can answer:

```text
This file belongs to intake.
This file belongs to Matter Workbench legal workflow.
This file is just an adapter between them.
```

### Phase 2: Large Browser Upload Hardening

Goal: make manual large uploads safe and understandable.

Deliverables:

- clear batch size policy;
- progress and retry model;
- stable oversized-batch error;
- safe partial-batch behavior;
- no runtime OOM;
- operator telemetry for upload pressure.

This phase should not promise "unlimited upload." It should promise:

```text
The app will not die, the user will know what to do, and operators will see why.
```

### Phase 3: ZIP And Container Intake

Goal: treat archive files as containers, not mysterious PDFs.

Deliverables:

- safe ZIP unpack planning;
- zip-slip protection;
- file-count and expanded-byte limits;
- compression-ratio protection;
- rejected-entry ledger;
- original archive lineage.

The output of ZIP intake must be the same candidate shape used by browser
upload. ZIP should be an adapter, not a parallel upload system.

### Phase 4: Email Intake

Goal: ingest email evidence without confusing email body, headers, and
attachments.

Deliverables:

- `.eml` adapter;
- body-as-source policy;
- attachment candidate policy;
- thread metadata preservation;
- sender/date/subject metadata;
- clear handling of inline images and signature attachments.

Email should not bypass intake. It should feed the same intake core.

### Phase 5: Connector-Ready Intake

Goal: prepare for Gmail, Drive, Dropbox, or future connectors without building
them prematurely.

Deliverables:

- adapter contract for remote files;
- idempotency keys for external objects;
- cursor/checkpoint model;
- permission and audit boundary;
- "selected remote files" to candidate-file stream.

No connector should be allowed to write matter artifacts directly.

### Phase 6: Optional Service Split

Goal: split intake into a separately deployable service only if the internal
boundary is already proven.

Triggers for a split:

- upload traffic needs separate scaling;
- object storage direct upload needs a different security boundary;
- background import jobs need independent workers;
- Matter Workbench runtime should no longer handle upload bodies at all.

If split, the service can remain Node. Python can be added for specialist
processing workers where it earns its keep, such as PDF repair, OCR
preprocessing, or document classification.

## User Experience Shape

The lawyer should not see this architecture.

The lawyer should see:

- "Add files";
- "Uploading";
- "Checking files";
- "Some files need attention";
- "Ready to prepare";
- "Upload fewer files and try again" when a batch is too large.

Avoid exposing words like:

- object storage;
- bytea;
- multipart;
- worker;
- custody row;
- import batch id.

Operator and developer views can expose the precise codes and diagnostics.

## Data Model Direction

The durable model should have these conceptual records:

- `intake_batches`: one logical incoming batch;
- `intake_candidates`: every file-like candidate seen before import;
- `intake_rejections`: candidates rejected with stable reasons;
- `storage_objects`: durable bytes or object references;
- `documents`: accepted matter documents;
- `matter_import_items`: mapping from candidate to source identity;
- `processing_jobs`: background import and preparation steps;
- `incidents` or signals: upload/import failures worth operator attention.

Existing tables already cover parts of this. The design should prefer extending
current runtime DB concepts over inventing a second custody model.

## Error Codes

Stable codes matter because they make telemetry, support, and UI behavior
predictable.

Examples to preserve or introduce:

| Code | Meaning |
| --- | --- |
| `upload.no_files_attached` | User submitted a matter without files. |
| `upload.invalid_matter_name` | Matter caption cannot produce a safe identity. |
| `upload.duplicate_paths` | Two uploaded files resolve to the same relative path. |
| `upload.too_large` | One HTTP upload batch exceeds the configured limit. |
| `intake.container_too_large` | Archive expansion exceeds policy. |
| `intake.unsafe_container_path` | Archive entry attempts path escape. |
| `intake.duplicate_content` | Candidate content already exists in this matter. |
| `intake.import_failed` | Candidate was accepted but import job failed. |

Codes should be visible to operators and telemetry. Lawyers should get short,
plain-language action text.

## Telemetry And Mothership

The intake boundary should produce high-value signals:

- upload batch started/completed/failed;
- file count and size bucket;
- rejection counts by code;
- duplicate counts;
- import job duration;
- retry count;
- OOM-prevention events such as `upload.too_large`;
- slow upload warnings;
- browser-side file hashing unavailable.

Telemetry should never include raw document text or source bytes. In
firm-internal beta mode it may include richer operational metadata, but secrets
must still be redacted.

## Testing Strategy

Tests should grow around contracts, not only around implementation files.

Required test classes:

- planner parity tests for filesystem and runtime DB storage;
- candidate-shape tests for browser upload, ZIP, and email adapters;
- duplicate-path and duplicate-content tests;
- oversized upload tests;
- retry/idempotency tests;
- storage-object custody tests;
- import job state transition tests;
- UI tests for user-facing batch/retry language;
- telemetry tests for stable codes and safe metadata.

Every new adapter must prove:

```text
adapter input -> common intake candidates -> same intake core -> same handoff
```

## What This Is Not

This workstream is not:

- a public file-sharing product;
- a general Dropbox clone;
- a billing/credit feature;
- a replacement for OCR or extraction;
- a new legal reasoning engine;
- a reason to add Python to the hot path immediately;
- a promise that one huge browser upload should always work.

It is the custody and import boundary for legal source material.

## Initial Implementation Slice

The first code slice should be intentionally boring:

1. Create the intake module boundary.
2. Move only contract-shaped upload concepts into it.
3. Preserve current browser upload behavior.
4. Add tests proving no behavior drift.
5. Add one operator-facing report that summarizes intake pressure and failures.

No ZIP. No email. No connector. No separate service. No new deployment unit.

## Acceptance Criteria For Phase 1

Phase 1 is complete when:

- the current browser upload path still passes existing tests;
- `services/upload-service.mjs` no longer needs to know low-level intake policy;
- runtime DB and filesystem modes consume the same intake contract;
- stable error codes remain unchanged;
- docs clearly separate upload UI, intake custody, and legal preparation;
- no new provider calls or legal artifacts are introduced;
- the branch can be merged without changing the deployed beta behavior.

## Design Decision

Use Option A:

```text
same repo, separate branch/worktree, internal service-shaped module first
```

Treat email, ZIPs, Gmail, Drive, and other sources as later source adapters that
feed the same intake core.

Only split into a separate deployed service after the internal boundary proves
itself under tests and beta usage.
