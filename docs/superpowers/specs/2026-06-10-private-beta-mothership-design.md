# Private Beta Mothership Design

## Purpose

Matter Workbench already captures two development inputs on each installation:

- explicit tester feedback from "Have a problem? Tell us what happened";
- automatic diagnostic signals derived from matter attention, failed jobs, and Skill Factory health.

Today those records remain in per-installation ledgers unless an external sync endpoint exists. The mothership closes that gap. It gives the product owner and Codex one central, durable baseline from which feedback and failures can be inspected, grouped, prioritized, and converted into development work.

The mothership is an operator tool, not a lawyer-facing product surface.

## Deployment Shape

The first mothership runs on the existing Debian private VM as a second user-level systemd service:

```text
Matter Workbench :4191 -> feedback/signals -> Mothership :4192 -> separate PostgreSQL database
```

The receiver binds to `127.0.0.1:4192`. The current Workbench installation reaches it over loopback. A later cloud deployment can expose the same endpoints through HTTPS without changing the ingestion contract.

The mothership uses a separate `matter_workbench_mothership` database and restricted database role. It does not query or modify legal matter tables.

## Installation Identity And Authentication

Each beta installation has:

- a stable human-readable installation ID;
- a label;
- an active or revoked status;
- one or more ingestion tokens.

Tokens are random high-entropy bearer tokens. The raw token is printed once by the operator command and is never stored. PostgreSQL stores only a SHA-256 digest and a short non-secret prefix. Revoking one installation must not interrupt any other installation.

Every request must satisfy both conditions:

1. its bearer token resolves to an active installation;
2. its payload `installId` equals that installation's ID.

## HTTP Contract

The receiver exposes:

- `GET /health` - no secret details, only receiver/database readiness;
- `POST /v1/feedback` - accepts `private-beta-feedback-sync/v1`;
- `POST /v1/signals` - accepts `private-beta-signal-sync/v1`.

Requests are limited to 256 KiB. Unknown routes return 404, unsupported methods return 405, invalid JSON or schemas return 400, missing/invalid credentials return 401, revoked installations return 403, and valid committed ingestion returns 202.

Retrying the same installation/event ID is idempotent and returns success without creating a duplicate.

## Stored Data

The mothership database owns four tables:

- `mothership_installations` - installation identity and lifecycle;
- `mothership_ingestion_tokens` - token digest, prefix, and revocation metadata;
- `mothership_feedback_events` - indexed feedback fields plus the received JSON payload;
- `mothership_signal_events` - indexed signal fields plus the received JSON payload.

The receiver stores the already-sanitized payload sent by Matter Workbench. With `MWB_PRIVATE_BETA_TELEMETRY_MODE=firm_internal`, useful firm-internal context is retained. Secret-like values remain redacted by the sender. Raw uploaded documents and document bytes are never part of this contract.

Payloads expire after 180 days by default. A daily prune operation deletes expired feedback and signals. The retention period is configurable.

## Reliable Delivery

The Workbench sender keeps its current local ledgers and immediate send attempt. A small background retry coordinator calls both queue-drain methods every five minutes. It must:

- never block startup or lawyer workflows;
- prevent overlapping retries;
- stop cleanly with the server;
- retain queued items until the receiver commits them;
- log only bounded, secret-redacted summaries.

## Operator Workflow

There is no dashboard in this slice. Operator commands provide:

- database migration;
- installation registration and token issuance;
- installation revocation;
- receiver health;
- prioritized report generation for a chosen time window;
- retention pruning.

The report groups open development evidence in this order:

1. blocker/error diagnostic signals;
2. repeated warning signals, ranked by occurrence count;
3. tester reports classified as bugs;
4. confusing-UX reports;
5. feature ideas.

The report is emitted as Markdown and JSON so a future Codex session can read it, verify the underlying evidence, and choose implementation targets. It is evidence, not an automatic instruction to edit code.

## VM Operations

The deploy includes:

- `matter-workbench-mothership.service`;
- a separate mode-0600 mothership environment file;
- migration and installation-management commands;
- VM-local health and end-to-end ingestion checks;
- updates to the existing deployment documentation.

The Workbench runtime environment receives loopback feedback/signal URLs, its per-installation token, stable installation ID, and `firm_internal` telemetry mode.

## Failure And Security Posture

- Mothership downtime queues data locally and does not block Matter Workbench.
- Database failure causes ingestion to return a non-success response, so the sender keeps the event queued.
- Tokens and database URLs are never printed by health/report commands.
- Request bodies, auth headers, and raw payloads are not written to service logs.
- The receiver has no matter database credentials and no file-storage access.
- Public exposure is forbidden until an HTTPS reverse proxy and network policy are explicitly configured.

## Acceptance Criteria

- A registered installation can submit feedback and a signal.
- Invalid, mismatched, and revoked tokens are rejected.
- Duplicate delivery does not duplicate rows.
- Workbench retries queued events automatically after receiver recovery.
- A prioritized Markdown/JSON report includes the submitted evidence.
- Receiver and Workbench run as separate active services on the Debian VM.
- The mothership database role cannot access Matter Workbench legal data.
- Full tests, build, VM service checks, and end-to-end ingestion pass.

