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
I want a new feature
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
- `feature_request`;
- `feature_idea` (legacy historical rows only);
- `legal_quality_concern`;
- `blocked_workflow`;
- `operator_note`.

The app can infer an initial classification from the tester's simple choice:

| Tester choice | Initial operator classification |
| --- | --- |
| Something did not work | `bug` |
| I got confused | `confusing_ux` |
| I want a new feature | `feature_request` |

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
2. Decide whether it is a bug, confusion, feature request, legal-quality concern,
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
| `safe` | Default. Send compact metadata and UI context. Do not include tester usernames, display names, roles, or legal/source/generated text silently. Use trace/request IDs for correlation. |
| `firm_internal` | Firm-controlled beta mode. Send richer tester context, including tester identity, monitor detail, evidence lines, and job metadata so the mothership can debug faster. Secrets are still redacted. |

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

- tester username, display name, and role;
- full tester-provided feedback context;
- advisory item detail;
- broader evidence lines;
- job metadata;
- Skill Factory store paths;
- matter root/path details useful to the operator.

Signal packets must not include:

- full bug evidence packs;
- secrets or database URLs.

In `safe` mode, tester username/display name/role, source document text, OCR
text, generated legal output, provider prompts/responses, full matter paths, and
skill output bodies are also excluded from silent sync. In `firm_internal` mode, those legal/debug details
may be included only if they are already part of the captured feedback or
diagnostic context; secret redaction still applies.

The full private beta bug evidence pack remains operator-triggered. It is too
large and too close to support evidence to send silently.

## Operator Observability Bundle

The private beta runtime now exposes an operator-only correlation surface:

```text
GET /api/private-beta/observability?limit=50
```

This is not a lawyer-facing API. It is available only to local/superuser
operators. It joins the current feedback ledger, failed job ledger, diagnostic
signal ledger, and latest backend metrics into one debugging bundle:

- summary counts for feedback, failed jobs, open signals, backend suitability,
  and user-patience risk;
- ranked top problems grouped by job failure, diagnostic signal, or feedback
  class;
- each feedback record with related failed jobs and related signals, matched by
  trace id, matter name, and nearby time;
- recent failed jobs and latest metrics for release/debug context.

Every request receives an `x-mwb-trace-id` response header. Tracked jobs and
feedback records carry that trace id where available, so a tester report can be
linked back to the failed action that produced it. This keeps the beta debugging
loop enterprise-grade without asking lawyers to export logs or explain internal
state.

## Heartbeat And Journey Telemetry

Status: Push foundation implemented; external pull checks planned
Date: 2026-06-13

Feedback, diagnostic signals, failed jobs, and backend metrics are necessary,
but they are still event-shaped. They tell the operator what happened after a
tester reports or triggers something. They do not, by themselves, give the
mothership a steady sense of whether the beta app is alive, responsive, and
following the expected lawyer journey.

The telemetry foundation now includes a regular pushed heartbeat that summarizes
the product journey without asking testers to export logs or explain app state.
The separate mothership pull monitor remains planned.

The heartbeat should answer:

- is this install alive;
- which version and runtime mode is it running;
- who is using it, at the level allowed by telemetry mode;
- which matter journey is active;
- where the current journey is in the app;
- whether preparation, extraction, source labels, List of Dates, story writing,
  Copilot, custom skills, Activity, or feedback are healthy;
- where a tester stalled, retried, switched matter, or hit a failure;
- whether user patience is at risk because a stage is slow, stuck, or repeatedly
  failing.

### Beta Deployment Topology

For beta-real testing, do not put the mothership on the same VM as the app.

The preferred topology is:

```text
DigitalOcean App VM
  -> HTTPS push to separate DigitalOcean Mother VM/service

Separate Mother VM/service
  -> shallow HTTPS pull checks against the App VM
```

Same-VM loopback is still useful for local rehearsal, private development, and
contract smoke tests:

```text
Local/private rehearsal:
App process -> 127.0.0.1 mothership receiver
```

But it should not be the confidence-building topology for beta release. Earlier
private-VM-to-public-VM testing showed that tenancy, runtime DB, auth, and
deployment bugs can hide until the real network and custody boundary exists.
The mothership boundary should therefore be exercised early, not deferred until
after testers are already relying on the app.

The separate Mother VM/service can remain small and cheap. It does not run legal
engines or OCR. Its job is durable intake, reports, uptime visibility, and
operator debugging. It should have its own database role and should not have
Matter Workbench legal-data storage permissions.

### Push vs Pull

Use a hybrid model.

The app should **push** rich journey telemetry to the mothership. The app is the
only process that reliably sees the real in-product path:

- login/session context;
- route and screen changes;
- selected matter changes;
- upload/add-files events;
- preparation stage transitions;
- run ids, trace ids, job ids, and failed stage names;
- Copilot model tier and source-bounded answer attempts;
- custom skill run lifecycle;
- feedback submissions near failed actions.

Push also works better for local/private deployments behind NAT, firewalls, or
private networks because the app only needs outbound access to the mothership.
Remote sync must remain non-blocking: write the local ledger first, enqueue the
packet, retry later, and never fail the lawyer's action merely because telemetry
egress failed.

In a later deployment-monitor slice, the mothership should **pull** only shallow
external health checks:

- public URL reachable;
- HTTPS certificate valid;
- login page reachable;
- app version/health endpoint reachable;
- last heartbeat age;
- basic latency from the mothership's point of view.

Pull is valuable because it detects app-down, nginx, DNS, certificate, and
network failures that the app cannot report once it is unreachable. Pull should
not be the primary source of rich journey telemetry.

### Heartbeat Packet Shape

The heartbeat should be a compact summary, not a full evidence pack. A future
packet can look like:

```json
{
  "kind": "heartbeat",
  "installId": "matter-workbench-do-beta-1",
  "appVersion": "git-or-release-tag",
  "runtimeMode": "postgres",
  "telemetryMode": "firm_internal",
  "sentAt": "2026-06-13T00:00:00.000Z",
  "activeSessions": 2,
  "journeys": [
    {
      "user": "shivangi@lawzeus.com",
      "matter": "Gionee India Pvt Ltd v Bharat Nagpal",
      "screen": "matter_overview",
      "lastAction": "run_preparation_again",
      "currentStage": "extract_documents",
      "currentStageStatus": "failed",
      "traceId": "trace_...",
      "jobId": "job_...",
      "lastError": "504 Gateway Time-out",
      "patienceRisk": "high"
    }
  ],
  "counters": {
    "queuedFeedback": 1,
    "openSignals": 4,
    "failedJobs": 2,
    "slowStages": 1
  }
}
```

In `safe` mode, heartbeat packets must not include tester usernames, raw source
text, OCR text, generated legal output, provider prompts/responses, database
URLs, API keys, or raw documents. In `firm_internal` mode, richer diagnostic metadata is acceptable
for trusted firm beta, but secrets remain redacted.

### Product-Journey State Machine

The heartbeat should eventually summarize a simple journey state machine:

```text
login
  -> home
  -> add_new_matter | find_existing_matter
  -> upload_files
  -> prepare_matter
  -> extract_documents
  -> label_sources
  -> build_list_of_dates
  -> write_dispute_story
  -> advisory_ready
  -> copilot_answer | run_skill | submit_feedback
```

The state machine is diagnostic, not a lawyer-facing workflow rule. It helps the
operator and developer answer: "Where did this tester get stuck?"

### Suggested Configuration

Do not introduce tester choices for heartbeat. It should be operator configured:

```text
MWB_PRIVATE_BETA_HEARTBEAT_INTERVAL_SECONDS=300
MWB_PRIVATE_BETA_HEARTBEAT_SYNC_URL=https://...
MWB_PRIVATE_BETA_HEARTBEAT_SYNC_TOKEN=...
MWB_PRIVATE_BETA_INSTALL_ID=...
MWB_PRIVATE_BETA_TELEMETRY_MODE=firm_internal
```

If heartbeat-specific URL/token values are absent, the implementation can fall
back to sibling mothership endpoints derived from the configured metrics,
signal, or feedback endpoint. The product rule is that heartbeat is automatic,
non-blocking, and visible to the operator.

### Success Criteria For This Slice

This slice is successful when the mothership can show:

- last heartbeat per install;
- last user journey per tester;
- current or last active matter per journey;
- failed or slow stage, if any;
- whether the failure appears to be app, provider, storage, auth, network, or
  user-action related;
- whether the app has gone silent;
- whether beta-user patience is at risk.

The tester should not see or manage this telemetry. It exists so the operator
and developer can fix beta issues before they become long phone calls,
screenshots, or forgotten context.

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
9. Add the operator-only observability bundle that links feedback, failed jobs,
   diagnostic signals, and latest backend metrics.
10. Keep screenshots/manual attachments out of the first slice unless a tester
   explicitly requests it.

## Non-Goals

Do not build in the first slice:

- public feedback submission;
- automatic GitHub issue creation;
- roadmap voting;
- user accounts;
- email notifications;
- screenshot auto-capture;
- unsupervised model-generated triage in the tester-facing flow;
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

## Net-New Feature Request Category

Status: Implemented small slice
Date: 2026-06-13

### Problem

The mothership triage router must not treat every tester note as bug-shaped work. A report that says
"please add a dashboard" is not a broken button, and it should not compete with failed extraction,
login issues, or Copilot source-verification bugs in the same mental bucket.

Before this slice, the tester choice `want_something` became `feature_idea`. That was distinct from
`bug`, but the name was soft and easy to confuse with general product feedback. The report also did
not show a direct "feature request" count.

### Decision

Use `feature_request` as the canonical classification for net-new tester asks:

| Classification | Current action lane |
| --- | --- |
| `bug` | `fix_now` / `investigate` |
| `confusing_ux` | `product_decision` |
| `feature_request` | `product_decision` |
| `feature_idea` | `product_decision` (legacy historical rows only) |

This deliberately creates a category distinction, not a new ticketing system. `feature_request` still
lands in `product_decision` for now because the operator should decide whether to scope it for beta or
park it.

Implemented behavior:

- tester label changed from "I want this to do something" to "I want a new feature";
- `services/private-beta-feedback-service.mjs` maps `want_something` to `feature_request`;
- `mothership/report.mjs` counts `summary.featureRequests`;
- `routeTriage` gives `feature_request` its own product-decision recommended action;
- legacy `feature_idea` rows remain readable and stay in `product_decision`.

### Future Product-Backlog Lane

Still parked: if feature-request volume grows, split `feature_request` into a separate
`product_backlog` action lane. That would be the clean seam for a later ticket integration
(Jira/GitHub/Linear), but it should remain a separate explicit product decision.

### Current Test Coverage

- `test/private-beta-feedback-service.test.mjs` verifies `want_something -> feature_request`;
- `test/mothership-report.test.mjs` verifies `feature_request` is separate from bugs and routes to
  `product_decision`;
- `test/mothership-operator.test.mjs` keeps legacy `feature_idea` rows readable;
- `test/react-private-beta-feedback.test.mjs` locks the simpler tester-facing label.

## Intelligent Feedback Triage Router

Status: First server-side slice landed in `codex/feedback-triage-router`
Date: 2026-06-13; updated 2026-06-16

### Problem

The current mothership report router is useful, but still too checklist-shaped.
It mostly trusts:

- the tester's simple choice;
- a few deterministic text matches;
- hard-coded category branches.

That is enough for obvious failures, but not enough for real beta feedback.
Lawyers will write messy natural-language reports:

- "I was trying to understand the case but the answer felt incomplete";
- "Can it also show me limitation dates?";
- "It says source labels are missing but I already ran preparation";
- "This is not a bug, but I expected a way to share this with my junior."

Those examples are not reliably separable by keyword rules. The router should
understand the whole feedback packet and nearby app evidence, not just scan
user text for trigger words.

### Design Direction

Use a hybrid router:

1. **Deterministic safety overrides first.**
   Known hard failures stay rule-owned. Examples: login required, unsupported
   citations, no extraction records, source labels failed, List of Dates failed,
   telemetry sync failed, or a repeated job failure. These should never depend
   on model judgment.

2. **Intelligent classifier second.**
   For everything else, classify the packet using the full structured context:
   tester choice, free text, active screen, route, visible error, recent
   activity, related job status, diagnostic signals, matter name, runtime mode,
   and sync state. The classifier should output structured JSON only.

3. **Conservative fallback.**
   If classification fails, confidence is low, or the model response is
   malformed, route to `investigate`. Do not let an uncertain classifier create
   a `fix_now` claim or a product-roadmap claim.

### Router Inputs

The intelligent pass should receive a compact packet:

```json
{
  "feedback": {
    "choice": "want_something",
    "classification": "feature_request",
    "tryingToDo": "Add deadline calendar",
    "happenedInstead": "I want a week view for filing dates."
  },
  "context": {
    "screen": "activity",
    "route": "/activity",
    "activeMatterName": "Example Matter",
    "visibleError": "",
    "recentActivity": []
  },
  "relatedSignals": [],
  "relatedJobs": [],
  "runtime": {
    "mode": "postgres",
    "installId": "matter-workbench-do-beta-1"
  }
}
```

It should not receive provider secrets, API keys, database URLs, full source
text, full generated legal output, or screenshots by default.

### Router Output

The classifier should return:

```json
{
  "classification": "feature_request",
  "action_lane": "product_decision",
  "confidence": "high",
  "reason": "The tester is asking for a capability that does not currently exist.",
  "recommended_action": "Decide whether deadline calendar belongs in beta scope or product backlog.",
  "missing_evidence": []
}
```

Allowed `classification` values:

- `bug`;
- `confusing_ux`;
- `feature_request`;
- `blocked_workflow`;
- `legal_quality_concern`;
- `operator_note`.

Allowed `action_lane` values for this slice:

- `fix_now`;
- `investigate`;
- `product_decision`;
- `watch`.

Do not add `product_backlog` yet. That lane remains parked until there is a
real backlog/ticket destination.

### Safety Rules

- Deterministic hard-failure overrides win over the classifier.
- A classifier may downgrade or clarify a soft item, but it must not suppress a
  hard runtime signal.
- `fix_now` requires either a deterministic hard signal or high-confidence bug
  classification with concrete related evidence.
- `feature_request` should be distinct from `confusing_ux`. A request for a new
  capability is not the same thing as confusion about an existing capability.
- The tester-facing form remains simple. Do not expose confidence, action lane,
  model reason, or internal categories to the lawyer.
- Store classifier metadata for operators only.

### Implementation Shape

The first server-side slice adds a triage module, not React logic:

```text
services/private-beta-feedback-triage-service.mjs
```

Suggested responsibilities:

- normalize a feedback packet into a bounded classifier input;
- apply deterministic hard-failure overrides;
- call the configured model only when a model pass is useful;
- validate the classifier JSON against allowed values;
- return deterministic fallback on provider failure;
- expose one pure function for report-time triage.

`mothership/report.mjs` should call that service or shared pure helper rather
than growing more regex branches inline.

### Tests To Add

- deterministic unsupported-citation signal stays `fix_now` even if model would
  call it confusion;
- "I want a new deadline calendar" becomes `feature_request`, not `bug`;
- "I cannot find where List of Dates went" becomes `confusing_ux` unless a
  related missing-output signal exists;
- failed source-label job plus vague tester feedback becomes `fix_now`;
- malformed model output falls back to `investigate`;
- low-confidence classifier output falls back to `investigate`;
- feature request does not create a product-backlog lane yet.

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
