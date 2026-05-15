# Model Routing Design

This document is the guardrail for OpenAI direct, OpenRouter, and any later model gateway in Matter Workbench.

The short version:

```text
skill -> task profile -> model policy -> provider client
```

A skill should say what kind of work it is doing. A central policy layer should decide which model tier is allowed. A provider client should translate that policy into the actual API request. Individual skills should not know whether a request goes to OpenAI directly, OpenRouter, or a later provider.

## Why This Exists

Matter Workbench is starting to have two different kinds of AI work:

- Router work, such as deciding whether a proposed skill overlaps with the registry.
- Lawyer-facing work, such as building a cited list of dates from extraction records.

Those jobs should not automatically use the same model. A router can often be cheap, fast, and low-context. A legal chronology needs stronger reasoning, strict source grounding, and conservative failure behavior.

The trap is to solve this by sprinkling model names inside each skill. That works for a week and then becomes hard to reason about. The better design is closer to chambers administration: each task gets classified by risk and required capability, then the clerk sends it to the right desk under a written policy.

## Current State

As of the current implementation, the app has:

- `shared/ai-defaults.mjs` for default OpenAI model constants.
- `shared/responses-client.mjs` for OpenAI Responses API fetch, error mapping, output text extraction, and JSON parsing.
- `shared/model-policy.mjs` for task-specific model policy resolution.
- `shared/ai-provider-policy.mjs` for request-ready provider config and metadata.
- `create-listofdates-engine.mjs` using OpenAI direct by default and an explicit OpenRouter path when configured.
- `source-descriptors-engine.mjs` using OpenRouter for `source_description`.
- `services/skill-router-service.mjs` using OpenAI direct for skill intent routing.
- `skills/registry.json` describing current skills, but not yet declaring model policy.

The shared clients are intentionally thin. They know how to make provider requests and parse JSON. They do not decide legal risk, task complexity, privacy requirements, or fallback strategy.

That judgment belongs in model policy.

## OpenRouter Fit

OpenRouter is useful here because it provides access to multiple models behind one API surface. Matter Workbench currently uses two API shapes:

- OpenAI direct uses the OpenAI Responses API through `shared/responses-client.mjs`.
- OpenRouter-backed legal tasks use `POST https://openrouter.ai/api/v1/chat/completions` with strict JSON schema output.

The important contract is not the endpoint name. The important contract is that the model policy resolves the provider, model, token budget, timeout, structured-output requirement, and fallback posture before a skill makes a request.

Relevant OpenRouter docs:

- [API overview and model routing fields](https://openrouter.ai/docs/api/reference/overview/)
- [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)

Important caution: OpenRouter routing is a provider capability, not a skill design principle. The app should be able to run direct OpenAI only, OpenRouter only, or a mixed provider setup without rewriting skills.

## Non-Goals

This document still does not propose:

- Adding new provider code in documentation-only changes.
- Changing prompts.
- Changing skill registry schema.
- Moving every model choice into the UI.
- Letting an AI model choose the production model policy.
- Using the cheapest possible model for legal work by default.

Cost matters, but in a legal workflow it is not the first axis. Risk and auditability come first.

## Product Principle

```text
Deterministic work stays deterministic.
AI work declares its risk.
Policy chooses the model tier.
Provider adapters execute the request.
Artifacts record what happened.
```

The app should never silently downgrade a lawyer-facing skill to a weaker model because the cheaper option was available. If the selected policy cannot be satisfied, fail closed with a clear error.

## Architecture

The intended shape is:

```text
skills/registry.json
        |
        v
model policy resolver
        |
        v
provider adapter
        |
        v
OpenAI direct or OpenRouter
```

Skills should keep building task-specific prompts and schemas. They should not select provider endpoints directly.

### Layer 1: Skill Task Profile

A task profile describes what the skill needs, not which vendor should answer.

Example future registry shape:

```json
{
  "slash": "/create_listofdates",
  "ai": {
    "task_type": "source_backed_analysis",
    "complexity": "medium",
    "legal_risk": "lawyer_facing",
    "source_grounding": "required",
    "structured_output": "required",
    "latency_sensitivity": "normal",
    "context_window": "standard"
  }
}
```

This is intentionally provider-neutral. It says, "This is cited legal analysis that must return structured JSON." It does not say, "Use model X from provider Y."

### Layer 2: Model Policy

The model policy maps task profiles to model tiers.

Example internal policy:

```json
{
  "router": {
    "tier": "router",
    "max_output_tokens": 1200,
    "allow_external_router": true,
    "requires_zdr": false,
    "fallback": "same_tier_only"
  },
  "source_backed_analysis": {
    "tier": "reasoning",
    "max_output_tokens": 3000,
    "allow_external_router": false,
    "requires_zdr": true,
    "fallback": "fail_closed"
  }
}
```

This is where legal-risk judgment belongs.

### Layer 3: Provider Client

The provider client turns resolved policy into an API request.

Future interface sketch:

```js
const result = await aiProvider.requestJson({
  task: "source_backed_analysis",
  policy,
  body,
  schemaName: "list_of_dates_chunk",
});
```

The provider client returns normalized JSON or throws an HTTP-shaped error. Skills should not parse provider-specific response shapes.

## Suggested Model Tiers

These are logical tiers. They are not fixed model names.

| Tier | Intended Work | Default Posture |
| --- | --- | --- |
| `router` | Skill intent classification, MECE checks, lightweight classification | Cheap and fast, no matter documents |
| `balanced` | Low-risk summarization, internal planning, non-final helper tasks | Moderate quality, lower cost |
| `source_backed_analysis` | Chronologies, issue extraction, evidence-linked analysis | Strong model, citations required, fail closed |
| `drafting` | Lawyer-facing drafts, pleadings, formal letters | Strong reasoning, strict review gate |
| `long_context` | Large record sets or cross-document synthesis | Large context, cost visible |

The first implementation does not need all tiers. It can start with `router` and `source_backed_analysis`, because those map to the current AI surfaces.

## Current Skill Mapping

| Skill | Current AI Use | Proposed Profile |
| --- | --- | --- |
| `/matter-init` | None | deterministic |
| `/extract` | None | deterministic |
| `/create_listofdates` | OpenAI direct by default; optional OpenRouter Chat Completions, structured JSON | `source_backed_analysis` |
| `/describe_sources` | OpenRouter Chat Completions, structured JSON | `source_description` |
| `/doctor` | None | deterministic |
| Skill router | OpenAI Responses, structured JSON | `router` |

This table shows why model routing should be central. The app already has deterministic skills and AI skills with different risk levels.

## Skill Model Policy

The saved-skill governance flow should be quality-first where the model is shaping future legal work product. Cost still matters for bulk/mechanical work, but high-order judgment tasks should default to the strongest proven planner. The current bakeoff evidence points to `gpt-5.4` for those stages: it beat `gpt-4.1` on skill-interview quality, while `gpt-5.5` was terser and less useful for this strict 1-3 question planning surface.

Current deterministic stages:

| Stage | Model Posture | Reason |
| --- | --- | --- |
| Skill idea capture | No model | It records user intent and must not imply a runnable skill was created. |
| Skill interview V1 | Deterministic fallback | It uses lawyer-facing templates for interview planning and saves answers into the design brief. A future model-backed planner may only plan questions, not generate runnable skills. |
| Readiness gate | No model | It checks whether required design-brief fields are present. |
| Command rail slash dispatch | No model | Exact slash commands and static aliases run the same explicit skill runners as the UI buttons. |

Current AI-assisted stage:

| Stage | Model Posture | Reason |
| --- | --- | --- |
| Skill router / overlap check | Cheap, fast router tier is acceptable | The router classifies or checks overlap. It should not receive full matter documents by default. |
| Skill design interview planner | Quality-first default: `gpt-5.4` when model planning is enabled; deterministic fallback otherwise | It may receive the idea text, safe matter metadata, built-in skill cards, and existing design-brief fields. It must not receive raw documents, extraction blocks, Source Index content, List of Dates content, logs, `.env`, API keys, or chat history. |
| Skill sample output | Quality-first default: `gpt-5.4` | It generates a review sample from the bounded matter context after the user chooses a test matter. It must not create a runnable skill, prompt, slash command, or matter artifact. |

## Quality-First GPT-5.4 Task Map

Use `gpt-5.4` for work where one weak model answer can bend the product in the wrong direction: legal framing, future skill design, strategic review, and externally visible drafts. Do not spend it on deterministic state checks, routing glue, or bulk extraction.

| Task / Surface | Recommended Model Posture | Why |
| --- | --- | --- |
| Skill design interview planner | `gpt-5.4` via OpenAI direct once model-backed planning is enabled | It decides what questions get asked before a future skill is designed. Bad questions create bad briefs. |
| Skill sample output review loop | `gpt-5.4` via OpenAI direct | The sample is what the lawyer judges before any future build step. Poor samples create false confidence, so this is a quality-first stage. |
| Skill design review | `gpt-5.4` | It should catch overlap, ambiguity, risk, missing acceptance criteria, and bad default assumptions before implementation. |
| Skill authoring / prompt-schema drafting | `gpt-5.4` minimum, with human review and fail-closed activation | This shapes future runnable behavior. Quality beats cost here. |
| Configurable skill validation for legal/high-risk skills | `gpt-5.4` | It should judge whether generated output obeys citation, evidence, tone, and artifact contracts before a skill can be trusted. |
| Matter Q&A / legal synthesis, when added | `gpt-5.4` for answer synthesis | The model will be reasoning over bounded evidence and giving lawyer-facing answers. It must cite source labels and raw citations. |
| Weakness Review, Limitation Review, Evidence Gap Review, Opponent Argument Map, Settlement Risk Matrix | `gpt-5.4` | These are strategic legal-review tasks where nuance matters more than token cost. |
| Senior Counsel Briefing, Court Synopsis, Legal Notice, Affidavit, Client Update Email | `gpt-5.4` | These are draft or dispatch-adjacent tasks. They need careful tone, legal boundaries, and human review. |
| `/create_listofdates` lawyer-facing final chronology | Quality-first candidate: `gpt-5.4`; keep observable provider/model metadata | Chronology is core legal work product. If the goal is maximum quality over cost, this belongs in the premium tier, subject to real-matter smoke and raw citation checks. |
| `/describe_sources` source labels | Strong structured model, but not automatically `gpt-5.4` | This is high-volume descriptor work. Keep strict JSON and fail-closed behavior; escalate only if label quality or malformed JSON failures justify it. |
| Skill router / overlap check | Cheap/fast structured model | It should classify, not decide legal strategy. If uncertain, ask for approval instead of spending premium model budget. |
| Command rail parsing, status, lane navigation, context preview/search, readiness checks | No model | These are deterministic product controls. |
| Intake, extraction, OCR normalization, artifact status, rerun advice | No model or task-specific OCR provider | These are pipeline mechanics, not legal reasoning. |

The operational split is therefore:

```text
Premium legal/design judgment: gpt-5.4
Bulk structured labeling: strong structured model with strict schema, escalate only on evidence
Routing and app controls: cheap or deterministic
```

Current implementation note: `gpt-5.4` did not work through OpenRouter for the skill interview planner under the strict `json_schema + require_parameters=true` contract. Use the OpenAI-direct planner path for this task:

```text
SKILL_INTERVIEW_PLANNER_ENABLED=1
SKILL_INTERVIEW_PLANNER_PROVIDER=openai-direct
OPENAI_SKILL_INTERVIEW_PLANNER_MODEL=gpt-5.4
OPENAI_SKILL_INTERVIEW_PLANNER_MAX_OUTPUT_TOKENS=2600
OPENAI_SKILL_INTERVIEW_PLANNER_TIMEOUT_MS=90000
```

The OpenRouter planner path remains available for models that can honor the strict schema contract.

Skill work needs separate task names before any selector or runtime provider choice becomes visible:

```js
AI_TASKS.SKILL_ROUTER
AI_TASKS.SKILL_DESIGN_INTERVIEW
AI_TASKS.SKILL_DESIGN_REVIEW
AI_TASKS.SKILL_AUTHORING
AI_TASKS.CONFIGURABLE_SKILL_RUN
AI_TASKS.CONFIGURABLE_SKILL_VALIDATION
AI_TASKS.CREATE_LISTOFDATES_PASS1
AI_TASKS.CREATE_LISTOFDATES_PASS2
```

Recommended future policy:

| Future Stage | Model Posture | Rule |
| --- | --- | --- |
| Skill design review | Strong model | Review a completed brief for overlap, ambiguity, risk, and missing acceptance criteria. |
| Prompt/schema authoring | Highest available model | Fail closed, require human review, and do not activate generated work automatically. |
| Configurable skill validation | Strong or task-specific model | Validate against goldens and citation rules before activation. |
| Runnable configurable skill execution | Skill's own task policy | Do not always use the highest model. A deterministic skill stays deterministic; a source-backed legal skill uses source-backed policy; a drafting skill uses drafting policy. |

Do not add a visible model selector for skill work until these task names are stable. Settings may later show model posture per task, and the Skills tab may later show labels such as `Authoring model: premium` or `Run model: source-backed analysis policy`. The lawyer should not have to choose models while describing an idea.

## Runtime Environment Contract

Use `.env.example` as the starting point for local configuration. Do not commit real keys.

OpenAI direct remains the default for `/create_listofdates`:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
OPENAI_MAX_OUTPUT_TOKENS=3000
SOURCE_BACKED_ANALYSIS_PROVIDER=openai-direct
```

To route `/create_listofdates` through OpenRouter instead, set all of these explicitly:

```text
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL=meta-llama/llama-3.3-70b-instruct
OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS=3000
OPENROUTER_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS=90000
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_ORDER=
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_PROMPT_PRICE=
OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_COMPLETION_PRICE=
```

The gated two-pass `/create_listofdates` runtime uses separate pass policies so the harvester and editor can be tuned independently:

```text
CREATE_LISTOFDATES_TWO_PASS_ENABLED=0
CREATE_LISTOFDATES_PASS1_PROVIDER=openai-direct
OPENAI_CREATE_LISTOFDATES_PASS1_MODEL=gpt-4.1
OPENAI_CREATE_LISTOFDATES_PASS1_MAX_OUTPUT_TOKENS=9000
OPENAI_CREATE_LISTOFDATES_PASS1_TIMEOUT_MS=120000
CREATE_LISTOFDATES_PASS2_PROVIDER=openai-direct
OPENAI_CREATE_LISTOFDATES_PASS2_MODEL=gpt-5.4-mini
OPENAI_CREATE_LISTOFDATES_PASS2_MAX_OUTPUT_TOKENS=9000
OPENAI_CREATE_LISTOFDATES_PASS2_TIMEOUT_MS=120000
```

The one-pass runtime remains default while this gate is off.

This is intentionally separate from source-description settings:

```text
OPENROUTER_SOURCE_DESCRIPTION_MODEL=...
OPENROUTER_SOURCE_DESCRIPTION_MAX_OUTPUT_TOKENS=3000
OPENROUTER_SOURCE_DESCRIPTION_TIMEOUT_MS=90000
```

The separation prevents a route-level bug where OpenAI model or token overrides accidentally shadow OpenRouter settings. If `SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter`, `/api/create-listofdates` must use `OPENROUTER_SOURCE_BACKED_ANALYSIS_*` for model and token budget, not `OPENAI_MODEL` or `OPENAI_MAX_OUTPUT_TOKENS`.

OpenRouter chronology requests are still fail-closed:

- `provider.require_parameters=true`
- `provider.allow_fallbacks=false`
- no automatic model fallback
- raw `FILE-NNNN pX.bY` citations remain canonical

For `/create_listofdates`, use either a pinned provider order or price/latency routing, not both. `OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT` accepts `price`, `throughput`, or `latency`. A provider order cannot be combined with `OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT`, `OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_PROMPT_PRICE`, or `OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_COMPLETION_PRICE`.

The current recommended smoke-tested setting is `OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency`. The final merged-path smoke hit OpenRouter `429` twice with `provider.sort=price`, while `provider.sort=latency` succeeded and returned provider `Friendli`.

## Provider Modes

### Mode 1: OpenAI Direct

Use the existing `shared/responses-client.mjs` path with the configured OpenAI API key.

This remains the safest default because it is already working and tested.

### Mode 2: OpenRouter Chat Completions Adapter

Use a separate adapter that targets `https://openrouter.ai/api/v1/chat/completions` and passes policy-driven fields such as:

- `model` for a single selected model.
- `provider.require_parameters=true`.
- `provider.allow_fallbacks=false`.
- `response_format.type=json_schema`.
- `max_tokens` from the resolved policy.
- `temperature=0` for stable source-backed extraction.

This adapter lives beside the OpenAI direct path. Skills keep their prompt and schema construction local, while the provider boundary handles request shape, API key selection, error mapping, timeout, and returned model/usage metadata.

### Mode 3: Hybrid

Use OpenAI direct for some tasks and OpenRouter for others, based on explicit task policy.

The current production posture is:

```text
skill router -> OpenAI direct
source_description -> OpenRouter
create_listofdates -> OpenAI direct by default, OpenRouter only when SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
future drafting -> not wired
```

## Privacy And Legal-Risk Constraints

Model routing for legal workflows should be policy-first.

Minimum constraints:

- Matter documents must not be sent through a new provider until the user explicitly enables that provider.
- Lawyer-facing outputs should require a stronger tier than internal router tasks.
- Source-backed skills must keep citation validation independent of the model.
- If a provider cannot guarantee the required data handling posture, the request should fail.
- If fallback would move data to a provider outside the allowed set, fallback must be disabled.
- The app should log provider, model, policy version, request class, and token usage when available.
- The UI should distinguish "AI unavailable" from "policy refused this route."

For OpenRouter specifically, provider preferences such as `zdr`, `only`, `ignore`, `order`, and fallback controls should be policy outputs, not prompt-level choices.

## Fallback Rules

Fallback is useful for reliability, but it can be dangerous if it changes quality or data handling silently.

Recommended rules:

1. Router tasks may use same-tier fallback.
2. Lawyer-facing tasks should initially use `fail_closed`.
3. Cross-provider fallback requires an explicit allowlist.
4. Fallback must not bypass structured-output support.
5. Fallback must not bypass source-grounding or citation validation.
6. Invalid JSON is not automatically a reason to use a cheaper model. It may be retried once on the same model, then fail.
7. Context-length failure should surface as a chunking or long-context policy problem, not a silent downgrade.

OpenRouter supports model arrays for fallback, but the app should decide when that feature is allowed.

## Provider Fallback Policy

The app should treat provider choice as a runtime route, not as a permanent allegiance to one vendor path.

The two practical routes are:

```text
OpenAI direct
OpenRouter / vendor-mediated
```

The policy question is not "which provider is best forever?" The useful question is:

```text
For this task, which route is primary, which route is allowed as fallback, and what must be recorded if fallback happens?
```

### Principles

1. Provider fallback must be task-specific.
2. Direct-to-vendor and vendor-mediated routes should both be supported where the task policy allows it.
3. No lawyer-facing task should silently move to a materially weaker model or different data-handling route.
4. Every AI run must record requested provider/model, returned provider/model, fallback reason, and validation outcome.
5. If fallback changes the expected quality/risk posture, the UI or run report should say so.
6. If structured JSON, citation preservation, or source-grounding fails after fallback, the run fails closed.

### Two-Pass List of Dates Evidence

The Atlas two-pass bakeoff showed why fallback needs to consider both model quality and provider reliability.

Quality finding:

```text
best legal-use accuracy: gpt-4.1 -> gpt-5.4-mini
clean concise alternate: gpt-5.4-mini -> gpt-5.4
```

Operational finding:

```text
OpenRouter Claude editor passes can work, but strict JSON can be fragile.
Claude as verbose first pass repeatedly returned truncated / unterminated JSON with the current chunk shape.
```

This means OpenRouter should not be treated as "bad" or "good" globally. It should be treated as another route with task-specific evidence.

### Recommended V0 Fallback Shape

For source-backed chronology work:

```text
primary: configured proven model pair
fallback route: same role, same or comparable quality tier, explicit allowlist only
retry: same provider/model on transient 5xx/network failure
fail closed: malformed JSON after retry, citation failure, source-grounding failure
```

For the current two-pass chronology eval:

```text
pass 1 fallback:
  only to a model proven to return valid candidate JSON on chunks of this size

pass 2 fallback:
  OpenRouter Claude can be tested as an editor fallback, but the run must record JSON retries and returned model aliases
```

For skill interviews and skill authoring:

```text
primary: OpenAI direct premium policy
fallback: deterministic fallback for interview planning; no automatic fallback for authoring unless validation and human review remain intact
```

For lightweight router tasks:

```text
primary: cheap structured model
fallback: same-tier structured model is acceptable
```

### Fallback Metadata

Every provider-backed run should eventually include:

```json
{
  "requestedProvider": "openai-direct",
  "requestedModel": "gpt-4.1",
  "returnedProvider": "openai-direct",
  "returnedModel": "gpt-4.1-2025-04-14",
  "fallbackUsed": false,
  "fallbackReason": "",
  "attempts": 1,
  "structuredOutputValid": true,
  "citationValidationPassed": true
}
```

If fallback happens:

```json
{
  "requestedProvider": "openai-direct",
  "requestedModel": "gpt-5.4-mini",
  "actualProvider": "openrouter",
  "actualModel": "anthropic/claude-4.6-sonnet-20260217",
  "fallbackUsed": true,
  "fallbackReason": "primary provider timeout",
  "structuredOutputValid": true,
  "citationValidationPassed": true
}
```

This is especially important with brokered providers because the returned model alias may differ from the requested model id.

### Non-Goals For Now

Do not add yet:

- visible model chooser for lawyers;
- silent auto-fallback for `/create_listofdates`;
- multi-provider fallback for all skills;
- provider fallback that bypasses validation;
- fallback from a premium legal task to a cheap model merely to save cost.

The next implementation step should be a small policy resolver shape, not broad runtime failover.

## Configuration Shape

A later config file could look like this:

```json
{
  "schema_version": "model-routing/v1",
  "default_provider": "openai-direct",
  "providers": {
    "openai-direct": {
      "enabled": true,
      "endpoint": "https://api.openai.com/v1/responses"
    },
    "openrouter": {
      "enabled": false,
      "endpoint": "https://openrouter.ai/api/v1/chat/completions",
      "allow_matter_documents": false
    }
  },
  "tiers": {
    "router": {
      "provider": "openrouter",
      "models": ["example/router-model"],
      "max_output_tokens": 1200,
      "fallback": "same_tier_only"
    },
    "source_backed_analysis": {
      "provider": "openai-direct",
      "model": "default",
      "max_output_tokens": 3000,
      "fallback": "fail_closed"
    }
  }
}
```

Use placeholders in code until real model IDs are selected. Model IDs change, and hardcoding fashionable names into skill files will age badly.

## Observability

Every AI run should eventually record:

- Skill slash command.
- Task profile.
- Model policy version.
- Provider.
- Model actually used.
- Fallback path, if any.
- Input and output token counts when available.
- Whether structured output validation passed.
- Whether citation validation passed.

This should go into skill output metadata or logs, not just terminal text. When a lawyer asks why a chronology was produced a certain way, the app should have an answer beyond "the AI said so."

## Failure Modes

The design should make these cases boring:

| Failure | Expected Behavior |
| --- | --- |
| No API key | 409 with setup guidance |
| Provider disabled by policy | 409 or 403-style policy error |
| Body too large | Fail before provider call |
| Model lacks structured JSON support | Fail closed |
| Provider rate-limited | Retry or fallback only if policy allows |
| Fallback provider outside allowlist | Fail closed |
| Invalid JSON | Same-model retry later, then 502 |
| Missing citations | Reject output in the skill validation layer |

## Implementation Status

Completed:

1. Added `shared/model-policy.mjs` with current task policies.
2. Added the provider-adapter boundary for request-ready config and metadata.
3. Wired `source_description` to OpenRouter with strict JSON schema output.
4. Wired `/create_listofdates` to keep OpenAI direct as default and opt into OpenRouter only with `SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter`.
5. Added artifact metadata so generated outputs record policy version, task, tier, provider, model, token budget, fallback posture, and provider-returned usage when available.
6. Added `.env.example` coverage for the implemented provider-selection env vars.
7. Added gated two-pass `/create_listofdates` task policies for `create_listofdates_pass1` and `create_listofdates_pass2`.

Still not done:

- No automatic model fallback.
- No provider-selection UI.
- No registry schema change.
- No Gemini fallback or multi-provider orchestration.
- No silent provider change for lawyer-facing skills.

## Decision

OpenRouter is useful, but it must stay behind central model policy and provider adapters.

Do not wire provider-specific behavior directly into skills or routes. The architecture should make model choice inspectable, testable, and reversible.
