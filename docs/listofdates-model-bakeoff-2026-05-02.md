# List Of Dates Model Bakeoff - 2026-05-02

This note preserves the first bakeoff after fixing the OpenRouter request-shape failures for `/create_listofdates`.

The purpose was not to pick a permanent model forever. The purpose was to decide what mode is safe enough for beta testing, and which premium mode is worth keeping available for high-stakes review.

## Test Setup

Matter:

```text
/Users/aksingh/matters-matter-workbench/Mehta vs Skyline
```

Output artifacts:

```text
/tmp/listofdates-bakeoff-fixed-1777702246
```

Common runtime settings:

```text
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS=8000
OPENROUTER_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS=300000
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_ORDER=
```

The bakeoff used `runCreateListOfDates({ dryRun: true })`, so it did not overwrite the matter's `10_Library/List of Dates.*` artifacts.

## Why This Was Retested

Earlier OpenRouter failures had two separate root causes:

- `/create_listofdates` always sent `temperature: 0`. With `provider.require_parameters=true`, this excluded models whose OpenRouter endpoint did not advertise `temperature` support.
- Anthropic structured-output routes rejected parts of the strict JSON schema, including `maxItems`, `minimum`, and `maximum`.

The retest was run after changing the OpenRouter request path to omit default `temperature` and send an OpenRouter-compatible version of the schema while keeping Matter Workbench's local validation strict.

## Results

| Model | Route | Result | Time | Rows | Accepted | Clustered | Cost | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `openai/gpt-5.5-pro` | OpenRouter, latency | Failed | 300s | - | - | - | - | Routed successfully, but timed out on the full matter at the 300s request timeout. |
| `anthropic/claude-opus-4.7` | OpenRouter, latency | Failed | 3s | - | - | - | - | Latency routing selected Amazon Bedrock, which rejected the structured-output request. |
| `anthropic/claude-opus-4.7` | OpenRouter, `provider.order=Anthropic` | Passed | 152s | 42 | 54 | 12 | `$0.4651` | Highest-cost successful premium run. |
| `anthropic/claude-sonnet-4.6` | OpenRouter, latency | Passed | 204s | 48 | 66 | 18 | `$0.2744` | Most exhaustive successful run, but somewhat over-inclusive. |
| `openai/gpt-4.1` | OpenRouter, latency | Passed | 40s | 35 | 49 | 14 | `$0.0708` | Best practical beta default: fastest, cheapest, and clean enough. |

## Quality Notes

### `openai/gpt-4.1`

GPT-4.1 produced the strongest practical output for beta use:

- fast enough for normal testing;
- materially cheaper than Anthropic runs;
- clean lawyer-facing phrasing;
- preserved raw `FILE-NNNN pX.bY` citations;
- preserved source labels;
- identified the main payment discrepancy;
- avoided generic relevance language.

Observed weakness:

- one non-merits/procedural row slipped through: a vakalatnama execution row.

### `anthropic/claude-opus-4.7`

Opus 4.7 is the premium comparison mode, but only when pinned to Anthropic:

```text
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_ORDER=Anthropic
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=
```

It produced richer legal detail than GPT-4.1, including additional deadline/compliance rows such as the 15-day legal notice compliance window. It stayed clean on generic relevance and non-merits rows.

Tradeoff:

- about 6.5x the GPT-4.1 cost on this matter;
- much slower than GPT-4.1;
- unsafe to run unpinned with latency routing, because Bedrock may be selected and fail structured output.

### `anthropic/claude-sonnet-4.6`

Sonnet 4.6 was detailed and useful for review, but more over-inclusive:

- 48 rendered rows versus GPT-4.1's 35;
- two payment-discrepancy rows, including one questionable 2024-03-14 discrepancy caused by grouping different notice/summary amounts;
- more granular site-inspection and evidence-gap treatment.

This is useful as a review comparison, but less safe as the default chronology mode.

### `openai/gpt-5.5-pro`

GPT-5.5 Pro no longer failed with "No endpoints found" after the request-shape fix. A tiny structured-output probe succeeded.

However, the full Mehta matter timed out at 300 seconds. It should not be the default full-matter chronology model until the timeout behavior is understood.

## Current Recommendation

Use GPT-4.1 as the default beta chronology model:

```text
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL=openai/gpt-4.1
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=latency
OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS=8000
```

Use Opus 4.7 as premium review mode only when explicitly pinned to Anthropic:

```text
SOURCE_BACKED_ANALYSIS_PROVIDER=openrouter
OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL=anthropic/claude-opus-4.7
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_ORDER=Anthropic
OPENROUTER_SOURCE_BACKED_ANALYSIS_PROVIDER_SORT=
OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS=8000
```

Avoid for now:

- `openai/gpt-5.5-pro` for full matters, because the full-matter run timed out.
- unpinned `anthropic/claude-opus-4.7` with latency routing, because it can route to Bedrock and fail structured output.

## Engineering Follow-Up

The bakeoff supports keeping model selection explicit and observable:

- do not enable automatic fallback for lawyer-facing chronology yet;
- preserve fail-closed behavior;
- keep recording returned provider, returned model, token usage, and cost in `ai_run`;
- treat provider pinning as a deliberate mode, not a hidden default.

