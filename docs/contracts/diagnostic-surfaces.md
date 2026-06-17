# Diagnostic Surfaces

Status: Current boundary contract

This contract defines the boundary between matter-level diagnostics and
app/system-level diagnostics.

The core rule is:

```text
Matter Attention explains what is wrong in one matter
System Health explains what is wrong with the app/runtime
```

Do not merge these into one score.

## Why This Exists

Matter Workbench can fail for very different reasons:

- a single matter has missing source files;
- one PDF extracted poorly;
- one Source Index is stale or invalid;
- one custom skill run returned warnings;
- the matters home folder is not writable;
- an API key is missing;
- all provider-backed calls are failing;
- the local app cannot read its stores.

Those failures need different surfaces. A lawyer or developer should not have
to infer whether a problem is matter-specific or system-wide from a scattered
log trail.

## Matter Attention

Matter Attention answers:

```text
For this matter, what looks broken or risky right now?
```

Current local implementation:

- `GET /api/matter-attention`;
- optional named matter query;
- `npm run matter-attention:report`;
- compact matter overview/advisory display.

Matter Attention is current-state and matter-scoped. It reads existing matter
traces and aggregates them into evidence-backed items.

It may inspect:

- `matter.json`;
- intake `File Register.csv`;
- intake `Extraction Log.csv`;
- `10_Library/Source Index.json`;
- `10_Library/List of Dates.md`;
- `10_Library/List of Dates.json`;
- rerun advice;
- configurable custom-skill run receipts;
- matter-scoped command interactions.

Matter Attention may report:

- intake blockers;
- extraction/OCR warnings;
- skipped unsupported files;
- source-label review needs;
- chronology dependency issues;
- custom-skill run failures/warnings;
- active-matter command failures.

It must not:

- call providers;
- run skills;
- mutate matter artifacts;
- write new logs in the local/V1 file app;
- preserve advisory history in local/V1;
- diagnose global provider or filesystem health as its primary job.

## System Health

System Health answers:

```text
Is the app itself configured, connected, writable, and operational?
```

Current first-slice implementation:

- `GET /api/system-health`;
- schema `system-health/v1`;
- `npm run system-health:report`;
- compact Settings-page readiness card for operator/local surfaces.

Its scope includes app/runtime setup rather than any one matter:

- matters home configured, readable, and writable where required;
- runtime DB storage mode configured when selected;
- `.env` readability/parseability without exposing secret values;
- provider/model routes resolve through policy;
- configured provider keys exist where required;
- recent global job failures point to provider/runtime posture;
- command interaction log is readable and recent command failures are summarized;
- private beta observability ledgers are readable, so telemetry retry evidence can be trusted;
- matter list scanning does not throw.

System Health is read-only in this first slice. It must not run skills, call
providers, mutate config, write matter artifacts, enforce credits, or initiate
billing/payment flows.

## Stable Diagnostic Code Families

Operator-only chrome may include stable `code` values in terminal-style error
copy. Those codes are for support triage and should remain safe to show without
raw paths, secrets, provider prompts, or work product.

Current hosted-beta families include:

| Family | Scope | Example codes |
| --- | --- | --- |
| `runtime_db.read.*` | DB-backed workspace/file reads. | `runtime_db.read.file_not_found`, `runtime_db.read.payload_missing` |
| `runtime_db.storage.*` | Low-level DB storage queries. | `runtime_db.storage.query_failed`, `runtime_db.storage.invalid_json` |
| `runtime_db.matter_index.*` | Runtime DB matter listing/resolution. | `runtime_db.matter_index.query_failed`, `runtime_db.matter_index.no_json` |
| `runtime_db.upload.*` | Runtime DB upload/add-files allocation. | `runtime_db.upload.matter_not_found`, `runtime_db.upload.allocation_failed` |
| `runtime_db.command_log.*` | Runtime DB command interaction audit reads/writes. | `runtime_db.command_log.query_failed`, `runtime_db.command_log.invalid_json` |
| `runtime_db.configurable_skill*.*` | Runtime DB custom-skill stores and run ledgers. | `runtime_db.configurable_skill_store.query_failed`, `runtime_db.configurable_skill_run.not_found` |
| `runtime_db.skill_idea.*` / `runtime_db.skill_sample.*` | Runtime DB Skill Factory ideas/samples. | `runtime_db.skill_idea.write_failed`, `runtime_db.skill_sample.stale` |
| `upload.*` | Multipart upload and browser-relative path validation. | `upload.multipart_required`, `upload.paths_mismatch`, `upload.too_large` |
| `private_beta.feedback.*` | Private beta feedback validation. | `private_beta.feedback.invalid_choice`, `private_beta.feedback.trying_to_do_required` |
| `http.*` | Cross-cutting HTTP request parsing. | `http.invalid_json_body`, `http.json_body_too_large` |
| `workspace.*` | Local workspace preview/raw-file reads. | `workspace.path_hidden`, `workspace.preview.unsupported_type`, `workspace.raw.not_file` |
| `job.*` / `workflow.*` | Durable job and workflow failures. | `job.stale_running`, `workflow.extract.failed` |

These codes do not change the surface boundary: matter-specific failures still
belong in Matter Attention, while app/runtime-wide failures belong in System
Health. They simply give operators stable handles for logs, screenshots, and
support tickets.

## Examples

| Symptom | Surface |
| --- | --- |
| One matter is missing `Source Index.json`. | Matter Attention |
| One matter has `Extraction Log.csv` OCR warnings. | Matter Attention |
| One custom skill run has warnings. | Matter Attention |
| One active-matter command failed. | Matter Attention |
| Matters home is not writable. | System Health |
| OpenRouter key is missing and all source-label runs fail. | System Health |
| App-local JSON stores are unreadable. | System Health |
| Feedback/signal/metrics ledgers cannot be read for retry evidence. | System Health |
| Provider-backed commands fail across many matters after config change. | System Health |

Matter Attention may surface the symptom first. System Health should explain the
shared root cause when the problem is app-wide.

## Hosted Beta Direction

Hosted beta should not make Matter Attention its own durable source of truth.

The durable backend should persist canonical facts such as:

- incidents;
- job failures;
- artifact validation results;
- provider run failures;
- audit events.

Matter Attention should be a view/projection over those facts, plus optional
acknowledgements if needed.

Preparation Advisory snapshots may be preserved in hosted beta for QA and
support, but only as snapshots tied back to canonical incidents/jobs/artifact
validations. Do not add durable advisory history to the local file-based app.

## UI Placement

Matter Attention belongs near the active matter:

- matter overview;
- Preparation Advisory;
- matter-scoped developer report.

System Health belongs near app administration:

- Settings;
- developer/admin diagnostics;
- CLI/system report.

Lawyers should not have to read provider routing tables, raw logs, or store
diagnostics during normal legal work.

## Non-Goals

- This contract does not create a background monitor.
- This contract does not define a hosted incident schema.
- This contract does not make diagnostics lawyer-facing legal advice.
- This contract does not preserve local advisory history.
- This contract does not replace cost visibility or provider-run ledgers.

## Implementation Pointers

Current code and docs connected to this contract include:

- `services/matter-attention-service.mjs`;
- `services/matter-attention-intake.mjs`;
- `services/matter-attention-source-labels.mjs`;
- `services/matter-attention-chronology.mjs`;
- `services/matter-attention-custom-runs.mjs`;
- `services/matter-attention-command-failures.mjs`;
- `scripts/matter-attention-report.mjs`;
- `scripts/system-health-report.mjs`;
- `services/system-health-service.mjs`;
- `routes/matter-workflow-routes.mjs`;
- `routes/app-shell-routes.mjs`;
- `docs/future-design-decisions/matter-developer-attention-surface.md`;
- `docs/future-design-decisions/system-health-surface.md`;
- `test/matter-attention-*.test.mjs`.
