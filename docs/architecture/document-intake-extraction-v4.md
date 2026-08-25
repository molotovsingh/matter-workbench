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

- **Object storage:** immutable staged uploads, content-addressed source blobs, page artifacts, and versioned result artifacts. The S3-compatible boundary uses short-lived direct PUT authorization, explicit region/encryption headers, streamed server-side size/SHA-256 verification, verified promotion, and staged-object deletion. Large reads must stream to bounded worker scratch rather than enter process memory.
- **Control plane:** logical upload provenance, intake/batch state, hashed upload-authorization tokens, document-to-blob references, computation fingerprints, durable page work, leases, attempts, cost events, validation outcomes, result versions, and outbox events. Raw upload tokens are returned once and never persisted.
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

Routing selects capabilities rather than mandatory stages. Native extraction, Mistral, Gemini, Textract, and future local/GPU implementations are adapters behind the same provider-result contract. Isolated HTTP adapters now exist for pinned `mistral-ocr-4-1` primary pages and `gemini-3.7-flash` LOW repair pages; they use bounded page inputs, hard timeouts, structured output, request IDs, redacted errors, and measured per-page/token cost including Gemini thinking tokens. They are evidence-only and have made no provider calls in V4. Provider, pinned model, adapter version, route policy, validator version, source hash, and page number form the computation fingerprint.

Completeness and legal-critical validation are hard gates. Only accepted candidates compete using the 70% quality / 30% speed preference. Every provider attempt—including throttles, retries, failures, speculative work, and failover—must be attributed for latency, usage, and billed/logical cost.

## Scheduling and scale

The production control plane will use owned PostgreSQL state and leased/fenced page work. The isolated scheduler now creates only contiguous same-document tasks with one pinned capability and bounds them by pages, bytes, and predicted time; an oversize single page remains visible as an explicit exception. Hierarchical weighted fairness prevents multiple matters under one tenant from multiplying that tenant's share, retains a bounded small-job/priority boost, and admits tasks only against live capability budgets. A small pre-warmed worker baseline protects latency; predicted page/byte volume and upload progress start burst workers before batch commit. Provider admission follows live quotas, throttling, latency, and route capacity.

The isolated capacity planner combines upload progress, corpus page density/route mix, queue depth, rolling provider throughput/throttling, local worker throughput, scratch capacity, and boot latency. It emits ranges and named exception reasons rather than a false precise countdown, and uses the remaining upload window to request burst workers. Its rolling calibrator keeps workload classes separate so PDFEval-like and large mixed legal corpora do not share one misleading density assumption.

The independent PostgreSQL migration chain now defines the durable ownership model: forced tenant RLS, manifest-fingerprinted idempotent intake/file manifests, global immutable blobs plus tenant references, logical documents, tenant-scoped fingerprinted page computations, weighted demands, fenced `SKIP LOCKED` leases, provider attempts, complete cost events, extraction result versions, idempotent outbox delivery, and capacity observations. PostgreSQL repositories implement intake replay/conflict detection, raw-token-free upload authorization, atomic custody references/counters, batch commit, duplicate logical documents sharing single-flight computations, and fenced outbox checkpoints. The migration never touches legacy Matter Workbench tables. A disposable-real-PostgreSQL integration test verifies migration replay/checksums, fail-closed tenant context, cross-tenant denial, concurrent work stealing, lease-token renewal, duplicate computation reuse, and outbox retry/delivery.

The current filesystem adapters and in-memory calibration model are deliberately isolated vertical-slice references. They prove state transitions, restart semantics, and capacity decisions but are not multi-process production substitutes for the new PostgreSQL schema, S3-compatible storage, and durable telemetry. Moving the runtime service onto dedicated PostgreSQL repositories remains a later milestone.

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
