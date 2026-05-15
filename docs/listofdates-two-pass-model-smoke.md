# Two-Pass List of Dates Model Smoke

This is a reusable live-eval harness for testing List of Dates quality across model pairs.

It exists because the Atlas Construction smoke showed a clear pattern:

- one-pass chronology generation over low-quality PDFs produced duplicate rows and noisy legal-history dates;
- simply moving the one-pass job to a stronger model did not fix that reliably;
- a verbose first pass followed by a stricter editor pass produced a cleaner lawyer-facing chronology.

The harness is for model and prompt evaluation only. It does not change the production `/create_listofdates` runtime.

Production contract: `docs/create-listofdates-two-pass-contract.md`.

## Command

```bash
node evals/listofdates/two-pass-model-smoke.mjs \
  --matter-root "/path/to/matter" \
  --pass1-model gpt-5.4-mini \
  --pass2-model gpt-5.4 \
  --run-label atlas-mini-to-54
```

For matrix tests, reuse the first-pass candidate ledger instead of rerunning it for every editor model:

```bash
node evals/listofdates/two-pass-model-smoke.mjs \
  --matter-root "/path/to/matter" \
  --pass1-model gpt-5.4-mini \
  --pass1-only \
  --run-label atlas-pass1-mini

node evals/listofdates/two-pass-model-smoke.mjs \
  --candidates-file ".local/listofdates-two-pass/atlas-pass1-mini/candidates.json" \
  --pass2-model gpt-5.4 \
  --run-label atlas-mini-to-54
```

Outputs are written under:

```text
.local/listofdates-two-pass/<run-label>/
```

That folder is gitignored. Treat its contents as matter-derived work product.

## Output Files

```text
candidates.json
polished.json
List of Dates.md
report.json
```

`candidates.json` is the deliberately verbose first-pass ledger. It keeps duplicate candidates, OCR suspicions, conflicts, source excerpts, and same-fact hints so the second pass has enough context to merge and polish.

`polished.json` and `List of Dates.md` are the second-pass lawyer-facing outputs.

`report.json` captures comparison metrics such as candidate count, polished row count, duplicate date clusters, needs-review rows, technical label leaks, precedent-like rows, returned model, and token usage.

The harness retries transient provider 5xx/network failures. A one-off provider error should not invalidate a multi-chunk legal bakeoff.

## Why Two Passes

The first pass is not trying to be elegant. It is trying to harvest.

It should:

- preserve messy but potentially material date candidates;
- keep repeated versions of the same fact from pleadings, orders, appeals, affidavits, and revisions;
- include enough source excerpt for a later editor pass to work without rereading the raw extracted text;
- mark OCR suspicion and date uncertainty rather than hiding it.

The second pass is the lawyer-facing editor.

It should:

- merge minor variants into one row;
- preserve useful supporting citations;
- drop pure precedent/case-law dates unless they are part of this matter's procedural history;
- keep uncertainty visible instead of pretending the chronology is cleaner than the inputs.

This design accepts the garbage-in problem directly: the first pass gives the second pass more audit context, but it does not magically repair bad OCR. A bad source block should become a `needs_review` row or a dropped candidate with a reason, not a confident chronology fact.

## Atlas Construction Smoke Results

These were local smoke runs on the same Atlas Construction matter. The generated matter-derived artifacts remain in `.local/`.

| Run | Candidate Rows | Polished Rows | Duplicate Date Clusters | Needs Review | Technical Label Leaks | Precedent-Like Rows |
|---|---:|---:|---:|---:|---:|---:|
| one-pass `openai/gpt-4.1` via OpenRouter | n/a | 52 | 15 | n/a | observed filename leakage | noisy |
| one-pass `gpt-5.4` OpenAI direct | n/a | 61 | 17 | n/a | improved but still noisy | 2 |
| two-pass `gpt-5.4 -> gpt-5.4` | 257 | 24 | 0 | 9 | 0 | 2 |
| two-pass `gpt-5.4-mini -> gpt-5.4-mini` | 161 | 26 | 0 | 10 | 0 | 3 |
| two-pass `gpt-4.1 -> gpt-4.1` | 156 | 33 | 2 | 12 | 0 | 4 |

The current default recommendation for further testing is:

```text
pass 1: gpt-5.4-mini
pass 2: gpt-5.4
```

Reason: first pass benefits from cost-effective breadth, while second pass benefits from the stronger model's judgment and cleanup.

## Useful Model Pair Commands

Strong editor, cheaper harvester:

```bash
node evals/listofdates/two-pass-model-smoke.mjs \
  --matter-root "/path/to/matter" \
  --pass1-model gpt-5.4-mini \
  --pass2-model gpt-5.4
```

Same-model premium baseline:

```bash
node evals/listofdates/two-pass-model-smoke.mjs \
  --matter-root "/path/to/matter" \
  --pass1-model gpt-5.4 \
  --pass2-model gpt-5.4
```

Lower-cost baseline:

```bash
node evals/listofdates/two-pass-model-smoke.mjs \
  --matter-root "/path/to/matter" \
  --pass1-model gpt-4.1 \
  --pass2-model gpt-4.1
```

Cross-provider editor test using OpenRouter:

```bash
node evals/listofdates/two-pass-model-smoke.mjs \
  --candidates-file ".local/listofdates-two-pass/atlas-pass1-gpt-41-20260515/candidates.json" \
  --pass2-provider openrouter \
  --pass2-model anthropic/claude-sonnet-4.6 \
  --pass2-max-output-tokens 24000 \
  --run-label atlas-gpt-41-to-claude-sonnet-46
```

Models with `/` in the model id default to OpenRouter. Explicit `--pass1-provider` and `--pass2-provider` can be used when needed.

Opus editor variant:

```bash
node evals/listofdates/two-pass-model-smoke.mjs \
  --candidates-file ".local/listofdates-two-pass/atlas-pass1-gpt-41-20260515/candidates.json" \
  --pass2-provider openrouter \
  --pass2-model anthropic/claude-opus-4.6 \
  --pass2-max-output-tokens 24000 \
  --run-label atlas-gpt-41-to-claude-opus-46
```

## Review Gates

When comparing runs, do not judge only by row count. Check:

- whether repeated rows were merged;
- whether source labels are readable, not technical filenames;
- whether raw `FILE-NNNN pX.bY` citations are preserved;
- whether precedent/case-law dates were dropped unless truly part of this matter;
- whether low-quality OCR became a `needs_review` warning instead of a confident fact;
- whether the resulting chronology is client-perspective and useful to a lawyer.

## Boundary

This harness sends extracted matter text to the configured OpenAI Responses API. Use it only for deliberate live model evaluation on matters where that is acceptable.

It must not write matter artifacts, mutate the production List of Dates, or replace `/create_listofdates` without a separate product decision.
