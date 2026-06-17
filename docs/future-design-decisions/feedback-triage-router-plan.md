# Feedback Triage Router Plan

Date: 2026-06-16
Status: Implementation branch / operator-only
Branch: `codex/feedback-triage-router`
Base: `8a27c8f Extract runtime DB object key policy`

## Purpose

Private beta feedback, mothership signals, and journey telemetry are now rich
enough that simple action-lane regexes are becoming a weak seam. Lawyers will
file messy feedback that blends bugs, confusing UX, missing features, legal
quality concerns, and blocked workflows.

This branch extracts feedback triage into a bounded server-side service so the
mothership report can stop accumulating inline classification rules.

## Non-Goals

- No tester-facing category complexity.
- No product backlog or ticket integration.
- No automatic `product_backlog` action lane.
- No screenshots or raw legal work-product ingestion.
- No provider calls in the first wired report path.
- No frontend changes required for the first slice.

## Implemented First Slice

Added:

```text
services/private-beta-feedback-triage-service.mjs
test/private-beta-feedback-triage-service.test.mjs
```

Changed:

```text
mothership/report.mjs
```

The report now calls:

```js
routePrivateBetaFeedbackTriage(item)
```

instead of keeping triage rules inline.

## Triage Policy

Current policy version:

```text
private-beta-feedback-triage/v1
```

Allowed classifications:

```text
bug
confusing_ux
feature_request
blocked_workflow
legal_quality_concern
operator_note
feature_idea
```

Allowed action lanes:

```text
fix_now
investigate
product_decision
watch
```

`product_backlog` remains intentionally unsupported until there is a real
backlog/ticket destination.

## Routing Shape

The service follows the documented hybrid design:

1. deterministic hard-failure overrides first;
2. optional classifier-result validation second;
3. conservative deterministic fallback last.

The first branch does not perform live model calls. It does define and test the
bounded packet shape that a future classifier can receive:

```js
buildFeedbackTriagePacket(item)
```

That packet redacts secrets and excludes prompts, source text, generated legal
work product, provider payloads, raw documents, API keys, and database URLs.

## Deterministic Overrides

The service keeps hard runtime signals rule-owned:

- critical preparation failures stay `fix_now`;
- unsupported Copilot citations stay `fix_now` unless stale and requiring live
  recheck;
- repeated warning signals become `investigate`;
- single warning signals stay `watch`;
- missing extraction/source-label/List of Dates evidence attached to vague
  feedback becomes `fix_now`;
- cannot-find chronology feedback stays `product_decision` / UX unless related
  hard evidence exists;
- product/workflow requests mistakenly filed through the bug channel route to
  `feature_request` / `product_decision` when no concrete malfunction language
  is present;
- onboarding/help-copy complaints filed as bugs route to `confusing_ux` /
  `product_decision`;
- positive notes and operator/test smokes filed as bugs route to `operator_note`
  / `watch`.

## Classifier Guardrails

The optional classifier-result path is intentionally strict:

- malformed classifier output falls back to `investigate`;
- unsupported action lanes, including `product_backlog`, fall back to
  `investigate`;
- low confidence falls back to `investigate`;
- `fix_now` requires high confidence plus concrete related evidence;
- deterministic hard failures beat classifier output.

## Follow-up Report Hardening

The mothership development report now adds bounded operator metadata to each
prioritized evidence item:

- `severity`: one of `blocker`, `error`, `warning`, or `info`;
- `status`: currently preserved for feedback rows (`new`, `reviewed`,
  `needs_evidence`, `fixed`, `parked`, or `not_reproducible`).

These fields are additive report metadata for operators. They do not change the
tester-facing feedback form, ingestion payload, or triage routing policy.
Markdown rendering also redacts installation identifiers before display.

The operator CLI supports filtered report views for triage queues:

```bash
npm run mothership:report -- --action-lane fix_now --severity error --limit 20
npm run mothership:report -- --status needs_evidence
```

Filters are view-only and fail closed on unsupported values; they do not alter
stored feedback, signal ingestion, or the underlying unfiltered report summary.

The mothership operator can mark feedback triage status after review:

```bash
npm run mothership:operator -- feedback update-status \
  --installation-id <installation_id> \
  --id <feedback_id> \
  --status needs_evidence \
  --actor operator \
  --note "needs current repro"
```

Status updates use the existing `mothership_feedback_events.status` column,
patch the stored JSON payload status for report consistency, and write bounded
redacted operator audit metadata:

- `operatorTriage`: latest status, actor, note, and timestamp;
- `operatorTriageHistory`: append-only status-change entries.

The markdown report prints each prioritized evidence item ID plus latest status
audit details so operators can copy the correct `feedback_id` into this command
and see why a row moved. This remains an operator-only action; tester feedback
submission is unchanged.

## Tests Added

The new tests cover the examples from the parked decision note:

- unsupported-citation signal stays `fix_now` even if a classifier disagrees;
- deadline-calendar request can be clarified as `feature_request`;
- cannot-find List of Dates feedback is UX unless hard missing-output evidence
  exists;
- failed source-label evidence plus vague feedback becomes `fix_now`;
- malformed classifier output falls back to `investigate`;
- low-confidence classifier output falls back to `investigate`;
- feature requests do not create a `product_backlog` lane;
- classifier packets redact secrets before any future provider call.

## Later Work

A later branch may add an actual model-assisted classifier, but only after the
operator-only pure service has been stable. That branch should inject the model
behind a bounded service API and keep report rendering deterministic when the
classifier is unavailable.
