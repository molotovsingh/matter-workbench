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
```

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

Still not done:

- No automatic model fallback.
- No provider-selection UI.
- No registry schema change.
- No Gemini fallback or multi-provider orchestration.
- No silent provider change for lawyer-facing skills.

## Decision

OpenRouter is useful, but it must stay behind central model policy and provider adapters.

Do not wire provider-specific behavior directly into skills or routes. The architecture should make model choice inspectable, testable, and reversible.
