# Claude Sonnet 4.6 List of Dates Trial - 2026-05-15

This note records a cross-provider trial on the Atlas Construction two-pass List of Dates eval.

The test used the existing `gpt-4.1` verbose candidate ledger, then used Claude Sonnet 4.6 through OpenRouter as the second-pass chronology editor.

## Successful Pair

```text
pass 1: gpt-4.1
pass 2: anthropic/claude-sonnet-4.6 via OpenRouter
returned model: anthropic/claude-4.6-sonnet-20260217
```

Local output:

```text
.local/listofdates-two-pass/atlas-matrix-gpt-41-to-claude-sonnet-46-20260515-tokens24000/List of Dates.md
sha256: c2f6ba3e7ca5a46f84954043a5183524079d089947d25943046a1d475582a659
```

Local comparison against the current leader:

```text
.local/listofdates-two-pass/atlas-gpt41-editor-comparison-gpt54mini-vs-claude46-20260515.md
sha256: 2cbddd08771e79439d350bd1e234ee48c550ccb3640489758a83b3dc9db828e1
```

## Result

| Pair | Coverage | Rows | Duplicate Date Clusters | Needs Review | Technical Label Leaks | Precedent-Like Rows | Total Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| `gpt-4.1 -> gpt-5.4-mini` | 19/19 | 28 | 0 | 9 | 0 | 4 | 184,977 |
| `gpt-4.1 -> claude-sonnet-4.6` | 19/19 | 30 | 1 | 13 | 0 | 6 | 199,494 |
| `gpt-5.4-mini -> gpt-5.4` | 17/19 | 21 | 0 | 6 | 0 | 3 | 208,725 |

## Call

Claude Sonnet 4.6 is usable as an editor pass, but it did not beat the current legal-use leader.

Current legal-use leader remains:

```text
pass 1: gpt-4.1
pass 2: gpt-5.4-mini
```

The Claude editor output covered all checked legal milestones, but it was less clean:

- one duplicate-date cluster remained;
- more rows were marked `needs_review`;
- more precedent-like rows survived into the final chronology;
- the OpenRouter call needed retry and a larger output budget.

## Reverse Direction

Attempted:

```text
pass 1: anthropic/claude-sonnet-4.6 via OpenRouter
pass 2: gpt-4.1
```

This did not complete with the current strict JSON first-pass harness. Claude extracted usable chunks, but later chunks repeatedly returned truncated / unterminated JSON through OpenRouter.

This is an operational reliability issue with the current harness shape, not necessarily proof that Claude cannot be a good first-pass reader.

If we want to retest Claude as pass 1, use smaller source chunks and a chunk-resume mechanism before drawing a quality conclusion.

## Harness Change

The reusable harness now supports:

```text
--pass1-provider openrouter
--pass2-provider openrouter
```

It still defaults to OpenAI direct for model ids without `/`, and OpenRouter for model ids like `anthropic/claude-sonnet-4.6`.
