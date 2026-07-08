# Two-Pass `/create_case_timeline` Runtime Contract

Status: design contract plus gated runtime path. The production default remains the one-pass runtime unless `CREATE_LISTOFDATES_TWO_PASS_ENABLED=1` is set.

This contract records the path from the reusable two-pass smoke harness to a production-safe `/create_case_timeline` implementation. The current one-pass skill remains the default while the two-pass path is gated and re-smoked on real matters.

## Why Change

Atlas Construction exposed a real chronology-quality problem:

- low-quality PDFs produced repeated rows with minor variations;
- stronger one-pass runs still carried duplicate clusters and noisy legal-history rows;
- some outputs used technical filenames instead of the readable source labels already available in Source Index;
- precedent or background case-law dates sometimes leaked into the matter chronology;
- a second editor pass cleaned the output more reliably than simply using a stronger one-pass model.

The useful product shape is therefore:

```text
verbose candidate ledger -> lawyer-facing chronology
```

The first pass is deliberately generous. The second pass is deliberately selective.

Evidence:

- `docs/listofdates-two-pass-model-smoke.md`
- `docs/listofdates-atlas-two-pass-ranking-2026-05-15.md`
- `evals/listofdates/golden/atlas-two-pass-2026-05-15/`

## Current Production Behavior

Today `/create_case_timeline`:

1. Reads `extraction-record/v1` outputs and `10_Library/Source Index.json`.
2. Filters chronology-eligible source blocks.
3. Chunks those blocks.
4. Calls the configured AI provider once per chunk.
5. Validates and hydrates returned entries against source blocks and source labels.
6. Clusters accepted entries.
7. Writes:

```text
10_Library/Case Timeline.md
10_Library/Case Timeline.csv
10_Library/Case Timeline.json
```

Those final artifact paths are the public contract. Downstream skills and lawyers should continue to read those outputs.

## Proposed Runtime Shape

### Pass 1: Candidate Ledger

Pass 1 should harvest a verbose candidate ledger. It is not the final Case Timeline.

It should preserve:

- repeated descriptions of the same event from pleadings, orders, replies, affidavits, appeals, and revisions;
- potentially material background dates if they explain ownership, authority, limitation, collateral litigation, appeal delay, or enforceability;
- source excerpts short enough to support second-pass editing;
- readable source labels from Source Index;
- raw `FILE-NNNN pX.bY` citations;
- OCR suspicion and date uncertainty;
- same-fact hints and possible duplicates;
- why a candidate may be legally material.

It should not:

- write the final chronology;
- hide contradictions or uncertainty;
- collapse duplicates too early;
- send anything to `00_Inbox`;
- replace original/source records.

### Pass 2: Chronology Editor

Pass 2 should read the candidate ledger and produce the lawyer-facing client-perspective chronology.

It should:

- merge duplicate or near-duplicate candidates into one row;
- preserve supporting citations;
- drop pure precedent/case-law dates unless they are part of this matter's own procedural history;
- use readable source labels plus raw citations;
- mark uncertainty instead of inventing confidence;
- keep the final chronology useful to the lawyer, not merely short.

It should not:

- pretend bad OCR is clean;
- invent legal conclusions;
- remove raw citations;
- expose technical filenames when a readable source label exists;
- change the public artifact paths.

## Artifact Contract

The final public outputs remain unchanged:

```text
10_Library/Case Timeline.md
10_Library/Case Timeline.csv
10_Library/Case Timeline.json
```

The first-pass ledger is an internal review artifact. It should not appear as the main lawyer-facing chronology. The implementation should choose one explicit technical path and hide it by default in normal workspace view. Suggested path:

```text
10_Library/Case Timeline Candidates.json
```

If the workspace later adds a separate hidden technical subfolder, this can move behind a compatibility reader. Do not put candidate ledgers in `00_Inbox`; they are analysis products, not source materials.

The final JSON should remain backward-compatible with current readers and include extra run metadata:

```json
{
  "engine_version": "create-listofdates-v2-two-pass",
  "generation_mode": "two_pass",
  "candidate_ledger_path": "10_Library/Case Timeline Candidates.json",
  "pass1_ai_run": {},
  "pass2_ai_run": {},
  "validation": {}
}
```

Downstream custom skills should keep reading the final `Case Timeline.md` or `Case Timeline.json` unless they explicitly opt into review-mode access to the candidate ledger. That preserves the lawyer's usual style and prevents a custom skill from unexpectedly ingesting raw candidate noise.

## Candidate Ledger Schema

Suggested V1 shape:

```json
{
  "schema_version": "list-of-dates-candidates/v1",
  "matter": {
    "name": "",
    "folder": ""
  },
  "generated_at": "",
  "source_block_count": 0,
  "ai_run": {
    "provider": "",
    "model": "",
    "returned_model": "",
    "task": "create_listofdates_pass1"
  },
  "candidates": [
    {
      "candidate_id": "cand_0001",
      "date_iso": "2024-09-30",
      "date_text": "30 September 2024",
      "event_candidate": "",
      "legal_materiality": "",
      "source_label": "",
      "citation": "FILE-0007 p1.b2",
      "source_excerpt": "",
      "candidate_type": "agreement | payment | notice | pleading | order | filing | inspection | correspondence | other",
      "party_posture": "helps_client | hurts_client | neutral | unclear",
      "same_fact_hint": "",
      "date_uncertainty": "",
      "ocr_suspicion": "",
      "needs_review": false,
      "confidence": "high | medium | low"
    }
  ]
}
```

The ledger may keep several candidates for one date or one fact. That is the point. The editor pass decides what becomes a final chronology row.

## Final Chronology Compatibility

The final `Case Timeline.json` should keep existing fields that current UI and downstream skills rely on. New fields should be additive.

Suggested row additions:

```json
{
  "merged_candidate_ids": ["cand_0001", "cand_0042"],
  "source_label": "Flat Purchase Agreement - 12 April 2022",
  "review_flags": ["ocr_uncertain", "duplicate_candidates_merged"]
}
```

The Markdown remains the lawyer-facing review chronology:

```text
| Date | Event | Legal Relevance | Source |
```

The `Source` cell must include the readable source label and the raw citation.

## Model Policy

The Atlas ranking currently supports two model-pair profiles:

| Profile | Pass 1 | Pass 2 | Use When |
| --- | --- | --- | --- |
| Legal-use accuracy default candidate | `gpt-4.1` | `gpt-5.4-mini` | The goal is richer legal coverage on messy PDFs. |
| Clean concise alternate | `gpt-5.4-mini` | `gpt-5.4` | The goal is a cleaner first draft with lower row count. |

OpenRouter editor passes can be useful as comparison or fallback experiments, but non-default editor models should not become the default verbose first pass under the current strict JSON/chunk shape without a fresh reliability bakeoff. The observed failure mode in one prior provider trial was truncated or unterminated JSON.

Production should use central model policy rather than hardcoding model IDs inside the engine. The policy must record requested provider/model and returned provider/model for both passes.

## Provider Fallback

Use the fallback rules in `docs/model-routing.md`.

V0 production posture:

- no silent fallback for lawyer-facing chronology work;
- retry transient 5xx/network failures on the same provider/model where safe;
- fallback only to explicit allowlisted model pairs for the same pass role;
- fail closed on malformed JSON after retry;
- fail closed on citation validation failure;
- record fallback reason and returned model metadata.

OpenRouter is not globally good or bad. It is a route. Use it only where the task policy allows it and where the model has proven it can obey the structured-output contract.

## Validation Gates

A two-pass run can replace the production Case Timeline only if the final output passes these checks:

1. Final Markdown renders a readable lawyer chronology.
2. Final rows preserve raw `FILE-NNNN pX.bY` citations.
3. Final rows use readable source labels when Source Index has them.
4. Technical filenames do not leak into the main source label unless no label exists.
5. Duplicate date clusters are checked and reported.
6. Pure precedent/case-law rows are dropped unless part of this matter's procedural history.
7. OCR/date uncertainty is marked rather than hidden.
8. Every final row can be traced to one or more candidate IDs.
9. Candidate ledger and final output record pass 1 and pass 2 provider/model metadata.
10. Existing final artifacts are not overwritten if pass 2 or validation fails.

## Rerun And Overwrite Rules

Keep the existing rerun guard.

If final Case Timeline artifacts already exist, the UI must ask before replacing them. The destructive action should be described as replacing the existing output document, not replacing the skill.

If pass 1 succeeds but pass 2 fails:

- do not replace `Case Timeline.md`, `.csv`, or `.json`;
- do not mark the matter as having a new current Case Timeline;
- the candidate ledger may be retained only as a failed/internal run artifact with clear metadata;
- the UI should report that final chronology generation failed after candidate extraction.

If pass 2 succeeds but validation fails:

- do not replace final artifacts;
- keep diagnostics for developer review;
- surface a fail-closed error to the user.

## Rollout Plan

1. Keep one-pass `/create_case_timeline` as default.
2. Enable two-pass only behind the explicit env gate:

```text
CREATE_LISTOFDATES_TWO_PASS_ENABLED=1
```

3. Use the task names:

```text
AI_TASKS.CREATE_LISTOFDATES_PASS1
AI_TASKS.CREATE_LISTOFDATES_PASS2
```

4. Write the candidate ledger and final outputs only inside the gated path.
5. Smoke on:
   - Atlas Construction;
   - Mehta;
   - one low-quality scanned matter;
   - one cleaner matter where current one-pass already works.
6. Compare against current one-pass output and the committed Atlas goldens.
7. Promote only after duplicate control, source-label quality, raw citation preservation, and legal coverage are better or equal.
8. Roll back by disabling the env gate. Existing canonical Case Timeline paths stay valid; legacy List of Dates paths remain readable fallbacks.

## Tests To Add When Implementing

Implemented service tests:

- pass 1 writes candidate ledger in gated mode;
- pass 2 writes the stable final Case Timeline paths after validation;
- pass 2 failure leaves existing final Case Timeline artifacts unchanged and marks the candidate ledger failed;
- model policy exposes separate pass 1 and pass 2 task defaults.

Remaining tests before promoting the gated runtime:

- pass 2 merges duplicate candidates into one final row;
- final rows preserve raw citations and readable labels;
- precedent-like candidate rows are dropped unless matter-procedural;
- validation failure does not overwrite final artifacts;
- metadata records both requested and returned provider/model for each pass.

UI/API tests:

- rerun guard still appears before replacing existing Case Timeline;
- the final success report shows both pass models;
- technical candidate ledger is not presented as the main lawyer-facing output;
- legacy `/create_listofdates` and canonical `/create_case_timeline` commands both work through the skill runner.

## Non-Goals

Do not include in the first production slice:

- changing matter folder taxonomy;
- exposing a model selector to lawyers;
- changing downstream custom skills to read the candidate ledger by default;
- moving candidate ledgers into `00_Inbox`;
- replacing Source Index or extraction records;
- silently falling back across providers;
- court-ready certification;
- a new chronology editing UI.

## Open Questions

These need product judgment before or during implementation:

1. Should the candidate ledger be visible under a technical-files toggle, or only in run metadata?
2. Should final Markdown include an explicit `Review Flags` column, or keep flags only in JSON?
3. Should the legal-use profile and concise profile become a hidden policy choice or a visible user choice later?
4. How many committed golden matters are enough before changing the default runtime?
5. Should downstream skills be able to request candidate-ledger access only through an explicit skill policy?

Until those are answered, the safe default is:

```text
one-pass remains production default;
two-pass remains gated;
candidate ledger stays internal;
final Case Timeline contract stays stable.
```
