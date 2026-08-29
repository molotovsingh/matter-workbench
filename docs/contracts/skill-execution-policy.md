# Skill Execution Policy

Date: 2026-07-15
Status: **Draft v0.2 — under refinement.** Principles P1–P4 adopted. Decided in review: critic pass mandatory (P3), validator rejection persists-as-degraded (P3), enforcement runner-gate-first, duplicate keys server-derived (P1), P4 adopted, storage-agnostic-injection kept as implementation note rather than principle. Remaining open questions at the end.

This contract defines how a skill — native builtin today, custom skills by
extension through the same runner — is invoked, how it runs internally, and
what it must do before its output counts as final.

The core rule is:

```text
a skill is a contract, not a route
start it twice safely, retry it from the job, never finalize unchecked output
```

It complements, and does not replace, `custom-skill-governance.md` (which
governs how custom skills come to exist and change). This policy governs how
any skill *executes*.

## Why This Exists

Quality-pass Run 11 (`claude_review/quality-pass/2026-07-15-de9452f.md`)
found that every serious defect this cycle lived on a *second pass* through a
flow: a retry bound to the wrong matter, a replay fabricating a custody event,
a re-commit dropping its follow-up job, a validator that could not reject.
The first-pass engineering of skills is strong; the contract around
invocation, staging, checking, and replay is what this document pins down.

## P1 — A skill is invoked through a contract, callable by an orchestrator

A skill must be startable by something that is not a human clicking a button:
a route today, the processing-job worker already, any future scheduler or
chained skill tomorrow. That requires a stable invocation contract, **not** a
separate OS process — the native runner is deliberately in-process
(`services/skill-runner-service.mjs`); subprocess isolation reintroduced the
crash/truncation class we eliminated and is a non-goal here.

The contract per skill is one registry entry:

```text
{ slash, kind, label, buildRequest, present, stages, validator, retrySemantics }
```

consumed identically by routes, the queue worker, and any future orchestrator.
Nobody hand-wires a skill into a route again.

Rules:

- **Idempotent start, server-derived (decided 2026-07-15).** The runner
  computes the duplicate-detection key itself — `slash : matter :
  input-fingerprint` — and a start matching an existing active run returns
  that run instead of launching a second. Callers send nothing and cannot
  forget; a double-click, a second tab, or a client retry cannot double-run
  or double-charge. (Run 11 R11-5 found the current client-supplied key is
  accepted, never sent, and ignored.)
- **The job record is sufficient to re-execute.** Retry derives its execution
  context (matter, roots, storage bindings) from the failed job, never from
  the retrying caller's request (Run 11 R11-4).
- **Visibility travels with invocation.** Any read of another run (retry
  source, status) passes the same matter-visibility filter as every other job
  read.

## P2 — A skill runs as staged turns: collect → process → feed forward → repeat

Inside a skill, work proceeds as recorded stages, each producing a durable
intermediate that the next stage consumes. This is the existing house
pattern at its best: posture diagnosis (`build_packet → propose → critique →
finalize`, stage-retryable) and the Case Timeline two-pass runner (candidate
ledger → editor pass, with pass-2 failure salvaging the ledger).

Rules:

- **Stages are durably recorded** (`runRecordedStage` / native-skill-run
  state) so a failed run resumes at the failed stage, not from zero.
- **A stage's record pins its inputs.** Stage reuse on resume is valid only
  while a content fingerprint of its upstream inputs still matches; otherwise
  the stage and everything downstream re-run. (Run 11 found posture resume
  can pair a fresh evidence packet with a draft grounded in the old one.)
- **Stage when there is a real intermediate contract** — something worth
  persisting for salvage or audit (evidence packet, candidate ledger). Do not
  add ceremony stages to single-shot skills.
- **Paid stages fail salvageable.** A provider failure persists what the run
  learned (ledger + error), never discards it.

## P3 — A skill always second-passes its final output before it counts

No skill output is final until a checking pass has run over it. Two tiers,
deliberately distinct, **both mandatory** (decided 2026-07-15):

1. **Deterministic validation — the hard gate.** Schema conformance derived
   from the contract module, citation grounding (every cited handle resolves
   against the evidence actually supplied), calendar-date validity, bounds.
   Server-side, always — provider-side schema enforcement is known
   insufficient (OpenRouter strict mode strips constraints).
2. **Model critic pass — every skill, every run.** A critique turn (posture's
   critic is the template) reviews the final output before finalize. Cost is
   managed through model policy, not through skipping: the critic runs on the
   task-appropriate tier (a cheaper model is acceptable for simple skills;
   `shared/model-policy.mjs` already routes by task), and its findings feed
   the finalizer or land as receipt warnings. The critic can *improve* output;
   only the deterministic tier can *reject* it.

**On rejection, persist as degraded — never publish, never discard.** When
the deterministic validator rejects, the run persists its intermediates and a
degraded/failed receipt carrying the rejection reasons (the two-pass
candidate-ledger salvage philosophy); the artifact is never written as
current, and prior artifacts stay untouched. Paid work survives for retry;
unchecked output never becomes the record.

Rules that keep the second pass honest (each learned from a live failure):

- **The checker derives from the contract, never a parallel list.** Required
  fields come from the schema module (`finalDiagnosisSchema().required`), not
  a hand-copied array — the hand copy drifted one contract version behind and
  passed fixtures missing whole sections (Run 11 R11-24).
- **A validator must be proven able to reject.** Every skill ships a negative
  test: an output the validate stage refuses. A validator with no rejection
  test is decoration.
- **Check-and-surface, never coerce-and-drop.** Malformed model content
  becomes a counted warning in the sidecar/receipt — silent normalization to
  emptiness is forbidden.
- **Coverage loss is output too.** If the packet or renderer truncates or
  drops anything (row caps, dropped citations), the final artifact says so
  (`packet_limits`, warnings) — silent truncation reads as completeness
  (Run 11 R11-21).
- **Every output path second-passes, including siblings.** A guard that Ask
  mode applies and research mode skips is not a guard (Run 11 R11-19).
  Enforcement lives in the runner (see Enforcement), so a new route cannot
  opt out.

## P4 — The second-time-through semantics are part of the contract

*(Adopted 2026-07-15. Sourced from Run 11 evidence; both of that run's P1s
lived on replay paths.)*

A skill declares, explicitly, what happens:

- **On re-run over existing output** — overwrite guard + archive-before-
  overwrite (already house standard; keep).
- **On retry after failure** — which stages reuse (per P2 fingerprints),
  what the receipt records.
- **On concurrent/duplicate invocation** — idempotency key behavior (per P1).
- **On replayed mutations** — side effects fire only on state *transition*,
  never on state *existence*: a replay must not append events, re-stamp
  currentness, or double-write artifacts (the custody-event fabrication bug,
  Run 11 R11-1, is the canonical violation).
- **On stale upstream inputs** — the dependency-state classification the
  skill participates in (`dependency-states-and-staleness.md`).

**Implementation note (not a principle of this policy, decided 2026-07-15):**
skill services stay storage-agnostic by injection — one body taking
`artifactReader / artifactStatReader / artifactWriter`, serving filesystem
and runtime-DB modes alike (the posture and MW LOD pattern). All five
builtins already conform; keep it that way, but it is documented by example
rather than legislated here.

## Current conformance (at `de9452f`)

| Skill | P1 contract | P2 stages | P3 second pass | P4 replay |
|---|---|---|---|---|
| procedural_posture_diagnosis | ◐ registry entry exists; dup key ignored | ✅ 4 stages, retryable | ⚠️ critic ✅, validator presence-only + version-behind | ◐ stage reuse lacks input pins |
| create_mw_listofdates | ◐ same | ✅ layered load→preflight→packet→validate→persist | ⚠️ real deterministic gate; no critic; silent 120-row truncation | ◐ overwrite guard ✅ |
| create_listofdates (Case Timeline) | ◐ same | ✅ two-pass, salvageable ledger | ⚠️ hydration/citation checks; no critic; unconditional soften rewrites | ◐ |
| the_story | ◐ same | — single-shot (acceptable per P2) | ✗ no validator, no critic | ◐ |
| describe_sources | ◐ same | ◐ batch→stage mapping; reporter can strand | ✗ none | ◐ |

With the critic pass now mandatory, only posture conforms to P3 tier 2 today;
the other four adopt it as they migrate onto the enforced registry.

## Enforcement

Principles become mechanical, or they decay. **Sequencing decided
2026-07-15: the runner gate lands first**, in the same change family as the
Run 11 routes/runner queue (R11-3 table-driven dispatch, R11-4 retry
rebinding, R11-5 idempotency) — structural from day one, so sibling paths
never get a window to bypass it.

1. **Registry-declared, runner-enforced.** The skill registry entry declares
   `stages`, `validator`, `critic`, `idempotency`, `retrySemantics`. The
   runner refuses to finalize a run whose declared validator did not pass or
   whose critic did not run, refuses duplicate keyed starts, and rebuilds
   retries from the job. Sibling paths cannot bypass what the runner
   enforces.
2. **A shared contract-test harness** every skill runs through:
   validator-rejects (negative case), stage-retry-with-changed-inputs,
   double-start with one key, retry-matter-pinning, replay-produces-no-
   side-effects.
3. **This document is pinned** the way `source-custody-removal-contract-doc`
   is — a doc test asserts the core rules stay present, and the
   future-decisions ledger links it.

## Non-goals

- Not process isolation, not a language migration, not a rewrite of working
  skills. Adoption is incremental: new skills conform on arrival; existing
  skills conform as the Run 11 queue items land (R11-3/4/5 deliver most of P1
  mechanically).
- Not custom-skill lifecycle governance — that stays in
  `custom-skill-governance.md`; custom skills inherit *this* policy at
  execution time through the same runner.

## Decisions log

- **2026-07-15 · Critic pass mandatory for every skill** (P3 tier 2). Cost
  managed via model-policy tiering, not skipping. Only the deterministic tier
  rejects; the critic improves.
- **2026-07-15 · Validator rejection → persist-as-degraded.** Intermediates +
  degraded receipt with reasons; artifact never published as current.
- **2026-07-15 · Enforcement is runner-gate-first**, landing with the Run 11
  R11-3/4/5 fixes.
- **2026-07-15 · Duplicate-detection key is server-derived**
  (`slash:matter:input-fingerprint`); callers send nothing.
- **2026-07-15 · P4 adopted; storage-agnostic injection demoted** to an
  implementation note (house pattern by example, not policy).

## Open questions (refining now)

1. **Input fingerprints on all stages, or paid stages only?** Full pinning is
   more correct; paid-only is cheaper to land.
2. **Does P4's transition-not-existence rule extend beyond skills** to every
   mutation service (it is the R11-1 fix generalized) — i.e., does it belong
   here or promoted into `matter-mutation-inventory.md`?
