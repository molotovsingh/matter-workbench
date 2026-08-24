# Page Extract V3 — PDFEval Gold30 Benchmark

Date: 2026-08-24  
Experiment revisions: `18b5e8c`, `6b942fa`, `4bf31d1`
Production integration: **none**  
PDFEval repository mutations: **none**  
Verdict: **promising, review_required**

## What had and had not already been tested

The sibling `pdf-extraction-eval` repository had already benchmarked individual OCR providers, including Mistral, Gemini Pro, Gemini 3.7 Flash, Textract, and OvisOCR2. It had **not** run Matter Workbench's routed V3 pipeline.

This benchmark is the first run of the complete V3 route:

```text
conservative native routing → Mistral primary OCR → selective Gemini repair → ordered document assembly
```

against PDFEval's Gold30 corpus and its human-verified page excerpts.

## Corpus

- 30 Indian Supreme Court judgments;
- 10 archival, 10 transitional, and 10 modern;
- 395 pages;
- 9.7 MiB of source PDFs;
- eight image-verified excerpts from six judgments;
- 1,890 verified reference words;
- 54 verified legal-critical fields.

The PDFEval source tree and evaluator were read-only. An isolated V2-shaped fixture copied and hash-verified the 30 source PDFs for V3 custody and checkpoint compatibility.

## Routing result

| Era | Documents | Pages | Native | Primary OCR |
| --- | ---: | ---: | ---: | ---: |
| Archival | 10 | 94 | 0 | 94 |
| Transitional | 10 | 101 | 0 | 101 |
| Modern | 10 | 200 | 80 | 120 |
| **Total** | **30** | **395** | **80** | **315** |

V3 made no native-text shortcut on archival or transitional scans. It accepted 80 conservative native pages from the modern set and sent the other 315 pages to Mistral.

Primary OCR produced all 315 pages. Ninety-two pages were independently escalated because Mistral did not retain every critical token found in the embedded text layer:

| Era | Primary pages | Repair pages |
| --- | ---: | ---: |
| Archival | 94 | 30 |
| Transitional | 101 | 30 |
| Modern | 120 | 32 |
| **Total** | **315** | **92** |

This 29.2% repair rate is much higher than Rashmi's 4.6% because the PDFEval scans have text-bearing but noisy embedded layers. The result confirms that ETA and repair prediction must account for workload type, not only page count.

## Human-verified quality

Both completed repair arms produced the same scores on PDFEval's eight existing verified excerpts:

| Candidate | Verified excerpts | Reference words | WER | Normalized CER | Legal-critical fields |
| --- | ---: | ---: | ---: | ---: | ---: |
| V3 + Gemini 2.5 Pro repair | 8/8 | 1,890 | **0.95%** | **0.36%** | **54/54** |
| V3 + Gemini 3.7 LOW repair | 8/8 | 1,890 | **0.95%** | **0.36%** | **54/54** |
| V3 + pinned OCR 4.1 + Gemini 3.7 LOW | 8/8 | 1,890 | **0.95%** | **0.36%** | **54/54** |
| OvisOCR2 Gold30 | 8/8 | 1,890 | 3.86% | 3.21% | 51/54 |

Across the 1,890 verified words, V3 had zero deletions, two substitutions, and 16 insertions. The verified V3 sample contained:

- six primary-Mistral pages;
- one native page;
- one Gemini-repair page.

Therefore, this is strong evidence for the routed pipeline as a whole, but it is **not** enough to declare 3.7 and 2.5 repair quality equivalent across all 92 repair pages.

### Important recovered failure

The known OvisOCR2 failure on the 2018 sale-deed-history page omitted an entire subsection and two checked date fields. V3 independently routed that page to conservative native text. Its verified excerpt retained all seven checked critical fields, with 1.82% WER and 0.87% normalized CER.

## Whole-corpus proxy agreement

Agreement with another OCR system is not ground truth, but it is useful for locating divergence.

| Candidate | Proxy | Coverage | Macro normalized token-sequence agreement |
| --- | --- | ---: | ---: |
| V3 + 2.5 repair | OvisOCR2 | 30/30 | **99.43%** |
| V3 + 3.7 LOW repair | OvisOCR2 | 30/30 | 99.39% |
| V3 + 2.5 repair | Gemini Pro archival output | 10/10 | **99.08%** |
| V3 + 3.7 LOW repair | Gemini Pro archival output | 10/10 | 98.90% |
| V3 + 3.7 LOW | V3 + 2.5 | 30/30 | 99.76% |

The 2.5 arm remains slightly closer to both proxy outputs, consistent with the earlier Rashmi reference comparison.

## Subsequent pinned-model evidence

A later PDFEval run separated two newly available models:

| Direct whole-document tool | Verified WER | Normalized CER | Critical fields | Archival10 wall |
| --- | ---: | ---: | ---: | ---: |
| Gemini 3.7 Flash, provider-default thinking | **0.05%** | **0.02%** | **54/54** | 291.7s |
| Mistral OCR 4.1 | 0.95% | 0.29% | **54/54** | **22.9s** |
| Textract | 0.26% | 0.03% | 53/54 | 191.7s |

This does not contradict V3's 0.95% score. Six of V3's eight verified excerpts used Mistral primary output, one used native text, and only one used Gemini repair. The direct Gemini run sent every excerpt to Gemini. Also, PDFEval's direct Gemini tool used provider-default thinking, while the fast V3 arm used LOW thinking.

The direct results changed two experiment requirements:

1. primary OCR must be explicitly pinned to `mistral-ocr-4-1`, not the mutable `mistral-ocr-latest` alias;
2. primary task construction must preserve document locality rather than mixing pages from unrelated PDFs into synthetic batches.

V3 now records the primary model in configuration and in every task fingerprint. A checkpoint produced by `latest` cannot be reused as OCR 4.1 evidence.

## Timing, reliability, and cost

Preparation made no provider calls and took 4.5–6.6s across the completed arms. Ninety-two repair pages were balanced into 23 bounded batches.

| Primary / repair configuration | Primary tasks | Primary active wall | Repair active wall | Reconstructed fresh path | Logical fresh cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| `mistral-ocr-latest`, mixed balanced pages / Gemini 2.5 | 20 | 489.437s | 295.071s | 791.673s | $2.652 |
| `mistral-ocr-latest`, mixed balanced pages / Gemini 3.7 LOW | 20 | 489.437s | 42.743s | 538.491s | $1.523 |
| `mistral-ocr-4-1`, mixed balanced pages / Gemini 3.7 LOW | 20 | 265.173s | 42.982s | 314.869s | $1.523 |
| `mistral-ocr-4-1`, document-local ranges / Gemini 3.7 LOW | 86 | **34.370s** | 47.671s | **87.156s** | $1.525 |

Pinning OCR 4.1 cut mixed-batch primary wall by 45.9%. Preserving document locality then cut primary wall another 87.0%, despite increasing the number of small calls. The final bounded four-way run completed all 109 provider calls without failure and was 6.18× faster than the first 3.7 V3 arm.

The 86 document-local tasks include original whole PDFs when every page requires OCR and contiguous same-document ranges when native pages interrupt OCR routing. A follow-up should combine non-contiguous pages from the same document to reduce request count without recreating the severe heterogeneous cross-document slowdown.

This is direct evidence that user-facing ETAs need live, corpus-sensitive recalibration after the first few batches. Page count alone is insufficient; model version and batch homogeneity materially change throughput.

## Interpretation

This run closes an important evidence gap: V3 has now been tested against human-verified legal OCR excerpts rather than only the frozen current-model reference.

The result is encouraging:

- complete document/page coverage;
- zero terminal provider failures;
- sub-1% WER on the purposive human sample;
- all 54 legal-critical fields retained;
- a known complete-region omission from a local OCR candidate avoided by routing;
- substantial 3.7 LOW latency and cost savings;
- a pinned, document-local primary path that reduced Gold30's reconstructed wall to 87.156s.

The result is not yet a production-quality claim:

- eight excerpts are purposive, not a random corpus-wide accuracy sample;
- only one verified excerpt exercised the repair lane;
- 92 repaired pages still lack direct human adjudication;
- 80 native pages require broader sampling beyond the one verified native excerpt;
- primary latency varied sharply by corpus.

## Recommendation

1. Pin Mistral primary OCR to `mistral-ocr-4-1`; do not use `latest` for benchmark or production evidence.
2. Keep primary work document-local and bounded; next reduce the 86 range calls using same-document chunks.
3. Treat direct Gemini 3.7 with provider-default thinking as the current verified-quality leader, while LOW remains the measured V3 speed/cost repair setting.
4. Retain Gemini 2.5 as a comparator until the repair lane has more human-verified pages.
5. Expand PDFEval's verified manifest with stratified samples from:
   - at least 15 repair pages where 2.5 and 3.7 differ;
   - at least 10 native pages across modern documents;
   - at least 10 difficult primary pages across archival and transitional scans.
6. Compare Textract, Google Document AI, Azure Document Intelligence, and GPU OCR on the same expanded human set.
7. Do not integrate V3 into production until that adjudication is complete.

## Evidence locations

Isolated local workspace:

- `/Users/aksingh/matter-workbench-experiments/18b5e8c-pdfeval/evidence`
- `/Users/aksingh/matter-workbench-experiments/18b5e8c-pdfeval/data/work/candidates/routed-gemini-25/report.json`
- `/Users/aksingh/matter-workbench-experiments/18b5e8c-pdfeval/data/work/candidates/routed-gemini-37-low/report.json`
- `/Users/aksingh/matter-workbench-experiments/18b5e8c-pdfeval/data/work/candidates/routed-ocr4-doc-ranges-37-low/report.json`

Exported candidate text and detailed evaluator artifacts remain outside both repositories. No production code, routes, schemas, builds, or deployments were changed.
