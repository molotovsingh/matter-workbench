# Matter Workbench

**Matter Workbench is an AI-assisted legal workbench that turns messy case documents into a structured, source-backed workspace lawyers can review and use.**

It is built for the first hard part of legal work: taking PDFs, emails, scans, spreadsheets, pleadings, notices, orders, and client material, then producing an auditable record with document labels, extracted text, a source index, matter context, and a lawyer-review-ready chronology.

> Status: **Beta 3 private-cloud beta is code-complete, deployed, migration `019_credit_ledger` is applied and recorded, and deployed smoke has passed.**
>
> Access: **Private beta only.** This is not a public self-serve legal advice product; trusted testers use supervised accounts and lawyer review remains mandatory.

---

## Why This Exists

Legal AI is only useful when the lawyer can trust where each answer came from.

Matter Workbench is not a generic chatbot. It is closer to a disciplined junior chamber clerk:

1. preserve the incoming brief;
2. identify and fingerprint every source;
3. extract the record;
4. label documents in lawyer-readable language;
5. build source-backed matter artifacts;
6. keep every AI-assisted output reviewable by a lawyer.

The product goal is simple:

```text
messy matter folder -> structured legal workspace -> source-backed legal work product
```

---

## What It Does Today

### Matter Intake

- Upload or point the app at a matter folder.
- Preserve originals and assign stable document IDs.
- Detect duplicate files and unsafe upload paths.
- Keep matter metadata and file custody explicit.

### Extraction And Source Indexing

- Extract text from supported documents.
- Support OCR-first handling for scanned PDFs when configured.
- Produce source records and lawyer-readable source labels.
- Validate model output against server-owned file identity and citations.

### List Of Dates / Chronology

- Build a chronological List of Dates from the matter record.
- Preserve source references for review.
- Flag stale dependencies and review needs.
- Keep generated legal artifacts separate from originals and dispatch-ready outputs.

### Matter Copilot

- Answer matter questions from bounded matter context.
- Fail closed on unsupported citations.
- Keep transient Q&A separate from durable legal artifacts.

### Custom Skills

- Let operators design reusable legal workflows.
- Generate samples, require review, and activate versioned custom skills.
- Preserve custom-skill run receipts for audit and improvement.

### Private Beta Operations

- Private beta login and tester accounts.
- In-app feedback capture.
- Operator/mothership reports for bugs, confusing UX, feature requests, and runtime signals.
- Read-only System Health for provider/config/runtime/storage posture.
- Runtime DB private-cloud deployment path with tenant-scoped Postgres migrations.

---

## Why It Is Different

### Source-backed by design

Matter Workbench treats citations, source identity, and artifact boundaries as product contracts, not prompt suggestions.

### Legal-review-ready, not lawyer-replacement

The app is designed to help lawyers review faster. It does not claim that generated output is court-ready without human verification.

### Workflow, not chat

Outputs are durable artifacts: source indexes, extracted records, lists of dates, skill receipts, and diagnostic reports. Work does not disappear into a chat transcript.

### Local/private-cloud custody

The project supports a local-first workflow and a private-cloud runtime DB path. Legal data custody is explicit, tenant-scoped, and designed for controlled beta deployment.

### Feedback becomes product intelligence

Beta feedback, job traces, system health, and operator reports are being shaped into a governed improvement loop: evidence first, triage second, gated work third.

---

## Current Beta 3 State

Beta 3 is deployed and release-closeout checked.

Completed release checks include:

- Postgres migration `019_credit_ledger` applied and recorded;
- private-cloud deployment to the beta VM;
- runtime DB migration through `019_credit_ledger`;
- login smoke;
- matter upload smoke;
- extraction, source labels, and List of Dates smoke;
- Matter Copilot endpoint smoke;
- feedback submission and sync smoke;
- System Health smoke;
- browser UI hardening pass with zero console errors;
- runtime and mothership service checks.

Current release docs:

- [v1.0.0-beta.15 release marker](docs/releases/v1.0.0-beta.15.md)
- [Docs map](docs/README.md)
- [Private beta runbook](docs/beta-user-runbook.md)
- [Database transition handoff](docs/database-transition-handoff.md)

---

## Architecture At A Glance

```text
React app
  -> Node local/private runtime server
    -> matter engines
    -> provider routing layer
    -> runtime DB storage mode
    -> private beta telemetry / feedback / health surfaces
```

Core surfaces:

- `react-ui/` - product shell and lawyer/operator UI.
- `routes/` - API route groups.
- `services/` - matter storage, model routing, health, skill, feedback, and runtime services.
- `db/migrations/` - Postgres control-plane and runtime DB migration track.
- `docs/contracts/` - current product/engineering contracts.
- `docs/future-design-decisions/` - parked roadmap and implementation decisions.

For a deeper codebase map, see [docs/codebase-diagram.md](docs/codebase-diagram.md).

---

## Safety And Governance

Matter Workbench is built around legal safety boundaries:

- no silent mutation of generated legal artifacts;
- server-owned source identity and citation validation;
- separation between raw originals, generated drafts, and dispatch-ready outputs;
- private beta authentication and operator-only diagnostic surfaces;
- tenant-scoped runtime DB posture;
- secret redaction in reports and telemetry;
- read-only first slices for cost, credit, and system health;
- human review before legal reliance.

Important: this beta is not a public self-serve legal advice product.

---

## Roadmap Themes

Near-term roadmap themes are documented rather than hidden in ad hoc issues:

- feedback-to-ticket improvement loops;
- observability-to-smaller-model cost reduction;
- broader native legal skill library;
- hosted beta worker architecture;
- richer document/source inventory;
- spreadsheet and communication evidence ingestion;
- governed credit/cost reporting;
- stronger runtime health and incident projection.

See:

- [Feedback-To-Improvement And Smaller Models](docs/future-design-decisions/feedback-to-improvement-and-smaller-models.md)
- [Native Skill Library Strategy](docs/future-design-decisions/native-skill-library-strategy.md)
- [Hosted Beta Database Architecture](docs/future-design-decisions/hosted-beta-database-architecture.md)
- [Credit System](docs/future-design-decisions/credit-system.md)

---

## Development Quickstart

```sh
npm install
npm test
npm run ui:build
npm start
```

Read-only local health:

```sh
npm run system-health:report
```

Database migration posture:

```sh
npm run db:migrations:check
npm run db:doctor
```

For the full technical README that previously lived at the repo root, see
[docs/engineering-readme-archive.md](docs/engineering-readme-archive.md).

---

## Investor / Partner Note

Matter Workbench is early, but the beta now demonstrates the core thesis:

```text
AI legal work becomes valuable when it is source-backed, workflow-native,
observable, and governed by reviewable product contracts.
```

The investment opportunity is not just another legal chatbot. It is a legal-work operating system that can accumulate workflow evidence, feedback, traces, and domain-specific process knowledge, then convert that into safer product automation and lower-cost specialised intelligence over time.

For partnership or investment conversations, review the product docs above and request a supervised beta walkthrough.
