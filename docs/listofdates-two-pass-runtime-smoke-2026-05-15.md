# Two-Pass `/create_listofdates` Runtime Smoke - 2026-05-15

This note records the first non-writing smoke of the gated two-pass runtime after PR #156 landed.

Matter:

```text
/Users/aksingh/matters-matter-workbench/Atlas Constuction vs Diptishree
```

Command shape:

```text
dryRun: true
CREATE_LISTOFDATES_TWO_PASS_ENABLED=1
```

No `--apply` path was used. The smoke did not write `List of Dates.md`, `List of Dates.csv`, `List of Dates.json`, or `List of Dates Candidates.json`.

## OpenAI Direct Attempt

The first attempt used the default two-pass direct OpenAI route:

```text
pass 1: gpt-4.1
pass 2: gpt-5.4-mini
```

It failed before producing output because the direct OpenAI account returned quota exhaustion:

```text
You exceeded your current quota, please check your plan and billing details.
```

This was not a chronology-quality failure. It was an account/provider availability failure.

## OpenRouter Route Check

The second attempt used the same model pair through OpenRouter:

```text
pass 1 provider: openrouter
pass 1 model: openai/gpt-4.1
pass 2 provider: openrouter
pass 2 model: openai/gpt-5.4-mini
```

Result:

```json
{
  "engineVersion": "create-listofdates-v2-two-pass",
  "generationMode": "two_pass",
  "counts": {
    "recordsRead": 9,
    "blocksSent": 855,
    "blocksFiltered": 0,
    "aiRequests": 23,
    "candidateEntries": 181,
    "acceptedCandidates": 171,
    "acceptedEntries": 18,
    "clusteredEntries": 0,
    "entries": 18,
    "rejectedCandidates": 10,
    "rejectedEntries": 0
  },
  "outputPaths": {
    "directory": "10_Library",
    "candidates": "10_Library/List of Dates Candidates.json",
    "json": "10_Library/List of Dates.json",
    "csv": "10_Library/List of Dates.csv",
    "markdown": "10_Library/List of Dates.md"
  },
  "pass1": {
    "provider": "openrouter",
    "model": "openai/gpt-4.1",
    "returnedModel": "openai/gpt-4.1-2025-04-14",
    "returnedProvider": "OpenAI"
  },
  "pass2": {
    "provider": "openrouter",
    "model": "openai/gpt-5.4-mini",
    "returnedModel": "openai/gpt-5.4-mini-20260317",
    "returnedProvider": "OpenAI"
  },
  "elapsedMs": 377508
}
```

Terminal tail:

```text
[listofdates] pass 1 chunk 21/22: 13 candidate(s)
[listofdates] pass 1 chunk 22/22: 5 candidate(s)
[listofdates] pass 1 accepted 171 candidate(s) into 10_Library/List of Dates Candidates.json
[listofdates] pass 2 accepted 18 cited date event(s)
[listofdates] provider two-pass: openai/gpt-4.1 -> openai/gpt-5.4-mini
[listofdates] dry run only. Re-run with apply to write list of dates.
```

## What This Proves

- The gated runtime path can run end to end without changing the default one-pass runtime.
- The pass 1 and pass 2 provider policies can be routed independently.
- OpenRouter can serve as a manual route for the same model pair when direct OpenAI quota is unavailable.
- Returned provider/model metadata is captured for both passes.
- `dryRun: true` did not write the internal candidate ledger or final matter artifacts.

## What This Does Not Prove

- It does not prove the generated final 18-row chronology is better than the committed golden outputs, because this smoke did not write or inspect the generated Markdown.
- It does not prove automatic fallback should be enabled.
- It does not justify making two-pass the default yet.

## Next Gate

Before enabling this for normal `/create_listofdates` use:

1. Run the gated path with `dryRun: false` on a copied or explicitly approved test matter.
2. Compare final output against the committed Atlas golden outputs.
3. Confirm readable source labels and raw citations are preserved.
4. Confirm the candidate ledger stays hidden from the normal lawyer-facing workspace unless technical files are shown.
5. Decide whether OpenRouter should be an explicit fallback route or only an operator-selected route.

## Copied-Matter Apply Smoke

After the dry-run, the gated path was run with `dryRun: false` against a copied Atlas matter under:

```text
.local/two-pass-apply-smoke/Atlas Constuction vs Diptishree
```

This deliberately overwrote only the copied matter's List of Dates artifacts. The real matter folder was not changed.

Route:

```text
CREATE_LISTOFDATES_TWO_PASS_ENABLED=1
pass 1: openrouter / openai/gpt-4.1
pass 2: openrouter / openai/gpt-5.4-mini
```

Result:

```json
{
  "engineVersion": "create-listofdates-v2-two-pass",
  "generationMode": "two_pass",
  "counts": {
    "recordsRead": 9,
    "blocksSent": 855,
    "blocksFiltered": 0,
    "aiRequests": 23,
    "candidateEntries": 164,
    "acceptedCandidates": 153,
    "acceptedEntries": 21,
    "clusteredEntries": 0,
    "entries": 21,
    "rejectedCandidates": 11,
    "rejectedEntries": 0
  },
  "elapsedMs": 359407
}
```

Written files in the copied matter:

```text
10_Library/List of Dates Candidates.json
10_Library/List of Dates.json
10_Library/List of Dates.csv
10_Library/List of Dates.md
```

SHA-256 after the copied-matter run:

```text
30871576392ebc82a51c0c66fd55b485090a54d4f20fed7d1fb70c92821852c4  List of Dates.md
1893e42b6dfd6b5417571df7cec08f2b416808a51f03cd2a7ddc474810eea6b4  List of Dates.json
98bbebc1be729934c7a3ee95c40afd17b791c6afcaec42bf4d4f8d56c0847371  List of Dates.csv
01fcdd7a5f185643fd42f2588fa2372dd0f3ad4328cea604a1fa6ffc5d6ce038  List of Dates Candidates.json
```

Quick quality checks:

- Markdown used readable source labels with raw citations.
- No `FILE-0001__`, `_extracted`, `By Type`, `Originals`, `Source Files`, `.pdf`, `.docx`, `.txt`, or `.eml` technical-label leak was found in the Markdown.
- `sourcesWithFileOnly` was `0`.
- `needsReview` rows were `1`.
- One same-date cluster was present for `2008-12-16`, but the two rows describe distinct legal acts: development agreement execution and General Power of Attorney execution.

This apply-smoke proves the gated runtime can write the expected artifact set safely on a copied matter. It still does not make two-pass the default; the next decision is whether the 21-row output is lawyer-preferred against the committed goldens.
