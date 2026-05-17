# Future Design Decision: System Health Surface

Date: 2026-05-17
Status: Parked future feature

## Why This Exists

The current Developer attention surface is deliberately matter-level. It answers:

```text
For this matter, what looks broken or risky right now?
```

That is not the same as system health.

System health should answer:

```text
Is the app itself configured, connected, writable, and operational?
```

Without this distinction, app-wide failures can look like matter-specific
failures. For example, if the OpenRouter key is missing, every matter may fail
source labeling, but the root problem is system configuration. If matters home
is unreadable, no matter lifecycle diagnostic can be trusted.

## Product Boundary

Use two separate surfaces:

| Surface | Question | Audience | Scope |
| --- | --- | --- | --- |
| Matter Attention | What is broken in this matter? | Developer/operator | Active or named matter |
| System Health | What is broken in the app/runtime setup? | Developer/operator, settings admin | Whole local workbench |

Do not merge these into one score.

Matter Attention may point to a system issue when the same failure repeats
across matters, but the system-level explanation should live in System Health.

## Candidate First Contract

Future endpoint:

```text
GET /api/system-health
```

Future schema:

```text
system-health/v1
```

Future CLI:

```sh
npm run system-health:report
```

The first implementation should be read-only. It should not run skills, call
providers for expensive probes, mutate config, or write matter artifacts.

## Initial Checks

Configuration:

- matters home configured;
- matters home exists and is readable;
- matters home is writable where required;
- app `.env` can be parsed;
- no obvious secret exposure in public config responses.

Provider posture:

- OpenAI direct key configured when direct model routes are enabled;
- OpenRouter key configured when OpenRouter routes are enabled;
- provider/model settings resolve through model policy;
- configured routes fail closed where required;
- optional cheap connection probes remain explicit and bounded.

Runtime and routes:

- local server is responding;
- key API routes return shaped errors, not raw stack traces;
- invalid JSON returns client errors, not server errors;
- recent command failures show whether failures are clustered globally or tied
  to one active matter.

Storage and artifacts:

- app-local stores are readable JSON;
- app-local stores can be written atomically;
- command interaction log is readable;
- custom-skill stores are readable;
- matters home scan does not throw.

Cross-matter signals:

- repeated source-label failures across many matters;
- repeated provider failures across many matters;
- repeated filesystem permission errors;
- repeated malformed artifact reads after app updates;
- high count of blocked matters from Matter Attention sweep.

## UI Placement

The Settings page is the natural first UI surface.

The header can keep a short readiness line:

```text
All systems ready
```

or:

```text
System health needs attention
```

The detailed report should be collapsed by default. Lawyers should not have to
read provider routing tables or store diagnostics unless they are administering
the app.

## Relationship To Matter Attention

System Health consumes aggregate signals; it does not replace per-matter
attention.

Expected flow:

```text
Matter error happens
  -> Matter Attention explains the matter-local symptom
  -> System Health explains whether the app/runtime is broadly unhealthy
```

Examples:

- One matter has missing `Source Index.json`: Matter Attention.
- Ten matters fail source labeling with provider authentication errors: System
  Health.
- One matter has a failed extraction row: Matter Attention.
- Matters home is not writable: System Health.
- One custom skill run has warnings: Matter Attention.
- All provider-backed commands fail after a config change: System Health.

## Non-Goals

This future feature should not become:

- a lawyer-facing legal readiness score;
- a replacement for Matter Attention;
- a background monitoring daemon in the first slice;
- a full log warehouse;
- a bug tracker with assignments and comments;
- a provider-cost dashboard.

Cost visibility is related but separately parked in
[Cost Estimation Framework](cost-estimation-framework.md).

## First Useful Slice

When implemented, start with:

1. `GET /api/system-health`.
2. A read-only `system-health/v1` response.
3. Settings-page compact readiness status.
4. CLI report for local debugging.
5. Tests proving provider/config/filesystem failures are reported as system
   health issues, not matter lifecycle issues.

Only after that should the app consider persisted history, acknowledge/resolve
states, or cross-session monitoring.
