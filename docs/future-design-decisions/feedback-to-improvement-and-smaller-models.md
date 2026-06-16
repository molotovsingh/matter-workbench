# Future Design Decision: Feedback-To-Improvement And Smaller Models

Date: 2026-06-16
Status: Parked future feature

## Summary

Matter Workbench should eventually turn real beta usage into two disciplined
learning loops:

```text
feedback + traces + observability
  -> structured evidence
  -> gated improvement work
  -> verified product changes
```

and:

```text
redacted traces + outcomes + human labels
  -> evals / datasets / routing policies
  -> smaller specialised models
  -> lower enterprise inference cost
```

This is directionally RLHF-like, but for product operations and enterprise cost
control. It must be gated, auditable, and privacy-preserving. Feedback should
not directly auto-build features.

## Limb 1: Feedback To Gated Product Improvement

The mature loop should be:

```text
tester feedback
  -> deterministic/system evidence packet
  -> triage lane
  -> ticket or backlog item
  -> human approval
  -> scoped implementation plan
  -> agent/developer execution
  -> tests/evals
  -> review
  -> deploy
  -> observe whether the feedback resolved
```

For Matter Workbench this means:

- tester intake stays child-simple;
- operator/mothership reports preserve evidence and triage lanes;
- repeated or high-confidence issues can become tickets;
- legal/product-risk work needs human approval before implementation;
- agent work starts only after scope, acceptance criteria, and tests are clear;
- deployment is followed by observable resolution checks.

This is not a public roadmap-voting system. It is a controlled product
improvement pipeline.

## Limb 2: Observability To Smaller Models And Cost Reduction

Matter Workbench can later use operational traces and human-reviewed outcomes to
reduce dependence on expensive general-purpose models for routine decisions.

Safer candidate uses:

- feedback triage classifiers;
- workflow intent routing;
- failure prediction;
- cost/latency route selection;
- UX next-step suggestions;
- matter-preparation readiness classifiers;
- synthetic or metadata-only evals;
- redacted trace summary models.

The goal is not to train legal reasoning on client matter documents. The goal is
to make narrow operational decisions cheaper, faster, and more reliable.

## Data Governance Boundary

Do not train on or export raw client documents, privileged legal work product,
prompts, chat history, provider secrets, or full matter context packets unless a
future governance contract explicitly permits it.

Preferred training/eval inputs are:

- redacted feedback summaries;
- structured event metadata;
- job status and failure classes;
- triage lanes and human dispositions;
- latency/cost/routing metadata;
- synthetic examples derived from product behavior;
- explicit human labels that do not expose legal work product.

Any future dataset must declare:

- source tables/events;
- redaction rules;
- consent/tenant isolation posture;
- retention period;
- allowed model/task use;
- evaluation and rollback plan.

## Relationship To Current Work

Current Beta 3 work only provides first primitives:

- private beta feedback capture;
- mothership/operator reports;
- deterministic feedback triage lanes;
- System Health;
- job and command failure signals;
- shadow cost/credit evidence.

Those primitives are observability inputs, not permission to automate product
work or train models.

## Non-Goals For Now

Do not implement yet:

- Jira/Linear ticket creation;
- autonomous feature implementation from feedback;
- automatic prioritisation without operator approval;
- training or fine-tuning on client documents;
- cross-tenant datasets;
- user-visible model-personalisation claims;
- billing enforcement based on learned cost models.

## Revisit Triggers

Revisit after:

1. beta feedback volume is high enough that manual triage is a bottleneck;
2. mothership evidence packets are trusted and useful;
3. repeated issue classes have clear resolution labels;
4. the team has chosen a ticketing destination;
5. data governance and tenant isolation are explicit;
6. model-routing/cost pressure is measurable.

## First Safe Slice Later

The first implementation slice should be read-only:

1. export a redacted feedback/evidence packet suitable for a human-created
   ticket;
2. add optional operator fields for disposition and resolution status;
3. produce eval rows for triage quality without sending data to a model;
4. measure whether fixed issues stop recurring after deployment.

Only after that should the app consider ticket API writes or specialised model
training.
