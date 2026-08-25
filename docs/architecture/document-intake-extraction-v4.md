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

- **Object storage:** immutable staged uploads, content-addressed source blobs, page artifacts, and versioned result artifacts.
- **Control plane:** logical upload provenance, intake/batch state, document-to-blob references, computation fingerprints, durable page work, leases, attempts, cost events, validation outcomes, result versions, and outbox events.
- **Workers:** bounded encrypted scratch only. A worker can disappear without losing authoritative state or requiring completed paid work to be repeated.
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

Routing selects capabilities rather than mandatory stages. Native extraction, Mistral, Gemini, Textract, and future local/GPU implementations are adapters behind the same provider-result contract. Provider, pinned model, adapter version, route policy, validator version, source hash, and page number form the computation fingerprint.

Completeness and legal-critical validation are hard gates. Only accepted candidates compete using the 70% quality / 30% speed preference. Every provider attempt—including throttles, retries, failures, speculative work, and failover—must be attributed for latency, usage, and billed/logical cost.

## Scheduling and scale

The production control plane will use owned PostgreSQL state and leased/fenced page work. Scheduling is weighted-fair across tenants/matters, preserves a small-job fast lane, and prefers same-document provider ranges. A small pre-warmed worker baseline protects latency; predicted page/byte volume and upload progress start burst workers before batch commit. Provider admission follows live quotas, throttling, latency, and route capacity.

The current filesystem adapters are deliberately an isolated vertical-slice reference. They prove state transitions and restart semantics but are not multi-process production substitutes for PostgreSQL and S3-compatible storage.

## Publication and integration

A versioned result contains every logical document in manifest order and every page in source order. Page outcomes carry text when available, review reasons, source hash, computation fingerprint, provider/model provenance, and validation version. The service emits an idempotent versioned `extraction.result.ready` outbox event. Matter Workbench receives events and reads normalized results only through the public service API.

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
