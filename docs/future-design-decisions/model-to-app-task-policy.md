# Future Design Decision: Model-To-App Task Policy

Date: 2026-05-19
Status: Current boundary partly landed; broader selector policy parked

Current canonical contract:
[Model Task Boundaries](../contracts/model-task-boundaries.md).

## Why This Exists

V2 had a useful product lesson that V1 needed to preserve before any broader
model selector was allowed:

```text
Models are replaceable. Legal-output rules and task boundaries are not.
```

The risk is not simply that a cheaper model gives a weaker answer. The larger
risk is that a model choice made for one kind of work quietly affects another
kind of work.

For example:

- a lawyer chooses a cheap model for fast copilot Q&A;
- the same selected model is then reused for skill creation;
- the model designs weak citation rules or vague output routing;
- the resulting skill becomes durable product behavior;
- future users keep inheriting the bad design long after the original model
  choice is forgotten.

That is the failure mode this future feature should prevent.

## Current V1 Status

The first narrow slice has now landed in V1:

- `shared/model-policy.mjs` includes `AI_TASKS.COPILOT_ANSWER`;
- the visible selector is scoped to transient Matter Copilot answers;
- model switches are pinged before they are accepted;
- failed pings keep the previous model;
- durable skills and source-backed artifacts still resolve model/provider
  through app-owned task policy.

The canonical rule now lives in
[Model Task Boundaries](../contracts/model-task-boundaries.md). This note is
kept as the product rationale and backlog for any broader selector work.

## Deep Review Correction

Do not treat this note as a simple port of V2.

V2 already had a narrow Unibox model selector for matter Q&A, plus tests proving
that `/new_skill` ignores that selected copilot model. V1 now has its own
`copilot_answer` task class and selector boundary. Any broader selector still
needs task boundaries and tests before it is safe.

The deeper rule is also more nuanced than:

```text
copilot = cheap
skills = strong
```

Some copilot work is low-risk and transient, such as "where is the addendum
agreement?" or "summarize this document." That can use deterministic search
first, and cheaper answer models later if a bakeoff supports them.

Other copilot work is transient but legally judgment-heavy, such as "what is the
best hook for first argument?" or "surgically rewrite paragraph 8 of the grounds
with this case law." Those answers may still need a premium source-backed or
drafting model even if they do not immediately write a durable artifact.

So the right classification is not only "transient versus durable." It is:

```text
durability + legal judgment + source dependence + write authority
```

That four-part risk profile should decide the model tier.

## What V1 Already Has

This is not a blank-slate idea. V1 already has important pieces of the policy
spine:

- `shared/model-policy.mjs` classifies current AI tasks such as skill router,
  skill design interview, skill sample output, configurable skill run,
  source-backed analysis, and source description.
- `docs/model-routing.md` explains the provider-routing layer and warns against
  letting individual skills hand-pick provider endpoints.
- `docs/future-design-decisions/legal-workbench-policy-prompt.md` defines the
  legal-output discipline that provider-backed tasks must carry across model
  and provider changes.
- AI run metadata already records policy/model information such as model policy
  version and `policyPromptVersion` on policy-backed paths.
- Paid rerun guardrails already distinguish deterministic actions from
  provider-backed artifact writes.

So the future work is not "invent model policy." The future work is to protect
that model policy when V1 grows a broader copilot/model-choice surface.

Current V1 gaps that matter before broader selector expansion:

- Settings shows only a small task-status subset, not every model-policy task;
- draft-amendment/copilot-strategy tasks need their own task policy before they
  can safely share or override the Copilot answer selector;
- any broader selector must prove exact slash commands, skill design, skill
  execution, and native artifacts remain isolated from that selector.

Deep-review fix landed with this note: `/api/create-listofdates` no longer
accepts a request-body `model` override on the OpenAI-direct route. Durable List
of Dates generation now resolves its model from central task policy, not from a
per-request body field.

## Core Product Distinction

Not every AI task in a legal workbench has the same risk profile.

| Task class | Nature | Future model policy |
| --- | --- | --- |
| Deterministic app work | Navigation, exact slash commands, file scans, local search | No AI |
| Copilot location / explanation | Transient matter help, document finding, quick explanation | Deterministic search first; cheaper models allowed only after bakeoff |
| Copilot legal synthesis | Argument framing, risk comparison, paragraph-level draft amendment | Strong/premium copilot or drafting tier; still no silent artifact overwrite |
| App helper | "Where are skills?", "what should I do next?" | Deterministic first; ultra-cheap later if useful |
| Skill creation | New reusable workflow design, output shape, legal setting | SOTA skill-design tier only |
| Skill modification | Changes durable reusable behavior | SOTA skill-design tier only |
| Skill execution | Source-backed outputs, drafts, notices, native skills | Policy-bound model chosen by task profile |
| Validation/judging | Promotion gates and expected-output checks | Strong/SOTA, policy-bound |
| Native source skills | Source Labels, List of Dates, future evidence primitives | Policy-bound, source-backed, fail closed |

## Policy Hierarchy

A visible model selector must not become the top authority.

The hierarchy should be:

1. **Legal workbench policy**
   - source discipline;
   - citation truth;
   - draft ownership;
   - no invented facts;
   - fail closed when source support is weak;
   - raw citations remain canonical audit handles;
   - readable labels are presentation handles, not proof.

2. **Task class**
   - copilot answer;
   - skill creation;
   - skill modification;
   - skill execution;
   - source-backed native skill;
   - validation/judging task.

3. **Model tier**
   - cheap/fast model;
   - strong general model;
   - SOTA model;
   - provider-specific model.

4. **User-facing selector**
   - allowed only for task classes where user choice is safe;
   - should not silently control durable skill creation, skill modification,
     validation, or source-backed artifact generation.

## Product Rule

When V1 shows a visible model selector, name and scope it honestly.

Prefer:

```text
Copilot answer model
```

Avoid:

```text
Model
```

The plain word "model" implies the choice governs the whole app. That would be
misleading if the selector is intentionally allowed to affect only transient
copilot answers.

## Future Runtime Shape

The runtime should keep this shape:

```text
user action
  -> task classifier / exact command resolver
  -> task class
  -> app-owned model policy
  -> provider adapter
  -> normalized AI run metadata
  -> artifact or transient answer
```

For a transient copilot answer, a selected cheaper model may be permitted after
evidence. For strategic copilot or draft-amendment work, the task profile may
still resolve to a premium model even though the output is conversational.

For durable tasks, the selector should be ignored or shown as inapplicable:

```text
Skill design uses the configured skill-design model.
Source-backed artifacts use the configured legal-workbench policy.
```

## Acceptance Criteria For Copilot Model Selection

- V1 has an explicit `copilot_answer` task policy before any selectable model is
  accepted from the UI.
- Exact slash commands remain deterministic first.
- The selected copilot model is sent only to matter Q&A / copilot answer calls.
- `/new_skill` ignores the copilot answer selector.
- Skill interview planning ignores the copilot answer selector.
- Skill sample generation ignores the copilot answer selector.
- Skill router / overlap checks ignore the copilot answer selector unless a
  separate router policy explicitly permits a cheaper router model.
- Configurable skill authoring, validation, revision, and execution ignore the
  copilot answer selector.
- Native source-backed skills ignore the copilot answer selector.
- Durable artifact routes do not accept request-body model overrides unless a
  separate admin-only route and policy explicitly allow it.
- AI run metadata records the resolved task policy/model/provider actually used
  where the current answer/artifact path supports it.
- UI copy makes the boundary visible without asking lawyers to understand
  provider architecture.
- Tests prove a selected cheap copilot model cannot leak into durable skill
  creation or artifact-writing paths.

## Bakeoff Before Cheap Copilot Defaults

Do not promote cheap copilot models by intuition.

Run a small controlled bakeoff:

- 3 real matters;
- 5 fixed copilot questions per matter;
- include both low-risk location/explanation questions and judgment-heavy
  strategy questions;
- compare usefulness, source discipline, legal caution, speed, and cost;
- no skill creation;
- no artifact writes;
- no durable outputs;
- record results under `docs/acceptance/` or a model-bakeoff note.

Only after that evidence should a cheaper model become a recommended default for
legally meaningful Copilot answers.

## Relationship To Existing V1 Documents

Read this note together with:

- `docs/model-routing.md` for current provider/model routing.
- `docs/future-design-decisions/legal-workbench-policy-prompt.md` for the
  app-owned legal-output policy.
- `docs/future-design-decisions/cost-estimation-framework.md` for future spend
  awareness.
- `docs/future-design-decisions/native-skill-library-strategy.md` for why
  native reusable skills should absorb common legal work instead of relying on
  unconstrained custom prompts.

V2 reference documents that informed this parked feature:

- `matter-workbench-v2/docs/model-tier-policy.md`
- `matter-workbench-v2/docs/model-routing.md`
- `matter-workbench-v2/docs/legal-workbench-policy-contract.md`
- `matter-workbench-v2/docs/source-label-presentation-plan.md`

## Non-Goals

This parked feature does not authorize:

- adding a broad model dropdown immediately;
- letting lawyers pick models for durable legal artifacts;
- weakening source-backed native skills to save cost;
- using cheap models for skill creation because they are available;
- treating readable source labels as proof-grade citations;
- removing raw canonical source handles from audit metadata;
- changing current provider routing without tests and acceptance evidence.

## Decision Summary

V1 should learn the clean v2 mental model, but not copy it blindly.

The standing decision is:

```text
Model choice is a task-policy feature, not a global settings-dropdown feature.
```

The first build slice is now the narrow Copilot answer selector. The remaining
parked work is any broader model-choice surface, especially draft amendment,
strategy, validation, or source-backed artifact policy.
