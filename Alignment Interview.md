# Live Alignment Interview

Started: 2026-08-24
Purpose: Clean-sheet alignment of Matter Workbench's upload-to-OCR architecture using V2, V3, PDFEval Gold30, and provider benchmark evidence.

During this interview, do not edit canonical artifacts. Record questions, answers, tensions, and later-edit candidates here only.

## Interview Protocol Notes

- Default mode: user asks one alignment question at a time; the agent answers and records the Q&A.
- Reverse interview mode: the agent asks the user one question at a time to expose missing assumptions and decisions.
- Consolidation mode: the agent summarizes confirmed principles, tensions, open decisions, and recommended edits without applying them.
- Canonical code, production configuration, schemas, architecture documents, and benchmark reports remain unchanged during interview mode.
- Reference evidence includes the isolated V2/V3 experiments, PDFEval Gold30 human-verified results, and the stated 70% quality / 30% speed preference.

## Mode Shift - Reverse Interview

The agent will now ask one question at a time to expose assumptions, ownership decisions, constraints, and unresolved tensions.

## Q1 - Required service level

**Question:**
Is 1,000 PDFs processed in under 60 seconds a hard customer-facing guarantee, an aspirational stress benchmark, or not required?

**Answer / Reasoning:**
The customer-facing guarantee should be hard, but the benchmark envelope should be 500 PDFs rather than 1,000. Cloud OCR is already part of the intended system through Mistral, Gemini, and Textract. The working interpretation is therefore a hard target of 500 PDFs within 60 seconds, subject to clarifying the workload envelope and how the three providers participate.

**Architecture / Initiative Impact:**
Confirmed | Open Decision

**Decision / Tension:**
A hard 60-second target rules out cold-started capacity and simple serial document jobs. It requires admission control, pre-warmed bounded capacity, page-level work units, live quota management, and a defined page/byte envelope. PDF count alone is not a sufficient enforceable SLO because 500 PDFs could contain 500 pages or tens of thousands of pages. The phrase “all three” also needs clarification: routing among three providers is architecturally different from sending every page to all three.

**Later Edit Candidate:**
Define a formal 500-PDF service envelope and SLO in the future architecture document, including maximum pages, bytes, file-size limits, queue conditions, and degraded-mode behavior.

**Potential Open Decisions:**
- Whether 60 seconds means OCR completion, assembled extraction availability, or full downstream matter preparation.
- Maximum pages and bytes covered by the guarantee.
- Whether Mistral, Gemini, and Textract are alternative routed providers or mandatory parallel passes.

## Q2 - Provider participation contract

**Question:**
Must every page pass through Mistral, Gemini, and Textract, should a router choose one primary with selective validation, or should only high-risk pages use all three?

**Answer / Reasoning:**
There is no requirement to use any fixed combination of providers. The architecture should use whatever provider, local method, or combination best solves quality and speed at reasonable cost.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
The system is outcome-driven and provider-agnostic. Mistral, Gemini, and Textract are capabilities available to a routing policy, not mandatory stages. Blanket triple-processing would waste latency and cost. The router may use native text, one OCR provider, selective verification, consensus, or repair according to predicted risk, current capacity, and the service envelope.

**Later Edit Candidate:**
Define a provider-neutral routing contract and capability registry rather than hard-coding a Mistral-to-Gemini chain.

**Potential Open Decisions:**
- The numerical cost ceiling for one guaranteed workload.
- Which quality failures require consensus, repair, or human review.
- The precise page/byte envelope covered by the 500-PDF guarantee.

## Q3 - Guaranteed workload envelope

**Question:**
Should the hard guarantee cover up to 500 PDFs, 10,000 total pages, and 2 GB uploaded, with assembled extraction ready within 60 seconds, while larger work receives a revised ETA?

**Answer / Reasoning:**
Yes. This is a reasonable initial envelope provided the user receives a clear estimate and an understandable reason whenever the workload falls outside the guarantee or the estimate changes.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
The service needs explicit admission classification rather than a hidden timeout. In-envelope jobs receive the hard SLO. Out-of-envelope or temporarily capacity-constrained jobs remain accepted but move to an estimated-completion contract. The explanation must identify the real cause—page volume, bytes, unusually complex scans, queue load, provider throttling, or recovery—not a generic “processing” message.

**Later Edit Candidate:**
Add a future service-envelope contract and UX states for guaranteed, estimated, and temporarily capacity-constrained processing, including reason codes and ETA confidence.

**Potential Open Decisions:**
- Whether upload/network time is inside or outside the 60-second processing clock.
- How much reserved capacity is required before an in-envelope job may be labelled guaranteed.
- ETA confidence bands and update cadence.

## Q4 - SLO clock boundary

**Question:**
Should upload time have a connection-dependent ETA, with the hard 60-second processing SLO beginning only after every file is safely received, hash-verified, and committed to server custody?

**Answer / Reasoning:**
Yes. Upload and processing are separate commitments.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
The system must not promise control over the user's network. Upload exposes a continuously updated transfer ETA. The processing clock begins at a durable custody checkpoint after receipt, integrity verification, filtering, deduplication, and commit. This creates an auditable SLO boundary and prevents retransmission or browser variability from corrupting processing measurements.

**Later Edit Candidate:**
Define separate upload and processing clocks in the future service contract, telemetry, API status model, and UI.

**Potential Open Decisions:**
- Whether archive expansion and malware/security inspection occur before or after the processing clock starts.
- Exact custody event and timestamp that starts the SLO.

## Q5 - Mandatory quality gate

**Question:**
Should the 70% quality / 30% speed score apply only after mandatory completeness checks pass, so a faster result cannot win if it has missing pages, truncation, lost critical legal tokens, severe duplication, or reading-order failure?

**Answer / Reasoning:**
Yes. Legal completeness is a hard gate before weighted optimization.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
The optimizer is constrained rather than purely scalar. Coverage and critical legal integrity are non-negotiable. Among candidates that pass those checks, the system may optimize 70% for measured quality and 30% for speed, subject to the cost ceiling. Failed candidates must be repaired, replaced, routed to review, or explicitly marked incomplete; they cannot be silently selected because they are fast.

**Later Edit Candidate:**
Define a formal extraction acceptance contract with hard gates followed by weighted quality/speed scoring.

**Potential Open Decisions:**
- Which critical signals are independently detectable without circular dependence on another OCR model.
- Whether a human-review result can satisfy the 60-second “ready” commitment or must be classified separately.
- Thresholds for duplication, reading-order, and confidence-based review.

## Q6 - Guarantee ownership during provider failure

**Question:**
Should the system verify capacity before accepting a guaranteed job, automatically fail over after acceptance even at higher cost, and label capacity-constrained work as estimated before the processing clock begins?

**Answer / Reasoning:**
The capacity-aware labelling and failover posture is broadly correct, but 60 seconds is flexible rather than an absolute deadline. Faster labelling is also important, but that workflow is explicitly outside the current upload-to-OCR architecture scope.

**Architecture / Initiative Impact:**
Tension | Open Decision

**Decision / Tension:**
The earlier phrase “hard customer-facing guarantee” is now softened: the architecture needs a strong service objective with honest exception handling, not necessarily an absolute per-job contractual deadline. Provider failures should still be absorbed through failover where reasonable, but the system may extend the ETA transparently when recovery makes 60 seconds impossible. Labelling performance must not be folded into this architecture redesign.

**Later Edit Candidate:**
Define capacity admission, provider failover, and explicit SLO-exception reason codes. Keep labelling optimization in a separate initiative.

**Potential Open Decisions:**
- The percentile definition of the flexible 60-second target.
- Maximum emergency cost allowed for failover.
- When a provider incident justifies revising an accepted ETA.

## Q7 - Flexible service objective

**Question:**
Should in-envelope work target P95 extraction readiness within 60 seconds and P99 within 120 seconds, with a visible exception state and revised ETA beyond 120 seconds, while never sacrificing mandatory quality gates for speed?

**Answer / Reasoning:**
Yes. This is the accepted definition of the flexible processing objective.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
The service objective is percentile-based rather than an absolute per-job guarantee. The system optimizes toward P95 ≤60s and P99 ≤120s for admitted workloads up to 500 PDFs, 10,000 pages, and 2 GB. Jobs beyond 120 seconds remain durable and recoverable, surface an explicit exception reason, and receive a revised ETA. Quality gates remain invariant across all latency states.

**Later Edit Candidate:**
Add P95/P99 SLO definitions, exception-state semantics, and measurement boundaries to the future architecture and observability contracts.

**Potential Open Decisions:**
- Cost ceiling for standard and emergency execution.
- Statistical window and minimum sample size for publishing SLO attainment.

## Q8 - Cost ceiling priority

**Question:**
Should the maximum in-envelope workload have a $50 normal provider-cost target and $100 automatic-failover ceiling?

**Answer / Reasoning:**
Cost optimization should not be a present design priority. Quality and speed must be solved first. Cost must nevertheless always be measured completely.

**Architecture / Initiative Impact:**
Confirmed | Open Decision

**Decision / Tension:**
The clean-sheet architecture should first establish the feasible quality/latency frontier without prematurely constraining routing to a cost budget. Every provider attempt—including retries, failures, speculative work, cached work, and failover—must still have attributable usage and cost evidence. The system must prevent accidental unbounded fan-out, but normal cost thresholds should be calibrated from successful quality/speed evidence rather than imposed before the architecture works.

**Later Edit Candidate:**
Make complete per-job, per-document, per-page, per-provider, and per-attempt cost attribution mandatory, with an emergency runaway circuit breaker; defer normal cost optimization and pricing-policy thresholds.

**Potential Open Decisions:**
- Production runaway ceiling required for operational safety.
- When cost becomes an optimization objective after quality and latency acceptance.

## Q9 - Overlap upload and OCR

**Question:**
Should processing begin as soon as each file is individually received, hash-verified, and deduplicated, while the rest of the upload continues, with results hidden until the batch commits?

**Answer / Reasoning:**
Follow the recommended approach: yes, overlap upload and processing.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Custody and batch publication remain transactional, but computation becomes streaming and speculative. Each committed file may enter preflight and OCR immediately. Completed work is checkpointed and reused when the upload batch commits. If the batch is abandoned, speculative cost remains fully measured and artifacts expire under a cleanup policy. This overlaps provider latency with the user's remaining transfer time without exposing a partial matter as complete.

**Later Edit Candidate:**
Separate per-file custody commit, batch commit, processing eligibility, and result publication states in the future workflow and data model.

**Potential Open Decisions:**
- Retention period for abandoned speculative artifacts.
- Whether users may intentionally publish a partially uploaded batch.

## Q10 - Shared custody architecture

**Question:**
Should uploads stream into shared object storage with hashes, while PostgreSQL holds custody and processing state and stateless workers read only the work they need?

**Answer / Reasoning:**
The user does not want to make a low-level technical choice and asks for the tradeoffs. The recommended architecture is shared object storage plus PostgreSQL because the 500-file service objective requires durable shared access and horizontal workers.

**Architecture / Initiative Impact:**
Later Edit Candidate

**Decision / Tension:**
Local VM storage is simpler and cheaper to build, but creates a machine bottleneck, complicates failover, and prevents multiple workers from safely sharing custody. Database blob storage provides strong transactional semantics but bloats backups and the primary database and is poorly suited to multi-gigabyte document traffic. Object storage plus PostgreSQL adds operational components, request costs, lifecycle policies, and security configuration, but provides durable blobs, content deduplication, resumability, independent scaling, and auditable shared access. Given the agreed workload, its complexity is justified.

**Later Edit Candidate:**
Use content-addressed S3-compatible object storage for immutable blobs and PostgreSQL for manifests, leases, work units, checkpoints, and publication state. Keep this as an architectural recommendation rather than requiring the user to choose implementation details.

**Potential Open Decisions:**
- Cloud/object-storage vendor and regional placement.
- Retention and deletion policies.
- Encryption-key ownership and data residency requirements.

## Q11 - Isolated unreadable pages

**Question:**
If nearly every page passes but one page remains unreadable, should the system hold the entire extraction or publish the usable result on time with that page explicitly marked for review?

**Answer / Reasoning:**
Publish the usable result with the unresolved page clearly marked for review.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Completeness means every source page has an explicit outcome, not that the whole matter must wait indefinitely for one irreducible page. A page may be accepted, repaired, failed-with-review, or pending manual replacement. The assembled extraction can become available with a visible review count and page-level reason while preserving the original source and later allowing that page to be replaced atomically.

**Later Edit Candidate:**
Define page-level terminal outcomes, review markers, partial-ready publication, and versioned reassembly after a page is corrected.

**Potential Open Decisions:**
- Whether downstream preparation may consume pages marked for review.
- Which page failures are severe enough to block specific downstream skills even if extraction is generally ready.

## Q12 - Fairness between simultaneous users

**Question:**
Should one 500-PDF matter consume all OCR capacity until completion, or should the scheduler preserve progress and a fast lane across simultaneous matters?

**Answer / Reasoning:**
The user requests the tradeoffs rather than making a technical scheduling choice. Weighted fairness with capacity-aware admission is recommended.

**Architecture / Initiative Impact:**
Later Edit Candidate

**Decision / Tension:**
Finishing one large matter first minimizes that one user's latency but makes every other ETA unpredictable and lets a single upload monopolize the system. Strictly equal sharing protects fairness but can unnecessarily slow urgent or nearly complete work and ignores different page complexity. Weighted fairness is more complex to implement and explain, but it protects small jobs, keeps all admitted matters progressing, uses spare capacity efficiently, and best supports percentile SLOs. The engineering team should own the scheduling algorithm.

**Later Edit Candidate:**
Use capacity-aware admission plus weighted fair scheduling, predicted work weights, bounded provider lanes, and work stealing. Expose only clear ETA and queue-state outcomes to users, not scheduler mechanics.

**Potential Open Decisions:**
- Whether commercial priority tiers are ever permitted.
- Minimum capacity reserved for small/interactive jobs.

## Q13 - Restricted or private processing mode

**Question:**
Must some matters be prohibited from using external OCR providers, requiring a separate private/local processing mode?

**Answer / Reasoning:**
This does not need to be settled today. The architecture may be designed freely without making restricted-mode support a current blocker.

**Architecture / Initiative Impact:**
Open Decision | Out of Scope

**Decision / Tension:**
Provider eligibility should be a policy input rather than embedded in routing logic. The initial design may assume approved cloud providers are available, while preserving a capability boundary for a future restricted/local lane. A restricted lane would have its own quality evidence, capacity, cost, and ETA and should not silently inherit the normal cloud SLO.

**Later Edit Candidate:**
Include provider-eligibility policy in the abstract routing contract, but defer local/private worker implementation until there is a concrete privacy or residency requirement.

**Potential Open Decisions:**
- Which matters or tenants require restricted processing.
- Approved provider list, data residency, retention, and contractual controls.
- Whether a local GPU lane is commercially justified.

## Mode Shift - User-Led Interview

The user will now ask architecture questions one at a time. The agent will answer directly, record the implication and any tension, and preserve implementation changes as later-edit candidates only.

## Q14 - Clean-sheet plan versus the current system

**Question:**
Compare the proposed upload-to-OCR architecture with what exists today and explain why it is superior.

**Answer / Reasoning:**
Today's production system has useful foundations—durable upload sessions, integrity telemetry, runtime jobs, deployment drain guards, extraction records, and stable citation assembly—but its processing shape is still document/job oriented, locally hosted, mostly serial at the runtime-worker layer, and coupled to a fixed OCR chain. Production custody and compute depend on the beta VM; processing begins after batch workflow transitions; page work is not a first-class durable unit; provider/model selection is not a capability router; the primary model uses a mutable alias; whole-document repair and document boundaries amplify tail latency; capacity admission, cross-matter fairness, complete per-attempt cost attribution, and predictive ETA are not first-class contracts. Isolated V3 proves better routing, page checkpoints, pinned models, and document-local scheduling, but none of that is wired into production and its scheduling remains experiment-local.

The clean-sheet plan separates immutable custody, orchestration, computation, validation, and publication. Files stream into content-addressed shared storage and become individually eligible for speculative processing after hash verification. PostgreSQL owns manifests, work graphs, leases, checkpoints, costs, and publication versions. Pages are durable computation units under document custody boundaries. A provider-neutral router selects native extraction, pinned Mistral OCR 4.1, Gemini, Textract, or future capabilities according to page risk, live latency, capacity, and mandatory quality gates. Document-local work is scheduled through bounded provider lanes with global weighted fairness and admission control. Every attempt is measured; accepted pages assemble incrementally; irreducible pages become explicit review outcomes rather than blocking the entire matter; upload ETA and processing SLO are separate user contracts.

This is superior because failure is isolated to a page/task rather than a multi-hour document/job; completed paid work survives restart; upload and OCR overlap; immutable shared custody permits horizontal workers and provider failover; model versions and task fingerprints make evidence reproducible; the optimizer cannot trade away critical legal completeness; capacity-aware scheduling supports the agreed 500-PDF/10,000-page envelope; and the user receives an explainable ETA rather than a generic spinner. Evidence supports the design: V2 file concurrency gave 1.98× improvement, routed V3 gave roughly 9.7–16.3× directional improvement over V2, and pinning OCR 4.1 plus preserving document locality reduced PDFEval Gold30's reconstructed path from 538.5s to 87.2s while retaining 54/54 verified critical fields.

**Architecture / Initiative Impact:**
Confirmed | Later Edit Candidate

**Decision / Tension:**
The clean-sheet plan is not superior because it has more services; it is superior because it establishes correct boundaries and measurable contracts. It does add object-storage, orchestration, scheduler, lease, observability, and migration complexity. A small serial VM is simpler for beta traffic, but it cannot credibly meet the agreed scale/SLO or isolate provider failures. The design should therefore remain minimal—object storage, PostgreSQL control plane, and stateless workers—without prematurely adding Kafka, Airflow, or many microservices.

**Later Edit Candidate:**
Prepare a future architecture document describing the custody plane, control plane, durable page work graph, capability router, validation gates, scheduler/admission model, assembly/versioning, observability/cost ledger, and user-facing state contract. Prepare a shadow migration rather than modifying production in place.

**Potential Open Decisions:**
- Exact worker topology and reserved capacity needed for P95/P99 targets.
- Same-document chunking policy that lowers the 86-call PDFEval range count without recreating heterogeneous-batch latency.
- Quality predictors that decide when Mistral output warrants Gemini/default-thinking or Textract verification.
- Shadow-run acceptance thresholds and cutover sequence.

## Q15 - Duplicate exclusion in the clean-sheet design

**Question:**
Will duplicates still be excluded in the clean-sheet architecture?

**Answer / Reasoning:**
Yes. Exact-byte deduplication becomes a custody invariant and occurs before any paid OCR capacity is consumed. Every streamed file receives a server-computed SHA-256. Logical upload entries remain preserved for provenance, filenames, folder positions, and audit history, but identical bytes reference one immutable canonical blob and one compatible extraction result. Concurrent arrivals for the same hash coalesce behind one in-flight work graph rather than starting duplicate provider calls.

Extraction reuse is keyed by source hash plus pipeline/policy/model version, so an old result cannot be silently reused after a material model or extraction-policy change. Tenant and matter authorization remain logical boundaries even where physical blob deduplication is possible. Near-duplicate or visually similar documents are not automatically discarded because small legal revisions may be material; they may be flagged for review but remain separate sources.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Deduplication removes computation, not legal provenance. A user may upload the same document twice under different paths and must still see both intake entries, while the system stores and extracts the bytes only once. Cross-tenant cache reuse introduces privacy, deletion, billing, and side-channel concerns and should not be assumed merely because content hashes match.

**Later Edit Candidate:**
Define canonical blob identity, logical source references, single-flight work coalescing, extraction cache fingerprints, duplicate outcomes, and tenant-scoped reuse rules in the future custody and work-graph contracts.

**Potential Open Decisions:**
- Whether physical cross-tenant blob deduplication is permitted.
- Retention/legal-hold behavior when one of several logical references is deleted.
- Whether near-duplicate detection is exposed as advisory UX.

## Q16 - Replacing the legacy pipeline

**Question:**
How will the clean-sheet architecture be integrated in place of the old system?

**Answer / Reasoning:**
Use a strangler migration, not a big-bang rewrite. The clean-sheet pipeline is built beside production behind the existing upload, extraction-record, citation, job-status, and downstream preparation contracts. New internal page/work models are additive. A backend selector is fixed per job so legacy and clean-sheet execution never mix invisibly within one published result.

First, validate an isolated implementation on frozen corpora and human-verified samples. Next, import or lazily mirror existing blobs into content-addressed object storage without deleting legacy custody. Then shadow selected production jobs: legacy remains authoritative while clean-sheet work runs separately and records coverage, quality, latency, failures, and cost. After acceptance, expose staff-only and tenant-cohort opt-ins. Progressively route new jobs through the clean-sheet backend while legacy in-flight jobs drain normally. Publish assembled clean-sheet output through the existing normalized extraction contract so downstream skills do not require a simultaneous rewrite. Use versioned results and job-level feature flags for rollback. Retain the legacy path read-only as a fallback through a defined soak period, then decommission it only after audit, replay, and rollback criteria are satisfied.

**Architecture / Initiative Impact:**
Confirmed | Later Edit Candidate

**Decision / Tension:**
The migration favors reversibility and evidence over the shortest implementation. Dual custody/metadata and shadow processing temporarily add complexity and measured provider cost, but they avoid downtime, preserve user data, prevent in-flight job corruption, and allow immediate cohort rollback. Destructive schema replacement, mid-job migration, or silently combining pages from two backends would create unacceptable provenance risk.

**Later Edit Candidate:**
Create a future phased migration plan covering additive schemas, object-store mirroring, immutable per-job backend selection, shadow comparison, staff/cohort flags, normalized output compatibility, rollout gates, automatic rollback, legacy drain, and decommission criteria.

**Potential Open Decisions:**
- Exact shadow sample size and soak duration.
- Whether shadow runs may use cheaper providers or must reproduce the final route exactly.
- Conditions under which an unpublished clean-sheet failure automatically falls back to legacy processing.
- Duration of legacy read-only retention after full cutover.

## Q17 - No legacy runtime after cutover

**Question:**
Reject long-lived legacy retention: test the clean-sheet system sufficiently, replace the old pipeline, and fix failures forward rather than returning jobs to legacy.

**Answer / Reasoning:**
Agreed. The migration becomes a tested one-way cutover rather than a permanent strangler. Temporary pre-cutover shadow comparison is allowed because it is part of proving readiness, but after the readiness gate the legacy processing backend is drained, removed from deployment, and no longer available as a runtime fallback. Historical source files, published extraction records, audit events, and database backups remain preserved; the obsolete execution path does not.

Post-cutover recovery stays within the clean-sheet architecture: retry or reassign page work, switch provider capabilities, disable a faulty route through policy, publish review markers, restore control-plane state from checkpoints, and deploy forward fixes. Git history may retain old source history, but production does not retain duplicate workers, queues, infrastructure, or a legacy backend selector.

**Architecture / Initiative Impact:**
Confirmed | Tension

**Decision / Tension:**
This removes ongoing duplicate operational cost, prevents architectural stagnation, and forces the new platform to own failures. It also removes the fastest rollback during a severe incident. The readiness bar must therefore be materially higher: full-envelope load tests, human-golden quality gates, provider-outage and throttling drills, restart/replay tests, object-store and database recovery, security review, observability, runbooks, and a rehearsed forward-fix/degraded-mode process are required before cutover.

**Later Edit Candidate:**
Replace the future rollout plan with a finite pre-cutover validation phase, explicit go/no-go gate, legacy-job drain, one-way cutover, immediate legacy runtime decommission, and clean-sheet-only roll-forward recovery plan.

**Potential Open Decisions:**
- Exact go/no-go evidence thresholds.
- Length and workload volume of the temporary shadow-validation period.
- Which clean-sheet degraded modes may remain available during incidents without violating quality gates.

## Q18 - Clean-sheet service boundary

**Question:**
Will the clean-sheet pipeline be a service called by the main Matter Workbench processes, and what will the simple system shape look like?

**Answer / Reasoning:**
Yes. Treat it as one logical Document Intake and Extraction Service called asynchronously by the main Matter Workbench application. The main application retains authentication, tenants, matters, user permissions, business workflows, and UI. The extraction service owns upload-session custody coordination, integrity verification, deduplication, admission/ETA, page work graphs, provider routing, validation, assembly, checkpoints, progress, and cost evidence. The main application never calls Mistral, Gemini, or Textract directly.

The browser should upload large payload bytes directly to shared object storage through short-lived authorized upload instructions. The main application creates the matter/intake request; the extraction service creates the custody session and returns upload instructions. As each file commits, the service starts work. It publishes progress and a versioned normalized extraction result back to the main application through an idempotent event/callback contract. The request is asynchronous: the main application receives a job id and ETA immediately rather than holding an HTTP request open.

Internally, avoid a service per provider. Use one control-plane service with PostgreSQL and object storage, plus stateless bounded worker pools that invoke provider adapters. This is a real deployment boundary for independent scaling and failure isolation, but it remains a minimal architecture rather than a microservice fleet.

**Architecture / Initiative Impact:**
Confirmed | Later Edit Candidate

**Decision / Tension:**
A separate service adds network contracts, authentication, deployment, observability, and distributed-state concerns. Keeping everything in the main process is simpler, but couples web/API availability to long OCR workloads and prevents independent worker scaling. The agreed workload and SLO justify the service boundary. Idempotency, an outbox/event mechanism, and authoritative ownership rules are required so the main app and extraction service cannot disagree about custody or publication.

**Later Edit Candidate:**
Define the future Document Intake and Extraction Service API/events: create intake, authorize upload, file committed, batch committed, progress, ETA/reason, extraction ready, review required, failed, cancel, and retrieve versioned extraction result.

**Potential Open Decisions:**
- Same PostgreSQL cluster with an owned schema versus a separately managed processing database.
- Event delivery mechanism and retry/dead-letter policy.
- Whether the main app stores a copy of the normalized extraction record or only a durable reference and version.

## Q19 - Lego-like maintainability

**Question:**
Does the service-oriented, capability-based design make future fixes, maintenance, provider upgrades, and replacements easier?

**Answer / Reasoning:**
Yes, provided the boundaries are enforced rather than merely drawn in a diagram. Stable versioned contracts let Matter Workbench depend on intake, progress, and normalized extraction outcomes instead of provider-specific behavior. Provider adapters implement one capability interface, routing is policy rather than hard-coded chains, immutable custody supports replay, and every result records its pipeline/model fingerprint. This allows a provider upgrade, new local/GPU capability, routing fix, worker scaling change, or validation improvement to be tested and deployed without rewriting the main application.

Examples include evaluating Mistral 4.2 beside pinned 4.1, disabling one degraded provider without stopping uploads, rerunning only affected pages after a validator fix, or adding a new OCR provider behind the existing adapter contract. Versioned results preserve provenance through these changes.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
The design is modular but not magically simple. Distributed components add API compatibility, authentication, event delivery, leases, observability, and deployment responsibilities. The Lego benefit disappears if the main app reads processing tables directly, provider-specific fields leak into shared contracts, workers bypass the control plane, or every small component becomes its own microservice. Maintain a small number of strong ownership boundaries and comprehensive contract tests.

**Later Edit Candidate:**
Define and enforce stable capability, work-unit, event, and extraction-result contracts; forbid cross-boundary database access and direct provider calls from Matter Workbench; require pipeline fingerprints and compatibility tests for upgrades.

**Potential Open Decisions:**
- Compatibility and deprecation policy for service API/event versions.
- Whether control-plane and worker releases are versioned independently.

## Q20 - V4 development location

**Question:**
Should V4 be built directly in the current Matter Workbench checkout or in a dedicated Git worktree of the Matter Workbench repository, and why?

**Answer / Reasoning:**
Build V4 in a dedicated Git worktree on its own feature branch, while keeping the source in the Matter Workbench repository. A recommended shape is a sibling worktree such as `/Users/aksingh/matter-workbench-v4` on a branch such as `feature/document-intake-extraction-v4`. The worktree provides filesystem and branch isolation from production operations and unrelated local changes; using the same repository preserves shared contracts, tests, history, and atomic integration.

The service should live behind an explicit package/service boundary inside the repository rather than being left indefinitely under experiments. A deployment boundary does not require a separate repository. A separate repo would introduce premature package publishing, cross-repository version coordination, duplicated CI, and harder atomic contract changes. It can be extracted later if independent team ownership or release cadence makes that worthwhile.

V4 must remain unreachable from production routes, imports, builds, and deployments until its gates pass. CI/dependency checks should enforce that isolation. Once validated, reviewed commits are merged normally; integration is enabled deliberately in a later cutover phase. The worktree is a development-isolation mechanism, not a permanent fork or runtime fallback.

**Architecture / Initiative Impact:**
Confirmed | Later Edit Candidate

**Decision / Tension:**
Working directly in the current checkout would be simpler for small edits but risks mixing a long-lived architectural build with beta operations, experiments, and unrelated untracked files. The worktree requires deliberate branch synchronization and dependency installation but materially reduces accidental coupling and deployment risk. Keeping one repository balances isolation with contract coherence.

**Later Edit Candidate:**
After alignment closes, create a dedicated V4 worktree/branch, define service and shared-contract package boundaries, add forbidden-import/build/deployment guards, and keep benchmark payloads outside the repository.

**Potential Open Decisions:**
- Final branch, worktree, and package names.
- Whether V4 initially shares the existing PostgreSQL cluster under an owned schema.
- CI workflow and deploy artifact boundaries for the service and workers.

## Q21 - V4 delivery estimate

**Question:**
How long will V4 take to build?

**Answer / Reasoning:**
Budget approximately five to seven weeks for a one-way-cutover-ready system with one focused implementation stream. A useful isolated V4 should exist within seven to ten working days; code-complete integration with Matter Workbench should take roughly another one to two weeks; full-envelope load validation, failure drills, security/custody review, expanded human quality evidence, operational runbooks, and cutover readiness require another two to three weeks. The higher validation burden follows directly from the decision not to retain legacy runtime fallback.

A directional sequence is: week 1 for contracts, service scaffold, object custody, hashing, deduplication, and durable work graph; week 2 for page workers, pinned provider adapters, checkpoints, routing, validation, assembly, and cost ledger; week 3 for main-app API/events, progress/ETA, admission, fairness, and review outcomes; weeks 4–5 for Gold/Rashmi regression, 500-file/10,000-page load tuning, provider outage/restart/replay drills, security and observability; weeks 6–7 as contingency for quota constraints, defects, human adjudication, and the final go/no-go/cutover exercise.

Provider quota approval and human adjudication are calendar-time dependencies rather than coding tasks and could extend the date. The P95 60-second objective cannot be promised until the full 10,000-page workload is measured against real provider quotas and capacity.

**Architecture / Initiative Impact:**
Confirmed | Open Decision

**Decision / Tension:**
A fast prototype is possible in days because V3 already supplies routing, batching, checkpoint, provider, and PDFEval building blocks. Production-grade custody, distributed correctness, observability, security, recovery, and one-way cutover evidence dominate the schedule. Compressing those gates would contradict the agreed fix-forward-only migration posture.

**Later Edit Candidate:**
After consolidation, create a milestone plan with acceptance evidence for isolated V4, integrated-but-disabled V4, full-envelope readiness, and one-way cutover.

**Potential Open Decisions:**
- Available implementation/review capacity and whether workstreams can run in parallel.
- Provider quota lead time.
- Human adjudicator availability for the expanded golden set.

## Q22 - Decide provider quotas now

**Question:**
Can provider quota approval be decided now rather than waiting for V4?

**Answer / Reasoning:**
The required capacity envelope and quota requests can and should be defined and submitted now; provider approval itself is controlled by Mistral, Google, and AWS and cannot be decided internally. The agreed workload requires at least 166.7 completed source pages per second before accounting for validation or repair. Designing for up to 25% additional repair work plus roughly 20% operational headroom yields a provisional aggregate target near 250 page-operations per second.

That target must be translated into each provider's quota dimensions: Mistral request rate, concurrent OCR jobs, file-size/upload throughput, and workspace limits; Gemini requests/minute, tokens/minute, concurrent requests, model tier, and regional capacity; Textract start/get transactions per second and concurrent asynchronous jobs. With roughly four pages per provider task, 250 page-operations per second is directionally about 62.5 requests per second or 3,750 requests per minute across lanes, but document-local task sizes and measured token distributions must refine the per-provider requests. Quota should be sized for burst capacity, not daily averages.

Submit a provisional request now and recalibrate after V4's saturation tests. Existing account-tier limits must first be captured from provider consoles or rate-limit responses. A quota grant still does not prove the SLO; sustained-load and throttling tests must verify usable throughput and latency.

**Architecture / Initiative Impact:**
Confirmed | Later Edit Candidate

**Decision / Tension:**
Starting quota work now removes an avoidable calendar dependency. Requesting too little blocks load validation; requesting generous limits generally does not require the application to consume or pay for that capacity, though reserved/provisioned arrangements may. Multi-provider quotas provide failover only where providers meet the same quality gate and data-policy requirements.

**Later Edit Candidate:**
Prepare a provider quota worksheet and submit requests for the 500-PDF/10,000-page burst envelope while V4 is being built. Measure granted versus demonstrated throughput separately.

**Potential Open Decisions:**
- Current Mistral workspace, Gemini project tier, and AWS regional quotas.
- Whether any provider requires reserved capacity or an enterprise agreement for the target burst.
- Final per-provider allocation after route-mix and task-size benchmarks.

## Q23 - User inputs needed for quota grants

**Question:**
What is needed from the user to obtain provider quota grants?

**Answer / Reasoning:**
The user should not provide API keys or secret credentials in chat. The minimum inputs are the non-secret account identifiers and an owner able to approve billing or commercial terms: the Mistral workspace/organization ID and owner contact; the Google Cloud project ID behind the Gemini key, billing status, and a Project Owner or Quota Administrator; and the AWS account ID, intended Textract region, and an IAM principal able to request Service Quotas or open a support case.

Each request also needs a concise business profile: legal-document OCR use case, 500 PDFs/10,000 pages per burst, P95 60-second and P99 120-second objective, estimated average and peak frequency, intended launch date, production region/data-residency constraints, expected file sizes, and the provisional per-provider throughput/concurrency request. The user must approve any reserved-capacity or enterprise commercial terms and authorize a bounded paid saturation test after limits are granted.

The implementation agent can prepare the quota worksheet, calculate provider-specific limits from benchmark evidence, draft request text, inspect local configuration for non-secret identifiers where authorized, and provide exact console steps. The user or designated account owner must submit/approve requests, respond to provider questions, and accept billing or contracts.

**Architecture / Initiative Impact:**
Confirmed | Later Edit Candidate

**Decision / Tension:**
Most technical preparation can proceed without the user. The irreducible user actions concern account authority, billing, company/contact information, region/privacy commitments, and commercial acceptance. Quota requests should not require disclosing production secrets.

**Later Edit Candidate:**
Create a quota-request packet containing one shared workload profile, provider-specific requested limits, current-limit evidence, console/support instructions, contact ownership, and approval status.

**Potential Open Decisions:**
- Production region and data-residency posture.
- Expected number of maximum-envelope bursts per hour/day.
- Who owns each provider account and vendor relationship.
- Budget authorization for post-grant load tests and any reserved capacity.

## Q24 - Existing quota/account information audit

**Question:**
Is the required account information already available locally, including additional provider configuration in the PDFEval repository?

**Answer / Reasoning:**
Most execution credentials and benchmark evidence are already available, but the administrative quota metadata is not. A read-only audit found valid Mistral credentials in both Matter Workbench and PDFEval; they are different keys, and both can list models successfully, but neither response exposes workspace, organization, or limit headers. Matter Workbench and PDFEval also contain different Google/Gemini keys. No Google Cloud project ID is configured, and the API-key lookup endpoint requires authority the key does not provide. PDFEval supplies the missing AWS Textract credentials and region (`ap-southeast-2`); STS successfully resolves the AWS account and principal, but that principal is denied access to list Textract Service Quotas.

Therefore no new OCR secrets are needed to begin V4 or build the quota worksheet. The missing items are administrative: identify which of the multiple Mistral/Gemini accounts is the intended production quota scope, expose the Mistral workspace limits through an admin, identify the Google project/billing tier through its console owner, and grant or use an AWS principal with Service Quotas/support access. Existing benchmark reports already provide call counts, timings, retry behavior, route mix, and measured costs.

**Architecture / Initiative Impact:**
Confirmed | Open Decision

**Decision / Tension:**
Provider API access is not the same as quota-administration access. PDFEval materially fills the Textract execution gap, but it does not grant the current IAM user quota visibility. Distinct local keys may represent distinct projects/workspaces and their quotas cannot safely be pooled or assumed equivalent without account ownership confirmation.

**Later Edit Candidate:**
Populate the quota worksheet from existing benchmark evidence and mark only the production account scope and console-admin fields as requiring user/account-owner action. Do not copy or expose secret keys.

**Potential Open Decisions:**
- Which Mistral key/workspace and Google project become production capacity owners.
- Who can provide Mistral Admin Panel, Google quota-console, and AWS Service Quotas access.

## Q25 - Are Google and AWS access gaps blockers?

**Question:**
Are the Google project/quota and AWS Service Quotas access gaps blockers?

**Answer / Reasoning:**
They are not blockers to creating the V4 worktree, implementing the service, running functional tests, or repeating bounded Gold/Rashmi benchmarks: the existing Gemini and Textract credentials execute successfully. They are blockers to certifying the 500-PDF/10,000-page P95/P99 objective and to the final one-way production cutover if those providers are part of the accepted route or failover capacity.

Google is the more material current dependency because Gemini is the quality/repair lane in the preferred route. Before production, its key must belong to an identified, billed, administratively controlled project with known rate limits. AWS is not presently a critical-path quality dependency because Textract is an optional capability and lost one verified critical field in the current sample; its quota access becomes blocking only if V4 evidence makes Textract necessary for quality, speed, or failover. Separately, production should use managed service identities rather than PDFEval's user access keys.

**Architecture / Initiative Impact:**
Confirmed | Open Decision

**Decision / Tension:**
Development can proceed immediately and quota administration can run in parallel. Full-envelope tests without known/granted limits would measure only accidental current capacity and cannot justify a customer-facing SLO. The architecture remains provider-neutral so an unavailable quota lane can be replaced, but no provider may be counted toward guaranteed capacity without administrative ownership and demonstrated sustained throughput.

**Later Edit Candidate:**
Do not gate V4 scaffolding on quota administration. Add an explicit readiness gate before full-envelope certification requiring identified production accounts, billing, quota visibility, service identities, and sustained-load evidence for every provider counted in the route.

**Potential Open Decisions:**
- Whether Textract is required for launch after expanded quality benchmarking.
- Production Google project owner and billing tier.
- Production AWS role/account if Textract remains enabled.

## Q26 - End-state goal and definition of done

**Question:**
At the end of development, what goal should V4 have achieved?

**Answer / Reasoning:**
The end goal is not merely a new OCR implementation. It is for Matter Workbench to have one production upload-to-extraction service that turns a committed legal-document batch into a trustworthy, page-complete, versioned extraction within an explainable time, at the agreed scale, while remaining recoverable and independent of any single OCR provider.

Definition of done: users can upload up to 500 PDFs/2 GB/10,000 pages with a live upload ETA; every file enters durable hash-verified custody; exact duplicates consume no duplicate OCR; processing overlaps the upload and the processing clock begins at batch custody commit; admitted in-envelope workloads demonstrate P95 ≤60 seconds and P99 ≤120 seconds under representative concurrent load; every source page has an accepted or explicit review outcome; no missing/truncated output passes; the expanded human golden set retains 100% of adjudicated critical legal fields and meets the agreed WER/CER non-inferiority threshold; one hard page does not block the usable matter; worker restarts, provider throttling, and task retries preserve checkpoints and do not repeat completed paid work; every attempt has latency, usage, cost, model, route, and source provenance; the UI receives progress, ETA confidence, and specific exception reasons; and Matter Workbench consumes only the service's versioned normalized result contract.

Operational completion also requires full-envelope load evidence, security/custody review, service identities and demonstrated quotas for every launch provider, backup/replay drills, dashboards/alerts, and forward-fix runbooks. After the go/no-go gate, V4 becomes the sole runtime path, legacy jobs drain, the legacy runtime is removed, and historical user data/audit evidence remains intact. Faster downstream labelling, minimum-cost optimization, and restricted/local OCR are not part of this definition of done.

**Architecture / Initiative Impact:**
Confirmed | Later Edit Candidate

**Decision / Tension:**
The goal is evidence-backed service replacement, not code completion. P95/P99 latency must be measured with real workload distributions and concurrency; quality must be human-adjudicated across native, primary, and repair lanes; provider quotas must be demonstrated rather than assumed. These acceptance gates may extend calendar time but are necessary because cutover is one-way.

**Later Edit Candidate:**
Turn this definition into a V4 acceptance matrix with measurable functional, quality, performance, recovery, security, observability, integration, and decommission gates.

**Potential Open Decisions:**
- Final WER/CER non-inferiority threshold for the expanded golden set.
- Representative concurrent-load distribution used for SLO certification.
- Minimum soak volume before the one-way cutover.

## Q27 - Role of Box by ASCII

**Question:**
Would Matter Workbench benefit from using persistent Box by ASCII virtual machines?

**Answer / Reasoning:**
Box is a strong fit for V4 development and destructive/parallel testing, but it should not become the production upload-to-OCR runtime or custody foundation. A prepared V4 Linux template could be snapshotted and forked into isolated boxes for control-plane work, worker development, load/chaos tests, independent review, and long-running agent tasks. This would keep the local machine and beta VM clean, provide repeatable environments, and allow parallel branches to be discarded or compared cheaply. Build artifacts should remain ordinary containers and repository commits so Box is replaceable.

It is a weak production fit for this service. Users need document extraction, not persistent desktops or per-user coding VMs. Full VMs are heavier than stateless container workers; creation/resume is not a reliable part of a 60-second processing path; EU-only placement adds legal-document residency, network-latency, and snapshot-retention questions; and the published material does not establish the managed database/object-store integration, production OCR SLO, private-network controls, or availability guarantees needed to make Box the service foundation. ASCII's own platform guide recommends publishing production traffic elsewhere so production does not depend on a Box being up.

If trialled, Boxes should contain sanitized/public benchmark data only, use `no-env` or narrowly scoped temporary credentials, have explicit retention/deletion, and never connect to the production database or become original-document custody. The production architecture remains shared object storage, PostgreSQL control plane, and pre-warmed stateless workers in the chosen data region.

**Architecture / Initiative Impact:**
Confirmed | Later Edit Candidate

**Decision / Tension:**
Box could accelerate parallel engineering and failure testing at low initial cost, but introduces another vendor, secret-management surface, EU data boundary, and environment to maintain. It does not solve provider quotas, human quality adjudication, or production high availability. Use it as an optional engineering laboratory, not an application dependency.

**Later Edit Candidate:**
Optionally run a bounded seven-day Box trial using a sanitized V4 template and compare setup time, parallel-agent throughput, test reproducibility, snapshot recovery, and cost against the local worktree. Do not place production payloads or credentials in the trial.

**Potential Open Decisions:**
- Whether the development acceleration justifies introducing Box.
- Whether any non-production legal benchmark data may be stored in EU snapshots.
- Box retention and secret-injection policy for the trial.

**Supplemental Reference / Reasoning:**
The user clarified Box's core USP as the combination of a cheap persistent full Linux VM, real-machine/root capability, Docker, snapshot/fork, SSH/desktop, and per-second pricing for AI-agent software factories. This strengthens the development-laboratory use case: prepare one sanitized V4 template, fork isolated implementation, integration-test, failure/security-test, and review agents, and merge only reviewed Git commits. It does not change the production boundary because these advantages target coding agents rather than low-latency document-processing workers. Git remains the source of truth; Box snapshots accelerate environments but do not replace repository history, evidence storage, or CI.

## Q28 - Burst compute rather than Box

**Question:**
Clarification: Box was considered because large volumes and temporary files might overwhelm the existing DigitalOcean VM; the actual need is heavy temporary compute that can appear on demand.

**Answer / Reasoning:**
The concern is valid, but Box is not required to solve it. The clean-sheet architecture deliberately removes heavy document bytes and PDF processing from the Matter Workbench VM. Browsers upload directly to object storage; the main app and control plane handle only authorization, manifests, state, and events. Pre-warmed and burst stateless workers download only assigned documents/pages to encrypted local scratch space, inspect/split/render them, invoke cloud OCR, upload checkpointed outputs, securely delete scratch data, and terminate.

A purely cold on-demand pool cannot reliably satisfy P95 60 seconds because machine provisioning may consume the budget. Maintain a small warm baseline and use upload progress/page estimates to start additional workers before batch custody commit. The user's upload time becomes the scale-up window. The main DigitalOcean VM can remain small because it never buffers 2 GB, stores the authoritative PDF corpus locally, or performs all 10,000-page preflight work.

**Architecture / Initiative Impact:**
Confirmed | Later Edit Candidate

**Decision / Tension:**
This adds a capacity manager, worker images, scratch-data controls, and compute-second cost attribution, but it directly addresses burst workloads without making a coding-sandbox vendor part of production. Burst workers may run on DigitalOcean or another approved compute platform near the selected object store; provider choice should follow measured startup time, regional/data controls, network throughput, and cost.

**Later Edit Candidate:**
Add a pre-warmed baseline plus predictive burst-worker pool to the future V4 capacity design. Require bounded scratch disks, cleanup on success/failure, no authoritative local state, and per-job compute cost evidence.

**Potential Open Decisions:**
- Worker size, baseline count, and scale-up trigger needed for full-envelope SLOs.
- Production object-store/worker region.
- DigitalOcean versus another managed compute platform after startup and throughput benchmarks.

## Consolidation - 2026-08-24

### Confirmed Principles

- V4 is a clean-sheet Document Intake and Extraction Service called asynchronously by Matter Workbench; the main app retains users, matters, permissions, UI, and downstream workflows.
- Build V4 in a dedicated Matter Workbench Git worktree/feature branch, inside the same repository, with no production routes, imports, builds, or deployments until readiness gates pass.
- Use direct-to-object-storage uploads, server-computed hashes, content-addressed immutable blobs, PostgreSQL control-plane state, and stateless workers. The existing application VM must not buffer or process the full workload.
- Begin preflight/OCR per file after individual custody commit while the remaining batch uploads; keep final publication transactional at batch/result version boundaries.
- Exact duplicates consume no duplicate storage/provider work while every logical upload entry and provenance record remains visible. Near-duplicates are not discarded automatically.
- Pages are durable computation/checkpoint units; custody and assembly remain document boundaries. Preserve document locality when forming provider tasks.
- Providers are replaceable capabilities, not mandatory stages. Pin model versions and fingerprint source, pipeline, routing, model, and validator versions.
- Mandatory legal-completeness gates precede the 70% quality / 30% speed optimization. Cost is always measured per attempt but is not yet an optimization constraint.
- The initial service envelope is up to 500 PDFs, 10,000 pages, and 2 GB. Upload ETA is separate from processing: target P95 ≤60 seconds and P99 ≤120 seconds after durable custody commit, with honest exception reasons and revised ETA.
- Every page must have an explicit accepted or review outcome. An irreducible page must not block thousands of usable pages.
- Use capacity-aware admission and weighted fair scheduling. Maintain a small pre-warmed worker baseline and predictively start burst workers during upload; worker scratch state is bounded, temporary, and never authoritative.
- Migration is one-way: finite isolated/shadow validation, explicit go/no-go, drain legacy jobs, cut over, remove the legacy runtime, and fix forward exclusively within V4. Preserve historical user data and audit evidence, not obsolete execution infrastructure.
- Box by ASCII is not needed for production burst compute. It may be optional development tooling, but V4 must remain portable and production-hosted on appropriate regional compute.
- Development is complete only when V4 is evidence-backed, human-validated, load-tested, recoverable, observable, integrated as the sole runtime, and the legacy runtime is removed—not merely when code is written.

### Open Tensions

- The one-way cutover avoids ongoing legacy waste but raises the required quality, recovery, security, load, and operational evidence bar.
- The 500-file SLO is plausible only with demonstrated provider quotas and sufficient pre-warmed/burst capacity; quota grants alone do not prove usable throughput.
- Shared object storage and distributed workers add engineering/operational complexity, but the current single beta VM cannot credibly own the agreed workload.
- Partial-ready extraction improves usability, but downstream skills need explicit rules for pages still marked for review.
- Cloud-first routing is assumed initially; a restricted/local processing lane remains a future policy extension, not a launch blocker.

### Open Decisions

- Final WER/CER non-inferiority thresholds, expanded human-golden composition, and the minimum shadow/soak evidence for cutover.
- Exact route policy among native extraction, pinned Mistral OCR, Gemini, Textract, and future providers; Textract has not yet earned a mandatory launch role.
- Mistral production workspace, Google production project/billing/quota ownership, and optional AWS production role/quota access.
- Worker size, warm baseline, burst trigger, concurrent-load distribution, compute vendor, object-store region, and data-residency posture.
- Same PostgreSQL cluster with an owned schema versus a separate processing database; event transport and normalized-result ownership.
- Same-document chunk sizing that reduces provider-call count without recreating heterogeneous-batch latency.
- Cost optimization thresholds and emergency ceilings after quality and speed are solved; full cost attribution remains mandatory immediately.
- Restricted/private processing requirements, retention policies, and whether commercial priority tiers are ever allowed.

### Later Edit Candidates

- Create a canonical V4 architecture document covering custody, control plane, work graph, capability router, validation, scheduling/admission, assembly/versioning, cost ledger, observability, and user-facing states.
- Define versioned service APIs/events and stable capability, work-unit, progress/ETA, review, and normalized extraction-result contracts.
- Create an executable V4 acceptance matrix spanning function, quality, performance, restart/replay, provider failure, security, cost evidence, integration, and one-way decommission.
- Create the dedicated V4 worktree/branch and service/package boundaries with forbidden-import, build, and deployment guards.
- Prepare and submit a quota worksheet using existing benchmark evidence; obtain administrative ownership for every provider counted toward the SLO.
- Expand the human-adjudicated golden set across native, difficult primary, repair, and provider-disagreement pages.
- Implement in milestones: isolated service, integrated-but-disabled service, full-envelope certification, go/no-go, legacy drain, one-way cutover, and forward-only operation.

### Suggested Next Step

When the user explicitly requests implementation, first create the dedicated V4 worktree and write the executable acceptance matrix plus versioned service contracts and isolation guards. Then build the smallest end-to-end vertical slice: create intake, direct immutable custody, hash/deduplicate, one durable page work unit, one pinned provider adapter, validation, versioned assembly, complete cost/provenance evidence, and an extraction-ready event. Do not modify or activate production during that step.

## Interview Closed

Closed: 2026-08-24

No canonical architecture, production configuration, schema, route, deployment, or implementation file was changed during the interview. `Alignment Interview.md` is the sole interview artifact.
