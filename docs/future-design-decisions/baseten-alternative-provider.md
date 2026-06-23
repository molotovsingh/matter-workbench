# Baseten As An Alternative Provider

Date: 2026-06-24
Status: Planned feature / parked future provider

## Product Idea

Add Baseten (`https://inference.baseten.co/v1`) as a third selectable AI provider
alongside `openai-direct` and `openrouter`. Baseten exposes an OpenAI-compatible
Chat Completions endpoint over open-weight models (DeepSeek, GLM, Qwen, Kimi,
Llama, gpt-oss, Nemotron), so it slots into the same Chat Completions family the
`openrouter` branch already builds — minus OpenRouter's provider-routing object
and identity headers.

## Why Plan It Now

- The extraction pipeline (`source_description`, `create_listofdates_pass1`,
  `pass2`, `source_backed_analysis`) is open-weight-appropriate and is currently
  over-specified on closed-frontier models routed through a public aggregator.
- Baseten is self-hostable/dedicated and SOC 2 / HIPAA-aligned, which suits
  privileged legal matter better than routing evidence through an aggregator.
- Pinning a fixed open-weight model improves legal-record attributability
  (no OpenRouter cross-provider nondeterminism).

## Scope

- New `AI_PROVIDERS.BASETEN` in the Chat Completions family; endpoint
  `https://inference.baseten.co/v1/chat/completions`; auth `BASETEN_API_KEY`.
- Introduce a first-class two-API-family provider registry (Responses vs Chat
  Completions) so Baseten is a one-descriptor swap, not a per-factory branch.
- Eligible tasks: the extraction pipeline only. Generative / skill-factory tasks
  stay on `openai-direct` (closed frontier, different API family).

## Non-Goals

- No replacement of `openai-direct` for generative / skill-factory work.
- No silent model swap on law-firm-facing outputs; production default changes
  are gated by a citation-exactness + refuses-to-invent eval.
- No dependence on Baseten `usage.cost` / `provider` echo (OpenRouter-isms); keep
  those best-effort audit fields, as today.

## Revisit / Trigger

When an open-weight model matches `gpt-4.1` on the citation-exactness eval
(`evals/listofdates/`, `evals/source-descriptors/`), or when OpenAI-direct
quota/billing pressure forces a second working path for the extraction pipeline.
