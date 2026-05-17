# Future Design Decision: Cost Estimation Framework

Date: 2026-05-13
Status: Parked for later product decision

## Why This Exists

Matter Workbench is moving toward more AI-assisted workflows: source
description, List of Dates, context search, skill idea interviews, future
matter Co-pilot work, and eventually governed configurable skills.

That creates a product obligation: users should not be surprised by AI spend.

The app already has important cost-control primitives:

- paid rerun guardrails;
- provider/model metadata in generated artifacts;
- OpenRouter usage and cost metadata when available;
- local-only context preview/search paths;
- deterministic skill idea capture and readiness gates.

The missing layer is a simple way to answer:

```text
What might this session cost?
What has this matter cost so far?
Which skills are likely to incur paid model calls?
```

This note parks a loose framework for session-level and matter-level cost
estimation. It is intentionally not a billing system.

## Product Principle

Use cost estimates as friction and awareness, not accounting.

The goal is to help the lawyer decide:

- whether to run a paid skill now;
- whether to rerun an already-current artifact;
- whether to choose a faster/cheaper model;
- whether a high-stakes matter justifies a premium model.

The app should avoid pretending it can produce exact bills. Provider pricing,
routing, retries, output length, and endpoint selection can all vary.

## Cost Scopes

### Session Cost

A session is the current browser/server usage window.

Session cost answers:

```text
How much paid AI work has this local session attempted or completed?
```

Useful for:

- active testing;
- beta debugging;
- preventing accidental repeated paid calls;
- showing "you have already run this three times today" style warnings.

Session cost can come from:

- Command rail interaction log;
- in-memory run counters;
- provider responses from this session;
- best-effort server-side JSONL diagnostics.

It may be reset when the app restarts.

### Matter Cost

Matter cost is aggregated from artifacts already written into a matter folder.

Matter cost answers:

```text
What paid AI work has been used to produce this matter's current artifacts?
```

Useful for:

- reviewing spend per matter;
- explaining why one matter was expensive;
- comparing source-description vs chronology vs future skill runs;
- deciding whether to rerun a stale output.

Matter cost should be derived from artifact metadata first, not from a hidden
database.

Examples:

- `10_Library/Source Index.json.ai_run`
- `10_Library/List of Dates.json.ai_run`
- future configurable skill output metadata
- extraction/OCR metadata if the OCR provider reports cost later

## Cost Confidence Levels

Every displayed cost should carry confidence.

### Actual

Use when the provider returned reliable usage cost metadata.

Examples:

- OpenRouter `usage.cost`
- OpenRouter `usage.cost_details`
- provider-returned endpoint/model pricing attached to the run

Display:

```text
Actual provider-reported cost
```

### Estimated

Use when token usage is known but provider cost is not.

Estimate from:

```text
input_tokens * prompt_rate + output_tokens * completion_rate
```

Display:

```text
Estimated from token usage and configured pricing
```

### Planned

Use before a run starts.

Estimate from:

- selected model;
- configured max output tokens;
- approximate prompt size;
- skill type;
- chunk count if known;
- previous runs on this matter if available.

Display:

```text
Pre-run estimate. Actual cost may differ.
```

### Unknown

Use when neither usage nor pricing is reliable.

Display:

```text
Cost unknown
```

Do not invent precision.

## What To Track

At minimum, each paid AI run should record:

- timestamp;
- matter folder;
- skill/task name;
- provider;
- requested model;
- returned model if different;
- returned provider/endpoint if available;
- prompt/input token count if available;
- completion/output token count if available;
- provider-reported cost if available;
- estimated cost if computed;
- cost confidence: `actual`, `estimated`, `planned`, or `unknown`;
- status: success, failed, cancelled, skipped, or dry-run;
- whether artifact was written;
- artifact paths touched;
- rerun confirmation state if applicable.

Do not track:

- API keys;
- `.env`;
- raw source text;
- full extraction records;
- full List of Dates content;
- full prompts unless explicitly required for a separate debug artifact;
- privileged user chat history.

## Session-Level UX

In the short term, session cost can be shown as a lightweight panel or command.

Possible Command rail commands:

```text
cost
show cost
session cost
matter cost
```

Possible display:

```text
Session AI Cost

Completed paid runs: 2
Failed paid attempts: 1
Known actual cost: $0.08
Estimated cost: $0.02
Unknown-cost runs: 0

Most recent paid run:
/create_listofdates
OpenRouter / openai/gpt-4.1
Actual: $0.0708
```

Keep this read-only.

## Matter-Level UX

Matter overview can later show a compact cost row:

```text
AI spend: actual $0.08 + estimated $0.02
```

Clicking it can open a read-only breakdown:

```text
Source labels
- Provider: OpenRouter
- Model: meta-llama/...
- Cost: unknown

List of Dates
- Provider: OpenRouter
- Model: openai/gpt-4.1
- Cost: actual $0.0708
```

For beta, avoid making this too prominent. The first value is awareness, not
financial reporting.

## Pre-Run Warnings

Cost estimation should integrate with rerun guardrails.

When a paid current artifact exists:

```text
/create_listofdates already has a current artifact.
Last run: 13 May 2026
Provider/model: OpenRouter / openai/gpt-4.1
Recorded cost: $0.0708 actual

Run again?
```

For planned expensive operations:

```text
This may use a premium model.
Estimated cost: unknown to $X range.
Proceed?
```

Do not block deterministic/local commands with cost warnings.

## Model Selection Tie-In

Cost should be shown per task policy, not as a generic app setting.

Examples:

- Skill router: low-cost/fast.
- Skill idea capture: no model.
- Skill interview planner: future premium model only when enabled.
- Source descriptions: configured provider/model.
- List of Dates: source-backed analysis policy.
- Future skill authoring: premium/high-reasoning model.

The Settings/Skills tab may later show:

```text
Task                          Model policy          Cost posture
Skill interview capture        Deterministic         Free/local
Skill design review            Premium planned       Paid
List of Dates                  GPT-4.1 via OR        Paid
Context search                 Local packet search   Free/local
```

## Estimation Formula

Use a simple first-pass formula:

```text
estimated_cost =
  (prompt_tokens / 1_000_000) * prompt_price_per_million
  + (completion_tokens / 1_000_000) * completion_price_per_million
```

For OpenRouter, prefer returned usage/cost data when present.

If OpenRouter returns routed endpoint/provider cost metadata, prefer that over
static model-config pricing. Static pricing should be fallback only.

## Data Storage Options

### Option A: Derive From Artifacts First

Read `ai_run` metadata from existing matter artifacts.

Pros:

- no new durable state;
- aligns with current matter-status philosophy;
- easy to explain.

Cons:

- misses failed attempts;
- misses cancelled runs;
- misses session-only experiments;
- only as complete as artifact metadata.

### Option B: Local App-Level JSONL Diagnostics

Extend the beta-only local diagnostics approach with cost fields.

Example:

```text
.local/ai-cost-events.jsonl
```

Pros:

- captures failed/cancelled attempts;
- useful during beta;
- does not pollute matter folders.

Cons:

- not authoritative;
- may be deleted;
- needs privacy discipline.

### Option C: Matter-Level Cost Summary Artifact

Write a matter-local summary such as:

```text
10_Library/AI Cost Summary.json
```

Do not start here.

This risks making cost estimation feel like formal billing/audit before the
data is mature.

## Recommended Phasing

### Phase 1: Read-Only Derived Matter Cost

- Parse existing `ai_run` metadata from current artifacts.
- Show known provider/model/cost confidence.
- No new writes.
- No billing language.

### Phase 2: Session Diagnostics

- Add local ignored `.local/ai-cost-events.jsonl`.
- Record paid AI attempts, provider/model, usage, and cost confidence.
- Keep it beta/debug-only.

### Phase 3: Pre-Run Estimate

- Add planned-cost estimate to rerun warning for paid skills.
- Prefer ranges and confidence labels over exact-looking numbers.

### Phase 4: Settings Visibility

- Show task/model/cost posture in Settings and Skills.
- Allow users to understand why one task is cheap and another is premium.

### Phase 5: Matter Cost Panel

- Add a read-only matter-level cost breakdown if earlier phases prove useful.

## Non-Goals

This parked decision does not authorize:

- billing;
- invoices;
- client-charge allocation;
- formal audit logs;
- storing API keys;
- raw prompt logging;
- raw source text logging;
- blocking all paid work;
- changing provider routing;
- changing model defaults;
- replacing rerun guardrails.

## Open Questions

- Should failed provider attempts count toward displayed session spend if cost
  is unknown?
- Should OCR provider costs be included when available?
- Should local deterministic work show as `Free/local`, or should only paid AI
  be shown?
- Should a high-stakes matter allow a user-defined budget warning?
- Should cost be displayed in USD only, or with a local currency approximation?
- Should cost estimates be shown to all users, or only in beta/developer mode?

## Near-Term Recommendation

Do not implement this immediately unless cost confusion becomes a blocker.

When implemented, start with read-only derived matter cost from current artifact
metadata. Keep the label humble:

```text
AI cost estimate
```

not:

```text
Bill
Invoice
Audit total
```
