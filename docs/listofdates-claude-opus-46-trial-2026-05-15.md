# Claude Opus 4.6 List of Dates Trial - 2026-05-15

This note records a Claude Opus 4.6 editor-pass trial on the Atlas Construction two-pass List of Dates eval.

OpenRouter model page used:

```text
anthropic/claude-opus-4.6
```

The response returned:

```text
anthropic/claude-4.6-opus-20260205
```

## Tested Pair

```text
pass 1: gpt-4.1
pass 2: anthropic/claude-opus-4.6 via OpenRouter
```

Local output:

```text
.local/listofdates-two-pass/atlas-matrix-gpt-41-to-claude-opus-46-20260515/List of Dates.md
sha256: e9f3f6f390afa09058e1d01696ec75a0301d6949680eab110e3d947695895ea2
```

Local comparison against the current leader:

```text
.local/listofdates-two-pass/atlas-gpt41-editor-comparison-gpt54mini-vs-opus46-20260515.md
sha256: 2543fa9e4425c33db3272c3e48983f796a513bc7206574adf84a5530594444f7
```

## Ranking Against Current Leaders

| Pair | Coverage | Rows | Duplicate Date Clusters | Needs Review | Technical Label Leaks | Precedent-Like Rows | Total Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| `gpt-4.1 -> gpt-5.4-mini` | 19/19 | 28 | 0 | 9 | 0 | 4 | 184,977 |
| `gpt-5.4-mini -> gpt-5.4` | 17/19 | 21 | 0 | 6 | 0 | 3 | 208,725 |
| `gpt-4.1 -> claude-sonnet-4.6` | 19/19 | 30 | 1 | 13 | 0 | 6 | 199,494 |
| `gpt-4.1 -> claude-opus-4.6` | 19/19 | 32 | 1 | 13 | 0 | 8 | 198,737 |

## Call

Claude Opus 4.6 is usable as a second-pass chronology editor, but it did not beat the current leader.

It covered all checked legal milestones, but it produced a noisier lawyer-facing chronology:

- one duplicate-date cluster remained;
- more rows were marked `needs_review` than the leader;
- more precedent-like rows survived;
- the output was larger than the `gpt-5.4-mini` editor result.

Current legal-use leader remains:

```text
pass 1: gpt-4.1
pass 2: gpt-5.4-mini
```

Clean concise alternate remains:

```text
pass 1: gpt-5.4-mini
pass 2: gpt-5.4
```

## Practical Note

For this specific legal chronology task, Opus-level reasoning did not translate into a better final List of Dates. The quality bottleneck appears to be chronology editing discipline: merge duplicates, keep legally material foundation facts, drop precedent noise, and avoid over-flagging.

That means prompt and pass-structure improvements may matter more here than simply moving the second pass to the most expensive reasoning model.
