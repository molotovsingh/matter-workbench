# Private Beta Feedback Capture

Status: Implemented first slice; automatic sync foundation added
Date: 2026-06-07

## Problem

Private beta testers will notice bugs, dead ends, confusing language, missing
actions, and useful feature ideas while they are trying to work. If they have to
remember the issue, explain it later, or classify it correctly, the report will
lose the most useful evidence.

The app needs a simple way for testers to say, "something happened here," while
the workbench quietly records enough context for the operator and developer to
triage it later.

This is not a support desk, public feedback portal, or roadmap voting system.
It is a supervised beta capture loop.

## Core Principle

The tester-facing flow should assume very low product vocabulary.

The tester should not have to know whether something is:

- a bug;
- a feature request;
- a legal-quality concern;
- a workflow failure;
- a product polish issue;
- a configuration problem.

The front of the flow is simple. The back of the flow is structured.

## Tester-Facing Flow

The visible entry point should be one plain button:

```text
Have a problem? Tell us what happened
```

The form should then ask the tester to choose one simple path:

```text
Something did not work
I got confused
I want this to do something
```

The only required text field:

```text
What were you trying to do?
```

Optional second field:

```text
What happened instead?
```

Submit confirmation:

```text
Saved. You can keep working.
```

Avoid these tester-facing words in the first slice:

- bug;
- severity;
- priority;
- feature request;
- workflow;
- triage;
- reproduction steps;
- legal quality concern;
- expected behavior.

Those words can exist in the operator view, not in the tester intake.

## Automatic Context Capture

The app should silently attach safe diagnostic context:

- timestamp;
- current screen;
- active matter name, if any;
- active matter folder identifier, if safe;
- current route/tab;
- last command or button, if known;
- recent activity lines;
- visible error text, if any;
- whether a run/job is active;
- runtime mode, such as filesystem or runtime DB;
- app version or git commit when available;
- provider route summary, without secrets;
- browser viewport category, such as desktop or narrow.

The tester should not have to collect this manually.

## Privacy Boundary

Feedback capture must not silently include legal work product or secrets.

Do not automatically include:

- source document text;
- OCR text;
- generated legal output;
- provider prompts;
- provider responses;
- API keys;
- database URLs;
- raw file paths outside the app's safe matter labels;
- screenshots unless the user explicitly attaches one;
- full command text if it may contain privileged legal detail.

The first slice should prefer metadata and recent UI/activity evidence. If a
developer needs deeper evidence, use the existing private beta bug evidence pack
after operator review.

## Operator View

The operator can see the structured classification that testers never see:

- `bug`;
- `confusing_ux`;
- `feature_idea`;
- `legal_quality_concern`;
- `blocked_workflow`;
- `operator_note`.

The app can infer an initial classification from the tester's simple choice:

| Tester choice | Initial operator classification |
| --- | --- |
| Something did not work | `bug` |
| I got confused | `confusing_ux` |
| I want this to do something | `feature_idea` |

The operator can later adjust classification, severity, status, and notes.

Suggested operator fields:

- status: `new`, `reviewed`, `needs_evidence`, `fixed`, `parked`, `not_reproducible`;
- severity: `P0`, `P1`, `P2`, `P3`;
- owner: optional local operator/developer name;
- linked commit or tag;
- linked evidence-pack path;
- operator notes.

## Relationship To The Private Beta Bug Loop

This feature feeds the existing [Private Beta Bug-Fix Loop](../private-beta-bug-fix-loop.md).

The feedback item is the intake. The bug loop is the developer process:

1. Review the captured item.
2. Decide whether it is a bug, confusion, feature idea, legal-quality concern,
   or parked note.
3. Run the evidence pack if developer handoff needs more context.
4. Reproduce the issue on the smallest safe matter or read-only surface.
5. Fix the narrowest owning path.
6. Add or update the focused test.
7. Run release gates.
8. Close or park the feedback item.

## Storage

For local/private beta, the first slice uses an append-only local ledger:

```text
.local/private-beta-feedback-ledger.json
```

The local ledger is the offline queue and fallback record. It is not the final
"mothership" collection point.

Hosted/public beta can later promote feedback to tenant-scoped database storage.

## Automatic Mothership Sync

Tester workflow stays one-step:

1. Tester submits the simple form.
2. The app stores the redacted feedback locally.
3. If a sync target is configured, the app posts the safe packet to the
   mothership endpoint.
4. If sync fails, the local record is marked `queued`.
5. A later successful feedback submission silently retries older queued records.
6. The operator Activity page can also retry queued sync without asking the
   tester to export anything.

Environment variables:

```text
MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL=https://...
MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN=...
MWB_PRIVATE_BETA_INSTALL_ID=...
MWB_PRIVATE_BETA_TELEMETRY_MODE=safe
```

Only the redacted feedback packet is sent. The sync token is used as an outgoing
Bearer token and is not stored in the feedback record.

Telemetry modes:

| Mode | Meaning |
| --- | --- |
| `safe` | Default. Send compact metadata and UI context. Do not include legal/source/generated text silently. |
| `firm_internal` | Firm-controlled beta mode. Send richer tester context, monitor detail, evidence lines, and job metadata so the mothership can debug faster. Secrets are still redacted. |

`firm_internal` is intended only where beta testers are firm lawyers or trusted
internal users and the mothership is under the same controlled custody. It is
not a public/web beta default.

Sync states:

| State | Meaning |
| --- | --- |
| `not_configured` | Local-only capture; no mothership URL configured. |
| `sent` | Feedback was accepted by the configured mothership endpoint. |
| `queued` | Feedback is saved locally and waiting for retry. |
| `failed` | Reserved for future hard-failure states. |

## Passive Diagnostic Signal Sync

Tester-authored feedback is not the only beta signal. The app already has
developer-facing monitors that notice matter-specific and system-adjacent
problems during normal use:

- Matter Attention / Preparation Advisory from `/api/matter-attention`;
- failed long-running jobs from `/api/jobs`;
- Skill Factory health issues from `/api/skill-factory-health`.

These should also reach the mothership automatically, but only as compact
diagnostic summaries. They are not feedback records, and they are not full
evidence packs.

Local/private beta stores them in:

```text
.local/private-beta-signal-ledger.json
```

The app captures signal packets when the existing monitor endpoints are read.
It then syncs them through the same mothership configuration used for feedback,
with optional signal-specific overrides:

```text
MWB_PRIVATE_BETA_SIGNAL_SYNC_URL=https://...
MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN=...
MWB_PRIVATE_BETA_INSTALL_ID=...
MWB_PRIVATE_BETA_TELEMETRY_MODE=safe
```

If the signal-specific URL/token is absent, the app falls back to:

```text
MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL=https://...
MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN=...
MWB_PRIVATE_BETA_INSTALL_ID=...
```

Signal packets may include:

- install id;
- runtime mode;
- matter name;
- source: `matter_attention`, `job_status`, or `skill_factory_health`;
- severity, category, code, and title;
- blocker/warning/error counts;
- safe evidence handles such as `Extraction Log.csv - FILE-0001`;
- redacted failure messages.

In `firm_internal` mode they may also include:

- full tester-provided feedback context;
- advisory item detail;
- broader evidence lines;
- job metadata;
- Skill Factory store paths;
- matter root/path details useful to the operator.

Signal packets must not include:

- full bug evidence packs;
- secrets or database URLs.

In `safe` mode, source document text, OCR text, generated legal output,
provider prompts/responses, full matter paths, and skill output bodies are also
excluded from silent sync. In `firm_internal` mode, those legal/debug details
may be included only if they are already part of the captured feedback or
diagnostic context; secret redaction still applies.

The full private beta bug evidence pack remains operator-triggered. It is too
large and too close to support evidence to send silently.

## First Slice

Build the smallest useful version:

1. Add a `Have a problem? Tell us what happened` button.
2. Add the three-choice simple intake form.
3. Store feedback records in an append-only local ledger.
4. Attach safe automatic context.
5. Add an operator-only list/export surface.
6. Add a copy/export action that creates a developer handoff packet.
7. Add optional automatic mothership sync with queued retry.
8. Add passive diagnostic signal sync for compact monitor summaries.
9. Keep screenshots/manual attachments out of the first slice unless a tester
   explicitly requests it.

## Non-Goals

Do not build in the first slice:

- public feedback submission;
- automatic GitHub issue creation;
- roadmap voting;
- user accounts;
- email notifications;
- screenshot auto-capture;
- model-generated triage;
- automatic legal-output inspection;
- support ticket assignment.

## Success Criteria

The first slice is successful when:

- a confused tester can submit feedback without knowing product vocabulary;
- the operator can tell where and when the issue happened;
- no secrets or legal work product are captured silently;
- feedback can be exported into a useful developer handoff packet;
- feedback can be sent automatically to a configured mothership endpoint;
- matter/job/skill-health monitor signals can be sent automatically as compact
  redacted packets;
- firm-internal beta can opt into richer mothership packets without sending
  provider secrets, database credentials, or API keys;
- sync failure does not block tester flow and leaves a queued local record;
- the private beta bug-fix loop can start from a captured item without asking
  the tester to recreate the whole context from memory.

## Open Product Questions

These do not block the concept, but should be answered before implementation:

- Should the button live in the right assistant rail, the left sidebar, or both?
- Should the operator-only list live under Activity or Settings?
- Should feedback capture be available without an active matter?
- Should the app allow an optional screenshot attachment in V1?
- Should feedback records be visible to testers after submission, or only to
  the operator?
- Should the mothership endpoint write directly to Postgres, GitHub Issues, or
  an operator triage queue?
