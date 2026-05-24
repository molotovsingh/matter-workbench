# Future Design Decisions

Date: 2026-05-19
Status: Current decision ledger

This folder holds parked product decisions, SME requirement capture, current local contracts, and implementation-contract drafts for Matter Workbench.

The purpose of this ledger is to keep future work reviewable without letting product-discovery notes become scattered implementation authority. When a rule appears in multiple notes, implementation should promote it into one canonical contract before more code depends on it.

This README tracks the 22 decision documents in this folder. The README itself is the ledger, not a separate product decision.

## Status Meanings

| Status | Meaning |
| --- | --- |
| Current local contract | Implemented or actively used in the local/V1 product; changes should be treated as contract changes. |
| Current V0 accepted | Current minimum behavior is accepted; larger refinements remain parked until user testing or product need justifies them. |
| First slice landed | The first code slice exists, but the broader product direction may still evolve. |
| Implementation contract draft | Detailed enough to guide implementation, but still needs acceptance against current scope before coding. |
| SME requirement capture | Legal/product requirement capture; not yet a final build contract. |
| Working product note | Directionally accepted product strategy; needs execution planning before implementation. |
| Parked for later product decision | Documented option or direction that should not be implemented until an explicit product decision or trigger occurs. |
| Parked future feature | Intentionally not current work; revisit only when stated triggers or product need appear. |
| Parked UX backlog | Observed UX improvements; useful for polish, not itself an implementation contract. |

## Decision Ledger

| Document | Status | Priority | Revisit / trigger | Next action |
| --- | --- | --- | --- | --- |
| [Legal Workbench Policy Prompt](legal-workbench-policy-prompt.md) | First slice landed | High | Any provider-backed legal task, model-routing change, or custom/native skill expansion | Keep as the canonical app-level legal-output policy; ensure new provider-backed work composes it and records `policyPromptVersion`. |
| [Matter Developer Attention Surface](matter-developer-attention-surface.md) | Current local contract | High | New matter lifecycle traces, hosted incidents, advisory-history needs, or diagnostic UI changes | Keep matter-scoped; hosted beta should project from canonical incidents rather than making attention its own source of truth. Park durable Preparation Advisory history until database-backed incidents/jobs exist. |
| [Custom Skill Run Critique](custom-skill-run-critique.md) | Current V0 accepted; critique action parked | Medium | User testing shows `Improve this skill` is too vague after weak outputs | Keep V0 actions; do not add critique mutation paths outside the governed sample/version flow. |
| [Custom Skill Lifecycle Controls](custom-skill-lifecycle-controls.md) | Implementation contract draft | Medium | Users need to pause, archive, or delete custom skills during beta cleanup | Add lifecycle controls only for configurable/custom skills. Native skills remain app-owned and non-removable. Preserve run receipts and matter artifacts. |
| [React-Only Cutover And Database Transition](react-only-cutover-database-transition.md) | Current local contract / transition prep | High | Any product-shell route, legacy frontend deletion, or database-first-slice work | Keep `/` React-only. Delete retired browser UX safely, but migrate useful helpers first. Use `db/migrations/001_control_plane.sql` through `db/migrations/006_job_execution_leases.sql` and `scripts/db-migrate.mjs` as the preparatory database baseline. |
| [Hosted Beta Database Architecture](hosted-beta-database-architecture.md) | Implementation contract draft | High, but not first local polish | Hosted implementation begins | Keep as one broad contract for now. Split only when implementation starts. Enforce the stop rule before hosted legal engines move to workers. |
| [Native Skill Implementation Contract](native-skill-implementation-contract.md) | Implementation contract draft | High | Native skill UI/contract work resumes | Promote repeated source-label, staleness, visibility, and dispatch rules into canonical contracts before broad implementation. |
| [Native Skill Library Strategy](native-skill-library-strategy.md) | Working product note | High | Planning next native skill beyond current spine | Convert into an execution table: skill, lawyer question, inputs, outputs, source-backed fields, deterministic/model-heavy parts, cost risk, custom-skill demand replaced, status. |
| [Document Index / Source Inventory](native-skill-document-index-source-inventory.md) | SME requirement capture | High | Source Labels / Document Index work resumes | Resolve SME questions, then turn accepted requirements into source-record schema and review workflow contract. |
| [Chronology / List of Dates](native-skill-chronology-list-of-dates.md) | SME requirement capture started | High | List of Dates family, court-facing mode, or drafting handoff work resumes | Confirm output shape and court-facing export boundaries; align implementation with canonical source identity and staleness contracts. |
| [Matter Metadata and Client Interview](matter-metadata-client-interview.md) | SME requirement capture | Medium-High | New Matter flow or metadata review work resumes | Define minimum stage/role choices and metadata review behavior after documents are ingested. |
| [Lawyer-Facing Terminology Contract](lawyer-terminology-contract.md) | Parked for later product decision | Medium-High near-term polish | Beta UX polish, confusing labels, or command/report copy churn | Promote a small presentation-label slice before deeper engine work: lanes, statuses, paid/local posture, known artifacts, command states. |
| [Model-To-App Task Policy](model-to-app-task-policy.md) | Current boundary landed; broader selector policy parked | Medium | Any broader model selector, draft-amendment selector, or provider-choice expansion is proposed | Follow [Model Task Boundaries](../contracts/model-task-boundaries.md): Copilot selection is narrow; durable skills/artifacts stay on app-owned policy. |
| [Cost Estimation Framework](cost-estimation-framework.md) | Parked for later product decision | Medium | Cost confusion, hosted provider-run ledger, or paid rerun UX pressure | Start with read-only derived matter cost from existing `ai_run` metadata; avoid billing language. |
| [System Health Surface](system-health-surface.md) | Parked future feature | Medium | Provider/config/runtime failures need app-wide diagnosis | Keep separate from Matter Attention; first slice should be read-only settings/CLI health. |
| [Parallel Processing and Latency Strategy](parallel-processing-latency.md) | Parked future feature; local/V1 runtime path | Medium | Long native-skill latency becomes a beta blocker | First local slice should be bounded parallel Source Labels batches with deterministic merge and progress receipts. |
| [Spreadsheet Understanding](spreadsheet-understanding.md) | Parked future feature | Medium | Beta matters show spreadsheets are common and legally material | Keep current CSV/XLSX flattening. Later add a read-only spreadsheet summary and risk pass before screenshot/vision fallback. |
| [Communication Evidence Ingestion](communication-evidence-ingestion.md) | Parked future feature | Medium | Beta matters contain WhatsApp, screenshots, email attachments, `.msg`, or communication-heavy evidence | Keep current `.txt` and `.eml` extraction. Later add structured chat/email ingestion before vision fallback. |
| [Public Indian Legal Updates Widget](public-indian-legal-updates-widget.md) | Parked future feature; experimental integration only | Low-Medium | Product explicitly wants public legal-news updates inside the workbench and Parallel/provider contract is confirmed | Keep disabled by default. Do not implement against a guessed endpoint, send matter data, or place it as a floating panel over the command/workspace surfaces. |
| [Custom Skill Prompt Inspector](custom-skill-prompt-inspector.md) | Parked for later product decision | Low-Medium | Power users need transparency into active custom skill instructions | Start read-only; do not allow live prompt edits without versioned sample approval. |
| [Conversation Layout](conversation-layout.md) | Parked for later product decision | Low-Medium | Longer interviews/copilot sessions outgrow the rail | Prefer reversible `Expand conversation` layout before any chat-first redesign. |
| [Lawyer First-Run UX Friction Report](lawyer-first-run-ux-friction-2026-05-14.md) | Parked UX backlog; not implementation contract | Medium polish | Beta onboarding polish or first-run confusion | Mine for small UI copy/navigation fixes; do not treat as engine or storage contract. |

## Contract Centralization Backlog

The repetition across these notes is expected product-discovery residue, not a failure. Before more implementation lands, these repeated rules should become canonical contracts so code and docs do not drift.

| Contract area | Repeated in | Canonicalization target |
| --- | --- | --- |
| Source identity and lawyer-facing labels | Native skill implementation, Document Index, Chronology, Legal Policy, Hosted Beta | Canonicalized in [Source Identity and Labels](../contracts/source-identity-and-labels.md). Older notes should link there instead of restating the rule. |
| Artifact visibility and naming | Native Skill Library, Lawyer Terminology, Chronology, Document Index, Hosted Beta | Canonicalized in [Artifact Visibility and Dispatch](../contracts/artifact-visibility-and-dispatch.md). Older notes should link there instead of restating lane, visibility, or naming rules. |
| Staleness taxonomy | Native skill implementation, Document Index, Chronology, current List of Dates behavior | Canonicalized in [Dependency States and Staleness](../contracts/dependency-states-and-staleness.md). Older notes should link there instead of restating the taxonomy. |
| Dispatch boundary | Native Skill Library, Native Skill Implementation, Legal Policy, Lawyer Terminology | Canonicalized in [Artifact Visibility and Dispatch](../contracts/artifact-visibility-and-dispatch.md). `40_Dispatch` is a frozen send/file-ready boundary; further work starts from a new draft. |
| No silent skill/prompt mutation | Custom Skill Prompt Inspector, Custom Skill Run Critique, Legal Policy, Model-To-App Task Policy | Canonicalized in [Custom Skill Governance](../contracts/custom-skill-governance.md). Active skills/prompts do not mutate in place; changes go through draft version, sample, approval, validation, activation. |
| Model/task isolation | Model-To-App Task Policy, Legal Policy, Cost Framework, Hosted Beta | Canonicalized in [Model Task Boundaries](../contracts/model-task-boundaries.md). User-visible Copilot choices cannot leak into durable skill creation, validation, or source-backed artifacts. |
| Matter vs system diagnostics | Matter Developer Attention, System Health, Hosted Beta | Canonicalized in [Diagnostic Surfaces](../contracts/diagnostic-surfaces.md). Matter-local attention and app/runtime health stay separate. |

## Near-Term Recommended Order

1. Maintain this README as the decision ledger.
2. Centralize repeated contracts before expanding implementation.
3. Keep the hosted beta architecture intact until implementation begins; split it only when there is a concrete hosted first-slice plan.
4. Promote a small lawyer-facing terminology/presentation slice for beta polish without touching engines or storage contracts.
5. Turn the native skill library strategy into an execution planning table.

## Maintenance Rules

- When adding a future-decision doc, add it to the decision ledger above.
- When a parked note becomes implementation work, update its status and next action here first.
- When a repeated rule becomes canonical, link the canonical contract from every older note that still discusses it.
- Do not treat broad product notes as implementation permission unless their status or a linked implementation plan says so.
- Keep filesystem/API/schema names stable unless a migration contract explicitly authorizes a change.
