# Model Routing Design

This document is the guardrail before adding OpenRouter or any other model gateway to Matter Workbench.

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

As of this design, the app has:

- `shared/ai-defaults.mjs` for default OpenAI model constants.
- `shared/responses-client.mjs` for OpenAI Responses API fetch, error mapping, output text extraction, and JSON parsing.
- `create-listofdates-engine.mjs` using the shared Responses client for `/create_listofdates`.
- `services/skill-router-service.mjs` using the shared Responses client for skill intent routing.
- `skills/registry.json` describing current skills, but not yet declaring model policy.

The shared client is intentionally thin. It knows how to make a Responses request and parse JSON. It does not know legal risk, task complexity, privacy requirements, or fallback strategy.

That is the missing layer.

## OpenRouter Fit

OpenRouter can be useful here because it can provide access to multiple models behind one API surface. Its documentation describes both an OpenAI-like Chat API and a Responses endpoint at `https://openrouter.ai/api/v1/responses`. The Responses endpoint includes fields such as `model`, `models`, `provider`, `reasoning`, `text`, and `max_output_tokens`, which fit the direction of the current app.

Relevant OpenRouter docs:

- [Responses API create response](https://openrouter.ai/docs/api/api-reference/responses/create-responses)
- [API overview and model routing fields](https://openrouter.ai/docs/api/reference/overview/)
- [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)

Important caution: OpenRouter routing is a provider capability, not a skill design principle. The app should be able to run direct OpenAI only, OpenRouter only, or a mixed provider setup without rewriting skills.

## Non-Goals

This design does not propose:

- Adding OpenRouter code immediately.
- Changing prompts.
- Changing skill registry schema in this PR.
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
| `/create_listofdates` | OpenAI Responses, structured JSON | `source_backed_analysis` |
| `/doctor` | None | deterministic |
| Skill router | OpenAI Responses, structured JSON | `router` |

This table shows why model routing should be central. The app already has deterministic skills and AI skills with different risk levels.

## Provider Modes

### Mode 1: OpenAI Direct

Use the existing `shared/responses-client.mjs` path with the configured OpenAI API key.

This remains the safest default because it is already working and tested.

### Mode 2: OpenRouter Responses Adapter

Add a separate adapter that targets `https://openrouter.ai/api/v1/responses` and passes policy-driven fields such as:

- `model` for a single selected model.
- `models` for fallback candidates.
- `provider` for provider constraints.
- `reasoning` for models that support configurable reasoning.
- `max_output_tokens` from the resolved policy.

This adapter should live beside, not inside, the current OpenAI client. The current `requestResponsesJson` can either become the low-level shared transport or remain the OpenAI-direct adapter while a new OpenRouter adapter handles OpenRouter-specific request fields.

### Mode 3: Hybrid

Use OpenAI direct for high-risk legal work and OpenRouter for router or low-risk tasks.

This is likely the best first production posture if OpenRouter is added:

```text
skill router -> OpenRouter allowed
create_listofdates -> OpenAI direct by default
future drafting -> OpenAI direct by default until reviewed
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
      "endpoint": "https://openrouter.ai/api/v1/responses",
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

## Implementation Plan

### Phase 1: Policy Skeleton, No OpenRouter

Add a small model policy module:

```text
shared/model-policy.mjs
```

It maps known task names to current defaults. It should not change behavior yet.

### Phase 2: Provider Adapter Interface

Wrap the existing OpenAI direct client behind a provider interface. Keep `createOpenAiProvider` and `createOpenAiSkillRouterProvider` exports stable.

### Phase 3: Registry Metadata

Add optional `ai` metadata to `skills/registry.json`, but keep defaults for existing skills so old registry entries do not break.

### Phase 4: OpenRouter Behind A Flag

Add `OPENROUTER_API_KEY` and `AI_PROVIDER=openrouter` or a richer policy config. Start with router-only traffic. Do not send matter documents through OpenRouter until explicitly enabled.

### Phase 5: UI And Logs

Expose provider status and selected policy in settings. Record model usage in generated artifacts and server logs.

### Phase 6: Legal-Output Expansion

Only after the above is stable, allow high-risk skills to opt into OpenRouter with strict provider constraints and review gates.

## First PR Recommendation

The next coding PR should not add OpenRouter.

Recommended first PR:

```text
Add shared/model-policy.mjs with current behavior only.
```

It should:

- Define task names such as `skill_router` and `source_backed_analysis`.
- Resolve current model and token defaults.
- Keep OpenAI direct as the only active provider.
- Add unit tests for policy resolution.
- Not touch prompts, schemas, or settings UI.

That gives the app a place to put routing decisions before any new provider enters the system.

## Decision

OpenRouter is worth exploring, especially for low-risk router/classification work and model fallback experiments. But it should enter through a central policy/provider layer.

Do not wire OpenRouter directly into `/create_listofdates` or the skill router. The architecture should make model choice inspectable, testable, and reversible.
