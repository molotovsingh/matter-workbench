# Private Beta Ops Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight operator/incident bundle for the private VM beta so service health, deployment state, recent logs, and rollback commands can be captured without running a full backup.

**Architecture:** Keep the existing `private-vm:recoverability-pack` as the backup/restore proof. Add a separate `private-vm:ops-pack` command that reads current deployment state, runs the live service check, captures recent service logs, records disk/memory posture, writes redacted Markdown/JSON evidence, and generates a rollback script for the previous deployment candidate.

**Tech Stack:** Node ESM scripts, `node:test`, user-level `systemd`/`journalctl`, existing private VM service-check script, existing secret-redaction helper.

---

### Task 1: Ops Pack Tests

**Files:**
- Create: `test/private-vm-ops-pack.test.mjs`

- [x] Test that the ops pack writes service health, deployment state, recent logs, and rollback plan artifacts.
- [x] Test that the pack fails closed when the live service check fails.
- [x] Test that secret-looking log lines are redacted before evidence is written.
- [x] Test that `package.json` and private VM docs expose the command.

### Task 2: Ops Pack Command

**Files:**
- Create: `scripts/private-vm-ops-pack.mjs`
- Modify: `package.json`

- [x] Add `private-vm:ops-pack`.
- [x] Inspect `/home/aks/matter-workbench-deployments/current` style deployment state.
- [x] Find the previous deployment candidate.
- [x] Run the existing private VM service check unless skipped.
- [x] Capture recent `journalctl --user` logs unless skipped.
- [x] Record disk and memory posture.
- [x] Write `ops-pack.md`, `ops-pack.json`, and `rollback-plan.sh`.
- [x] Redact database URLs, provider keys, passwords, tokens, and bearer secrets.

### Task 3: Operator Documentation

**Files:**
- Modify: `deployment/private-vm/README.md`
- Modify: `db/README.md`
- Modify: `docs/private-vm-runtime-deployment-rehearsal.md`
- Modify: `FOR_AKSINGH.md`

- [x] Explain when to use `private-vm:ops-pack`.
- [x] Keep `private-vm:recoverability-pack` as the backup/restore proof.
- [x] Explain that rollback is generated as a reviewed operator action, not performed automatically.

### Task 4: Verification

**Commands:**

```sh
node --test test/private-vm-ops-pack.test.mjs test/private-vm-recoverability-pack.test.mjs test/private-vm-service-check.test.mjs test/private-vm-security-check.test.mjs
npm run ui:typecheck --silent
npm run ui:build --silent
npm test --silent
git diff --check
```
