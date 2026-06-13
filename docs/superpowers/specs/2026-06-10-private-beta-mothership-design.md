# Private Beta Mothership Design

## Purpose

Matter Workbench captures three operator inputs on each installation:

- explicit tester feedback from "Have a problem? Tell us what happened";
- automatic diagnostic signals derived from matter attention, failed jobs, and Skill Factory health;
- backend/deployment metrics for portability, restore confidence, runtime headroom, latency, and silent-wait risk.

Today those records remain in per-installation ledgers unless an external sync endpoint exists. The mothership closes that gap. It gives the product owner and Codex one central, durable baseline from which feedback and failures can be inspected, grouped, prioritized, and converted into development work.

The mothership is an operator tool, not a lawyer-facing product surface.

## Deployment Shape

The beta-real mothership should run as a separate service/VM from the public
Matter Workbench app VM:

```text
DigitalOcean App VM
  -> HTTPS feedback/signals/metrics/heartbeat
  -> separate DigitalOcean Mother VM/service
  -> separate PostgreSQL database
```

Same-VM loopback remains valid only for local/private rehearsal:

```text
Local rehearsal:
Matter Workbench :4191 -> 127.0.0.1 Mothership :4192
```

The release confidence path should not rely on loopback. The app-to-mothership
network boundary should be tested during beta because tenancy, runtime DB, auth,
TLS, retry, and outage behavior can hide when everything is on one machine.

The receiver is exposed to the app over HTTPS and authenticated bearer-token
ingestion. The endpoints stay the same whether the receiver is loopback in
rehearsal or separate-VM in beta.

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
- `POST /v1/signals` - accepts `private-beta-signal-sync/v1`;
- `POST /v1/metrics` - accepts `private-beta-metrics-sync/v1`;
- `POST /v1/heartbeats` - accepts `private-beta-heartbeat-sync/v1`.

Requests are limited to 256 KiB. Unknown routes return 404, unsupported methods return 405, invalid JSON or schemas return 400, missing/invalid credentials return 401, revoked installations return 403, and valid committed ingestion returns 202.

Retrying the same installation/event ID is idempotent and returns success without creating a duplicate.

## Stored Data

The mothership database owns five tables:

- `mothership_installations` - installation identity and lifecycle;
- `mothership_ingestion_tokens` - token digest, prefix, and revocation metadata;
- `mothership_feedback_events` - indexed feedback fields plus the received JSON payload;
- `mothership_signal_events` - indexed signal fields plus the received JSON payload;
- `mothership_metric_snapshots` - periodic backend/deployment health snapshots;
- `mothership_heartbeat_events` - compact journey and liveness snapshots.

The receiver stores the already-sanitized payload sent by Matter Workbench. With `MWB_PRIVATE_BETA_TELEMETRY_MODE=firm_internal`, useful firm-internal context is retained. Secret-like values remain redacted by the sender. Raw uploaded documents and document bytes are never part of this contract.

Payloads expire after 180 days by default. A daily prune operation deletes
expired feedback, signals, metric snapshots, and heartbeat events. The retention
period is configurable.

## Reliable Delivery

The Workbench sender keeps its current local ledgers and immediate send attempt. A small background retry coordinator captures backend metrics and calls queue-drain methods every five minutes. It must:

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

The report first shows the latest backend/deployment metrics and heartbeat
state, then groups open development evidence in this order:

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
- local rehearsal health checks;
- beta-real HTTPS ingestion checks from App VM to Mother VM/service;
- updates to the existing deployment documentation.

The Workbench runtime environment receives feedback/signal/metrics/heartbeat
URLs, its per-installation token, stable installation ID, and `firm_internal`
telemetry mode. In local rehearsal these URLs may be loopback. In beta-real
deployment they should point to the separate Mother VM/service HTTPS origin.

## Failure And Security Posture

- Mothership downtime queues data locally and does not block Matter Workbench.
- Database failure causes ingestion to return a non-success response, so the sender keeps the event queued.
- Tokens and database URLs are never printed by health/report commands.
- Request bodies, auth headers, and raw payloads are not written to service logs.
- The receiver has no matter database credentials and no file-storage access.
- Public or cross-VM exposure is forbidden until an HTTPS reverse proxy,
  bearer-token ingestion, and network policy are explicitly configured.

## Acceptance Criteria

- A registered installation can submit feedback, a signal, a metrics snapshot,
  and a heartbeat.
- Invalid, mismatched, and revoked tokens are rejected.
- Duplicate delivery does not duplicate rows.
- Workbench retries queued events automatically after receiver recovery.
- A prioritized Markdown/JSON report includes the submitted evidence.
- Local rehearsal proves receiver and Workbench can run as separate active
  services on one VM.
- Beta-real smoke proves the public App VM can ingest to a separate Mother
  VM/service over HTTPS.
- The mothership database role cannot access Matter Workbench legal data.
- Full tests, build, VM service checks, and end-to-end ingestion pass.
