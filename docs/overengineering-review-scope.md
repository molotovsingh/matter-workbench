# Overengineering Review Scope

This note does not judge the code yet. It defines the exact runtime surface we should inspect, in order, when we later assess whether the repo is overengineered.

## Goal

Answer one question cleanly later:

Is the current shipped beta path proportionate to the product we actually have, or have we built too much machinery around it?

To answer that well, we should not start by reading every file. We should follow the real execution path first, then compare it against the extension and future-work layers.

## Step 1: Read The Runtime Map First

Start here to anchor the vocabulary and current intended boundaries:

- `README.md`
- `docs/codebase-diagram.md`

This tells us the claimed product shape before we inspect implementation details.

## Step 2: Trace The Real App Entry Points

These files define what actually boots and what the browser can call:

- `server.mjs`
- `routes/api-routes.mjs`
- `routes/http-utils.mjs`
- `routes/static-routes.mjs`
- `app.js`
- `frontend/event-wiring.js`

Review question for later:

How many app surfaces and request paths exist before any legal-workflow logic even starts?

## Step 3: Inspect The Core Matter Workspace Layer

These files define the minimum local-app substrate:

- `shared/matter-contract.mjs`
- `services/config-service.mjs`
- `services/matter-store.mjs`
- `services/workspace-service.mjs`
- `services/upload-service.mjs`
- `services/matter-status-service.mjs`

This is the base layer that every real workflow depends on, regardless of AI.

## Step 4: Inspect The Core Beta Workflow Engines

This is the real product pipeline. Read these in this order:

1. `matter-init-engine.mjs`
2. `extract-engine.mjs`
3. `extract-utils/pdf-extract.mjs`
4. `extract-utils/docx-extract.mjs`
5. `extract-utils/xlsx-extract.mjs`
6. `extract-utils/eml-extract.mjs`
7. `extract-utils/text-extract.mjs`
8. `extract-utils/rtf-extract.mjs`
9. `extract-utils/mistral-ocr-provider.mjs`
10. `source-descriptors-engine.mjs`
11. `create-listofdates-engine.mjs`
12. `listofdates/clustering.mjs`

This step is the heart of the later review. If we want to know whether the app is overbuilt, we first need to understand the shortest path from raw matter files to `10_Library` outputs.

## Step 5: Inspect The AI Policy And Provider Boundary

These files control how much AI/provider machinery sits around the pipeline:

- `shared/model-policy.mjs`
- `shared/ai-provider-policy.mjs`
- `shared/responses-client.mjs`
- `shared/local-env.mjs`

Read these immediately after the engines, not before. Otherwise the provider/config layer can feel larger than the product path it serves.

## Step 6: Inspect The Command Rail And Operator UX

These files show how much orchestration exists in the browser layer:

- `frontend/ai-command-box.js`
- `frontend/skill-router-panel.js`
- `frontend/rerun-guardrails.js`
- `frontend/workspace-view.js`
- `frontend/matter-screens.js`
- `frontend/views/matter-overview.js`
- `frontend/views/extract-result.js`
- `frontend/views/source-descriptors-result.js`
- `frontend/views/listofdates-result.js`
- `frontend/skills/matter-init.js`
- `frontend/skills/extract.js`
- `frontend/skills/describe-sources.js`
- `frontend/skills/create-listofdates.js`
- `frontend/skills/prepare-matter.js`
- `frontend/skills/context-preview.js`
- `frontend/skills/context-search.js`
- `frontend/skills/doctor.js`

This step answers a separate later question:

Did we build a simple command surface over the workflow, or a second orchestration product around it?

## Step 7: Inspect The Context, Search, And Preparation Layer

These files are adjacent to the beta path but not the raw core pipeline:

- `services/matter-context-service.mjs`
- `services/prepare-matter-service.mjs`
- `frontend/views/context-preview-result.js`
- `frontend/views/context-search-result.js`

These should be assessed after the core pipeline because they are support layers, not the main extraction-to-chronology spine.

## Step 8: Inspect The Skill-System Expansion Layer

This is the part most likely to blur runtime product needs with platform ambitions. Read it as one cluster:

- `skills/registry.json`
- `services/skill-registry-service.mjs`
- `services/skill-router-service.mjs`
- `services/skill-ideas-service.mjs`
- `services/skill-interview-planner-service.mjs`
- `services/skill-samples-service.mjs`
- `services/skill-sample-output-service.mjs`
- `services/configurable-skills-service.mjs`
- `frontend/skill-idea-interview.js`
- `frontend/skill-idea-implementation-brief.js`
- `frontend/views/skills-page.js`
- `configurable-skills.json`
- `skill-ideas.json`
- `skill-samples.json`

This cluster should be judged against the shipped beta path, not in isolation.

## Step 9: Compare Runtime Code Against Design-Contract Surface

Only after understanding the running code should we inspect the design-heavy layer:

- `docs/archive/2026-05-13/prepare-matter-contract.md`
- `docs/archive/2026-05-13/new-skill-creation-contract.md`
- `docs/archive/2026-05-13/skill-modification-contract.md`
- `docs/archive/2026-05-13/ai-native-skill-router.md`
- `docs/matter-context-reader-contract.md`
- `docs/archive/2026-05-13/selective-unibox-adoption.md`
- `docs/archive/2026-05-13/omnibox-adoption-from-v2.md`
- `docs/future-design-decisions/*`

This is where we will later check whether product-contract thinking is clarifying the codebase or pulling it toward premature platform design.

## Step 10: Use Tests As A Mirror, Not As The Starting Point

After the code walk, use tests to measure what the repo considers important:

- `test/api-smoke.test.mjs`
- `test/engines.test.mjs`
- `test/create-listofdates.test.mjs`
- `test/source-descriptors-engine.test.mjs`
- `test/listofdates-clustering.test.mjs`
- `test/ai-command-box.test.mjs`
- `test/rerun-guardrails.test.mjs`
- `test/matter-context-service.test.mjs`
- `test/skill-router-service.test.mjs`
- `test/configurable-skills-service.test.mjs`
- `test/skill-ideas-service.test.mjs`
- `test/skill-interview-planner-service.test.mjs`
- `test/skill-sample-output-service.test.mjs`
- `test/skill-samples-service.test.mjs`

The tests should confirm which abstractions are central versus incidental.

## First-Pass Exclusions

Do not start with these:

- `node_modules/`
- `output/`
- `styles.css`
- most `docs/` files outside the list above
- `evals/` until after the runtime walk

They may matter later, but they are not the right place to decide whether the shipped system is overbuilt.

## Practical Reading Order

If we want the shortest useful pass, use this exact sequence:

1. `README.md`
2. `docs/codebase-diagram.md`
3. `server.mjs`
4. `routes/api-routes.mjs`
5. `app.js`
6. `shared/matter-contract.mjs`
7. `services/matter-store.mjs`
8. `services/workspace-service.mjs`
9. `matter-init-engine.mjs`
10. `extract-engine.mjs`
11. `source-descriptors-engine.mjs`
12. `create-listofdates-engine.mjs`
13. `shared/model-policy.mjs`
14. `shared/ai-provider-policy.mjs`
15. `frontend/ai-command-box.js`
16. `services/matter-status-service.mjs`
17. `services/matter-context-service.mjs`
18. `services/prepare-matter-service.mjs`
19. `services/skill-registry-service.mjs`
20. `services/skill-router-service.mjs`
21. `services/configurable-skills-service.mjs`
22. `docs/new-skill-creation-contract.md`
23. `docs/prepare-matter-contract.md`

That sequence will let us later separate:

- core product complexity
- operator-surface complexity
- platform-extension complexity
- future-contract complexity

without mixing them too early.
