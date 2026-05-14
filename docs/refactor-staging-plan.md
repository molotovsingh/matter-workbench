# Refactor Staging Plan

Date: 2026-05-13
Status: staged plan; Stage 0 completed
Scope: targeted refactors with low regression risk

## Goal

Reduce maintenance risk in the Command rail and skill-planning surfaces without destabilizing the shipped beta pipeline (`/matter-init -> /extract -> /describe_sources -> /create_listofdates`).

## Non-goals

- No broad rewrite of workflow engines.
- No UI redesign.
- No behavior change to legal output contracts unless explicitly listed below.

## Stage 0 (Done): Stabilize Behavior Before Structure

This was done first because there were active behavior risks in the new sample-review flow.

### Work

1. Fix stale sample approval after design-brief edits in `frontend/ai-command-box.js`.
2. Fix sample matter attribution so review shows sample-bound matter, not only currently active matter.
3. Remove dead duplicate branch in ready-state command handling.
4. Add regression tests that combine:
   - `approve sample -> edit answers -> save updates`
   - sample generated on Matter A, active matter switched to Matter B, review still shows Matter A.

### Completion evidence

- `npm test` fully green.
- No open P1/P2 findings in sample-review flow.
- Regression coverage now combines sample approval, design-brief edits, sample matter attribution, and stale command-rail state.

---

## Stage 1 (Current Hardening Track): Split Command Rail Monolith

Proceed in small slices. Several low-risk extractions have already landed, including command parsing, command reporting helpers, and configurable-skill command helpers.

### Why now

`frontend/ai-command-box.js` is carrying parsing, state machine, rendering, API orchestration, and telemetry/reporting in one unit. That slows safe changes.

### PR slices

1. Continue extracting skill-idea interview state transitions.
   - from: `frontend/ai-command-box.js`
   - to: `frontend/skill-idea-session-state.js`
2. Extract sample-review rendering/actions.
   - from: `frontend/ai-command-box.js`
   - to: `frontend/views/skill-sample-review.js`
3. Keep follow-up refactors opportunistic and behavior-preserving.

### Exit criteria

- `frontend/ai-command-box.js` reduced to orchestration shell.
- No behavior drift in `test/ai-command-box.test.mjs`.
- New modules have focused tests where pure logic exists.

---

## Stage 2 (Next): Backend Seams For Growth

Run in the next backend touch that adds or modifies AI-backed endpoints.

### Work

1. Replace route `if` chain with route registry in `routes/api-routes.mjs`.
2. Unify provider HTTP request plumbing (timeouts, error mapping, request envelope shape).
   - targets:
   - `services/skill-sample-output-service.mjs`
   - `services/skill-interview-planner-service.mjs`
   - any other AI caller using similar fetch+timeout+error logic
3. Keep model-policy and provider-policy boundaries unchanged, but reduce duplicated transport code.

### Exit criteria

- Endpoint behavior unchanged in `test/api-smoke.test.mjs`.
- Policy behavior unchanged in `test/model-policy.test.mjs` and `test/ai-provider-policy.test.mjs`.
- Shared transport utilities adopted by at least two AI services.

---

## Stage 3 (Later): Interview Policy Separation

Do this when adding the next 2 to 3 domain templates or legal-skill interview patterns.

### Work

1. Separate interview policy heuristics from interview assembly.
   - from: `frontend/skill-idea-interview.js`
   - to:
   - `frontend/skill-idea-policy.js` (domain heuristics and signal detection)
   - `frontend/skill-idea-normalizers.js` (planner normalization and constraints)
2. Keep existing public function signatures stable while internals move.

### Exit criteria

- New domain/template additions require no edits across unrelated normalization code.
- Test coverage remains strong in `test/skill-idea-interview.test.mjs`.

---

## Stage 4 (Later): Test Suite Maintainability

Run once Stage 1 and Stage 3 are merged.

### Work

1. Split `test/ai-command-box.test.mjs` into workflow-focused suites:
   - command parsing and dispatch
   - interview flow
   - sample review lifecycle
   - report/logging behavior
2. Keep integration assertions, reduce single-file churn and conflict rate.

### Exit criteria

- Faster triage from failing tests (clear suite ownership).
- No loss in scenario coverage.

---

## When Not To Refactor

Avoid structural refactors in a cycle where the team is also changing:

- legal chronology output rules,
- provider routing policy defaults,
- matter artifact contracts.

In those cycles, ship behavior changes first, then refactor in the next hardening window.

## Recommended order from today

1. Stage 1 now, in small behavior-preserving slices.
2. Stage 2 only when the next backend AI endpoint change makes shared transport useful.
3. Stage 2 in the next backend AI endpoint change.
4. Stage 3 only when new interview templates are being added.
5. Stage 4 as the hardening pass after Stage 1 and Stage 3.
