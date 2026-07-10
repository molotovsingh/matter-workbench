# Prompt Registry / Prompt Inventory

Date: 2026-07-10
Status: Review draft / governance design note

## Problem Statement

Matter Workbench is becoming a system of source-backed legal skills, and those skills increasingly depend on product-critical prompts. The prompts decide tone, legal caution, source discipline, output structure, validation expectations, and user-facing boundaries.

Today, those prompts are scattered across services, runners, policies, provider adapters, and feature-specific modules. To understand why a skill behaves a certain way, an operator or developer must know where to look in code and must manually reconstruct:

- which prompt or prompt fragments are involved;
- which skill or feature owns the prompt;
- which inputs are inserted into the resolved prompt;
- which output artifact the prompt controls;
- which legal policy prompt or shared rules are composed;
- whether the prompt is matter-bound and therefore privacy-sensitive once resolved;
- whether the prompt changed between releases;
- whether a behavior issue belongs in the prompt, inputs, validation, model routing, matter metadata, or UI.

This creates prompt sprawl. It makes beta support slower, release notes less precise, and future prompt governance harder.

The proposed solution is a read-only **Prompt Registry / Prompt Inventory**: one place where product-critical prompts can be named, classified, located, versioned, and audited without changing runtime behavior.

The registry should begin as visibility infrastructure, not as an editable prompt engine.

## Core Purpose

The Prompt Registry exists to answer:

> What prompts does Matter Workbench rely on, where are they, what do they control, what inputs do they consume, and what governance applies to them?

It should make prompts inspectable as product assets.

It should not initially supply prompts to runtime services, alter model behavior, allow prompt editing, or store matter-specific resolved prompts.

## V1 Principle

V1 should be deliberately safe:

```text
Find prompts.
Name prompts.
Classify prompts.
Record where they live.
Record what they control.
Expose read-only metadata.
Do not change runtime behavior.
```

The initial registry is an inventory and audit layer only.

## Why This Is Not Just For Its Own Sake

A read-only prompt registry solves practical problems.

### 1. Prompt Sprawl

Prompts currently live near implementation details. A registry gives one map across native skills, Ask, Research, legal policy, provider repair, custom skill scaffolding, and future semantic services.

### 2. Release Audit

When behavior changes, release notes and debugging can point to a stable prompt identity:

```text
native.mw_list_of_dates.generate
prompt version/hash
source file/function
changed in release X
```

This makes prompt-affecting changes reviewable.

### 3. Beta Support

If a tester says a skill output is too neutral, too aggressive, too generic, or missing source discipline, the team can quickly locate the relevant prompt and decide whether the issue belongs in:

- prompt language;
- upstream matter metadata;
- party/posture semantics;
- source selection;
- validation;
- model output budget;
- UI rendering.

### 4. No Silent Prompt Mutation

The registry supports the product rule that prompts should not silently mutate without an identifiable version or change trail.

Even while prompts remain code-owned, each product-critical prompt can have an identity and declared version.

### 5. Shared Policy Discipline

The registry can reveal duplicated prompt rules, such as:

- do not make final legal findings;
- preserve source discipline;
- do not expose internal handles;
- distinguish allegations from findings;
- keep Ask matter-record-only;
- keep Research separate for public law;
- treat certain artifacts as lawyer-review drafts only.

Some repetitions are appropriate. Others should eventually move into shared policy prompts or canonical contracts.

### 6. Future Testing and Evaluations

Once prompts have stable IDs, tests and future evaluation packs can link outputs to the prompt versions that produced them.

## Non-Goals for V1

V1 should not:

- move prompt execution into a central runtime service;
- allow users or operators to edit active prompts;
- dynamically replace prompts at runtime;
- store resolved prompts containing matter facts;
- create a prompt marketplace;
- introduce a new provider-routing layer;
- make prompt registry availability a hard dependency for skill execution;
- replace existing legal-output policy prompts;
- replace custom skill governance;
- promise better model output by itself.

The registry is an observability and governance tool first. It does not automatically improve model quality.

## Read-Only Registry Scope

The first inventory should collect all product-critical prompt-bearing surfaces, including:

- native skill prompts:
  - Case Timeline;
  - Matter Story;
  - Filing and Procedural Posture Diagnosis;
  - MW List of Dates;
  - future Matter Semantics proposal;
- Ask / matter Copilot prompts;
- Research prompts;
- legal workbench policy prompt;
- source-grounding and citation prompts;
- validation or repair prompts, if any;
- custom skill creation and sample-evaluation prompts;
- provider/task boundary prompts;
- prompt fragments that are composed into other prompts.

The registry can include prompt fragments and policies, not only final generation prompts.

## Prompt Card Shape

Each registry entry should be understandable as a prompt card.

Example shape:

```json
{
  "id": "native.mw_list_of_dates.generate",
  "label": "MW List of Dates generation prompt",
  "surface": "native_skill",
  "skill": "/create_mw_listofdates",
  "source_file": "services/mw-list-of-dates-service.mjs",
  "source_symbol": "buildMwListPrompt",
  "version": "mw-lod-prompt/v5",
  "inputs": [
    "Case Timeline",
    "Matter Story",
    "Filing and Procedural Posture Diagnosis",
    "Matter Semantics - future"
  ],
  "output_artifacts": [
    "20_Workshop/Case Analysis/MW List of Dates.md",
    "20_Workshop/Case Analysis/MW List of Dates.json"
  ],
  "matter_bound": true,
  "resolved_prompt_contains_matter_facts": true,
  "policy_prompts": ["legal-workbench-policy"],
  "validation_contracts": [
    "one MW row cites exactly one Case Timeline row",
    "no internal FILE-* or CT-* handles in Markdown"
  ],
  "editable": false,
  "runtime_supplied_by_registry": false
}
```

The exact field names can change, but the registry should preserve this kind of operational meaning.

## Template Prompt vs Resolved Prompt

The registry must distinguish between:

### Prompt Template

The reusable instruction text and metadata. This is safe to inventory and inspect.

### Resolved Prompt

The actual prompt sent to a model after inserting matter facts, source summaries, party names, dates, procedural posture, or user questions.

Resolved prompts may contain client confidential material. V1 should not persist or expose resolved prompts as part of the registry.

If future debugging needs resolved-prompt inspection, that should require a separate privacy and operator-access contract.

## Runtime Relationship

V1 should not make runtime services depend on registry lookup to execute prompts.

Current services can continue to own their prompt construction.

The registry can be assembled from explicit metadata near prompts, a central catalogue, or a hybrid approach. The key is that the registry is read-only and does not alter model calls.

A safe first architecture is:

```text
services and skills keep current prompt construction
        ↓
registry records prompt cards and source locations
        ↓
dev/operator surface reads registry metadata
```

Only later should selected prompts move into registry-owned template modules.

## Future State: Supplying Prompts

The registry may eventually become the place from which runtime services import or resolve prompt templates.

That is a later architectural step, not the starting point.

A possible maturity path:

1. Inventory only.
2. Read-only dev/operator prompt catalogue.
3. Stable prompt IDs, versions, and template hashes.
4. Selected prompts moved into template modules.
5. Services import templates from the prompt registry package/module.
6. Prompt registry becomes a runtime prompt supplier for selected stable prompts.
7. Governed prompt editing only if sample approval, rollback, receipts, and tests exist.

The system should not jump directly from inventory to editable prompt control panel.

## Editable Prompts Are A Separate Product

In-app prompt editing is a much larger product and governance problem.

Before any editable active prompt exists, Matter Workbench would need:

- draft prompt versions;
- sample runs;
- approval workflow;
- activation step;
- rollback;
- prompt-change receipts;
- permission model;
- tests/evals;
- clear separation from custom skill governance;
- no silent mutation of live legal behavior.

That is out of scope for the read-only registry.

## Relationship to Custom Skills

Custom skills already have governance concerns around prompt/sample/version approval.

The Prompt Registry should initially catalogue custom-skill system prompts and scaffolding prompts used by the platform, not expose every user-created custom prompt as editable system infrastructure.

Later, custom skills may have their own prompt cards, but they should preserve existing custom skill lifecycle rules.

## Relationship to Matter Semantics

Matter Semantics will improve the inputs available to downstream prompts.

Prompt Registry and Matter Semantics solve different problems:

- Matter Semantics answers: who is who, what is the matter posture, and what metadata should downstream skills rely on?
- Prompt Registry answers: which prompts exist, what do they consume, and what behavior do they control?

They reinforce each other. For example, the MW List prompt card can declare that it currently consumes Case Timeline, Story, and Procedural Diagnosis, and may later consume Matter Semantics.

## Suggested V1 Surfaces

V1 may expose registry data through one or more read-only surfaces:

- developer CLI/report;
- JSON endpoint for operator/debug use;
- Settings/System Health developer section;
- docs-generated inventory table.

The safest initial surface is probably a developer/operator report, not a normal user-facing UI.

## Governance Fields Worth Tracking

Prompt cards should ideally track:

- prompt ID;
- label;
- owning feature/skill;
- source file and symbol;
- prompt kind, e.g. generation, policy, repair, classifier, evaluator;
- matter-bound vs non-matter-bound;
- whether resolved prompt contains matter facts;
- whether public web/legal-source data is allowed;
- inputs;
- outputs;
- policy prompts composed;
- validation contracts;
- model route or task kind, if stable;
- version/hash;
- editable flag;
- runtime-supplied-by-registry flag;
- last known release or commit, if available.

## Risks

### False Sense of Control

A registry does not mean the prompt is good. It only makes it visible.

### Over-Centralization Too Early

Moving every prompt into a central runtime mechanism too early could destabilize working skills.

### Privacy Leakage

Resolved prompts can contain matter facts. The registry should avoid storing them.

### Busywork

If entries are too vague or not maintained, the registry becomes decorative. It must contain operational fields that help debugging and release review.

## Open Questions

1. Should the initial registry be hand-authored, generated from metadata near prompts, or hybrid?
2. Where should prompt versions live: inside prompt metadata, release docs, or derived template hashes?
3. Should the registry be exposed in the app UI, CLI, docs, or all three?
4. Should prompt fragments have separate IDs, or only full generation prompts?
5. How should custom skill prompts appear without confusing them with app-owned native prompts?
6. Should tests assert that all provider-backed native skills have prompt registry entries?
7. Should registry entries include model/task routing, or should that stay in model-policy contracts?

## Working Principle

The right first move is conservative:

```text
Make prompts visible and auditable.
Do not make them dynamically editable.
Do not move runtime ownership yet.
Do not store matter-filled resolved prompts.
Use the registry to understand and govern prompt behavior before making it infrastructure.
```
