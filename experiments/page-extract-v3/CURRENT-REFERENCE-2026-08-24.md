# Page Extract V3 — Current Reference

Captured: 2026-08-24  
Implementation revision: `9e4c453`  
Reference fingerprint: `dace34f9821109c8d1c1e6fbbe6f4d848e2f01b8e66cdc0d6f75d222619dc110`

> This is the current whole-PDF Mistral → Gemini output reference, not human-verified ground truth.

## Workload

- 181 upload entries;
- 157 real files;
- 152 byte-unique files;
- 5 duplicate files;
- 121 PDFs;
- 1,666 PDF pages;
- 860 pages without an embedded text layer;
- 806 pages with an embedded text layer;
- 124 layout-risk pages;
- up to 682 pages eligible for the straightforward native-text lane before additional sanity checks.

## Current path

Every readable PDF was processed as:

```text
PDF.js inspection → whole-PDF Mistral OCR → whole-PDF Gemini 2.5 Pro repair
```

All 119 readable PDFs made both provider calls. Gemini supplied the final result for 113 PDFs; six repairs failed and retained the Mistral result.

## Timing

- Upload active time: 15.546 seconds;
- extraction active time at concurrency 2: 3,098.932 seconds;
- cumulative file-processing time: 6,109.204 seconds;
- peak extraction RSS: 309.3 MiB.

The two uninterrupted, fully instrumented segments covered 49 files and measured:

| Stage | Cumulative time | Share |
| --- | ---: | ---: |
| Gemini repair | 1,473.472 s | 97.3% |
| Mistral OCR | 26.198 s | 1.7% |
| Local parse, normalize and write | 14.265 s | 0.9% |

## Provider evidence

- 119 recorded Mistral calls;
- 119 recorded Gemini calls;
- 1,666 Mistral pages;
- 42,769 captured Gemini input tokens;
- 191,265 captured Gemini output/thinking tokens;
- complete provider cost and Gemini token coverage were not retained across the deliberate hard interruption.

## Repair evidence

- 113 repairs used;
- 6 repairs failed;
- 38 files were repaired solely because Mistral confidence was unavailable, with no other recorded text-layer or provider warning;
- failures: 3 client timeouts, 2 service-unavailable/timeouts, and 1 invalid argument.

## V3 acceptance boundary

A routed candidate must:

- account for every unique document and expected page;
- report all normalized-text and critical legal-token differences;
- preserve dates, amounts, sections, articles, clauses, rules, and orders as separately measured signals;
- report every provider call, failure, latency, page/token usage, and cost;
- avoid silently accepting missing or duplicated pages;
- beat the controlled reference on speed and cost;
- distinguish parity with this reference from human-verified correctness.

The detailed sanitized baseline remains in the isolated VM evidence workspace. It contains hashes and aggregate measurements, not filenames or document text.
