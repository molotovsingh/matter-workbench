# Future Design Decision: Hosted Beta Database Architecture

Date: 2026-05-19
Status: Implementation contract draft

## Purpose

This note defines the first hosted-beta data contract for Matter Workbench:

- what the hosted control plane must own;
- what remains in object storage;
- how tenant isolation works;
- how upload, job, provider, artifact, and diagnostic state should be modeled;
- what the first implementation slice must prove before legal workflow engines
  move into hosted workers.

This is not a full product roadmap. It is the minimum database and worker
contract needed to avoid painting the hosted beta into a corner.

## Core Decisions

1. Use Postgres as the hosted control plane.
2. Use private object storage for original files, normalized files, extraction
   payloads, generated artifacts, exports, and large derived payloads.
3. Use durable jobs and workers for extraction, OCR, source labels, List of
   Dates, exports, and future configurable skills.
4. Use a tenant model underneath even if early beta looks like one private
   account per user.
5. Treat Matter Attention as a projection over canonical incidents, failures,
   validation results, and jobs. Do not make attention itself the main source of
   truth.
6. Keep source identity and citation discipline from the local app:
   `FILE-NNNN` remains matter-scoped; raw citations remain audit handles;
   lawyer-readable labels remain presentation handles.

## Naming Rule

Avoid using `workspace` as the internal database concept.

This repo already uses "workspace" for the matter file browser, lanes, and
preview surface:

- `services/workspace-service.mjs`
- `shared/workspace-lanes.mjs`
- `react-ui/src/components/workspace/WorkspaceTree.tsx`

For hosted tenancy, use one of these internally:

```text
tenants
tenant_memberships
```

The UI can later say "workspace" if that tests better, but the database and
backend authorization layer should call the boundary a tenant. That avoids
confusing the hosted ownership boundary with the local matter workspace tree.

## Storage Roles

### Postgres

Postgres owns:

- tenant membership and access control;
- matter metadata;
- document identity;
- upload state;
- object pointers and checksums;
- extraction/source-label/artifact registry rows;
- job state;
- provider run metadata;
- cost metadata;
- validation results;
- incidents;
- audit events;
- acknowledgement/resolution state.

Postgres should not store large PDFs, images, Word documents, long extracted
text payloads, generated Markdown bodies, or export blobs unless a narrow
exception is documented.

### Object Storage

Object storage owns:

- uploaded originals;
- normalized working copies, if needed;
- OCR output payloads;
- extraction record payloads or large text blocks;
- Source Index artifacts;
- List of Dates artifacts;
- export files;
- snapshots needed for dispatch/provenance.

All stored objects must have a Postgres row that records ownership, checksum,
state, and retention/deletion status.

### Queue And Workers

Workers own long-running work:

- intake normalization;
- extraction;
- OCR;
- source labeling;
- List of Dates;
- custom skill execution;
- exports;
- validation passes.

The web request should enqueue work and return durable job state. It should not
hold a user request open for a long legal-processing job.

## Tenant Isolation Contract

Every sensitive row must belong to exactly one tenant, directly or through an
explicit parent relation.

For hosted legal data, prefer denormalizing `tenant_id` onto tenant-scoped
tables even when it can be derived from `matter_id`. This makes RLS policies,
query review, debugging, and accidental ID-tampering tests simpler.

Tables that should carry `tenant_id` directly:

- `matters`
- `matter_memberships`
- `matter_intakes`
- `upload_sessions`
- `documents`
- `document_blobs`
- `extraction_records`
- `document_text_blocks`
- `source_descriptors`
- `processing_jobs`
- `provider_runs`
- `matter_artifacts`
- `artifact_validation_results`
- `incidents`
- `attention_acknowledgements`
- `cost_events`
- `audit_events`
- `job_outbox`

Access rule for the first hosted beta:

```text
user can access a matter only if user is an active member of matter.tenant_id
```

Matter-level sharing can be modeled with `matter_memberships`, but the first
beta does not need a sharing UI.

Acceptance test:

```text
Changing a matter/document/job/artifact id in the URL or request body must not
allow access to another tenant's data.
```

## First Schema Contract

This is not final SQL. It is the first implementation contract for table shape
and ownership.

### Tenancy And Users

```text
tenants
users
tenant_memberships
```

Required fields:

- `tenants.id`
- `tenants.name`
- `tenants.type`: `personal_beta`, `firm`, `internal_test`
- `tenants.created_at`
- `users.id`
- `users.email`
- `users.name`
- `users.status`
- `tenant_memberships.tenant_id`
- `tenant_memberships.user_id`
- `tenant_memberships.role`: `owner`, `admin`, `member`, `viewer`
- `tenant_memberships.status`: `active`, `invited`, `suspended`, `removed`

Early beta behavior:

```text
one user -> one personal_beta tenant -> all matters belong to that tenant
```

### Matters

```text
matters
matter_memberships
```

Required fields:

- `matters.id`
- `matters.tenant_id`
- `matters.created_by_user_id`
- `matters.name`
- `matters.client_name`
- `matters.opposite_party`
- `matters.matter_type`
- `matters.jurisdiction`
- `matters.brief_description`
- `matters.status`: `active`, `archived`, `deleted_pending`
- `matters.created_at`
- `matters.archived_at`
- `matter_memberships.tenant_id`
- `matter_memberships.matter_id`
- `matter_memberships.user_id`
- `matter_memberships.role`
- `matter_memberships.status`

### Intakes And Documents

```text
matter_intakes
upload_sessions
documents
document_blobs
```

`matter_intakes` represents a batch of files added to a matter.

`documents` represents the logical source document and stable matter-scoped
source identity.

`document_blobs` represents stored original/normalized file blobs. It must not
represent OCR text or extracted text.

Required fields:

- `matter_intakes.id`
- `matter_intakes.tenant_id`
- `matter_intakes.matter_id`
- `matter_intakes.label`
- `matter_intakes.received_at`
- `matter_intakes.created_by_user_id`
- `upload_sessions.id`
- `upload_sessions.tenant_id`
- `upload_sessions.matter_id`
- `upload_sessions.intake_id`
- `upload_sessions.idempotency_key`
- `upload_sessions.created_by_user_id`
- `upload_sessions.status`: `pending`, `uploading`, `uploaded`, `verified`,
  `partial_failed`, `failed`, `cancelled`
- `upload_sessions.expected_file_count`
- `upload_sessions.created_at`
- `upload_sessions.finished_at`
- `documents.id`
- `documents.tenant_id`
- `documents.matter_id`
- `documents.intake_id`
- `documents.file_number`
- `documents.file_id`: e.g. `FILE-0001`
- `documents.original_name`
- `documents.category`
- `documents.sha256`
- `documents.size_bytes`
- `documents.duplicate_of_document_id`
- `documents.status`: `pending_upload`, `uploaded`, `verified`, `duplicate`,
  `unsupported`, `failed`, `deleted_pending`
- `document_blobs.id`
- `document_blobs.tenant_id`
- `document_blobs.matter_id`
- `document_blobs.document_id`
- `document_blobs.blob_kind`: `original`, `normalized_working_copy`
- `document_blobs.object_key`
- `document_blobs.mime_type`
- `document_blobs.size_bytes`
- `document_blobs.sha256`
- `document_blobs.state`: `pending`, `uploaded`, `verified`, `failed`,
  `orphaned`, `deleted_pending`

Constraints:

```text
partial unique index: matters(tenant_id, lower(name)) where status = 'active'
unique(documents.matter_id, documents.file_number)
unique(documents.matter_id, documents.file_id)
unique(upload_sessions.tenant_id, upload_sessions.idempotency_key)
unique(document_blobs.tenant_id, document_blobs.object_key)
```

## FILE-NNNN Allocation

Hosted uploads can be concurrent. `FILE-NNNN` allocation must be database-owned.

Allowed patterns:

1. `matters.next_file_number` updated in a transaction with row lock.
2. A `matter_file_allocations` table with transaction-guarded allocation.
3. A database function that allocates the next matter-scoped number atomically.

Not allowed:

```text
read max(file_number) in application code -> add 1 -> insert later
```

Every document row must store both:

- `file_number`: integer, used for allocation and sorting;
- `file_id`: formatted `FILE-NNNN`, used for source identity and audit handles.

## Upload And Object Lifecycle

The upload flow must be idempotent and recoverable.

Required upload inputs:

- `tenant_id`
- `matter_id`
- `intake_id`
- idempotency key
- original file name
- size
- sha256, when available before upload

Required lifecycle:

```text
1. create upload session row
2. mark upload session uploading
3. for each file, create document row with status pending_upload
4. for each file, create document_blob row with state pending
5. upload object to private object storage
6. mark upload session uploaded when expected objects are stored
7. verify object checksum and size
8. mark document_blob verified
9. mark document uploaded or verified
10. mark upload session verified when expected files are verified
11. enqueue processing job through job_outbox
```

Failure handling:

- object upload succeeds but DB update fails:
  - object remains unreferenced or blob row remains non-verified;
  - cleanup job marks it `orphaned` or deletes it after retention window.
- DB rows exist but object upload fails:
  - document remains `pending_upload` or `failed`;
  - upload session becomes `failed` or `partial_failed`;
  - retry may reuse idempotency key;
  - no extraction job is enqueued.
- checksum mismatch:
  - blob state becomes `failed`;
  - document status becomes `failed`;
  - upload session becomes `failed` or `partial_failed`;
  - incident is recorded.

Acceptance tests:

- retrying the same upload idempotency key does not create duplicate documents;
- upload session status reflects `failed`, `partial_failed`, and `verified`
  outcomes;
- failed object verification does not enqueue extraction;
- orphaned object cleanup is observable;
- duplicate file hash within a matter records duplicate status without
  overwriting the first document identity.

## Extraction And Text

```text
extraction_records
document_text_blocks
```

`extraction_records` records the extraction run output and summary.

`document_text_blocks` stores queryable page/block metadata. The full text can
live in Postgres for bounded blocks or object storage for large payloads.

Required fields:

- `extraction_records.id`
- `extraction_records.tenant_id`
- `extraction_records.matter_id`
- `extraction_records.document_id`
- `extraction_records.document_blob_id`
- `extraction_records.status`: `queued`, `running`, `succeeded`, `failed`,
  `needs_ocr`, `unsupported`
- `extraction_records.engine`
- `extraction_records.engine_version`
- `extraction_records.page_count`
- `extraction_records.ocr_applied`
- `extraction_records.needs_review`
- `extraction_records.payload_object_key`
- `extraction_records.content_hash`
- `document_text_blocks.tenant_id`
- `document_text_blocks.matter_id`
- `document_text_blocks.document_id`
- `document_text_blocks.extraction_record_id`
- `document_text_blocks.page`
- `document_text_blocks.block`
- `document_text_blocks.citation`: e.g. `FILE-0001 p2.b4`
- `document_text_blocks.text`
- `document_text_blocks.text_object_key`, optional for large blocks

OCR text is extraction output. It is not a `document_blob` version.

## Source Labels

```text
source_descriptors
```

Required fields:

- `source_descriptors.id`
- `source_descriptors.tenant_id`
- `source_descriptors.matter_id`
- `source_descriptors.document_id`
- `source_descriptors.extraction_record_id`
- `source_descriptors.suggested_label`
- `source_descriptors.confirmed_label`
- `source_descriptors.label_status`: `suggested`, `confirmed`, `overridden`,
  `needs_review`
- `source_descriptors.label_source`: `model`, `filename`, `document_text`,
  `lawyer_override`
- `source_descriptors.confirmed_by_user_id`
- `source_descriptors.confirmed_at`
- `source_descriptors.document_type`
- `source_descriptors.document_date`
- `source_descriptors.needs_review`
- `source_descriptors.provider_run_id`

Rule:

```text
Changing only a label should refresh rendered artifacts when possible. It should
not automatically force AI chronology regeneration.
```

## Jobs, Outbox, And Provider Runs

```text
processing_jobs
job_outbox
provider_runs
```

`processing_jobs` is the user-visible job ledger.

`job_outbox` is the transaction boundary between Postgres state changes and
worker execution.

`provider_runs` records every model/provider call that can affect legal output,
validation, skill creation, or cost.

Required `processing_jobs` fields:

- `processing_jobs.id`
- `processing_jobs.tenant_id`
- `processing_jobs.matter_id`
- `processing_jobs.kind`: `intake`, `extract`, `ocr`, `source_labels`,
  `list_of_dates`, `label_refresh`, `custom_skill`, `export`, `validation`
- `processing_jobs.status`: `queued`, `running`, `succeeded`, `failed`,
  `cancelled`, `retrying`
- `processing_jobs.idempotency_key`
- `processing_jobs.created_by_user_id`
- `processing_jobs.started_at`
- `processing_jobs.finished_at`
- `processing_jobs.error_code`
- `processing_jobs.error_message`

Required `job_outbox` fields:

- `job_outbox.id`
- `job_outbox.tenant_id`
- `job_outbox.job_id`
- `job_outbox.event_type`
- `job_outbox.payload_json`
- `job_outbox.status`: `pending`, `claimed`, `published`, `failed`
- `job_outbox.created_at`
- `job_outbox.published_at`

Required `provider_runs` fields:

- `provider_runs.id`
- `provider_runs.tenant_id`
- `provider_runs.matter_id`, nullable only for tenant-level copilot,
  skill-creation, or skill-modification calls
- `provider_runs.job_id`
- `provider_runs.task_class`: `copilot`, `skill_creation`,
  `skill_modification`, `skill_execution`, `native_source_skill`,
  `validation`
- `provider_runs.provider`
- `provider_runs.model`
- `provider_runs.policy_prompt_version`
- `provider_runs.prompt_version`
- `provider_runs.input_artifact_id`
- `provider_runs.output_artifact_id`
- `provider_runs.status`: `started`, `succeeded`, `failed`, `cancelled`
- `provider_runs.error_code`
- `provider_runs.error_message`
- `provider_runs.usage_json`
- `provider_runs.input_tokens`
- `provider_runs.output_tokens`
- `provider_runs.cost_amount`
- `provider_runs.cost_currency`
- `provider_runs.cost_confidence`: `actual`, `estimated`, `planned`,
  `unknown`
- `provider_runs.approval_event_id`

No provider fallback should silently replace the model/policy selected for a
legal-output task.

Job idempotency constraints:

```text
unique(processing_jobs.tenant_id, processing_jobs.idempotency_key)
unique(job_outbox.tenant_id, job_outbox.job_id, job_outbox.event_type)
```

If a job type legitimately emits multiple events of the same type, add an
explicit `event_key` and include it in the outbox uniqueness rule. Do not rely
on worker-side de-duplication alone.

## Artifacts And Currentness

```text
matter_artifacts
artifact_validation_results
```

`matter_artifacts` registers generated outputs and durable snapshots. The body
usually lives in object storage.

Required fields:

- `matter_artifacts.id`
- `matter_artifacts.tenant_id`
- `matter_artifacts.matter_id`
- `matter_artifacts.artifact_family`: `source_index`, `list_of_dates`,
  `context_packet`, `draft`, `dispatch_copy`, `export`, `custom_skill_output`
- `matter_artifacts.mode`: e.g. `internal_review`, `court_filing`,
  `label_refresh`, `sample`, `default`
- `matter_artifacts.profile_key`: profile or audience key; use `default`
  instead of `null`
- `matter_artifacts.format`: `json`, `md`, `csv`, `pdf`, `docx`, `txt`
- `matter_artifacts.schema_version`
- `matter_artifacts.object_key`
- `matter_artifacts.content_hash`
- `matter_artifacts.created_by_job_id`
- `matter_artifacts.source_artifact_id`
- `matter_artifacts.source_index_hash`
- `matter_artifacts.extraction_snapshot_hash`
- `matter_artifacts.is_current`
- `matter_artifacts.created_at`

Currentness scope:

```text
partial unique index for current artifacts only:
(matter_id, artifact_family, mode, profile_key, format)
where is_current = true
```

Do not use only `(matter_id, kind)`. That is too coarse for internal chronology,
filing chronology, refresh-only output, court export, and future custom modes.

Do not make `profile_key` nullable unless the database index explicitly uses
`NULLS NOT DISTINCT`. Otherwise Postgres can allow multiple "current" artifacts
where `profile_key` is `NULL`.

`artifact_validation_results` records checks such as:

- schema validation;
- missing linked source labels;
- raw developer-name leakage in lawyer-visible output;
- stale source dependency;
- failed render/export;
- citation consistency.

Required fields:

- `artifact_validation_results.id`
- `artifact_validation_results.tenant_id`
- `artifact_validation_results.matter_id`
- `artifact_validation_results.artifact_id`
- `artifact_validation_results.validation_kind`
- `artifact_validation_results.status`: `passed`, `warning`, `failed`
- `artifact_validation_results.code`
- `artifact_validation_results.detail`
- `artifact_validation_results.evidence_ref`
- `artifact_validation_results.created_by_job_id`
- `artifact_validation_results.created_at`

## Incidents And Attention Projection

Canonical diagnostic facts should live in:

```text
processing_jobs
provider_runs
artifact_validation_results
incidents
audit_events
```

Attention should be a projection over those facts, plus acknowledgement state.

```text
incidents
attention_acknowledgements
preparation_advisory_snapshots
```

Required `incidents` fields:

- `incidents.id`
- `incidents.tenant_id`
- `incidents.matter_id`
- `incidents.source_type`: `job`, `provider_run`, `artifact_validation`,
  `system`, `manual`
- `incidents.source_id`
- `incidents.category`: `intake`, `extraction`, `source_labels`,
  `chronology`, `provider`, `custom_skill`, `artifact`, `security`, `system`
- `incidents.severity`: `blocker`, `warning`, `info`
- `incidents.status`: `open`, `resolved`
- `incidents.code`
- `incidents.title`
- `incidents.detail`
- `incidents.evidence_ref`
- `incidents.created_at`
- `incidents.resolved_at`

Required `attention_acknowledgements` fields:

- `attention_acknowledgements.id`
- `attention_acknowledgements.tenant_id`
- `attention_acknowledgements.matter_id`
- `attention_acknowledgements.incident_id`
- `attention_acknowledgements.user_id`
- `attention_acknowledgements.status`: `acknowledged`, `ignored`
- `attention_acknowledgements.note`
- `attention_acknowledgements.created_at`

Matter Attention API behavior:

```text
read canonical facts -> apply acknowledgement state -> return attention view
```

Do not write `matter_attention_items` as the primary diagnostic source. That
would create a stale second truth beside jobs, provider runs, and validation
results.

## Preparation Advisory Snapshots

Hosted beta should preserve the Preparation Advisory that was shown after a
matter preparation run. This is a QA/support feature, not a new truth source.

The advisory snapshot should be a durable rendering/projection record over
canonical facts:

```text
preparation_advisory_snapshots
```

Required fields:

- `preparation_advisory_snapshots.id`
- `preparation_advisory_snapshots.tenant_id`
- `preparation_advisory_snapshots.matter_id`
- `preparation_advisory_snapshots.preparation_run_id`
- `preparation_advisory_snapshots.generated_by_job_id`
- `preparation_advisory_snapshots.blocker_count`
- `preparation_advisory_snapshots.warning_count`
- `preparation_advisory_snapshots.info_count`
- `preparation_advisory_snapshots.incident_ids`
- `preparation_advisory_snapshots.artifact_validation_result_ids`
- `preparation_advisory_snapshots.rendered_summary_json`
- `preparation_advisory_snapshots.app_version`
- `preparation_advisory_snapshots.policy_versions_json`
- `preparation_advisory_snapshots.created_at`

Rules:

- advisory snapshots are append-only;
- resolving an incident does not rewrite an old advisory snapshot;
- a new preparation run creates a new advisory snapshot;
- the current matter attention view is still computed from canonical incidents,
  jobs, provider runs, and artifact validation results;
- snapshots are developer/support visible by default, not lawyer-facing by
  default.

Why preserve this:

- QA can compare whether extraction/source-label/chronology changes actually
  reduced warnings;
- beta-user bug reports can be tied to the exact advisory the user saw;
- future release notes can cite advisory deltas without reconstructing old
  transient UI state.

## Audit Events

```text
audit_events
```

Audit events are append-only.

Required fields:

- `audit_events.id`
- `audit_events.tenant_id`
- `audit_events.actor_type`: `user`, `worker`, `system`
- `audit_events.actor_user_id`, nullable for worker/system events
- `audit_events.matter_id`, nullable for tenant-level events such as
  invitation/removal
- `audit_events.action`
- `audit_events.target_type`
- `audit_events.target_id`
- `audit_events.ip_address`
- `audit_events.user_agent`
- `audit_events.metadata_json`
- `audit_events.created_at`

Must audit:

- user invitation/removal;
- matter creation/archive/delete request;
- document upload/delete request;
- provider job start/finish/failure;
- artifact generation/export/dispatch snapshot;
- permission changes;
- source label confirmation/override;
- cost approval events.

## Cost Governance

Cost is not billing in the first slice, but hosted beta must record enough to
avoid surprise spend.

```text
cost_events
```

Required fields:

- `cost_events.id`
- `cost_events.tenant_id`
- `cost_events.matter_id`, nullable for tenant-level or session-level costs
- `cost_events.provider_run_id`
- `cost_events.job_id`
- `cost_events.approval_event_id`
- `cost_events.scope`: `session`, `matter`, `tenant`
- `cost_events.amount`
- `cost_events.currency`
- `cost_events.confidence`: `actual`, `estimated`, `planned`, `unknown`
- `cost_events.input_tokens`
- `cost_events.output_tokens`
- `cost_events.provider`
- `cost_events.model`
- `cost_events.created_at`

The UI does not need a billing dashboard in the first slice. It does need enough
metadata to show paid-action confirmation, run receipts, and matter-level cost
summaries later.

## Hosted Execution Strategy Using Local Engines

Do not rewrite all engines first.

The first hosted worker can materialize a temporary matter workspace, run the
existing engine, validate output, then persist results back to object storage
and Postgres.

Required worker flow:

```text
1. claim processing job
2. create temporary isolated working directory
3. materialize required source blobs and metadata
4. run existing local engine
5. validate generated outputs
6. write artifact blobs to object storage
7. register artifacts, provider runs, validation results, incidents, cost
8. mark job succeeded or failed
9. clean temporary working directory
```

The local file contracts remain implementation details inside the worker. The
hosted UI reads Postgres and object pointers, not temporary disk paths.

## Importing Existing Local Matter Folders

This is separate from hosted execution.

Local-folder import is not required for the first hosted slice unless beta
users must bring existing Matter Workbench folders into the hosted product.

When implemented, import must:

- read `matter.json`;
- map local intake folders to `matter_intakes`;
- map `File Register.csv` rows to `documents`;
- allocate or preserve `FILE-NNNN` identities;
- upload originals/working copies to object storage;
- register extraction records, Source Index, List of Dates, and run metadata
  when present;
- preserve hashes and artifact provenance;
- report import warnings as incidents, not silently discard them.

If an imported `FILE-NNNN` collides with an existing hosted source identity for
the same matter, stop that import batch and record an incident. Do not silently
renumber source identities after import.

## Search Direction

First search should be deterministic and citation-preserving:

- Postgres full-text search, or a simple external search index;
- indexed matter metadata;
- document labels;
- extracted text blocks;
- citation blocks;
- artifact summaries.

Vector search can come later. It must not replace citation discipline.

Rule:

```text
Every legal search result must point back to source identity and citation
location.
```

## Security And Privacy Guardrails

Minimum hosted beta guardrails:

- tenant-scoped RLS or equivalent authorization on every sensitive table;
- private object storage buckets;
- short-lived signed URLs;
- encryption at rest;
- TLS everywhere;
- no public static serving of uploaded matter documents;
- provider keys never returned to frontend responses;
- provider calls logged with task class, model, policy, and artifact references;
- deletion/export policy defined before firm beta;
- backups tested, not merely enabled;
- audit events for sensitive actions;
- object cleanup for orphaned uploads;
- no training/tuning on user matter data unless explicitly approved by owner
  policy.

## First Implementation Slice

Build this first:

```text
hosted matter catalogue
+ tenant-scoped document upload
+ object lifecycle
+ durable extraction job ledger
+ incident projection
```

Acceptance criteria:

- user can sign in;
- user is assigned to one `personal_beta` tenant;
- user can create a matter;
- every matter row has `tenant_id`;
- user can upload files to a matter;
- each upload has an `upload_sessions` row and idempotency key;
- uploaded files are private object-storage blobs, not Postgres blobs;
- Postgres records document identity, checksum, size, object key, and state;
- `FILE-NNNN` is allocated transactionally per matter;
- duplicate upload by hash does not overwrite the original document identity;
- retrying the same upload idempotency key does not create duplicate documents;
- extraction job can be queued through `job_outbox`;
- job state survives server restart;
- failed jobs create canonical incidents;
- Matter Attention reads incidents/jobs/validation results as a projection;
- every API query is tenant-scoped;
- changing IDs in URL/body cannot access another tenant's matter;
- orphaned object cleanup can be observed;
- audit events exist for matter creation, upload, job enqueue, and failure.

Do not move `/describe_sources` or `/create_listofdates` into hosted workers
until this slice passes.

## Non-Goals For First Slice

Do not start with:

- firm admin UI;
- matter sharing UI;
- document-level sharing controls;
- real-time collaborative editing;
- full document-management replacement;
- automatic cross-matter knowledge graph;
- vector search as source of truth;
- court-facing export system;
- billing dashboard;
- rewriting all local engines.

## Open Product Owner Questions

These must be answered before firm beta:

- Is hosted beta legally a personal sandbox or a firm-owned workspace?
- Who can delete a matter?
- Who can export a matter?
- What happens when a user leaves a firm?
- Should firm admins see all matters by default?
- How long are uploaded originals retained?
- Are provider calls allowed for all uploaded documents, or only after explicit
  confirmation?
- What is the data deletion promise to beta users?
- Can beta operators view matter diagnostics that include document names?
- Is any training, tuning, or eval use of user matter data allowed? Safest
  default: no.

## Stop Rule

If implementation starts before the first-slice contract above is testable, the
team is likely building product screens on an unsafe hosted foundation.

The first hosted beta should prove:

```text
tenant isolation
+ private file custody
+ durable jobs
+ object lifecycle
+ canonical incidents
+ audit trail
```

Only then should hosted source labels, List of Dates, custom skills, exports,
and copilot-style work move onto the hosted path.
