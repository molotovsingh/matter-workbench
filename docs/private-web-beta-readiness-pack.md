# Private Web Beta Readiness Pack

Status: actionable pre-deployment gate for trusted private web beta

This pack answers one practical question:

> Can a trusted lawyer tester open Matter Workbench through a web URL without
> turning the current private beta into public SaaS?

The expected answer is narrow. This is for a controlled firm/private beta with
known users, an operator watching the app, and a developer feedback loop. It is
not public SaaS, not anonymous access, not multi-tenant hosted production, and
not unsupervised legal reliance.

## Target Boundary

Use this path when:

- testers are trusted firm/internal users;
- the deployment is one controlled VM or cloud instance;
- access is private-beta login gated;
- the app runs in explicit runtime DB mode;
- file/artifact payload custody is database-backed for the runtime;
- feedback and diagnostic signals sync automatically to a trusted mothership;
- the operator can roll back, inspect logs, and collect bug evidence.

Do not use this path when:

- the URL is public without login;
- the app is served over plain HTTP to remote testers;
- the runtime DB still points at a superuser role;
- file payloads live only in an unbacked local folder;
- there is no backup/restore proof;
- tester feedback requires manual export;
- no one is watching job failures, provider failures, or advisory signals.

## Required Runtime Posture

Set private beta access:

```text
MWB_PRIVATE_BETA_PUBLIC_URL=https://...
MWB_PRIVATE_BETA_AUTH=required
MWB_PRIVATE_BETA_USERNAME=...
MWB_PRIVATE_BETA_PASSWORD=...
```

`MWB_PRIVATE_BETA_PUBLIC_URL=https://...` is important because the auth service
uses it to mark the session cookie `Secure`. If the public URL is HTTPS but that
env var is unavailable, set:

```text
MWB_PRIVATE_BETA_COOKIE_SECURE=true
```

Set runtime DB custody:

```text
MWB_RUNTIME_DB=postgres
MWB_RUNTIME_DB_STORAGE=postgres
MWB_DB_RUNTIME_CUTOVER_APPROVED=yes
MWB_RUNTIME_DATABASE_URL=postgres://...
```

`MWB_RUNTIME_DATABASE_URL` should be the app runtime role, not the migration or
admin role. The runtime write smoke must reject a superuser or `BYPASSRLS`
connection.

Set mothership sync:

```text
MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL=https://...
MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN=...
MWB_PRIVATE_BETA_SIGNAL_SYNC_URL=https://...
MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN=...
MWB_PRIVATE_BETA_INSTALL_ID=...
MWB_PRIVATE_BETA_TELEMETRY_MODE=firm_internal
```

If signal-specific URL/token values are not provided, diagnostic signals fall
back to the feedback mothership. For firm-internal beta, `firm_internal` mode is
preferred because trusted lawyers in the same custody boundary need useful
debugging context. Secrets are still redacted.

Provider keys are still needed for the workflows testers will exercise:

```text
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...
MISTRAL_API_KEY=...
GEMINI_API_KEY=...
```

## Readiness Command

Run:

```bash
npm run private-web:readiness-check
```

For the full Codex/operator deployment command sequence, generate the
[Codex Private Beta Deployment Pack](private-beta-codex-deployment.md):

```bash
npm run private-beta:deployment-pack
```

To check a URL before it is written into the environment:

```bash
npm run private-web:readiness-check -- --public-url https://mwb-beta.example.com
```

For machine-readable output:

```bash
npm run private-web:readiness-check -- --json
```

The check fails only for blockers:

- missing HTTPS tester URL;
- private beta auth not required;
- missing access credentials;
- insecure cookie posture for HTTPS beta;
- runtime DB/Postgres custody not explicitly enabled;
- missing runtime database URL;
- missing feedback mothership URL/token;
- invalid non-HTTPS mothership URL.

Warnings are still important, but they do not block the command:

- runtime DB URL falls back to a generic `MWB_DATABASE_URL`;
- missing install ID;
- safe/default telemetry instead of firm-internal mode;
- missing provider keys;
- operator evidence packs not yet run.

## Operator Evidence Before Handoff

After the readiness command has no blockers, run the lower-level proof commands:

```bash
npm run private-vm:security-check
npm run private-vm:recoverability-pack
MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:write-smoke
npm run private-beta:rc-closure-pack
```

Those commands prove different things:

- `private-vm:security-check` checks access posture, env-file permissions,
  service hardening, audit disposition, and live service behavior.
- `private-vm:recoverability-pack` checks backup/restore posture for the runtime.
- `db:runtime:write-smoke` proves the runtime DB role is not a superuser or
  `BYPASSRLS` role and can roll back controlled writes.
- `private-beta:rc-closure-pack` aggregates local verification, browser/runtime
  acceptance, VM health, security posture, ops evidence, and recoverability.

## Tester Handoff Rule

Give testers:

- the app URL;
- the login credentials;
- [Private Beta Tester Brief](private-beta-tester-brief.md);
- the rule that generated legal output always needs lawyer review;
- the rule that they should click **Have a problem? Tell us what happened** as
  soon as something is confusing, wrong, slow, or legally weak.

Do not ask testers to manually export feedback or diagnostic files. The app
should store feedback locally and sync feedback plus monitor signals to the
mothership automatically.

## Stop Rules

Do not hand over the URL if any of these are true:

- `private-web:readiness-check` has blockers;
- runtime DB write smoke fails;
- recovery pack cannot prove database/file custody recovery;
- private beta auth is optional or missing;
- the VM/service logs show repeated startup or database errors;
- mothership sync is not configured;
- the current commit has not passed the beta closure pack;
- the operator cannot roll back to the previous deployment.

This is intentionally stricter than local play-testing. Local play can tolerate
rough edges. A web URL given to lawyers needs a clearer custody and feedback
story.
