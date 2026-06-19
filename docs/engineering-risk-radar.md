# Matter Workbench Engineering Risk Radar

Date: 2026-06-18

Status: Current engineering advisory, not a product contract

This note records the recurring engineering risks that are worth keeping visible
while Matter Workbench moves through the private beta line. It is intentionally
plain-spoken. These are not proof that the app is broken; they are the areas
where bugs are most likely to hide if we stop paying attention.

## Why This Exists

Matter Workbench is no longer in the "one obvious giant mess" phase. The large
boundaries are improving: React is the product UI, runtime DB is the hosted
path, upload intake has a shared contract, and telemetry is much richer.

The next quality risk is subtler:

```text
small duplicated decisions -> quiet drift -> beta-only bugs
```

That is the risk this page is meant to keep in front of us.

## Source And Process Material

The risk radar is allowed to start from engineer instinct. A "vibe" can be a
real signal when it comes from repeated debugging, code review, beta incidents,
or the feeling that a change is harder to explain than it should be.

But vibe is not enough by itself.

Use it as source material, then convert it into process material:

```text
vibe -> concrete signal -> risk hypothesis -> file/test/runtime evidence -> radar item
```

Examples:

- "This feels too clever" becomes a search for duplicated policy, hidden state,
  or tests that assert implementation details instead of behavior.
- "This feels noisy" becomes a check for logs, health warnings, retry loops, or
  telemetry that could train operators to ignore real failures.
- "This feels like it will fork" becomes a search for the same decision copied
  across frontend, backend, runtime DB, and docs.
- "This feels release-fragile" becomes a check of branch state, tag state,
  pushed state, deployed commit, and smoke evidence.

The useful skill is not suppressing instinct. The useful skill is reverse
engineering the instinct into a claim that another engineer can inspect, falsify,
or turn into a small refactor.

The North Star design philosophy names this as the tension between geometric and
algebraic thinking: first notice the shape of the system, then express the rule
that makes the shape safe. Risk-radar work should use both.

## Current Signals That Bother Us

### 1. Dirty release-line work needs deliberate closure

The checkpoint branch can be clean, tested, and deployed one moment, then carry
new local work the next. That is normal during active development, but it should
never be confused with release readiness.

Rule of thumb:

- uncommitted changes are development work;
- committed but unpushed changes are local evidence only;
- pushed commits are preserved;
- deployed commits are the only live-beta truth.

Before any "ready" claim, check branch status, tags, pushed state, and deployed
commit separately.

### 2. Provider startup checks are useful but must stay non-blocking

Startup AI checks can catch bad Copilot/provider configuration before a tester
hits it. That is valuable.

The risk is operational noise:

- startup latency;
- quota surprises;
- false warnings during temporary provider outages;
- logs that look scarier than the actual app state.

Keep these checks bounded, redacted, non-blocking, and clearly framed as health
signals rather than startup gates.

### 3. Model/provider policy must not fork in tiny helper copies

Small duplicated helpers are now more dangerous than large obvious files. A
good example is provider/model request policy such as whether a model supports
`temperature`.

If that rule appears in two places, it can drift:

- Settings may say a route is healthy;
- Copilot may call the same route differently;
- System Health may report the wrong operational posture.

Prefer one shared policy helper for model-route behavior, then use it from
settings, provider clients, health checks, and tests.

### 4. `runtime-db-storage-service.mjs` is still a gravity well

The runtime DB storage service has improved. Upload intake planning, upload
materialization, object-key policy, artifact policy, workspace read models, and
query helpers have all moved toward better boundaries.

But the service is still a central orchestration point. New runtime DB behavior
still tends to reach for it first.

The next refactors should stay incremental:

- extract named policy or mapping helpers;
- add contract tests at each extracted boundary;
- avoid a large rewrite that changes storage behavior and service shape at the
  same time.

### 5. Mothership reports are becoming a decision engine

The `whatHappened` packet and feedback status-disposition work are valuable.
They move the system from "tester said something" to "tester said something,
the app saw nearby evidence, and here is whether it is still actionable."

The risk is density. Report code can quietly become a second product brain.

Watch for these extraction points:

- status disposition;
- related runtime evidence matching;
- summary packet construction;
- redaction and bounding rules.

When any of those grow, move them into small helpers with focused tests rather
than letting `mothership/report.mjs` become another oversized service.

### 6. Embedded worktrees and generated folders pollute local scans

Local quality scans can get noisy when temporary worktrees, `node_modules`, or
tool snapshots sit inside the repo tree.

This wastes time and can distort simple metrics like "largest files" or grep
counts.

Prefer external sibling worktrees. Keep ignored generated files ignored, but do
not rely on `.gitignore` alone for engineering judgment.

### 7. Temporary DB materialization is a bridge, not the end-state

The hosted beta is DB-backed, but several legal engines still run through a
temporary materialized matter folder and then persist outputs back to Postgres.

That is acceptable for private beta because it preserves existing engines and
lets runtime DB custody advance without rewriting every workflow at once.

Do not forget the boundary:

- temporary folders are scratch;
- Postgres/runtime storage is the authority;
- future worker-native engines should reduce reliance on materialized disk.

## Current Best Next Move

The best next quality move is not a sweeping rewrite.

It is to keep extracting repeated policy decisions before they fork:

1. centralize small model/provider policy helpers;
2. keep runtime DB extractions narrow and test-backed;
3. split mothership report decision helpers when they grow;
4. keep release-readiness claims tied to branch, tag, pushed state, deployed
   commit, and live smoke evidence.

## How To Use This Page

Use this page during planning and review when a change feels small but touches
shared behavior.

Good questions:

- Is this rule already expressed somewhere else?
- Is this a product contract, a health signal, or a temporary bridge?
- Is this code making a decision, or only displaying a decision from another
  layer?
- Would a beta bug here show up in telemetry with enough context to fix it?

If the answer is unclear, the change probably needs a small contract/helper
before it needs more feature code.
