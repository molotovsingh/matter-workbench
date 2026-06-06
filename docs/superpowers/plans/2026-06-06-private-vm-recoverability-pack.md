# Private VM Recoverability Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one operator command that proves a private VM backup can carry both Postgres state and local storage bytes, then verify the live service still responds.

**Architecture:** Reuse the existing low-level backup tools instead of rewriting backup logic. Add a small orchestration script that runs DB backup, DB restore drill, storage backup, storage hash-check, and private VM service check, then writes one redacted evidence bundle.

**Tech Stack:** Node ESM scripts, `node:test`, PostgreSQL `pg_dump`/`psql`, existing Matter Workbench runtime DB scripts.

---

### Task 1: Restore Drill DB-Only Verification

**Files:**
- Modify: `scripts/db-shadow-restore-drill.mjs`
- Test: `test/db-shadow-restore-drill-verify-mode.test.mjs`

- [x] Add `--verify-mode sql-summary` so restored SQL can be checked without source matter folders.
- [x] Preserve the existing `report` verification mode.
- [x] Test both modes.

### Task 2: Recoverability Pack Command

**Files:**
- Create: `scripts/private-vm-recoverability-pack.mjs`
- Test: `test/private-vm-recoverability-pack.test.mjs`
- Modify: `package.json`

- [x] Run DB backup.
- [x] Run DB restore drill with `sql-summary`.
- [x] Run storage backup.
- [x] Run storage restore/hash check.
- [x] Run optional live service check.
- [x] Write `recoverability-pack.md` and `recoverability-pack.json`.

### Task 3: Operator Documentation

**Files:**
- Modify: `deployment/private-vm/README.md`
- Modify: `db/README.md`
- Modify: `docs/private-vm-runtime-deployment-rehearsal.md`
- Modify: `FOR_AKSINGH.md`

- [x] Explain that DB-only backup is insufficient when storage objects are local.
- [x] Document the one-command recoverability pack.
- [x] Keep lower-level commands for debugging.

### Task 4: Verification

**Commands:**

```sh
node --test test/private-vm-recoverability-pack.test.mjs test/db-shadow-restore-drill-verify-mode.test.mjs
node --test test/db-shadow-storage-backup.test.mjs test/db-shadow-restore-drill.test.mjs test/private-vm-service-check.test.mjs
npm run ui:typecheck --silent
npm run ui:build --silent
npm test --silent
git diff --check
```
