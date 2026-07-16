# Legal Workbench Summary

## Current Snapshot (May 2026)

Matter Workbench is a local-first legal workflow system for turning messy matter folders into source-backed legal working artifacts.

It is no longer just a shell prototype. The core pipeline is implemented and tested:

```text
/matter-init -> /extract -> /describe_sources -> /create_case_timeline
```

## What Is Running Today

- Matter home configuration and in-app matter switching.
- Multi-intake uploads (`00_Inbox/Intake NN - ...`) with deterministic file registration.
- Deterministic extraction record generation (`extraction-record/v1`) for supported file types.
- Optional OCR path for scanned PDFs with explicit provider gating.
- Source descriptor generation to `10_Library/Source Index.json`.
- Neutral Case Timeline generation to JSON/CSV/Markdown with source-backed citations.
- Rerun guardrails for paid/provider-backed skills.
- Local context preview and local context search over bounded matter context.
- Governance layer for configurable skills (idea -> interview -> sample -> approval -> runnable skill).

## Runtime Surface

### Built-in slash skills

- `/matter-init`
- `/prepare_matter`
- `/extract`
- `/describe_sources`
- `/context_preview`
- `/context_search`
- `/create_case_timeline`
- `/doctor`

### Command rail behavior

The right-side command rail supports:

- exact slash commands;
- deterministic aliases (`prepare matter`, `open library`, `status`);
- rerun confirmations when current paid artifacts already exist;
- configurable custom skill runs with overwrite confirmation;
- copyable run/check reports for operational traceability.

## Persistent Artifact Model

A matter folder is treated as durable legal workflow state, not transient UI state:

- `matter.json`
- `00_Inbox/Intake NN - .../File Register.csv`
- `00_Inbox/Intake NN - .../Extraction Log.csv`
- `00_Inbox/Intake NN - .../_extracted/FILE-NNNN.json`
- `10_Library/Source Index.json`
- `10_Library/Case Timeline.json`
- `10_Library/Case Timeline.csv`
- `10_Library/Case Timeline.md`

## What Changed vs Old Summary

- This is not a mocked Phase 1 UI anymore.
- `/matter-init` is real and deterministic, not a placeholder.
- Source labeling and chronology generation are implemented.
- Command rail and skill governance are productionized enough for supervised beta workflows.

## Current Boundaries

- Lawyer-facing artifacts remain review-required.
- Provider output is fail-closed where possible.
- No claim of court-ready output without lawyer review.
- Local-first posture remains primary for confidentiality and workflow control.

## Where To Look Next

- Architecture map: `docs/codebase-diagram.md`
- Beta operations workflow: `docs/beta-testing-list-of-dates.md` (legacy-titled; now covers Case Timeline review)
- Model/provider routing controls: `docs/model-routing.md`
- Current debt boundaries: `docs/technical-debt-large-files-review.md`
- Historical plain-JS refactor record: `docs/refactor-staging-plan.md`
