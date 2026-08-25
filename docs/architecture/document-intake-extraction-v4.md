# V4 Document Intake & Extraction Service

Status: isolated implementation; not integrated, deployed, or production-ready  
Date: 2026-08-24  
Branch: `feature/document-intake-extraction-v4`

## Objective

Replace the legacy upload/extraction runtime with one provider-neutral asynchronous service that can accept up to 500 PDFs, 10,000 pages, and 2 GB while preserving legal completeness, provenance, restart safety, and honest progress. The processing objective after durable batch custody is P95 ≤60 seconds and P99 ≤120 seconds. These are certification gates, not current performance claims.

## Boundary

```text
Matter Workbench
  users · tenants · matters · permissions · UI · legal workflows
                         │
                         │ versioned commands/events/results only
                         ▼
Document Intake & Extraction Service
  custody · dedup · work graph · routing · validation · cost · assembly
       │                    │                       │
       ▼                    ▼                       ▼
object storage         PostgreSQL              stateless workers
                                               provider adapters
```

Matter Workbench must not call providers or read processing tables. V4 must not import legacy extraction, production routes, React, or runtime-DB processing services. Until explicit integration approval, production must have no V4 caller and the private-beta deploy must exclude V4 executable directories.

## Data ownership

- **Object storage:** versioned staged uploads, content-addressed source blobs, page artifacts, and versioned result artifacts. The S3-compatible boundary uses short-lived direct PUT authorization, explicit region/encryption headers, requires a staging version ID, streams that exact version through size/SHA-256 verification, promotes that same version with create-only intent, checkpoints custody before best-effort staging cleanup, and remains replayable after cleanup failure. Large reads must stream to bounded worker scratch rather than enter process memory. Production certification must additionally prove bucket versioning, blob-prefix write denial/object lock, lifecycle cleanup, encryption keys, and regional posture.
- **Control plane:** logical upload provenance, intake/batch state, hashed upload-authorization tokens, document-to-blob references, computation fingerprints, durable page work, leases, attempts, cost events, validation outcomes, result versions, capacity requests, append-only audit, and outbox events. Raw upload tokens are returned once and never persisted. Audit details are size-bounded and reject filename, path, document text/content, credential, and token-shaped keys.
- **Workers:** bounded encrypted scratch only. The scratch boundary streams instead of buffering large blobs, reserves minimum free disk, prevents path traversal, re-verifies SHA-256, deletes allocations after success/failure, and scavenges abandoned allocations. Volume/container encryption remains an infrastructure requirement. A worker can disappear without losing authoritative state or requiring completed paid work to be repeated.
- **Matter Workbench:** tenant/matter identity, permissions, user-facing state, and references to published normalized results.

## Custody and computation

1. Matter Workbench requests an intake using the v1 contract.
2. The service returns short-lived object upload authorizations; bytes do not transit through the application VM.
3. Each uploaded file is server-verified for expected size and SHA-256, promoted to content-addressed immutable custody, and assigned logical provenance.
4. Exact-byte duplicates share the blob and fingerprinted computation, but retain separate names, paths, uploader context, and matter audit records.
5. Pages become durable work units as soon as an individually verified file is available. Speculative processing may overlap the rest of the upload.
6. Final result publication is forbidden until the whole batch reaches durable custody commit.
7. Each page finishes as `accepted` or `review_required`; neither failure nor review permits silent omission.

## Routing and validation

Routing selects capabilities rather than mandatory stages. Native extraction, Mistral, Gemini, Textract, and future local/GPU implementations are adapters behind the same provider-result contract. Isolated HTTP adapters now exist for pinned `mistral-ocr-4-1` single pages and document-local ranges plus `gemini-3.7-flash` LOW repair pages; they use bounded inputs, hard timeouts, structured output, request IDs, redacted errors, and measured per-page/token cost including Gemini thinking tokens. They are evidence-only and have made no provider calls in V4. Provider, pinned model, adapter version, route policy, validator version, source hash, and page number form the computation fingerprint.

Completeness and legal-critical validation are hard gates. Suspicious primary output and its cost checkpoint are committed in the same PostgreSQL transaction that creates a fingerprinted selective-repair computation, adds every affected intake demand, repoints each logical page, and records many-to-many supersession lineage. Unknown billing after a lost lease or incomplete provider checkpoint remains `unknown_requires_reconciliation`; a tenant-scoped restricted function can convert it to measured evidence only once (or replay the exact same reconciliation) against a non-secret billing reference, with an append-only audit event. Accepted neighbors are not repaired; a repair page still ends explicitly as `accepted` or `review_required`. Only accepted candidates compete using the 70% quality / 30% speed preference. Every provider attempt—including throttles, retries, failures, speculative work, and failover—must be attributed for latency, usage, and billed/logical cost.

## Scheduling and scale

The production control plane will use owned PostgreSQL state and leased/fenced page work. The scheduler creates only contiguous same-document tasks with one pinned capability and bounds them by pages, bytes, and predicted time; an oversize single page remains visible as an explicit exception. PostgreSQL can atomically claim up to 32 consecutive compatible pages with independent lease tokens and attempt records. Hierarchical weighted fairness prevents multiple matters under one tenant from multiplying that tenant's share and retains a bounded small-job/priority boost. A capability-specific token bucket and concurrency permit is acquired before durable work is claimed, so exhausted capacity does not consume an attempt or hold a lease; 429 feedback halves concurrency, enforces cooldown, and recovers additively after sustained success. Stateless workers reserve private scratch, re-verify blob SHA-256 while streaming, materialize only the claimed page or range, and clean every allocation. A small pre-warmed worker baseline protects latency; predicted page/byte volume and upload progress start burst workers before batch commit.

Every intake persists one bounded workload class (`mixed_legal`, `born_digital_legal`, `archival_legal`, or `evaluation`) in its idempotency fingerprint. The capacity planner combines upload progress, class-specific corpus page density/route mix, completed/running weighted work, deduplicated queue depth, rolling provider throughput/throttling/failure, local worker throughput, scratch capacity, and boot latency. Corpus and provider observations are tenant-scoped PostgreSQL records; workers persist success, failure, and throttle outcomes, and restart reconstructs bounded rolling models without treating failed calls as throughput. Predictive scale decisions become tenant-scoped, fingerprint-idempotent PostgreSQL requests scheduled inside the remaining upload window; a fenced manager calls an injected regional provisioner with a stable generation key, persists observed capacity, retries sanitized failures, and treats a newer generation as superseding stale ownership. A durable progress projection exposes upload ETA separately, processing ETA as a range, completion ratio, worker/provider capacity, scale action, confidence, and named exceptions; after 120 seconds it emits an explicit objective-breached reason, while ready jobs freeze at zero. Workload classes remain separate so PDFEval-like and large mixed legal corpora do not share one misleading density assumption.

The independent PostgreSQL migration chain now defines the durable ownership model: forced tenant RLS, manifest-fingerprinted idempotent intake/file manifests, global immutable blobs plus tenant references, logical documents, tenant-scoped fingerprinted page computations, weighted demands, many-to-many repair lineage, fenced `SKIP LOCKED` leases, provider attempts, complete cost events, extraction result versions, idempotent outbox delivery, and capacity observations. PostgreSQL repositories implement intake replay/conflict detection, raw-token-free upload authorization, atomic custody references/counters, batch commit, duplicate logical documents sharing single-flight computations, selective repair, and fenced outbox checkpoints. The migration never touches legacy Matter Workbench tables. A disposable-real-PostgreSQL integration test verifies migration replay/checksums, fail-closed tenant context, cross-tenant denial, concurrent work stealing, lease-token renewal, document-local claims, duplicate computation reuse, primary-to-repair replacement, cost lineage, and outbox retry/delivery.

PostgreSQL worker/result repositories exercise the durable path through claim, active-attempt fencing, heartbeat, success/failure cost evidence, lease-expiry reconciliation, demand fulfillment, complete ordered assembly, intake/result publication, and outbox creation. The document-range worker turns a contiguous claim into one pinned Mistral OCR 4.1 call, allocates measured request usage/cost across every page attempt, then checkpoints each page under its own fence; publication errors cannot repeat completed provider work. A single-page worker remains available for selective capabilities such as repair.

An isolated composition root now joins durable PostgreSQL repositories, direct S3 custody, streaming `pdfinfo` preflight, Mistral document-range processing, Gemini selective repair, progress/ETA, authenticated HTTP, complete publication, and fenced outbox delivery. All infrastructure, provider, identity, and authorization adapters are injected; it reads no Matter Workbench runtime configuration and remains deliberately unmounted by Matter Workbench.

The filesystem HTTP service and in-memory calibration model remain useful reference paths for fast deterministic tests. Neither composition is a production claim: real S3 credentials/region, provider quota, multi-worker load, security review, expanded human quality, and shadow/soak evidence remain required before integration or cutover.

## Publication and integration

A versioned result contains every logical document in manifest order and every page in source order. Page outcomes carry text when available, review reasons, source hash, computation fingerprint, provider/model provenance, and validation version. The service emits a versioned `extraction.result.ready` outbox event. Tenant-scoped dispatchers claim with `SKIP LOCKED`, fence completion by lease token, send the event ID as receiver idempotency key, use bounded exponential retry for transient failures, and dead-letter permanent schema/auth rejection for operator action. Matter Workbench receives events and reads normalized results only through the public service API.

## Migration

1. Isolated service and benchmark evidence.
2. Integrated but disabled contracts and shadow ingestion.
3. Full quality, performance, quota, restart, outage, custody, security, and soak certification.
4. Explicit go/no-go; drain legacy jobs.
5. One-way cutover.
6. Remove legacy runtime and fix forward exclusively in V4.

There is no long-lived legacy execution fallback after cutover.

## Executable acceptance

The claim ledger is `docs/acceptance/document-intake-extraction-v4.matrix.json`.

Run the currently automated isolated evidence with:

```bash
node --test test/document-intake-extraction-v4*.test.mjs
```

An `automated` row is a narrow implemented claim backed by tests. A `pending_evidence` row is a production blocker and must never be represented as passed merely because the vertical slice works.
