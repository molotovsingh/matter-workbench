# Private VM Beta Service Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the successful Debian VM runtime rehearsal into an operator-safe private beta service with a managed process, protected env file, repeatable smoke checks, and clear docs.

**Architecture:** Keep product APIs and schema unchanged. Add a small runtime server entrypoint that loads the existing DB env helper, a service-check script that validates an already running private VM app, a user-level systemd unit template, and documentation that separates service readiness from cloud production readiness.

**Tech Stack:** Node ESM scripts, built-in `node:test`, user-level `systemd`, Postgres runtime DB mode, React production build.

---

### Task 1: Add Runtime Service Entrypoint

**Files:**
- Create: `scripts/start-runtime-server.mjs`
- Test: `test/start-runtime-server.test.mjs`
- Modify: `package.json`

- [ ] Add a Node entrypoint that loads `.env` plus ignored `.env.shadow`, defaults private VM runtime flags to Postgres mode, starts `createWorkbenchServer`, and handles `SIGTERM`.
- [ ] Add parser tests for `--host` and `--port`.
- [ ] Add `private-vm:serve` to `package.json`.

### Task 2: Add Running-Service Smoke

**Files:**
- Create: `scripts/private-vm-service-check.mjs`
- Test: `test/private-vm-service-check.test.mjs`
- Modify: `package.json`

- [ ] Add a smoke script that checks an already running service URL.
- [ ] Verify root HTML, `/api/matters`, workspace tree, first previewable file, and file preview.
- [ ] Add `private-vm:service-check` to `package.json`.

### Task 3: Add Systemd Unit Template

**Files:**
- Create: `deployment/private-vm/matter-workbench-runtime.service`
- Create: `deployment/private-vm/README.md`

- [ ] Add a user-level systemd unit that runs the committed private VM serve script from `%h/matter-workbench-deployments/current/app`.
- [ ] Document the protected env file path `%h/.config/matter-workbench/runtime.env`.
- [ ] Include exact operator commands for install, status, logs, restart, and stop.

### Task 4: Update Docs

**Files:**
- Modify: `docs/private-vm-runtime-deployment-rehearsal.md`
- Modify: `docs/database-transition-handoff.md`
- Modify: `docs/README.md`
- Modify: `FOR_AKSINGH.md`

- [ ] Update the VM rehearsal from `nohup` to service-pack direction.
- [ ] Record the service-readiness claim and the remaining production gaps.
- [ ] Keep the shadow-verifier limitation explicit.

### Task 5: Deploy And Verify On VM

**Files:**
- VM only: `/home/aks/matter-workbench-deployments/<commit>/app`
- VM only: `/home/aks/.config/matter-workbench/runtime.env`
- VM only: `/home/aks/.config/systemd/user/matter-workbench-runtime.service`

- [ ] Transfer the committed checkpoint to the VM.
- [ ] Install dependencies and build React.
- [ ] Write a `0600` protected runtime env file without printing secrets.
- [ ] Enable linger for the user if available.
- [ ] Install and enable the user systemd service.
- [ ] Verify Mac-to-VM reachability, VM service check, and runtime write smoke.
- [ ] Run a DB backup and either a restore drill or document the exact restore blocker.

### Task 6: Final Verification And Commit

**Files:**
- All changed repo files

- [ ] Run focused script tests.
- [ ] Run `npm run ui:typecheck --silent`.
- [ ] Run `npm run ui:build --silent`.
- [ ] Run `npm test --silent`.
- [ ] Run `git diff --check`.
- [ ] Commit the service-pack docs and scripts.

