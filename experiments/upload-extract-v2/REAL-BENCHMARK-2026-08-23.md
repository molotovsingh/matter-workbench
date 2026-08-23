# Upload + Extract v2 — Real Benchmark Review

Date: 2026-08-23  
Experiment revisions: `c7db505`, recovery evidence patch `1b26d51`, report patch `85f6407`  
Production integration: **none**  
Verdict: **review_required**

## Fixture and baseline

The benchmark used the completed Rashmi upload session as a read-only source:

- 181 upload entries;
- 231,063,840 bytes total;
- 24 machine-junk / Office-lock entries filtered;
- 157 real retained source files;
- 1,670 pages reported by the v1 Extraction Log;
- v1 outcomes: 137 extracted, 14 unsupported, 5 duplicate, 1 failed.

The v1 extraction job had two attempts. Its recorded job wall time was 6,645,159 ms (1h 50m 45s). Summed per-file processing time was 6,124,457 ms (1h 42m 04s), which is the controlled extraction baseline.

## Upload result

| Measure | v1 | v2 |
| --- | ---: | ---: |
| Active upload time | 71.400 s | 15.546 s |
| Directional speedup | — | 4.59× |
| Entries received | 181 | 181 |
| Filtered entries | 24 | 24 |
| Upload attempts per entry | 1 | 1 |
| v2 peak client RSS | — | 123.1 MiB |

The v2 client stopped after 50 entries, the standalone upload server was restarted, and the remaining 131 entries resumed without retransmitting the first 50. The upload comparison is directional because v1 and v2 originated from different client/network conditions.

## Extraction result

| Measure | v1 | v2 |
| --- | ---: | ---: |
| Controlled active wall time | 6,124.457 s | 3,098.932 s |
| Controlled speedup | — | **1.98×** |
| End-to-end v2 time including interruption/pause | — | 3,839.603 s |
| Summed file processing time | 6,124.457 s | 6,109.204 s |
| Per-file p50 | 29.080 s | 26.831 s |
| Per-file p95 | 120.194 s | 127.159 s |
| Slowest individual file | 184.676 s | 199.834 s |
| Peak v2 RSS | — | 309.3 MiB |

The near-identical summed file time and roughly halved active wall time show that bounded file concurrency—not faster individual extraction—created the gain.

### Outcomes

All-file v2 outcomes were 141 succeeded, 14 unsupported/skipped, and 2 failed. One failure was the same password-protected PDF that failed under v1. The second was a byte-identical duplicate of that PDF; v1 correctly skipped it.

After collapsing the five byte-identical duplicates, v2 unique-file outcomes exactly matched v1:

- 137 succeeded;
- 14 unsupported;
- 1 failed.

This is why the verdict remains `review_required`: v2 preserved unique-file correctness but failed to suppress five duplicates before extraction, causing redundant provider work.

## Recovery proof

The experiment exercised three recovery boundaries:

1. planned upload stop after 50 entries;
2. planned extraction stop after 20 files;
3. an unplanned extraction-process loss after 128 terminal file checkpoints.

The unplanned interruption left two files in flight. A fresh process:

- preserved every completed checkpoint;
- reset only the two in-flight files;
- resumed the 27 pending plus two recovered files;
- finished with zero pending files;
- gave only those two recovered files a second attempt.

Run-level provider token evidence for the interrupted segment was necessarily incomplete; completed-file call counts and Mistral page counts were reconstructed from durable checkpoints.

## Real provider usage and cost evidence

Recorded v2 evidence contains:

- 119 Mistral calls;
- 119 Gemini calls;
- 1,666 Mistral pages accounted for;
- 236 successful and 2 failed recorded provider HTTP calls;
- 42,769 Gemini input tokens and 191,265 Gemini output/thinking tokens captured in the non-interrupted segments.

At Mistral's current official $4 / 1,000-page OCR rate, 1,666 accounted pages correspond to $6.664. Captured Gemini segments correspond to approximately $1.966 at the configured Gemini 2.5 Pro base rates. Gemini usage from the interrupted segment and any killed in-flight request must be taken from the provider billing ledger; the experiment deliberately does not invent a full-run cost estimate.

Pricing references used for the estimate:

- Mistral OCR pricing: https://docs.mistral.ai/inference/pricing
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing

## What the experiment proved

- Streaming, hash-verified, per-file custody works on the real 231 MB upload.
- Four-way resumable upload materially reduces request-serialization overhead.
- Two-way bounded extraction nearly halves wall time on the 2-vCPU VM.
- Per-file atomic checkpoints prevent a long restart from discarding completed paid work.
- The measured peak RSS remained below 310 MiB.
- Unique-file output outcomes match v1.

## What it did not prove

- It did not make one large file faster. v2's p95 and maximum individual-file latency were slightly worse.
- It did not implement page-level chunking/checkpoints for a very large PDF.
- It did not test concurrent jobs across different matters or queue fairness.
- It did not preserve v1 duplicate-of-prior-intake suppression.
- It did not retain complete Gemini token/cost evidence across a hard process interruption.
- The baseline runtime extraction records did not preserve useful per-file page counts, so exact per-file page parity could not be computed from normalized DB rows.

## Review questions before any integration

1. Should upload commit own SHA-based duplicate suppression before any extraction slot is consumed?
2. Is concurrency 2 the accepted beta default given the 1.98× gain and 309 MiB peak RSS?
3. Should the next experiment target single-large-PDF page chunking rather than broader worker concurrency?
4. Must provider usage/cost be checkpointed after every provider response as part of the durable file result?
5. Should cross-matter fairness be tested only after duplicate suppression and lease/ownership fencing are complete?

## Stop condition

The experiment is stopped. No experiment server or extractor is running. The production release remains `5cf4447`; no v2 code is wired into production.
