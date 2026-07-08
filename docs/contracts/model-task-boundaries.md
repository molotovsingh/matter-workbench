# Model Task Boundaries

Status: Current canonical contract

This contract defines which app tasks may be affected by model choice, and which
tasks must remain governed by app-owned policy.

The core rule is:

```text
models are replaceable
task boundaries and legal-output rules are not
```

A user-facing model selector must never become the top authority for durable
legal work.

## Why This Exists

Matter Workbench uses models for different kinds of work:

- transient Copilot answers;
- skill routing and overlap checks;
- skill design interviews;
- sample output generation;
- custom skill authoring and validation;
- source labels;
- Case Timeline generation;
- future drafting and draft amendments.

These tasks do not have the same risk profile.

A weak transient answer can be discarded. A weak skill design or source-backed
artifact can shape future work and mislead the lawyer later. That is why model
routing is an app policy problem, not a single global dropdown.

## Policy Hierarchy

The hierarchy is:

```text
legal workbench policy
-> task class
-> model policy
-> provider adapter
-> optional user-facing selector, only where allowed
```

The legal workbench policy owns source discipline, citation truth, draft
ownership, no invented facts, and fail-closed behavior.

The task class determines whether a model choice is safe.

The provider adapter executes the resolved policy. It does not decide legal
risk.

## Current AI Task Classes

Current task policy constants live in `shared/model-policy.mjs`.

Current task classes include:

| Task | Nature | Selector authority |
| --- | --- | --- |
| `skill_router` | Intent/overlap classification. | App policy. |
| `skill_design_interview` | Questions that shape a future skill brief. | App policy. |
| `skill_sample_output` | Non-runnable sample for review. | App policy. |
| `skill_authoring` | Durable skill prompt/config/schema authoring. | App policy. |
| `configurable_skill_run` | Custom skill execution that writes matter artifacts. | App policy. |
| `copilot_answer` | Transient matter Q&A in the assistant rail. | Copilot selector may apply after ping/validation. |
| `copilot_web_research` | Explicit Research mode answer from matter context plus validated public sources. | App policy for now; may later share Copilot selector only after a research-specific ping/validation contract. |
| `create_listofdates_pass1` | First-pass chronology generation. | App policy. |
| `create_listofdates_pass2` | Editor pass for chronology output. | App policy. |
| `source_backed_analysis` | Source-backed legal analysis. | App policy. |
| `source_description` | Source labels / document index descriptors. | App policy. |

The current visible selector is a Copilot answer selector, not a global model
selector.

## Copilot Selector

The Copilot selector may affect only transient `copilot_answer` calls.

Current rules:

- selector labels may be short, such as `4.1` or `Gemini`;
- Settings should show the real provider/model route;
- saved Copilot settings override defaults;
- model switches must be pinged before being accepted;
- failed pings must reject the switch and keep the previous model;
- Copilot answers are one-question-at-a-time and do not create durable matter
  artifacts.

The selector must not affect:

- exact slash command dispatch;
- `/new_skill`;
- skill design interview planning;
- skill sample output generation;
- skill authoring;
- custom skill validation;
- custom skill execution;
- Source Labels / Document Index;
- Case Timeline;
- drafting or dispatch workflows unless a future contract explicitly scopes a
  draft-amendment selector.

## Durable Artifact Routes

Durable artifact routes resolve model/provider through central task policy.

They should not accept request-body model overrides merely because the UI has a
model selector.

If an admin-only override is ever added, it needs its own explicit route,
policy, tests, and artifact metadata. It must not be indistinguishable from a
normal lawyer action.

## Exact Commands

Exact slash commands and deterministic app actions resolve before model
classification.

Examples:

- opening skills;
- finding a matter;
- showing matter lanes;
- running deterministic setup/status actions.

These should not call a model merely because the command box text happens to be
freeform-capable.

## Metadata

Provider-backed work should record the resolved task policy and model/provider
actually used where the current artifact or run ledger supports it.

Useful metadata includes:

- `modelPolicyVersion`;
- task name;
- provider;
- model;
- `policyPromptVersion` where legal-output policy is composed;
- structured-output and fallback posture where relevant.

This metadata should support audit/debugging without exposing raw provider
traces in normal lawyer-facing output.

## Non-Goals

- This contract does not add a global model dropdown.
- This contract does not let lawyers pick models for durable artifacts.
- This contract does not make cheap models acceptable for skill creation.
- This contract does not override the legal workbench policy prompt.
- This contract does not define billing or cost-estimation UX.
- This contract does not authorize provider fallback for source-backed legal
  artifacts unless task policy explicitly permits it.

## Implementation Pointers

Current code and docs connected to this contract include:

- `shared/model-policy.mjs`;
- `shared/ai-provider-policy.mjs`;
- `shared/legal-workbench-policy-prompt.mjs`;
- `services/matter-copilot-service.mjs`;
- `services/copilot-web-research-service.mjs`;
- `services/ai-settings-service.mjs`;
- `services/skill-router-service.mjs`;
- `services/skill-interview-planner-service.mjs`;
- `services/skill-sample-output-service.mjs`;
- `services/configurable-skills-service.mjs`;
- `source-descriptors-engine.mjs`;
- `create-listofdates-engine.mjs`;
- `docs/model-routing.md`;
- `docs/copilot-qna-contract.md`;
- `test/ai-settings-service.test.mjs`;
- `test/skill-router-intent.test.mjs`;
- `test/create-listofdates-api.test.mjs`.
