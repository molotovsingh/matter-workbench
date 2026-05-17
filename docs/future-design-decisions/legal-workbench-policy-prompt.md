# Future Design Decision: Legal Workbench Policy Prompt

Date: 2026-05-16
Status: First implementation slice landed

## Why This Exists

Every provider-backed legal task should carry a stable app-owned policy prompt.
This is not only about making custom skills safer. It is also a model-risk
control.

Models are replaceable. Legal-output rules are not.

Matter Workbench may run tasks through OpenAI direct, OpenRouter, cheaper
router models, stronger drafting models, or future firm-configured providers.
The app should not rely on a model's default personality, safety posture, or
formatting habits to decide how legal work product is written.

The legal workbench needs its own professional discipline:

- do not invent facts, dates, parties, or procedural steps;
- preserve uncertainty and source limitations;
- distinguish internal, lawyer-visible, and court-facing output;
- keep raw system citations internal unless an audit view explicitly asks for
  them;
- avoid overclaiming legal conclusions;
- fail closed when the evidence or schema is insufficient.

Those rules should travel with the task, even when the model changes.

## Scope

This contract applies to provider-backed tasks:

- source-description generation;
- List of Dates generation and editing passes;
- skill interview planning;
- skill sample generation;
- configurable skill authoring and runs;
- future native legal skills.

It does not apply to deterministic commands such as file setup, extraction,
local search, or simple readiness checks, except where those commands display
or validate AI-produced output.

This is not a proposal to make one giant prompt that every skill blindly
pastes. It is a proposal for shared policy sections that are composed into
task-specific prompts.

## Layered Prompt Shape

Use four layers.

### 1. Global Workbench Policy

The global layer defines the legal-output rules every provider-backed task must
inherit.

Minimum rules:

- use only supplied matter records and user instructions;
- do not invent facts, citations, documents, courts, parties, dates, amounts,
  deadlines, or procedural events;
- preserve date precision. If the source only supports a year or month, do not
  turn it into a fake exact date;
- separate facts from legal characterization;
- mark uncertainty and limitations clearly;
- do not provide final legal advice unless the skill is explicitly designed for
  that reviewed output;
- use conservative lawyer drafting tone;
- obey the requested output schema;
- fail closed or return a limitation when source support is insufficient.

### 2. Source And Visibility Policy

The source layer defines what may appear in normal lawyer-visible output.

Default lawyer-visible and dispatch-facing output must not expose:

- `FILE-0001` style source IDs;
- hashes;
- local storage paths;
- extraction IDs;
- provider traces;
- raw prompt traces;
- candidate ledgers;
- raw model response fragments.

Those details may stay in JSON, audit metadata, technical views, hover details,
or developer logs. Normal lawyer-visible text should prefer confirmed source
labels, suggested document labels, annexure labels, exhibit labels, paper-book
references, or other lawyer-confirmable labels.

### 3. Native Skill Policy

Each native skill adds its own legal job rules.

For `Create List of Dates`, the policy should include:

- one legal event per row;
- consolidate duplicate mentions of the same event;
- do not treat repeated citations as repeated events;
- preserve date precision;
- use lawyer-facing source labels in rendered Markdown;
- keep raw citations in internal JSON or audit views;
- describe legal relevance as procedural, evidentiary, limitation-related, or
  drafting-relevant without making unsupported arguments;
- include limitations and follow-up needs when the source record is incomplete.

For `Source Labels / Document Index`, the policy should include:

- distinguish a document title from a party position or procedural event;
- prefer labels a lawyer can verify and rename;
- preserve stable source identity internally;
- surface bad-copy and missing-document signals without blocking by default.

### 4. Custom Skill Policy

Custom skills may customize workflow, output shape, audience, and firm-specific
style. They must not override the baseline legal discipline.

The app should treat custom-skill instructions as narrower task instructions
inside the larger workbench contract.

If a user-created skill asks for unsafe behavior, such as hiding adverse facts,
inventing citations, exposing raw internal IDs in a court-facing draft, or
treating comments as canonical facts without review, the app should reject the
request or return a visible warning.

## Model-Risk Function

The policy prompt is a model abstraction layer.

Model routing decides where a task runs. The policy prompt defines the legal
discipline that task must carry wherever it runs.

This gives the app a testable contract across providers:

- if a model leaks raw `FILE-0001` citations into lawyer Markdown, it failed
  the app contract;
- if a model turns a year-only fact into `YYYY-01-01`, it failed the app
  contract;
- if a model creates duplicate chronology rows from repeated citations, it
  failed the app contract;
- if a model ignores the schema, it failed the app contract;
- if a model overstates a legal conclusion without source support, it failed
  the app contract.

This matters more as the app supports multiple providers and future models.
The app should be able to swap models without silently swapping professional
rules.

## Implementation Shape

The first code slice adds a shared module:

```text
shared/legal-workbench-policy-prompt.mjs
```

The module exposes small composable policy sections, not one opaque string.
Current exports:

```text
LEGAL_WORKBENCH_POLICY_PROMPT_VERSION
GLOBAL_LEGAL_POLICY_PROMPT
SOURCE_VISIBILITY_POLICY_PROMPT
NATIVE_SKILL_POLICY_PROMPTS
CUSTOM_SKILL_POLICY_PROMPT
legalWorkbenchSystemPrompt(taskPrompt, options)
```

Provider-backed tasks should compose the relevant sections into their existing
task prompts.

AI run metadata records the policy prompt version used, for example:

```json
{
  "policyPromptVersion": "legal-workbench-policy/v1"
}
```

That makes model behavior easier to audit when providers, model IDs, or prompt
versions change.

Configurable skill definitions and run receipts should preserve the same policy
prompt version in their model/run metadata. A custom skill can change the task
instructions, but it should not erase which app-level legal policy governed the
provider request.

AI-run metadata should be normalized through:

```text
shared/ai-run-metadata.mjs
```

That keeps matter status, rerun advice, context packets, generated sample
ledgers, and configurable-skill run receipts from drifting into separate
field whitelists.

## First Consumers

The first implementation covers the surfaces already producing lawyer-visible
or skill-shaping output:

1. `/describe_sources` as `Source Labels / Document Index`.
2. `/create_listofdates` candidate and editor passes.
3. Skill interview planning.
4. Skill sample generation.
5. Configurable skill authoring and run execution.

The simple AI settings connection probe is deliberately outside this contract
because it is not legal work product; it only asks the configured provider to
reply with a fixed health-check token.

## Acceptance Checks

A first implementation should include fixtures that prove:

- lawyer-visible Markdown does not leak raw `FILE-0001` citations;
- year-only or month-only facts are not converted into fake exact dates;
- repeated citations do not become duplicate chronology events;
- source labels remain lawyer-readable while internal source identity is
  preserved;
- insufficient evidence produces a limitation or fail-closed result;
- the same fixture can be evaluated across two model routes without changing
  the legal-output rules.

## Non-Goals

This contract does not propose:

- a lawyer-visible prompt editor;
- letting custom skills override the baseline policy;
- moving model selection into the lawyer UI;
- court-facing exports in the first slice;
- rewriting the List of Dates engine before the source-record contract is
  stable.
