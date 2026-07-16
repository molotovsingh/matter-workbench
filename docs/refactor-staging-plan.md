# Refactor Staging Plan

Date: 2026-05-13
Last updated: 2026-07-16
Status: Historical; superseded by the React-only cutover
Scope: record of targeted refactors completed before the plain-JS frontend was deleted

All `frontend/*` paths below describe the former plain-JS implementation. That
tree and its legacy-only tests are now deleted; current browser owners live
under `react-ui/src/`.

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

## Stage 1 (Done): Split Command Rail Monolith

This was completed in small slices so the Command rail could stay stable while
the skill factory grew.

### Why now

`frontend/ai-command-box.js` had been carrying parsing, state machine,
rendering, API orchestration, and telemetry/reporting in one unit. That slowed
safe changes and caused refactor collisions.

### Completed shape

- `frontend/ai-command-box.js` is now a façade around focused controllers.
- `frontend/skill-idea-session-controller.js` owns interview, samples, approval,
  and skill creation flow.
- `frontend/configurable-skill-run-controller.js` owns active custom skill runs,
  output replacement, run reports, and skill-improvement entry.
- Command reporting, router-check handling, deterministic command dispatch,
  new-skill mode, suggestions, and sample-review helpers live in focused modules.
- Skills page summary, health, saved ideas, and card rendering were split into
  smaller view modules.

### Completion evidence

- `frontend/ai-command-box.js` is roughly 325 lines.
- Full suite passed after the split.
- Custom-skill creation, modification, sample review, run, overwrite, reporting,
  and Skills page flows retained regression coverage.

---

## Stage 2 (Partly Done): Backend Seams For Growth

The first backend seams have been split. Further backend refactors should now
be opportunistic rather than automatic.

### Completed

- `routes/api-routes.mjs` is now a top-level dispatcher.
- `routes/app-shell-routes.mjs` owns config, settings, matters, workspace, file
  preview, and command diagnostics endpoints.
- `routes/matter-workflow-routes.mjs` owns matter engines, matter status,
  prepare matter, context preview, and context search endpoints.
- `routes/skill-factory-routes.mjs` owns skill registry, ideas, samples,
  configurable skills, and run ledger endpoints.
- `routes/route-dispatcher.mjs` owns exact routes, pattern routes, and ordered
  route-group dispatch, so route matching no longer lives as repeated branch
  control flow in each route module.
- `shared/provider-http.mjs` and OpenRouter response/error helpers now carry the
  common provider transport pieces.
- `source-descriptors-provider.mjs` now owns Source Labels / Document Index
  provider request construction, model-policy resolution, timeout handling, and
  injected-provider metadata. `source-descriptors-engine.mjs` remains focused on
  matter IO, packet building, descriptor validation, normalization, and artifact
  writing.
- `source-descriptors-validation.mjs` now owns the Source Index output schema,
  descriptor validation, evidence checks, lawyer-facing label safety, and
  normalization into label-governance fields. The engine still re-exports the
  public validation helpers for compatibility.
- `source-descriptors-packets.mjs` now owns bounded source-packet construction:
  duplicate file-id detection, source path/name projection, extraction summary
  fields, block truncation, and block-count limits.
- `services/skill-interview-planner-providers.mjs` now owns skill-interview
  provider request construction, shared policy prompt composition, OpenAI/OpenRouter
  response parsing, and timeout/error mapping. The planner service remains the
  orchestrator for enablement, registry summaries, matter metadata summaries,
  fallback decisions, and schema metadata.
- `services/skill-sample-output-providers.mjs` now owns sample-output provider
  request construction, sample-specific policy prompt composition,
  OpenAI/OpenRouter response parsing, and timeout/error mapping. The sample
  service remains the orchestrator for matter-context bounding, idea
  normalization, sample envelopes, warnings, and the no-artifact-write contract.
- `services/skill-router-providers.mjs` now owns skill-router provider request
  construction and router policy prompt composition. The router service remains
  the orchestrator for registry reads, MECE decision normalization, approval
  gates, and legal-setting cleanup.
- `services/configurable-skill-run-artifacts.mjs` now owns configurable custom
  skill output path resolution and paired Markdown/JSON artifact writes. The
  configurable skill service remains focused on lifecycle orchestration and run
  ledger updates.
- `services/configurable-skill-lifecycle.mjs` now owns pure configurable skill
  draft construction and version activation/supersession. The configurable skill
  service remains focused on provider calls, validation, store mutation order,
  and runtime execution.
- `services/multipart-upload.mjs` now owns multipart stream parsing, temp-file
  staging, upload byte limits, and cleanup. `services/upload-service.mjs`
  remains focused on create-matter and add-intake domain flow.
- `services/upload-file-intake.mjs` now owns upload JSON-field parsing,
  relative-path count validation, and safe copying from staged temp files into
  matter intake folders. The upload service no longer carries low-level file
  write/path mechanics.
- The multipart upload limit path is now covered through the real HTTP route:
  tests inject a small `maxUploadBytes` limit and assert oversized uploads
  return `413` without an unhandled file-stream rejection.
- `services/listofdates-dependency-state.mjs` now owns the pure decision that
  separates `label_refresh_needed`, `chronology_review_needed`, and
  `chronology_regeneration_needed`. The rerun advice service remains focused on
  disk mtimes, artifact reads, and advice message envelopes.
- Browser affordances import `shared/listofdates-dependency-states.mjs` directly,
  so the refresh-only UI does not depend on scattered literals.
- `services/matter-context-path-policy.mjs` now owns the pure path-exclusion
  trust boundary for matter context packets: secrets, logs, dependency folders,
  machine junk, and temporary Office files stay out of model-bound context.
- `services/workspace-path-policy.mjs` now owns direct workspace-preview path
  blocking for hidden/system paths, so manually guessed raw-file URLs cannot
  bypass what the workspace tree hides.
- Built-in command registry drift is guarded by startup/test validation between
  `shared/builtin-skill-commands.mjs` and `skills/registry.json`.

### Remaining

Only continue this stage when the next backend change naturally touches the
same surface.

- `services/configurable-skills-service.mjs` still owns lifecycle orchestration,
  but low-level store, provider, validation, context, and run metadata helpers
  are already split.
- `create-listofdates-engine.mjs` remains large because it carries meaningful
  chronology and legal-output policy. Do not mechanically split that policy
  without a behavior reason.

### Current exit criteria

- Endpoint behavior unchanged in `test/api-smoke.test.mjs`.
- Policy behavior unchanged in `test/model-policy.test.mjs` and
  `test/ai-provider-policy.test.mjs`.
- Shared transport utilities remain the common path for new AI callers.

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

## Stage 4 (Done): Test Suite Maintainability

This was done once the command rail had enough focused modules to make the
large scenario file more costly than useful.

### Completed

- `test/ai-command-box.test.mjs` now covers core command dispatch, lane opening,
  suggestions, reports, and paid rerun cancellation.
- `test/ai-command-box-skill-ideas.test.mjs` now covers interview flow,
  sample-review lifecycle, overlap gates, sample approval, and skill activation.
- `test/ai-command-box-configurable-skills.test.mjs` now covers active custom
  skill runs, overwrite confirmation, stale cards, and improvement ideas.
- `test-support/ai-command-box-helpers.mjs` remains the shared fake browser
  harness, so each scenario file can focus on user behavior.

### Completion evidence

- Full suite remained green at `361/361`.
- Scenario coverage was preserved; the split is file ownership only.
- Future failures should name the product surface directly in the test path.

---

## Stage 5 (Opportunistic): UI Surface Boundaries

Only do this when the next change naturally touches the same surface.

### Completed Opportunistic Slices

- `frontend/listofdates-markdown-preview.js` now owns List of Dates markdown
  parsing, chronology preview rendering, and copy/download actions. The
  workspace view decides which preview to open, but the document renderer can
  evolve separately.
- `frontend/skill-idea-session-action-wiring.js` now owns saved/interview skill
  idea button wiring. The session controller still owns the state machine.
- `frontend/skills-page-actions.js` now owns Skills and Activity page
  copy/open/status button wiring.
- The React-only cutover retired `frontend/matter-screens.js`; React now owns
  shell section switching, matter landing, and Settings page rendering.

### Rule

Do not split UI modules just because a file is long. Split only when a module
has a noun-shaped responsibility that future work will touch independently.

---

## When Not To Refactor

Avoid structural refactors in a cycle where the team is also changing:

- legal chronology output rules,
- provider routing policy defaults,
- matter artifact contracts.

In those cycles, ship behavior changes first, then refactor in the next hardening window.

## Recommended order from today

1. Do not keep refactoring only because older hotspots existed. Many have been
   reduced.
2. Use behavior-driven triggers:
   - if changing Command rail skill behavior, consider a focused extraction from
     `frontend/skill-idea-session-controller.js`;
   - if changing custom skill runtime semantics, consider a focused extraction
     from `services/configurable-skills-service.mjs`;
   - if changing chronology quality rules, keep the change close to
     `create-listofdates-engine.mjs` and protect it with golden-output tests.
3. Stage 3 only when new interview templates or planner normalization rules are
   being added.
4. Stage 4 is complete. Add new command-box scenarios to the focused suite that
   matches the product story.
5. Use Stage 5 opportunistically. Current good seams are document preview
   renderers and small action-wiring modules, not broad UI rewrites.
