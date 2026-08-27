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

## Provider timeout budget

The recurring latency-tail failure mode across evidence runs was a single
hung provider call consuming its whole timeout, with the retry landing past
the P99 clock. Provider ceilings are therefore hang detection sized from
observed worst successful calls (Gemini range 40.4s, Mistral 75.5s), not
patience: Gemini range 45s first attempt / 60s retries, Gemini page repair
60s, Mistral page 90s, GPT-5.4 apex 60s/120s. Certification runs may tune
the primary range rung per run via `MWB_V4_RANGE_TIMEOUT_MS` /
`MWB_V4_RANGE_FIRST_TIMEOUT_MS` (mount) or `buildProviderSuite`'s
`rangeTimeoutMs` / `rangeFirstAttemptTimeoutMs`; the tuned values must be
recorded with the run evidence. Latency evidence must come from bytes the
providers have not previously seen — provider-side caches make repeat
corpora read unrealistically fast.

## Preliminary evidence runs (not certification)

**2026-08-28 fresh-briefs storm run** — 20 archival scanned briefs, 3,062
logical pages, 103 MB, previously unseen bytes, 24 lanes, defaults
(Gemini range 45s/60s ceilings). Outcome: `ready`, 20/20 documents,
**3,062/3,062 pages accepted, 0 review pages**, $10.47 measured spend
(1,897 storm-failed attempts quarantined for invoice reconciliation).
Weather: a ~30-minute Gemini 503 event (1,045 refusals) beginning minutes
after custody. Resilience verdict: the ladder + admission controller +
drain recovered 100% of pages (Gemini 2,403 / Mistral 455 / GPT-5.4 apex
204 page wins); the durable work graph survived the runner's 90-minute cap
and reached terminal via the repair drain. Latency verdict: SLO breached
(96% at 90 minutes) — decomposition: (a) the outage itself; (b) the new
range ceilings clipped legitimate slow calls on this corpus class
(accepted-call P50 31s / P95 51.7s / P99 58s against a 45s first-attempt
ceiling; 847 timeout kills) — dense archival scans run several times
slower per range than the office-document corpus the defaults were sized
on, so scan-heavy certification runs should set
`MWB_V4_RANGE_TIMEOUT_MS` / `MWB_V4_RANGE_FIRST_TIMEOUT_MS` upward and the
default-sizing question should be revisited only with calm-weather data;
(c) four repair lanes were the drain bottleneck once the primary
collapsed — repair-lane scaling under primary failure is an open
improvement. Superseded-computation counts (1,923 review-tagged
intermediates) are lineage history, not result quality: the published
result carries zero review pages. 38 briefs (~5,374 pages) of the corpus
remain provider-unseen, reserved for calm-weather latency evidence.

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
