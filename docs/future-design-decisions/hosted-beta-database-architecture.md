# Future Design Decision: Hosted Beta Database Architecture

Date: 2026-05-18
Status: Planning note

## Why This Exists

Matter Workbench began as a local-first legal workbench. That was the right
shape for proving the core workflow:

```text
matter folder -> intake -> extraction -> source labels -> list of dates
```

The current app can reason from local artifacts such as `matter.json`,
`File Register.csv`, `Extraction Log.csv`, `Source Index.json`, and List of
Dates outputs. That is understandable, inspectable, and good for a single
operator on one machine.

Hosted beta changes the problem.

If selected members of a firm use the product, and each member may have 500+
matters, the product is no longer just a local document workbench. It becomes a
multi-user legal matter system. The hard questions become:

- who owns each matter;
- who can access it;
- where original documents live;
- which processing jobs have run;
- what failed;
- which generated artifact is current;
- what needs developer or operator attention;
- how data can be recovered, audited, exported, or deleted.

The database is therefore not only a performance tool. It is the operational
memory of the hosted product.

## Core Decision

Use a tenant/workspace model in the database from day one, even if the first
beta user experience behaves like isolated personal accounts.

The practical shape is:

```text
workspace/firm tenant underneath
single-user sandbox experience on top for early beta
```

This means the first beta can still feel simple:

```text
user -> matters -> documents -> artifacts
```

But the durable data model should still allow:

```text
workspace -> members -> matters -> documents -> jobs -> artifacts
```

The name can be `workspace` in code and UI if `firm` feels too heavy early on.
For a legal product, though, the concept should preserve firm-style ownership:
matters often belong to a firm or team, not permanently to one lawyer's login.

## Why Not Pure User Isolation

Pure user isolation is tempting for beta because it is simpler:

```text
users
matters.user_id
documents.user_id
```

That gives each beta user a private sandbox. It reduces early permissions work
and avoids firm administration screens.

The problem is that legal work rarely stays personal:

- a partner, associate, clerk, and paralegal may work on the same matter;
- the same matter may be uploaded twice by different firm members;
- a user may leave the firm;
- a firm may need to recover matter data;
- a future admin may need audit and deletion controls;
- collaboration becomes a painful retrofit if every table assumes one owner.

The first schema should avoid that trap. It can create one workspace per beta
user, but the rows should still carry `workspace_id`. That gives user-isolated
behavior today without blocking firm ownership tomorrow.

## Current Local Model

Current Matter Workbench state is mostly file-backed:

```text
matters home/
  Matter Name/
    matter.json
    00_Inbox/
      Intake 01 - Initial/
        File Register.csv
        Extraction Log.csv
        Originals/
        By Type/
        _extracted/
    10_Library/
      Source Index.json
      List of Dates.md
      List of Dates.json
```

The server selects a matters home, lists matter folders, reads `matter.json`,
and derives matter status from artifacts on disk. This is a good local
contract, but hosted beta needs a database-backed control plane.

The local artifact shape should still influence the hosted design. It already
has useful boundaries:

- matter metadata;
- intakes;
- file registers;
- extraction records;
- source labels;
- chronology artifacts;
- rerun and attention signals.

The hosted database should not erase these concepts. It should make them
queryable, permissioned, auditable, and recoverable.

## Recommended Hosted Shape

Use four storage layers:

```text
Postgres
  operational source of truth

Object storage
  original documents, extracted text payloads, generated artifacts

Queue/workers
  long-running extraction, OCR, source labeling, chronology, and custom skills

Search index
  full-text search first, vector search later where useful
```

Postgres should know what exists and who can access it. It should not hold large
PDFs, images, Word documents, or generated markdown blobs directly unless there
is a narrow reason.

Object storage should hold:

- original uploaded files;
- normalized working copies when needed;
- OCR outputs;
- full extraction record payloads if too large for normal rows;
- source index artifacts;
- list-of-dates artifacts;
- export files.

Postgres stores stable pointers to those objects plus checksums, versions,
ownership, status, and audit metadata.

## First Data Model

The first durable schema should include these tables or equivalent entities.

### Tenancy And Identity

```text
workspaces
users
workspace_memberships
```

`workspaces` is the tenant boundary. In early beta, each user can receive their
own workspace automatically. Later, multiple users can belong to the same firm
workspace.

Useful fields:

- `workspaces.id`
- `workspaces.name`
- `workspaces.type` such as `personal_beta`, `firm`, `internal_test`
- `users.id`
- `users.email`
- `users.name`
- `workspace_memberships.role` such as `owner`, `admin`, `member`, `viewer`
- `workspace_memberships.status`

### Matters

```text
matters
matter_memberships
```

Every matter belongs to a workspace. Optional `matter_memberships` allow
matter-level sharing later without changing the main matter table.

Useful fields:

- `matters.id`
- `matters.workspace_id`
- `matters.created_by_user_id`
- `matters.name`
- `matters.client_name`
- `matters.opposite_party`
- `matters.matter_type`
- `matters.jurisdiction`
- `matters.brief_description`
- `matters.status`
- `matters.archived_at`

For early beta, access can be:

```text
user can access matter if user is a member of matter.workspace_id
```

Matter-level memberships can remain unused until collaboration is required.

### Intakes And Documents

```text
matter_intakes
documents
document_versions
```

An intake represents a batch of files added to a matter. A document represents
the logical file. A document version represents a specific uploaded blob or
normalized copy.

Useful fields:

- `matter_intakes.id`
- `matter_intakes.matter_id`
- `matter_intakes.label`
- `matter_intakes.received_at`
- `matter_intakes.created_by_user_id`
- `documents.id`
- `documents.matter_id`
- `documents.intake_id`
- `documents.file_id` such as `FILE-0001`
- `documents.original_name`
- `documents.category`
- `documents.sha256`
- `documents.size_bytes`
- `documents.duplicate_of_document_id`
- `documents.status`
- `document_versions.object_key`
- `document_versions.mime_type`
- `document_versions.version_kind` such as `original`, `working_copy`, `ocr_text`

The current local `FILE-NNNN` idea should survive. Lawyers and artifacts need a
stable source identity. In the hosted model, `FILE-NNNN` can remain unique
inside a matter while the database primary key remains globally unique.

### Extraction And Source Labels

```text
extraction_records
source_descriptors
```

Extraction records can be split: summary fields in Postgres, full block payload
in object storage or a JSONB column depending on size.

Useful fields:

- `extraction_records.document_id`
- `extraction_records.status`
- `extraction_records.engine`
- `extraction_records.page_count`
- `extraction_records.ocr_applied`
- `extraction_records.needs_review`
- `extraction_records.payload_object_key`
- `source_descriptors.document_id`
- `source_descriptors.display_label`
- `source_descriptors.short_label`
- `source_descriptors.document_type`
- `source_descriptors.document_date`
- `source_descriptors.needs_review`
- `source_descriptors.ai_run_id`

This keeps the current Source Index concept but makes source labels queryable.

### Jobs And Provider Runs

```text
processing_jobs
provider_runs
```

Long-running work should not be modeled as a request/response event. Upload,
extraction, OCR, source labeling, and list-of-dates generation all need durable
job state.

Useful fields:

- `processing_jobs.id`
- `processing_jobs.workspace_id`
- `processing_jobs.matter_id`
- `processing_jobs.kind` such as `matter_init`, `extract`, `describe_sources`,
  `create_listofdates`
- `processing_jobs.status` such as `queued`, `running`, `succeeded`, `failed`,
  `cancelled`
- `processing_jobs.started_at`
- `processing_jobs.finished_at`
- `processing_jobs.error_code`
- `processing_jobs.error_message`
- `processing_jobs.created_by_user_id`
- `provider_runs.provider`
- `provider_runs.model`
- `provider_runs.prompt_version`
- `provider_runs.input_artifact_id`
- `provider_runs.output_artifact_id`
- `provider_runs.usage_json`
- `provider_runs.status`

Provider runs matter because legal output must remain auditable. When a List of
Dates was generated, the system should know the model, provider, prompt
version, source inputs, output artifact, and failure mode.

### Artifacts

```text
matter_artifacts
```

Generated outputs should be registered, even if the actual file lives in object
storage.

Useful fields:

- `matter_artifacts.id`
- `matter_artifacts.workspace_id`
- `matter_artifacts.matter_id`
- `matter_artifacts.kind` such as `source_index`, `list_of_dates_json`,
  `list_of_dates_markdown`, `context_packet`, `export_pdf`
- `matter_artifacts.schema_version`
- `matter_artifacts.object_key`
- `matter_artifacts.content_hash`
- `matter_artifacts.created_by_job_id`
- `matter_artifacts.is_current`
- `matter_artifacts.created_at`

Only one artifact of a kind may be current for a matter unless the product
explicitly supports multiple named versions.

### Attention And Incidents

```text
matter_attention_items
```

The local app already has a matter attention direction. Hosted beta should make
attention durable, not only derived at read time.

Useful fields:

- `matter_attention_items.id`
- `matter_attention_items.workspace_id`
- `matter_attention_items.matter_id`
- `matter_attention_items.category`
- `matter_attention_items.severity`
- `matter_attention_items.status` such as `open`, `resolved`, `ignored`
- `matter_attention_items.title`
- `matter_attention_items.detail`
- `matter_attention_items.evidence_ref`
- `matter_attention_items.created_by_job_id`
- `matter_attention_items.resolved_at`

This is how developers notice failing matters before lawyers have to complain.

### Audit

```text
audit_events
```

Legal products need a durable record of important operations:

- user invited;
- user removed;
- matter created;
- document uploaded;
- document deleted;
- AI job started;
- AI artifact generated;
- artifact exported;
- permission changed.

Audit events should be append-only. They should reference workspace, user,
matter, and target entity where applicable.

## Access Control Rule

The first access-control invariant should be simple and strict:

```text
Every matter, document, job, artifact, attention item, and audit event must
belong to exactly one workspace.
```

Every query should be scoped by `workspace_id`, either directly or through a
joined matter/document.

This avoids the most common hosted-app mistake: building features first and
then trying to bolt tenant isolation onto queries later.

## Beta Simplification

The first hosted beta does not need full firm administration.

Acceptable first behavior:

- each beta user gets one workspace;
- each workspace has one owner member;
- matters are visible only to that workspace owner;
- no sharing UI;
- no firm admin UI;
- no cross-user collaboration.

But the schema still carries `workspace_id`.

That keeps the beta experience personal while preserving the data model needed
for real firm deployment.

## Migration Strategy From Local App

Do not rewrite everything at once.

Use the database first as a control plane:

1. User creates a hosted matter.
2. Database creates the matter row.
3. Upload creates document rows and stores blobs in object storage.
4. Worker runs intake/extraction/source labeling.
5. Worker writes generated payloads to object storage.
6. Worker registers artifacts, jobs, provider runs, and attention items in
   Postgres.
7. UI reads matter status from Postgres instead of scanning local files.

The current file contracts can still be used inside workers as an implementation
detail. For example, a worker may materialize a temporary matter folder, run an
existing engine, validate the output, then persist the result back into object
storage and Postgres.

This reduces risk because the trusted engines do not all need to be rewritten
before the hosted architecture exists.

## Search Direction

Start with Postgres full-text search or a simple external search index over:

- matter metadata;
- document labels;
- extracted text;
- citation blocks;
- generated artifact summaries.

Vector search can come later. It should not replace citation discipline.

The legal search rule should remain:

```text
Search results must point back to source identity and citation location.
```

If a result cannot be tied back to a document, page, block, or artifact, it is
not useful enough for legal work.

## Security And Privacy Guardrails

Hosted beta must treat legal documents as sensitive by default.

Minimum guardrails:

- tenant-scoped queries;
- private object storage buckets;
- signed URLs with short expiry;
- encryption at rest;
- TLS everywhere;
- audit events for sensitive actions;
- deletion/export policy defined before firm beta;
- provider calls logged with model and artifact references;
- no provider secret leakage to frontend responses;
- no public static serving of uploaded matter documents;
- backups tested, not merely enabled.

The product should also make provider behavior explicit. If text leaves the
system for OCR, source labeling, or chronology generation, that needs a clear
operational record.

## Non-Goals For The First Hosted Slice

Do not start with:

- complex firm hierarchy;
- practice-group permissions;
- document-level sharing controls;
- real-time collaborative editing;
- full legal document management replacement;
- automatic cross-matter knowledge graph;
- vector search as the first source of truth;
- database storage of raw large files;
- rewriting all local engines before proving hosted job flow.

Those may matter later. The first hosted slice should prove secure tenancy,
matter upload, job execution, artifact registry, and developer-visible failure
state.

## First Implementation Slice

The first slice should be:

```text
hosted matter catalogue + document upload metadata + durable job ledger
```

Acceptance criteria:

- a user can sign in;
- the user has a workspace;
- the user can create a matter;
- uploaded documents are stored outside Postgres;
- Postgres records each document, checksum, size, and object key;
- an extraction job can be queued;
- job status survives server restart;
- failures are visible on the matter;
- every query is workspace-scoped;
- no user can access another workspace's matter by changing an ID in the URL.

Only after this slice should `/describe_sources` and `/create_listofdates`
move into the hosted job pipeline.

## Open Product Questions

These need owner judgment before a firm beta:

- Is the beta legally a personal sandbox or a firm workspace?
- Who can delete a matter?
- Who can export a matter?
- What happens when a user leaves the firm?
- Should firm admins see all matters by default?
- How long are uploaded originals retained?
- Are provider calls allowed for all uploaded documents or only after explicit
  user confirmation?
- What is the data deletion promise to beta users?
- Is the product allowed to train or tune anything from user matter data? The
  safest default is no.

## Summary

The database should not be treated as a bigger version of the local matter
folder. It should be the hosted product's control plane.

Use Postgres for ownership, permissions, job state, artifact registry,
attention items, provider runs, and audit. Use object storage for large files
and generated payloads. Use workers for long-running legal processing. Keep
source identity and citation discipline from the current local architecture.

The design should look user-isolated in early beta if that keeps rollout
simple, but it should be workspace-scoped underneath so the product can grow
into real firm use without a painful tenancy migration.
