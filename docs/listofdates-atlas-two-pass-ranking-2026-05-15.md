# Atlas Two-Pass List of Dates Ranking - 2026-05-15

This note records a live two-pass model bakeoff on:

```text
/Users/aksingh/matters-matter-workbench/Atlas Constuction vs Diptishree
```

Generated outputs are local matter-derived work product under:

```text
.local/listofdates-two-pass/
```

They are not committed.

## What Was Tested

The bakeoff used three first-pass candidate ledgers:

| First Pass Model | Candidate Rows |
|---|---:|
| `gpt-4.1` | 184 |
| `gpt-5.4-mini` | 198 |
| `gpt-5.4` | 313 |

Each candidate ledger was then edited by each of:

```text
gpt-4.1
gpt-5.4-mini
gpt-5.4
```

So the test covered all 9 first-pass / second-pass combinations.

## Ranking

This ranking weights legal usefulness over neatness alone. The main checks were:

- material chronology coverage;
- duplicate row control;
- source label cleanliness;
- raw citation preservation;
- precedent/case-law noise;
- OCR/date uncertainty handling;
- whether the output is useful to a lawyer rather than merely short.

| Rank | First Pass | Second Pass | Legal Use Call | Why |
|---:|---|---|---|---|
| 1 | `gpt-4.1` | `gpt-5.4-mini` | Best Atlas legal accuracy | Covered all checked legal milestones, no duplicate date clusters, no technical label leaks, and produced a fuller lawyer chronology without major row bloat. |
| 2 | `gpt-5.4-mini` | `gpt-5.4` | Cleanest concise draft | Very clean and low-noise, but missed some background/collateral-proceeding coverage that may matter to a lawyer. |
| 3 | `gpt-5.4` | `gpt-5.4` | Strong but expensive and still imperfect | Good cleanup and no duplicates, but the first pass over-harvested heavily and the final output still missed one checked foundation item. |
| 4 | `gpt-5.4-mini` | `gpt-4.1` | Usable but noisier | No duplicates, but more precedent-like rows and weaker cleanup. |
| 5 | `gpt-4.1` | `gpt-4.1` | Broad but less polished | Full milestone coverage, but one duplicate cluster and more noise. |
| 6 | `gpt-5.4` | `gpt-4.1` | Broad but noisy | Extra first-pass breadth did not translate into the best legal chronology. |
| 7 | `gpt-5.4-mini` | `gpt-5.4-mini` | Not preferred | One duplicate cluster and more precedent-like noise than the best options. |
| 8 | `gpt-5.4` | `gpt-5.4-mini` | Not preferred | The full-model first pass created too much review burden for this editor pairing. |
| 9 | `gpt-4.1` | `gpt-5.4` | Surprisingly weak on this matter | Lower row count but two duplicate date clusters; stronger editor model did not automatically improve this ledger. |

## Metrics Table

| First Pass | Second Pass | Candidate Rows | Final Rows | Duplicate Date Clusters | Needs Review | Technical Label Leaks | Precedent-Like Rows |
|---|---|---:|---:|---:|---:|---:|---:|
| `gpt-4.1` | `gpt-5.4-mini` | 184 | 28 | 0 | 9 | 0 | 4 |
| `gpt-5.4-mini` | `gpt-5.4` | 198 | 21 | 0 | 6 | 0 | 3 |
| `gpt-5.4` | `gpt-5.4` | 313 | 25 | 0 | 12 | 0 | 4 |
| `gpt-5.4-mini` | `gpt-4.1` | 198 | 23 | 0 | 10 | 0 | 7 |
| `gpt-4.1` | `gpt-4.1` | 184 | 33 | 1 | 11 | 0 | 5 |
| `gpt-5.4` | `gpt-4.1` | 313 | 30 | 1 | 10 | 0 | 6 |
| `gpt-5.4-mini` | `gpt-5.4-mini` | 198 | 26 | 1 | 9 | 0 | 6 |
| `gpt-5.4` | `gpt-5.4-mini` | 313 | 25 | 1 | 13 | 0 | 4 |
| `gpt-4.1` | `gpt-5.4` | 184 | 25 | 2 | 10 | 0 | 3 |

## Legal Coverage Check

The `gpt-4.1 -> gpt-5.4-mini` output covered all checked legal chronology categories:

- ownership / foundation;
- sanctioned plan;
- power of attorney;
- development agreement;
- delivery deadline;
- incomplete possession;
- refusal / reimbursement;
- civil title suit;
- consumer complaint filing;
- written version;
- evidence affidavit;
- occupancy certificate;
- expert appointment and inspection;
- questionnaire;
- power-of-attorney revocation;
- District Forum order;
- State Commission appeal order;
- NCDRC revision filing.

The `gpt-5.4-mini -> gpt-5.4` output was cleaner, but it omitted ownership/foundation and civil-title-suit coverage in this run.

The `gpt-5.4 -> gpt-5.4` output was strong, but not enough better to justify the extra first-pass cost for this matter. The larger candidate ledger also carried more review burden.

## Practical Conclusion

For Atlas-style low-quality PDFs, the winning pattern is still two-pass, but the best pair is not simply "strongest model both times."

Recommended next experiment default:

```text
pass 1: gpt-4.1
pass 2: gpt-5.4-mini
```

Recommended clean-draft alternate:

```text
pass 1: gpt-5.4-mini
pass 2: gpt-5.4
```

If the product goal is legal-use accuracy, use the first pair as the current Atlas leader. If the product goal is a concise first draft for lawyer review, use the second pair.

## Prompt Lesson

The first-pass prompt should stay verbose, but it needs one more legal instruction:

```text
Keep foundation and collateral-proceeding dates if they explain ownership, authority, limitation, parallel litigation, appeal delay, or enforceability.
```

Without that, some cleaner runs drop events that look like background but may matter to a lawyer.

## Committed Golden Outputs

The two output files compared by the user are committed as golden outputs because the user explicitly asked for these generated outputs to be preserved in the repo.

Best legal-use accuracy output:

```text
evals/listofdates/golden/atlas-two-pass-2026-05-15/best-legal-use-gpt41-to-gpt54-mini.md
sha256: c29a51cd353928fb86c574ceb70022495e6d5e67507a108b49e261811d924909
size: 19,769 bytes
```

Cleanest concise draft output:

```text
evals/listofdates/golden/atlas-two-pass-2026-05-15/clean-concise-gpt54-mini-to-gpt54.md
sha256: bdee69e23406d496eef757680061e424869a4149fd105cf2cafe8203d5365bb8
size: 17,755 bytes
```

Side-by-side local comparison:

```text
evals/listofdates/golden/atlas-two-pass-2026-05-15/top-two-comparison.md
sha256: 5d17f9e72018ae447982b564c74dc33534ed5927ad5c03bc94fbb58bc93d8595
size: 37,860 bytes
```

Regenerate the best legal-use output:

```bash
node evals/listofdates/two-pass-model-smoke.mjs \
  --matter-root "/Users/aksingh/matters-matter-workbench/Atlas Constuction vs Diptishree" \
  --pass1-model gpt-4.1 \
  --pass1-only \
  --run-label atlas-pass1-gpt-41-regen

node evals/listofdates/two-pass-model-smoke.mjs \
  --candidates-file ".local/listofdates-two-pass/atlas-pass1-gpt-41-regen/candidates.json" \
  --pass2-model gpt-5.4-mini \
  --run-label atlas-gpt-41-to-gpt-54-mini-regen
```

Regenerate the cleanest concise output:

```bash
node evals/listofdates/two-pass-model-smoke.mjs \
  --matter-root "/Users/aksingh/matters-matter-workbench/Atlas Constuction vs Diptishree" \
  --pass1-model gpt-5.4-mini \
  --pass1-only \
  --run-label atlas-pass1-gpt-54-mini-regen

node evals/listofdates/two-pass-model-smoke.mjs \
  --candidates-file ".local/listofdates-two-pass/atlas-pass1-gpt-54-mini-regen/candidates.json" \
  --pass2-model gpt-5.4 \
  --run-label atlas-gpt-54-mini-to-gpt-54-regen
```

If we later decide to commit golden outputs, create a separate redacted fixture or an explicit consented golden corpus. Do not silently commit live matter work product from `.local/`.
