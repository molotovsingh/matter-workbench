# Private Beta Mothership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a separate operator-only receiver that durably ingests Matter Workbench beta feedback and diagnostic signals, retries delivery, and emits prioritized development reports.

**Architecture:** Add a second Node HTTP service with a separate PostgreSQL database and per-installation hashed bearer tokens. Preserve the existing sender payloads, add a non-blocking retry coordinator to Workbench, and expose all operator functions through tested CLI commands rather than a dashboard.

**Tech Stack:** Node.js ES modules, PostgreSQL/`psql`, user-level systemd, existing JSON sender ledgers, Node test runner.

---

### Task 1: Mothership schema and migration runner

**Files:**
- Create: `mothership/db/migrations/001_mothership.sql`
- Create: `mothership/db-migrate.mjs`
- Test: `test/mothership-db-migration.test.mjs`

- [ ] Write a failing test asserting the migration defines installations, hashed tokens, feedback events, signal events, unique idempotency constraints, retention indexes, and no foreign references to the main control-plane tables.
- [ ] Run `node --test test/mothership-db-migration.test.mjs` and confirm it fails because the migration and runner do not exist.
- [ ] Implement the SQL schema and a checksum-protected numbered migration runner using `MOTHERSHIP_DATABASE_URL`.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Token-authenticated PostgreSQL store

**Files:**
- Create: `mothership/store.mjs`
- Create: `mothership/tokens.mjs`
- Test: `test/mothership-store.test.mjs`

- [ ] Write failing tests for installation creation, one-time raw token issuance, digest-only persistence, token lookup, installation-ID mismatch, token revocation, idempotent feedback insertion, idempotent signal insertion, report queries, and retention pruning.
- [ ] Run the test and confirm failures are caused by missing store/token behavior.
- [ ] Implement high-entropy token generation, SHA-256 digesting, constant-time digest comparison where applicable, `psql` parameter-safe SQL execution, and store methods with dependency injection for unit tests.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Mothership HTTP receiver

**Files:**
- Create: `mothership/server.mjs`
- Create: `mothership/http.mjs`
- Create: `scripts/start-mothership-server.mjs`
- Test: `test/mothership-server.test.mjs`

- [ ] Write failing real-HTTP tests for health, accepted feedback/signals, duplicate retries, malformed JSON, oversized payloads, wrong schema, missing token, wrong installation, and revoked token.
- [ ] Run the focused test and confirm the receiver is missing.
- [ ] Implement the loopback-default server, 256 KiB body limit, bearer authentication, strict payload validation, 202 responses after committed writes, and bounded redacted errors.
- [ ] Re-run the focused test and confirm it passes.

### Task 4: Operator CLI and prioritized report

**Files:**
- Create: `scripts/mothership-operator.mjs`
- Create: `mothership/report.mjs`
- Test: `test/mothership-operator.test.mjs`
- Modify: `package.json`

- [ ] Write failing tests for `installations create`, `installations revoke`, `health`, `report`, and `prune`, including confirmation that raw tokens and database URLs never appear in reports/errors.
- [ ] Run the focused test and confirm the CLI/report behavior is absent.
- [ ] Implement CLI parsing, Markdown/JSON prioritized output, configurable time windows, occurrence-based warning ranking, and 180-day default pruning.
- [ ] Add `mothership:migrate`, `mothership:serve`, `mothership:operator`, and `mothership:report` package scripts.
- [ ] Re-run the focused test and confirm it passes.

### Task 5: Automatic queued-delivery retry

**Files:**
- Create: `services/private-beta-telemetry-retry-service.mjs`
- Modify: `server.mjs`
- Test: `test/private-beta-telemetry-retry-service.test.mjs`

- [ ] Write failing tests proving an immediate optional retry, five-minute scheduling, overlap prevention, error isolation, and clean stop.
- [ ] Run the focused test and confirm the coordinator is absent.
- [ ] Implement a timer-injected retry coordinator that calls feedback and signal queue drains without blocking or leaking details.
- [ ] Wire start/stop into Workbench server lifecycle only when sync is configured.
- [ ] Re-run the focused test and confirm it passes.

### Task 6: VM service and deployment integration

**Files:**
- Create: `deployment/private-vm/matter-workbench-mothership.service`
- Create: `deployment/private-vm/mothership.env.example`
- Modify: `scripts/private-vm-rsync-deploy.mjs`
- Modify: `deployment/private-vm/README.md`
- Test: `test/private-vm-rsync-deploy.test.mjs`

- [ ] Write failing tests asserting deployment installs/reloads the mothership unit without copying secrets and verifies the second service when configured.
- [ ] Run the focused test and confirm the deploy plan lacks mothership integration.
- [ ] Implement the service unit, environment example, optional deploy preflight, restart, and health check while preserving deployments where mothership is not yet configured.
- [ ] Re-run the focused test and confirm it passes.

### Task 7: VM provisioning and end-to-end acceptance

**Files:**
- Modify: `FOR_AKSINGH.md`
- Modify: `deployment/private-vm/README.md`

- [ ] Run `npm test --silent`, `npm run ui:typecheck --silent`, `npm run ui:build --silent`, and `git diff --check`.
- [ ] Create the separate VM database and restricted role without printing credentials.
- [ ] Apply mothership migrations and create a named installation/token.
- [ ] Install mode-0600 mothership/runtime environment values and restart both services.
- [ ] Submit one synthetic feedback report and one synthetic diagnostic signal through the Workbench sender path.
- [ ] Confirm both rows exist centrally, duplicate delivery is idempotent, and the operator report prioritizes them.
- [ ] Confirm sender retry succeeds after a controlled receiver outage.
- [ ] Update `FOR_AKSINGH.md` with the architecture, operational workflow, failure semantics, token safety, and lessons learned.
- [ ] Commit the implementation in coherent slices and leave unrelated review artifacts untouched.

