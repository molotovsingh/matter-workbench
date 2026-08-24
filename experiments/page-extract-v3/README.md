# Page Extract V3 Experiment

An isolated experiment to remove the measured whole-document Gemini repair bottleneck without weakening extraction quality relative to the frozen V2 output.

## Hard boundary

- Nothing in this directory is imported by production routes, services, schemas, workers, builds, or deployment units.
- V3 reads the completed V2 experiment as a reference; it never mutates V2 evidence or production data.
- Real source files, candidate outputs, checkpoints, and detailed comparisons remain in an explicitly supplied experiment root.
- No provider is called by the baseline command.
- No production integration is part of this phase.

## Current phase: freeze the reference

The first reference is the existing whole-PDF pipeline:

```text
PDF.js inspection → Mistral full-PDF OCR → Gemini 2.5 Pro full-PDF repair
```

This reference is not human-verified ground truth. It is a non-inferiority starting point that lets later candidates report exactly where they differ.

Capture the reference from a completed V2 workspace:

```bash
node experiments/page-extract-v3/cli.mjs baseline \
  --v2-root <v2-experiment-root> \
  --session-id <v2-session-id> \
  --out <v3-evidence-dir>/current-reference.json
```

The output contains hashes and aggregate measurements, not document text or filenames. It records:

- unique and duplicate documents;
- page coverage and per-page normalized-text fingerprints;
- critical legal-token fingerprints for dates, amounts, sections, articles, clauses, rules, and orders;
- native-text, no-text-layer, and layout-risk diagnostics;
- upload, extraction, provider, and local-processing timing;
- repair routing and failure categories;
- the acceptance boundary for later V3 candidates.

Replay the conservative native-page routing policy against the same sources and compare those pages to the reference without making provider calls:

```bash
node experiments/page-extract-v3/cli.mjs plan \
  --v2-root <v2-experiment-root> \
  --session-id <v2-session-id> \
  --out <v3-evidence-dir>/native-route-plan.json \
  --concurrency 2
```

The plan opens each byte-unique PDF, classifies each page independently, fingerprints native text, and reports general-token and critical-legal-token agreement with the current reference. It never uses the reference to make the route decision.

## Current-provider candidate

Run the routed candidate with real billed providers:

```bash
node experiments/page-extract-v3/cli.mjs run-current \
  --v2-root <v2-experiment-root> \
  --route-plan <v3-evidence-dir>/native-route-plan.json \
  --root <v3-work-root> \
  --candidate-id routed-gemini-25 \
  --primary-concurrency 4 \
  --repair-concurrency 4 \
  --repair-model gemini-2.5-pro
```

Add `--prepare-only` first to validate page splitting and balanced batch construction with zero provider calls; rerunning the same candidate without that flag resumes the prepared files.

The runner:

- deduplicates before paid work;
- losslessly separates pages with Poppler rather than rendering them;
- forms size/complexity-balanced page batches across documents;
- schedules largest batches first through a bounded work-stealing pool;
- checkpoints every provider batch atomically;
- accepts missing Mistral confidence as unknown rather than automatically bad;
- sends only independently suspicious primary pages to Gemini;
- assembles pages back into their original documents and order;
- reports per-lane comparison with the frozen reference.

The 2.5 Pro arm leaves thinking unset to match the current reference configuration. `gemini-3.7-flash` with `LOW` thinking is supported as a separate repair arm. Pass `--primary-cache-candidate <2.5-candidate-id>` so the A/B arm validates and reuses the identical checkpointed Mistral results without another paid primary-OCR run. It must not overwrite or masquerade as the 2.5 Pro reference arm.

## Planned later arms

Later arms remain deliberately separate so their effects can be attributed:

1. routed Gemini 3.7 Flash repair;
2. routed Textract Detect/Layout;
3. best measured hybrid.

Provider replacement and production integration are not part of the first comparison.

## Acceptance rule

A candidate may be called better only if it:

- accounts for every unique source document and expected page;
- reports all text and critical-token differences from the reference;
- does not silently accept missing or duplicate pages;
- reports every provider call, failure, latency, token/page usage, and cost;
- is faster and cheaper under controlled conditions;
- distinguishes parity with the current reference from human-verified correctness.
