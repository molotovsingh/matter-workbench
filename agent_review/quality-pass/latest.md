# Matter Workbench — Engineering Quality Pass · Run 13

> **Run 13 · 2026-08-28 17:55 IST · branch `feature/document-intake-extraction-v4` · commit `0db1265`**
> Baseline: **Run 12 (`1e324d0`, 2026-07-18 08:03 IST, on `main`)** — legacy home `claude_review/quality-pass/`; this is the first run written to `agent_review/`. Delta: **98 commits · 195 files · +28,635/−327** — the branch is essentially a **new subsystem**: the clean-sheet V4 document intake/extraction service (~10.7k lines in `services/document-intake-extraction/` + `workers/document-processing/`, 9 Postgres migrations, 33 test files), the S3/SigV4 custody path, the flag-gated app mount, the legacy import bridge, and the React V4 intake panel. The delta review is therefore a deep **first-pass over the new subsystem** plus re-verification of Run 12's carried queue.
> **Clean worktree** at `0db1265`. Note: `HEAD` advanced mid-review (`8524079` → `0db1265`, "Fix three defects the post-merge review confirmed"); the new commit was read in full and all findings were re-anchored — it fixed two transport defects (Spaces client timeout + socket leak) and one contract divergence (`ocr_applied` boolean vs yes/no enum) and does not contradict any finding below.
> **Verification:** no subagent fan-out available in this harness, so the review ran sequentially, family by family. Every carried verdict was re-verified in current code (never from commit messages). New-code verdicts verified by reading the failure paths, the DB functions, the twins, and the tests. **47 tests executed across 15 sampled test files, all passing** (full suite: 1,902 green per `0db1265`'s commit message — taken on report). One suspicion raised and **retracted with evidence** (repair-enqueue no-op upsert — see Rubric row 8).
> Stable entry: `latest.md` · history: `../INDEX.md` · home: `agent_review/`.

A repeatable architecture-quality pass — **not** a formal security/correctness audit
(security-adjacent items may be flagged, but a dedicated security scan is still the
standing recommendation). One question per unit: *is the problem solved at the right
level, and where is the risk?*

---

## The headline: a flagship-quality new subsystem, flag-gated off — and the carried debt didn't move

The V4 document-intake/extraction service is the best-engineered surface this review
has seen in thirteen runs. It is *integrated but disabled* — `MWB_V4_INTAKE` off by
default, excluded from private-beta deploys, single sanctioned import site in
`server.mjs` — and within that posture it is disciplined almost everywhere the
previous twelve runs found risk: forced RLS on every table with transaction-scoped
tenant GUCs (`postgres/migrations/001:464-510`, `tenant-transaction.mjs:9-11`),
work claims as database functions with `SKIP LOCKED` + atomic attempt increments
(`001_control_plane.sql:395-437`), fencing (lease token + attempt id predicates) on
every checkpoint (`postgres-work-repository.mjs`), streamed-and-hashed custody with
conditional content-addressed promotion (`s3-compatible-object-store.mjs:128-186`),
hand-rolled SigV4 pinned to the official AWS test vector
(`test/document-intake-extraction-v4-spaces-client.test.mjs:28`), fail-closed
readiness gates, and a mount that unregisters itself on start failure so intakes are
refused rather than accepted-then-abandoned (`server.mjs:597-615`).

Meanwhile **both Run 12 P2 flagship findings cleared in the legacy code**:
`persistMatterJson` now runs inside `withSerializedMatterWrite` with a locked
re-read + intake merge (R12-1), and the enqueue upsert now resets terminal rows so
the commit-retry actually re-queues (R12-2). The Postgres integration suite now runs
in CI with a real `postgres:16` service (R12-4). The polling logic the react-ui
regex tests used to fake-promise was extracted into `preparationJobPolling.ts` and
is now transpile-and-execute tested (R12-3, the important half).

But the pattern of this repo's history repeats once more: **fix cycles land on what
the last report named, while the long-carried queue doesn't move.** R11-3 (routes
god-module, 1,768 lines), R11-25 (App/MatterOverview — MatterOverview *grew* 55
lines), R11-16/17 (multipart heap buffering, session reaper), R11-7 (client
idempotency key still random per attempt), R11-18 residual (telemetry awaited on the
legacy critical path; V4's new upload path got AbortSignal, the legacy runner still
has none), R11-20/21/22 — all untouched. And two new themes emerged from the new
code: **T16 — contract drift across the V4↔legacy seam** (the author's own
post-merge review just caught one instance, `ocr_applied` boolean vs enum; the
client/server slug pair is the same class, still unpinned), and **T17 — durable
stores that grow or retry forever** (no upload-session reaper, no scratch-allocation
reaper despite the method existing, no outbox dead-letter despite `attempt_count`
being tracked).

### Carried queue status (Run 12 → Run 13) — every verdict re-verified in code

| Item | Run 12 | Run 13 | Evidence |
|---|---|---|---|
| **R12-1** — story-worker matter.json write outside the lock | risky | ✅ **CLEARED** | `persistMatterJson` now locks and merge-reads: `runtime-db-storage-service.mjs:733-748` wraps in `withSerializedMatterWrite`, re-reads current `matter.json`, and merges via exported `mergeRuntimeMatterJsonForPersistence` (`:1255-1278`) — intakes merge by id (`intake_id/intakeId/intake_dir`), so a concurrent add-files commit can no longer be overwritten wholesale by a stale snapshot. The story route/worker now write through the guarded path for free. |
| **R12-2** — enqueue upsert no-ops on terminal rows | risky | ✅ **CLEARED** | `runtime-db-processing-job-store.mjs:41-55` — on conflict, `failed`/`cancelled` rows now reset to `queued` with `attempt_count=0`, `run_after=now()`, locks/heartbeats/errors/finish timestamps nulled; progress_json replaces rather than merging on the terminal branch. The commit-retry re-enqueue (R11-15's fix) now works in exactly the wedged scenario it was built for. |
| **R12-3** — react regex-over-source test tier | brittle | ◐ **PARTIAL → P3** | The delicate part is fixed the right way: polling extracted into `react-ui/src/lib/preparationJobPolling.ts` with **executed** tests (`test/react-preparation-job-polling.test.mjs` transpiles the module, 0 regex asserts) — and the kind-fallback stale latch (a Run 12 P3) is fixed in the same extraction (`preparationJobPolling.ts:55-57`: a provided `jobId` that isn't found returns null — keep polling — never falls through to kind). But `test/react-auto-preparation.test.mjs` **grew** from ~49 to **161** `assert.match` lines; the orchestration above the helper remains pinned by regex-over-source. |
| **R12-4** — Postgres suite runs nowhere automatically | brittle | ✅ **CLEARED** | `.github/workflows/quality-gates.yml:16-40` — `postgres:16` service container, health check, `MWB_POSTGRES_TEST_ADMIN_URL`, and `npm run test:postgres` (which globs `integration-test/*.postgres.mjs`, including the V4 suite `integration-test/document-intake-extraction-v4.postgres.mjs`). The best artifact of last cycle no longer rots unwired. |
| **R12-6** — reopen leaves stale operator attribution | risky | ◐ **PARTIAL → P3** | Recurrence no longer clobbers the resolver's bookkeeping: `mothership/store.mjs:234-239` preserves existing `operatorStatus`/`operatorStatusHistory` in the merged payload (previously the fresh signal payload overwrote them). But no synthetic `active` history entry is appended and `operatorStatus` still reads "resolved" while top-level `status` is `active` — report attribution remains ambiguous rather than wrong. |
| R11-7r — client idempotency key + doctor tooling | brittle | ❌ **NOT FIXED** | `MainContent.tsx:293-296` — `sourceRemovalIdempotencyKey` still appends `Date.now()`/`Math.random()`, so every click mints a fresh key; mid-mutation resume stays unreachable from the UI. Still no repair-file doctor tooling. **P2 carries.** |
| R11-16 — multipart eager heap buffering | risky | ❌ **NOT FIXED** | `multipart-upload.mjs:129-141` — `readFile(tempPath)` per file, all buffers held until busboy finishes. This delta even touched the file twice (Linux Busboy crash fixes, `:102-112`) without removing the buffering. One-line-class fix, five runs old. **P2 carries.** |
| R11-17 — session reaper + intake reclaim | risky | ❌ **NOT FIXED** | No reaper/expire/stale sweep exists in the upload-session store or worker service (grep-verified). Terminal sessions bounded, abandoned ones still retain bytea forever. **P2 carries** — now also **T17**, with two new siblings in the V4 code. |
| R11-18r — telemetry await, zero AbortSignal | brittle | ◐ **PARTIAL** | The *new* V4 upload path has full abort support (`v4Intake.ts:210-239`: XHR + `AbortSignal` listener + cancel error). The legacy runner still awaits `recordStageTelemetry` between stages (`autoPreparationRunner.ts:172,181,186`) and has no abort. **P2 residual carries.** |
| R11-3 — routes god-module + dead legacy branches | overgrown | ❌ **NOT FIXED** | `routes/matter-workflow-routes.mjs` still 1,768 lines; the five `run*Legacy` twins still at `:92, :236, :270, :310, :383`. **P2 carries.** |
| R11-25 — App/MatterOverview god + drift | overgrown | ❌ **NOT FIXED** (grew) | `App.tsx` 1,101 lines (unchanged); `MatterOverview.tsx` 1,279 → **1,334**. The V4 panel is cleanly separated behind its flag — but it is a third guarded-run workflow surface. **P2 carries.** |
| R11-20 — operator-error boundary collapse | overgrown | ❌ **NOT FIXED** (spot-checked) | No delta to the ai-settings routes' error shaping; the V4 http handler shows the right pattern (`normalizeHttpError` fails closed with code-preserving 4xx, `document-intake-extraction-http.mjs:200-216`) — unused as a template. |
| R11-21 — MW LOD silent 120-row truncation | brittle | ❌ **NOT FIXED** | `mw-list-of-dates-service.mjs:435` still `slice(0, MAX_CASE_TIMELINE_ROWS)` on date-ascending entries; cap now a named constant and announced to the model (`:448-451`) but still no `truncated_rows` or lawyer-visible warning. |
| R11-22 — soften-language rewrites ignore source text | brittle | ❌ **NOT FIXED** | `listofdates/entries.mjs:140-142` — `normalizeNarrativeText(value)` still discards its `sourceText` argument. |
| R11-4r / R11-13r / R11-14r + P3 clusters (dedup response shape, citation `candidates[0]`, job-ledger rewrite-on-read, VM signal ledger unbounded, telemetry retry-forever, chain-continuation crash window) | — | **CARRIED, not re-verified** | Those files are outside this delta; carried as-is for the next pass that touches them. |
| F3/F16/F19 — auth boundary (parked) | risky* | **OPEN** | Parked for the dedicated security scan, eighth run standing. See also **R13-1** — the V4 mount adds a *new* instance of the same boundary question. |

---

## Unit map (discovery)

Delta-scoped. Mode axis (as established in prior runs): `filesystem` / `DB` / `bridge` / `pure` / `—`.

| Unit | Family | Role — what it does (plain) | Powers (entry point / route / consumer) | Depends on / twin | Mode |
|---|---|---|---|---|---|
| `packages/extraction-contracts/index.mjs` | contracts | Versioned input/output contracts, service limits, capability pinning, fingerprints | Every V4 service, repo, worker, and test | — (leaf) | pure |
| `postgres/migrations/001-009` + `migrate.mjs` + `runtime-role-sql.mjs` | control plane | Tables, forced RLS, claim/expire/renew DB functions, outbox, cost reconciliation, audit, capability-scoped claims; restricted runtime role grants | Repositories, workers | `tenant-transaction.mjs` (GUC scoping) | DB |
| `postgres/tenant-transaction.mjs` | control plane | One tenant-scoped transaction wrapper (`set_config(..., true)` per tx) | Every repository method | pg pool | DB |
| `postgres/postgres-intake-repository.mjs` | repositories | Idempotent intake create (fingerprint 409), progress snapshots, batch custody commit, inspected-document routing with lineage-aware demand binding | V4 service (Postgres mode) | migrations, contracts | DB |
| `postgres/postgres-work-repository.mjs` | repositories | Fenced page claims (single + contiguous document-local batches), lease renew, success/failure checkpoints with cost evidence and repair escalation | processing workers | claim DB functions | DB |
| `postgres/postgres-result-repository.mjs` + `assembly.mjs` | repositories | Publishes ready intakes to versioned extraction results (idempotent) | outbox dispatcher, import bridge | intake/work repos | DB |
| `postgres/postgres-outbox-store.mjs` + `events/outbox-dispatcher.mjs` | events | Claim/deliver/mark outbox events; HMAC-signed HTTPS delivery with replay window; at-least-once | mount's outbox consumer loop | migrations | DB |
| `postgres/postgres-upload-authorization-store.mjs`, `-capacity-calibration-`, `-cost-reconciliation-`, `-worker-capacity-`, `-audit-store` | repositories | Token-digest upload authorizations; capacity outcomes; cost reconciliation; append-only audit | object store, admission, readiness | migrations | DB |
| `document-intake-extraction-service.mjs` | service core | Filesystem control-plane reference implementation of the intake lifecycle (speculative processing, dedup, custody) | isolated dev runs (`dev/isolated-run.mjs`) | Postgres twin of the same contract | filesystem |
| `postgres/postgres-document-intake-extraction-service.mjs` | service core | Durable Postgres facade: create intake → authorizations → custody → inspect → route → publish | the V4 HTTP handler | intake/result repos, object store, inspector, router | DB |
| `adapters/s3-compatible-object-store.mjs` + `sigv4.mjs` + `spaces-s3-client.mjs` | custody | Direct-to-bucket upload authorization, streamed hash verification, content-addressed promotion with If-None-Match race handling; hand-rolled SigV4 (header-signed + presigned) | both service cores | AWS test vectors in tests | bridge |
| `adapters/filesystem-object-store.mjs`, `filesystem-control-plane.mjs`, `pdfjs-document-inspector.mjs` | custody | Local-disk twins for the reference implementation | isolated runs | S3 twins | filesystem |
| `integration/local-composition.mjs` + `composition/create-v4-composition.mjs` | integration | Provider suite, admission controller, worker fleet, local-disk S3 emulation; the independently instantiable composition root | app mount + dev runners | everything above | bridge |
| `integration/app-mount.mjs` + `http/*` | integration | Flag-gated mount into server.mjs (`MWB_V4_INTAKE`): `/api/v4` handler, emulated staging PUT endpoint, worker fleet + outbox consumer lifecycle | `server.mjs:495-536, 552-615` | composition root | bridge |
| `services/v4-extraction-import-service.mjs` | bridge | Imports ready V4 results into legacy `_extracted` records + Extraction Log (idempotent, legacy-wins) | outbox consumer (resultConsumer seam) | matter folders, extraction-record/v1 contract | bridge |
| `workers/document-processing/*` (loop, scratch, processing worker, range worker, inspectors, materializer) | workers | Stateless lanes claiming fenced leases; streamed digest-verified scratch materialization; range worker batches contiguous pages into one provider call; PDF inspectors (pdfinfo / native-text / pdfjs) | fleet in app mount + dev runners | work repo, object store, providers | bridge |
| `providers/*` (gemini37 range/repair, gpt54 repair, mistral-ocr41 range/page, pinned adapter, provider-http) | providers | Pinned-capability adapters with per-attempt timeout budgets, transient classification, retry-after honoring | workers | provider-http | bridge |
| `scheduling/*` (weighted-fair-scheduler, document-local-task-planner), `routing/selective-repair-router.mjs`, `page-validator.mjs` | pipeline | Weighted-fair ordering (realized in the claim SQL), contiguous batch planning, repair ladder with per-rung fingerprints, legal page validation | routing at inspection time | contracts | pure |
| `capacity/*` (6 modules) | capacity | Workload planning, adaptive admission (AIMD + slow start), predictive burst capacity requests, rolling calibration, load/quota certification | progress/ETA service, readiness gates | worker-capacity store | pure/DB |
| `readiness/*` (cli, cutover-authorization, evaluate-acceptance, quality/security/service certification) | readiness | Fails-closed cutover gate requiring load, quality, quota, security, soak certifications | `node services/document-intake-extraction/readiness/cli.mjs` | all families | pure |
| `react-ui/src/api/v4Intake.ts` + `components/upload/V4IntakePanel.tsx` | frontend | V4 client: probe discovery, XHR uploads with byte progress + abort, custody-commit pipelining, progress polling | V4IntakePanel (renders only when probe succeeds) | `/api/v4/status` | — |
| `react-ui/src/lib/preparationJobPolling.ts`, `preparationTiming.ts` + hooks/views touched | frontend | Extracted server-job polling state machine (executed-tested); step timing | autoPreparationRunner, useBackendPreparationJobs | api client | — |
| `server.mjs` V4 mount block + `runtime-db-storage-service.mjs` + `runtime-db-processing-job-store.mjs` + `multipart-upload.mjs` | legacy touched | The R12-1/R12-2 fixes; V4 mount with fail-loud boot and start-failure self-unregister; multipart Linux crash fixes | whole app | — | DB/filesystem |
| `.github/workflows/quality-gates.yml` | CI | Postgres 16 service + `test:postgres` in CI | every push/PR | integration tests | — |

## Rubric

Controlled vocabulary as in prior runs: verdict `right-sized` · `brittle` · `overgrown` · `risky` (`*` = minor warning); action `ignore`·`watch`·`refactor`·`test now`; severity P0–P3. Verdict format (dual-audience): `<marker> <judgment + why>. <issue @ file:line>. **Fix:** <change>.`

## Audit view

**P1 queue: empty** — second consecutive run.

| Unit | Mode | Blast radius | Verdict | Theme | Action | Sev |
|---|---|---|---|---|---|---|
| app-mount auth stubs (R13-1) | bridge | any authenticated beta account reaches any matter's intakes once flag is on | risky* | T15 | refactor before enablement | P2 |
| V4↔legacy seam contracts (R13-3 slug; ocr_applied fixed) | bridge | silent dead-lettering of every result event when slug pair drifts | brittle | T16 | test now | P3 |
| outbox delivery (R13-5) | DB | poisoned event retries ≤15-min forever, no dead-letter | risky* | T17 | refactor | P3 |
| scratch-space reaper (R13-2) | bridge | leaked materialized PDFs on worker crash (mitigated by ephemeral volumes) | brittle* | T17 | refactor (wire existing method) | P3 |
| capacity apparatus (R13-4) | pure | burst manager unwired in the mount; static capacity fed instead | overgrown* | — | watch / wire | P3 |
| **carried**: R11-7r, R11-16, R11-17, R11-18r, R11-3, R11-25, R11-20/21/22, R12-3 residual, R12-6 residual | — | (see carried table) | — | T7/T9/T10/T17 | refactor | P2/P3 |
| contracts package, migrations+roles, intake/work/result repos, object custody, workers, providers, scheduling, HTTP handler, import bridge, React V4 client, CI, polling extraction | — | — | right-sized | — | ignore | P3 |

**Tally:** ~16 units right-sized (6 with minor warnings), 3 new brittle/overgrown, 1 new risky*; **0×P0 · 0×P1 · ~7×P2 (6 carried + 1 new downgraded) · ~9×P3 new or residual · ~2×P4.**

## Report log

- **Run 13** · 2026-08-28 17:55 IST · `0db1265` · scope: delta from Run 12 (`1e324d0`) = the V4 document-intake-extraction branch. First report in the new `agent_review/` home. 2 of Run 12's 3 new P2s cleared (R12-1, R12-2), R12-4 cleared, R12-3 half-cleared; new subsystem reviewed family-by-family — verdict: flagship-quality, flag-gated; 3 new P3 + 1 new P2* (auth stub, tracked by the readiness gate); two new themes (T16 seam drift, T17 unbounded durability). Prior runs: see `../INDEX.md`.

## Evidence & fixes — new findings

| Family | Unit | Role | Mode | Theme | Verdict — judgment · where (`file:line`) · Fix |
|---|---|---|---|---|---|
| **integration** | app-mount auth stubs | V4 mount composition | bridge | T15 | ⚠️ **R13-1 (P2, risky\*)** The HTTP layer fully implements matter-level authorization (`requireMatterAccess`, 404-on-denial, per-action scopes — `document-intake-extraction-http.mjs:29-32, 87-91`) and the single composition site bypasses it with `authenticate: async () => ({ tenantId })`, `authorizeMatter: async () => true` (`integration/app-mount.mjs:161-162`), so every authenticated private-beta principal can read/commit/poll any matter's intakes and results by ID within the fixed tenant. Mitigations verified: flag off by default, excluded from private-beta deploy, and the readiness gate fails closed without a passed `service_authentication_matter_authorization` control in a production-shaped environment (`readiness/security-certification.mjs:8`) — so it cannot silently reach production. It remains a single-door invariant: the enforcement exists and one caller defeats it. **Fix:** wire `authorizeMatter` to the workbench's matter store (resolve matterId → exists + principal access) before enabling for any multi-account deployment; until then, fail the mount at boot when the deployment has more than one supervised account. |
| **bridge** | slug contract duplication | V4↔legacy matter identity | bridge | T16 | ⚠️ **R13-3 (P3, brittle)** The client derives the V4 matterId slug (`react-ui/src/api/v4Intake.ts:269-278`) and the import service re-derives it to reverse-map result events to matter folders (`services/v4-extraction-import-service.mjs:134-141`) — byte-identical regex chains today, linked only by a comment; drift dead-letters every result event as `v4_import.matter_not_found` with `retryable: false`. This is not hypothetical: the same seam just produced a real defect — `ocr_applied: true` written where every other producer writes the `"yes"/"no"` enum, missing `matter-attention-intake.mjs`'s literal `=== "yes"` — found and fixed by the author's own post-merge review in `0db1265`. **Fix:** a shared test feeding both implementations the same name corpus (ASCII, spaces, non-ASCII, leading punctuation) asserting equal slugs; better, make the intake carry the server-known folder name as the primary key (clientRequestId already does) and demote the slug to last resort. |
| **events** | outbox delivery | durable event delivery | DB | T17 | ⚠️ **R13-5 (P3, risky\*)** `markFailed` dead-letters only when `error.retryable === false`; `attempt_count` is tracked in `outbox_events` (`migrations/001:254`) but never bounded, so a poisoned event whose delivery throws retryable errors (e.g. `getResult` 404 — which does *not* set `retryable: false`) retries every ≤15 minutes forever (`postgres-outbox-store.mjs:67-82`, `outbox-dispatcher.mjs:40-52`). The sibling design four tables over does this right: `page_computations.maximum_attempts` is enforced in the claim query. **Fix:** dead-letter when `attempt_count ≥ N` (mirror the page-computation pattern; reuse `retryDelay`'s attempt count), and set `retryable: false` on terminal lookups like `intake.result_not_found`. |
| **workers** | scratch-space reaper | temp materialization cleanup | bridge | T17 | ⚠️ **R13-2 (P3, brittle\*)** `removeStaleAllocations` is implemented, tested, and invoked by nothing in production (grep-verified: sole reference is its own definition, `worker-scratch-space.mjs:104`) — a crashed/killed worker leaks its materialized PDFs forever. Mitigated by the documented prod posture (encrypted ephemeral volumes) but the method is free. **Fix:** call it once at fleet start and on an interval in `local-composition.mjs`'s `startWorkerFleet` (the outbox loop too). Same class as R11-17 — see T17. |
| **capacity** | capacity/readiness apparatus | admission + burst planning | pure | — | ⚠️ **R13-4 (P3, overgrown\*)** The mount feeds static capacity (`workerCapacity: { activeWorkers: lanes, ..., pageOperationsPerSecondPerWorker: 4 }`, `app-mount.mjs:155`) while ~1,200 lines of capacity machinery (burst manager with `applyOnce`, quota/load certification, rolling calibration) sit beside it — `applyOnce` has no caller in the mount. This is a deliberate readiness-gated posture (the evaluator fails closed without load/quota certification), not gratuitous layering, but the surface is ahead of its consumer and will either get wired or rot. **Fix:** wire `applyOnce` into the mount's fleet loop against a real provisioner, or mark the burst manager readiness-only in its header until one exists. |
| **dev tooling** | drain-repairs | repair-queue drain tool | — | — | ⚠️ **R13-6 (P4)** `dev/drain-repairs.mjs:41` hard-codes `/Users/aksingh/matter-workbench/.env` as a fallback — a committed machine-specific path (fragile-signal coupling). **Fix:** env var or workspace-relative resolution. |
| **frontend** | V4 upload client | browser uploads | — | — | ⚠️ **R13-7 (P4)** `v4Intake.ts:227-231` swallows `setRequestHeader` failures with a comment that reasons only about the emulated endpoint; in real-S3 mode a refused header (forbidden name) produces a SigV4 signature mismatch at PUT time with a confusing error. **Fix:** fail fast on header-set failure when the target URL is not the app-origin staging prefix. |

### Verified clean (sample of the strongest evidence)

- **Contracts package** ✅ — mutable model aliases (`latest`/`current`/`auto`) rejected (`packages/extraction-contracts/index.mjs:32-34`), sha256 format asserted at every boundary, canonical-JSON fingerprints, executed tests.
- **Tenant transactions & RLS** ✅ — `set_config(..., true)` is transaction-scoped so a released client cannot leak a tenant; every table forces RLS with a single `tenant_isolation` policy (`migrations/001:464-510`); real-Postgres tests assert isolation.
- **Claims & fencing** ✅ — `claim_page_work` expires stale leases first, orders by weighted-fair demand priority, `for update skip locked`, increments attempts atomically (`001_control_plane.sql:395-437`); every checkpoint re-asserts `lease_token` **and** `active_attempt_id` (`postgres-work-repository.mjs:97-103, 169-175, 249-253`) — the active-attempt guard makes double-checkpoint structurally impossible.
- **Custody** ✅ — streamed hash verification with grow-detection (`s3-compatible-object-store.mjs:238-249`), conditional content-addressed promotion whose race loser verifies the winner's blob (`:154-170`), staging keys bound to token digests and re-validated against a real outstanding authorization before any emulated write (`app-mount.mjs:206-232`).
- **SigV4** ✅ — pinned to the official AWS documentation example (`test/document-intake-extraction-v4-spaces-client.test.mjs:28`, `AKIAIOSFODNN7EXAMPLE/20130524`).
- **Mount lifecycle** ✅ — loud boot failure except the excluded-deploy case (`server.mjs:523-528`), self-unregister on start failure so intakes are refused not stranded (`server.mjs:600-615`).
- **Retracted suspicion** — the repair-enqueue `on conflict do update set fingerprint = excluded.fingerprint` no-op upsert (`postgres-work-repository.mjs:245-247`) initially looked like a terminal-row wedge (R12-2's class). Verified safe: a terminal repair row *is* the designed review-required terminal state, the demand insert's `case when pc.status in ('accepted','review_required')` clause marks it fulfilled, and lineage resolution in `recordInspectedDocument` binds re-uploads to the tip so nothing re-claims a terminal rung. Downgraded, not reported.
- **Carried-fix verification** ✅ — R12-1/R12-2 fixes read in full and anchored above; both are the fixes the report asked for, not approximations.

## Emerging themes

- **T16 — contract drift across the V4↔legacy seam (new).** The seam deliberately crosses as plain JSON ("the import service never touches V4 code and the mount never touches legacy code" — a good isolation call), but every such seam needs its contracts pinned on *both* sides. Evidence: the `ocr_applied` boolean-vs-enum defect found by the author's own post-merge review (`0db1265`), fixed with a regression test asserting the enum (`test/v4-extraction-import.test.mjs:122-127`); the slug pair still unpinned (R13-3); the `requiredHeaders` swallow (R13-7) drifting from the S3 signature contract. Shared fix: seam-contract tests that execute both sides against the same fixtures.
- **T17 — durable stores that grow or retry forever (new).** Three units, one shape: something durable is created, the terminal/cleanup path is *designed* and even implemented, but nothing invokes it on the failure path. R11-17 (upload sessions, no reaper — legacy), R13-2 (scratch allocations, reaper written never called), R13-5 (outbox, attempt counter tracked never bounded). The contrast case is in the same new schema: page computations get `maximum_attempts` enforced in the claim query. Shared fix: a one-pass "durable resource lifecycle" audit — for every table/directory that accumulates, name the reaper and its caller, or bound the retries.
- **T15 — single-door invariants (persists).** The matter-authorization machinery is fully built in the V4 HTTP layer and bypassed by one stub at the single composition site (R13-1) — the same shape as Run 12's lock-only commit UPDATE. The V4 readiness gate is the correct backstop *because* it names the control explicitly; keep that gate honest.
- **T7 / T9 / T10 (persist)** — god-modules (R11-3/25), telemetry-on-critical-path (R11-18r), and the regex-over-source tier (R12-3 residual: the helper got executed tests, the orchestration above it gained 112 more regex asserts) all carry.

**Meta-observation:** risk has bifurcated. The new flagship subsystem concentrates its risk at exactly two points — the **seam** (T16) and the **enablement gate** (T15) — while the legacy codebase's risk is now almost entirely *frozen carried debt* that no fix cycle has touched in three-plus runs (R11-3/16/17/25). The second is the more predictable failure: nothing about it changes until someone decides the god-modules and the missing reapers are worth a dedicated cycle.

## What it does well

- **Fenced claims as database functions** — the claim/expire/renew trio in `migrations/001:324-462` is the template for any future durable queue in this repo: expiry handled in-claim, `skip locked`, atomic attempt increment, weighted-fair ordering realized in SQL rather than JS. R11-12's crash-loop class is structurally impossible here.
- **The readiness gate discipline** — `readiness/security-certification.mjs` fails closed on named controls (including the auth stub's control), load/quality/quota certifications require *evidence*, and the CLI's exit-2-pending semantics keep "integrated but disabled" honest. This is the pattern the legacy cutover paths (VM cutover self-approval, `SET_CONFIG` backdoor) never had.
- **Executed-test culture in the new code** — 33 test files for the subsystem, transpile-and-execute for the TS polling helper, AWS vectors for SigV4, real-Postgres isolation/race tests now in CI. `test/react-preparation-job-polling.test.mjs` is the template the 161 remaining regex asserts in `test/react-auto-preparation.test.mjs` should be converted to.
- **Honest seam design** — the import bridge's rules (never invent FILE-NNNN ids, never import blank/review pages into a legal record, legacy wins ties, synthesized confidence declared in `warnings`) plus the idempotent, dead-lettering outbox consumer; the `0db1265` post-merge fix shows the author reviewing this seam adversarially against consumers like `matter-attention-intake.mjs`.

## Highest-leverage fixes

1. **A seam-contract test pass (clears T16's whole row set):** one test module that executes the V4 import bridge and the React client's slug/id functions against a shared fixture corpus, plus an enum-pinning test for every CSV column the bridge writes (the `ocr_applied` fix shows the pattern). Half a day, retires the drift class before the flag ever turns on.
2. **A durable-resource lifecycle audit (clears T17's row set):** enumerate every accumulating store — upload sessions (R11-17), scratch allocations (R13-2), outbox attempts (R13-5) — and for each, wire the reaper or bound the retries. The scratch fix is literally calling an existing tested method.
3. **Wire `authorizeMatter` before any real enablement (R13-1):** the readiness gate will eventually demand it; doing it now — while the only consumer is a supervised single-tenant beta — means the flag can be flipped on evidence rather than hope.
4. **Finally spend a cycle on the frozen debt (R11-3/16/17/25):** these are the only P2s that have survived three fix cycles untouched; multipart buffering is a one-line delete, the routes/App decomposition is the only large one. The repo's fix-cycle machine works — it just needs pointing at the oldest queue entries, not just the newest report.

---

> **⏳ Currentness.** Valid only for commit `0db1265` at the time this report was written (clean worktree; findings verified against `8524079` and re-anchored over the `0db1265` delta, which was read in full). **A source edit since then can invalidate these findings — re-run `/quality-pass` after changes.**
