# V4 Full-Envelope Load Certification

Status: **not certified**. The evaluator exists; production-shaped evidence does not.

## Hard envelope and clock

- 500 PDFs
- 10,000 logical pages
- 2 GiB source bytes
- processing clock starts only at durable batch custody commit
- P95 target: 60 seconds
- P99 target: 120 seconds
- upload ETA remains separate
- human review time remains separate

`services/document-intake-extraction/capacity/load-certification.mjs` requires at least 30 full-envelope runs, an explicitly approved concurrent-load distribution, coverage of every required concurrency stratum, production-shaped object storage and PostgreSQL, stateless burst workers, and a provider-quota certificate. It fails on any omitted page, duplicate ready event, unreconciled cost event, non-ready batch, or latency breach.

The default planning strata `[1, 2, 4]` are placeholders for tooling tests, **not the final representative distribution**. Capacity owners must approve the real distribution before evidence collection.

## Required run record

Each sanitized record contains only:

- opaque run ID;
- file/page/byte counts;
- concurrent intake count;
- custody and ready timestamps;
- `ready` or `ready_with_review` status;
- omitted-page, duplicate-publication, and unreconciled-cost counts;
- production-shape attestations; and
- non-secret provider quota certificate ID.

Raw filenames, document text, credentials, request payloads, and provider secrets must not enter the report.

## Test sequence

1. Verify the provider quota certificate and approved concurrent distribution.
2. Pre-warm the minimum worker floor; allow the predictive capacity manager to burst during upload.
3. Upload directly to the versioned regional object store and confirm the batch custody timestamp.
4. Exercise mixed file sizes and document-local ranges, exact duplicates, selective repair, and review outcomes.
5. Include controlled throttling, a worker loss/reclaim, an outbox retry, and at least one provider outage/failover scenario in separate labeled runs.
6. Reconcile every provider attempt and billed/logical cost event.
7. Export sanitized run records, evaluate them, and retain restricted raw telemetry separately.
8. Keep `V4-LOAD-001` pending until both the evaluator and independent evidence review pass.
