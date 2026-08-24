# Page Extract V3 — Routed Current-Provider Benchmark

Date: 2026-08-24  
Experiment revisions: `3b68a9a`, `755d42a`, `e0037c4`, `3a9b6c9`, `6ccbeb3`, `93b0347`, `709e1db`  
Production integration: **none**  
Overall verdict: **review_required**

## Executive result

The page-routed pipeline materially changes the performance frontier, but it is not ready to replace the current extraction path on quality evidence alone.

- It produced all 1,648 expected pages with zero provider failures.
- It skipped five byte-identical duplicate PDFs before provider work.
- Only 212 pages used native text; 1,436 went to Mistral; only 66 independently suspicious Mistral pages went to repair.
- The Gemini 2.5 Pro arm reconstructed a fresh critical path of **319.765s**, a directional **9.69×** improvement over V2's 3,098.932s controlled extraction wall.
- Gemini 3.7 Flash LOW reduced the reconstructed path to **190.467s** and repair cost to **$0.214**, but was modestly worse than 2.5 Pro against the frozen reference, especially on critical-token recall.
- MEDIUM and HIGH thinking did not close that quality gap.

The correct decision is therefore:

1. keep 2.5 Pro as the quality reference;
2. retain 3.7 Flash LOW as the leading speed/cost tier;
3. do not claim that 3.7 outperforms 2.5 Pro for legal-page repair quality;
4. create a human-verified golden set before selecting either arm for production;
5. continue provider comparison using the same page set and evidence contract.

## Workload and routing

The benchmark used the frozen, read-only V3 reference and conservative route plan:

| Measure | Result |
| --- | ---: |
| Real files | 157 |
| Unique files | 152 |
| Unique readable PDFs | 115 |
| Password-protected PDFs | 1 |
| Duplicate PDFs skipped before provider work | 5 |
| Unique PDF pages produced | 1,648 |
| Native pages | 212 |
| Mistral primary-OCR pages | 1,436 |
| Gemini repair pages | 66 |
| Missing output pages | 0 |

The primary gate did **not** treat absent Mistral confidence as failure. It escalated only independently suspicious results:

- 57 pages lost critical tokens present in the native text layer;
- 10 pages had a major text-coverage drop;
- one page met both conditions.

Mistral image-placeholder notices were retained as diagnostics but not treated as repair failures. This removed 319 unjustified repairs involving ordinary extracted-image placeholders.

## Resumability and scheduling evidence

Preparation and provider execution were independently checkpointed:

- lossless Poppler page separation;
- 90 size/complexity-balanced primary batches;
- 17 four-page-or-smaller repair batches;
- atomic provider result per batch;
- exact reconstruction of cached primary batch boundaries across A/B arms;
- ordered per-document assembly after all page decisions.

The zero-provider preparation gate completed in 73.099s with 327.0 MiB peak RSS. Its 90 primary batches had a narrow weighted-work spread: p50 7.55M and p95 7.89M.

## Model availability and pricing

`gemini-3.7-flash` was available to the existing Gemini Developer API key: a live, non-generating model metadata request returned HTTP 200 with a 1,048,576-token input limit and 65,536-token output limit. Google documents it as GA from 2026-08-13 with PDF/multimodal input, structured output, and controllable thinking.

The benchmark used Google's published introductory Gemini 3.7 Flash pricing of **$0.75/M input tokens** and **$3.75/M output tokens including thinking**. The tested 2.5 Pro arm used **$1.25/M input** and **$10/M output**.

Official sources:

- Gemini 3.7 Flash model documentation: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-7-flash
- Gemini Developer API pricing: https://ai.google.dev/gemini-api/docs/pricing

## Performance and cost

All arms used the identical route plan and the same checkpointed Mistral primary results. Candidate cost is the logical fresh-run cost; the 3.7 experiments did not intentionally rebill the 90 cached primary calls.

| Repair model | Thinking | Reconstructed fresh path | Directional speedup vs V2 | Repair active wall | Logical total cost | Repair cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Gemini 2.5 Pro | provider default | **319.765s** | **9.69×** | 157.771s | $6.535 | $0.791 |
| Gemini 3.7 Flash | LOW | **190.467s** | **16.27×** | **33.255s** | **$5.958** | **$0.214** |
| Gemini 3.7 Flash | MEDIUM | 208.358s | 14.87× | 46.378s | $6.046 | $0.302 |
| Gemini 3.7 Flash | HIGH | 230.640s | 13.44× | 70.170s | $6.243 | $0.499 |

Relative to 2.5 Pro, 3.7 LOW was:

- **4.74× faster** in the repair phase;
- **40.4% faster** on the reconstructed end-to-end critical path;
- **72.9% cheaper** for repair;
- **8.8% cheaper** for the full routed candidate, where Mistral's $5.744 dominated cost.

The 2.5 routed arm's $6.535 logical cost is at least 24.3% below the V2 evidence's recorded lower bound of $8.630 ($6.664 Mistral plus $1.966 captured Gemini usage). V2's interrupted segment lacked complete Gemini usage, so no invented full-run baseline cost is presented.

## Quality against the frozen current reference

The current reference is Mistral followed by mostly whole-document Gemini 2.5 Pro repair. It is a non-inferiority reference, **not human-verified ground truth**.

### Whole routed output: 1,648 pages

| Repair model | Mean token F1 | Median token F1 | Mean critical-token recall | Pages with full critical-token recall | Pages below review threshold |
| --- | ---: | ---: | ---: | ---: | ---: |
| Gemini 2.5 Pro | **97.59%** | **99.52%** | **97.92%** | **1,558** | **155** |
| Gemini 3.7 LOW | 97.55% | 99.50% | 97.70% | 1,552 | 160 |
| Gemini 3.7 MEDIUM | 97.53% | 99.50% | 97.75% | 1,554 | 162 |
| Gemini 3.7 HIGH | 97.56% | 99.51% | 97.73% | 1,552 | 162 |

The whole-output differences look small because 1,582 pages are identical across arms: native and primary output is shared. The repair-only view is therefore the meaningful model comparison.

### Identical 66-page repair set

| Repair model | Mean token F1 | Median token F1 | Mean critical-token recall | Full critical-token recall | Pages below review threshold |
| --- | ---: | ---: | ---: | ---: | ---: |
| Gemini 2.5 Pro | **97.76%** | **99.35%** | **93.46%** | **47 / 66** | **24** |
| Gemini 3.7 LOW | 96.63% | 97.67% | 87.83% | 41 / 66 | 29 |
| Gemini 3.7 MEDIUM | 96.18% | 97.30% | 89.09% | 43 / 66 | 31 |
| Gemini 3.7 HIGH | 96.91% | 98.12% | 88.53% | 41 / 66 | 31 |

No 3.7 thinking level matched 2.5 Pro on this reference. HIGH improved general token F1 over LOW and MEDIUM, but not enough; MEDIUM had the best 3.7 critical-token recall, still 4.37 points below 2.5 Pro.

All 68 paid candidate repair calls across the four completed arms succeeded. The 3.7 arms showed no observed structured-output runaway or maximum-token pathology in this workload; their per-batch output-token maxima remained well below the model limit.

## Why the verdict remains `review_required`

The routed architecture is much faster and cheaper, but reference parity is not yet sufficient:

- 90 pages in the 2.5 arm did not retain every reference critical token;
- 155 pages in that arm fell below the reference review threshold;
- the frozen reference may itself contain OCR errors or Gemini additions;
- page-batched repair has less document context than whole-document repair;
- native-layer critical tokens can be correct, duplicated, malformed, or stale;
- no human-verified legal-page golden set yet adjudicates disagreements.

These are review candidates, not proof that the routed text is wrong.

## Transparent tuning costs excluded from candidate results

Two early bounded runs were stopped and preserved rather than hidden:

1. 32 unnecessary 2.5 repair pages before benign image-placeholder warnings were removed: $0.315 estimated cost;
2. 158 Mistral pages across 10 batches before exact cached task boundaries were enforced: $0.632 estimated cost.

Total tuning cost excluded from the controlled candidate matrix: **$0.947**.

The final primary-evaluation fingerprints for the 2.5 and 3.7 arms are identical.

## Recommendation

Gemini 3.7 Flash **is available and can outperform 2.5 Pro on latency and cost**, but it did **not** outperform 2.5 Pro on the current legal OCR quality evidence.

Use the results as follows:

- **Quality-first reference:** Gemini 2.5 Pro.
- **Speed/cost frontier:** Gemini 3.7 Flash LOW.
- **Do not use MEDIUM:** it was dominated by LOW on speed, cost, and general token F1.
- **Do not use HIGH by default:** it cost and waited more without reaching 2.5 quality.
- **Next evidence step:** human-adjudicate the six native outliers and a stratified set of repair/primary disagreements, then benchmark AWS Textract, Google Document AI, Azure Document Intelligence, and GPU OCR against that golden set.
- **Production decision:** none until golden-set review and cross-provider comparison are complete.

## Evidence locations

Private VM workspace:

- Candidate root: `/home/aks/matter-workbench-experiments/755d42a/data/work/candidates`
- 2.5 Pro report: `routed-gemini-25/report.json`
- 3.7 LOW report: `routed-gemini-37-low/report.json`
- 3.7 MEDIUM report: `routed-gemini-37-medium/report.json`
- 3.7 HIGH report: `routed-gemini-37-high/report.json`
- Warning-gate tuning evidence: `/home/aks/matter-workbench-experiments/755d42a/evidence/aborted-placeholder-warning-gate`
- Cache-boundary tuning evidence: `/home/aks/matter-workbench-experiments/755d42a/evidence/cache-boundary-miss`

No payload filenames or document text are included in this report.
