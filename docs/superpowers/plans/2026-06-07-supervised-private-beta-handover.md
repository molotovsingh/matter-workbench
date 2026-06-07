# Supervised Private Beta Handover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare Matter Workbench for supervised private beta handover while explicitly excluding public/web SaaS deployment work.

**Architecture:** Keep the current React-only local/private beta and runtime DB evidence posture. Add a concise tester-facing brief, fix release-reference drift, and link the handover path from existing docs without changing product routes or backend APIs.

**Tech Stack:** Markdown docs, existing npm verification scripts, existing private beta evidence-pack scripts.

---

### Task 1: Add Tester Brief

**Files:**
- Create: `docs/private-beta-tester-brief.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [x] **Step 1: Create the tester-facing brief**

Add a short Markdown document that tells trusted testers what Matter Workbench is, what to test, what not to rely on, and how to report issues. Keep it non-technical and avoid public SaaS promises.

- [x] **Step 2: Link it from repo entry points**

Add links from `README.md` and `docs/README.md` so the tester brief is visible without searching.

### Task 2: Tighten Operator Checklist

**Files:**
- Modify: `docs/beta-operator-checklist.md`

- [x] **Step 1: Fix release reference drift**

Change the bottom release reference from `v1.0.0-beta.6` to `v1.0.0-beta.7`.

- [x] **Step 2: Add tester handoff sequence**

Add a compact checklist for giving a tester access: run closure evidence, brief tester, back up matters, keep bug-evidence reports grounded, and stop before public/web deployment claims.

### Task 3: Update Teacher Note

**Files:**
- Modify: `FOR_AKSINGH.md`

- [x] **Step 1: Explain the handover boundary**

Add a plain-language note explaining why tester instructions are separate from operator runbooks and why public/web deployment remains out of scope.

### Task 4: Verify And Commit

**Files:**
- Test: documentation plus existing release verification commands

- [x] **Step 1: Run focused doc sanity checks**

Run:

```bash
git diff --check
node -e "JSON.parse(require('fs').readFileSync('docs/runtime-db-browser-acceptance-packs/runtime-db-browser-acceptance-pack-2026-06-07T07-02-32-214Z.json','utf8')); console.log('json ok')"
```

- [x] **Step 2: Run release verification gates**

Run:

```bash
npm run ui:typecheck --silent
npm run ui:build --silent
npm test --silent
MWB_BACKEND_URL=http://127.0.0.1:4191 MWB_UI_URL=http://127.0.0.1:4191/ npm run ui:smoke --silent
```

- [x] **Step 3: Commit**

Commit only the focused handover docs and plan:

```bash
git add README.md docs/README.md docs/private-beta-tester-brief.md docs/beta-operator-checklist.md docs/superpowers/plans/2026-06-07-supervised-private-beta-handover.md FOR_AKSINGH.md
git commit -m "Prepare supervised private beta handover"
```
