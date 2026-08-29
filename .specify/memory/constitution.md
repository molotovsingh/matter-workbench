<!--
SYNC IMPACT REPORT
Version change: (none) → 1.0.0
Rationale: Initial ratification. No prior constitution existed; this codifies rules
already observable in the repository rather than introducing new ones.

Principles defined:
  I.   Simple Surface, Rigorous Spine
  II.  Never Invent Into The Legal Record (NON-NEGOTIABLE)
  III. Fail Closed
  IV.  Evidence Before Claims
  V.   Invariants Must Be Executable

Sections added:
  - Legal Record And Custody Constraints
  - Development Workflow And Release Discipline
  - Governance

Sections removed: none (initial version)

Template alignment:
  ✅ .specify/templates/plan-template.md — "Constitution Check" derives gates from this
     file at plan time; placeholder is intentionally generic, no edit required.
  ✅ .specify/templates/spec-template.md — no mandatory section added or removed by this
     constitution, no edit required.
  ✅ .specify/templates/tasks-template.md — principle-driven task types (evidence,
     fail-closed paths, executable invariants) fit existing categories, no edit required.
  ✅ .specify/templates/commands/ — directory not present in this installation.

Deferred items: none. RATIFICATION_DATE is the adoption date of this constitution,
not of the underlying practices, which predate it.
-->

# Matter Workbench Constitution

## Core Principles

### I. Simple Surface, Rigorous Spine

The lawyer-facing surface MUST stay calm and legible while the machinery beneath stays
auditable and conservative. Complexity belongs in the spine, never pushed onto the user.
When an implementation constraint forces a trade-off, the surface is simplified and the
exception recorded — the spine is not weakened to make the surface easier.

A change that simplifies the UI by weakening a legal-output rule is wrong by definition.

### II. Never Invent Into The Legal Record (NON-NEGOTIABLE)

The system MUST NOT fabricate content, identifiers, or confidence into anything a lawyer
may rely on or cite.

- No placeholder or synthesized text may enter an extraction record.
- Durable identifiers (`FILE-NNNN` and equivalents) MUST be matched to existing
  registrations, never allocated to make an import succeed.
- Every claim MUST remain traceable to raw `FILE-NNNN pX.bY` evidence.
- Existing valid output MUST NOT be silently overwritten; ties resolve in favour of the
  record that already exists so citations stay stable.
- Where data is missing or unreadable, the correct behaviour is to leave the work for a
  path that can do it honestly — not to fill the gap.

### III. Fail Closed

When the system cannot safely continue, it MUST stop loudly rather than degrade quietly.

- Invalid, incomplete, or truncated provider output MUST NOT be persisted as partial
  legal output.
- Readiness, authorization, and certification checks MUST fail closed on missing or
  unverifiable evidence.
- A failure MUST tell the user what stopped and what to do next, and MUST leave the
  technical evidence recoverable by an operator.
- Silent fallback that produces a plausible-looking wrong answer is never acceptable.

### IV. Evidence Before Claims

A capability is not certified because it was built. It is certified because evidence says
so.

- Gate status MUST reflect measured evidence, not implementation progress. "Not certified"
  is the correct state until evidence exists.
- Documentation MUST NOT assert readiness that deployment or test evidence does not
  support. Broad claims such as "production ready" require evidence using that exact
  scope.
- Tooling that evaluates a gate does not satisfy the gate.
- Evidence gathered against an unrepresentative configuration MUST be labelled as such
  rather than counted.

### V. Invariants Must Be Executable

A rule that is only written down will drift. Architectural boundaries and correctness
rules MUST be enforced by tests that fail when the rule is broken.

- Isolation and deployment boundaries MUST have executable gates.
- When a boundary is deliberately relaxed, its gate MUST be rewritten to assert the new,
  true posture — never deleted, because deletion makes the change invisible.
- Behaviour shared across storage modes or adapters MUST be proven identical by tests
  that exercise every mode, not by inspection.
- A bug fix MUST come with a test that fails before it and passes after.

## Legal Record And Custody Constraints

These constraints hold regardless of feature, surface, or storage mode:

- **Source identity.** Raw source bytes remain identifiable and auditable. Content is
  addressed by digest; a digest mismatch is a custody failure, not a warning.
- **Citation truth.** Generated work is never final legal work. Outputs remain traceable,
  reviewable, and clearly attributed to their evidence.
- **No silent mutation.** Durable artifacts and skills are not changed underneath the
  user without an explicit, recorded action.
- **Tenant and matter isolation.** Cross-tenant and cross-matter access fails closed.
  Isolation is enforced at the data layer, not only in application code.
- **Recoverability.** Technical detail may be hidden by default but MUST remain
  recoverable for audit and operator diagnosis.
- **Retention honesty.** Removal from the active record MUST NOT be described as deletion
  of retained bytes unless that is what occurred.

## Development Workflow And Release Discipline

- **Deployed code MUST be knowable.** For any deployment it MUST be possible to state
  which commit is running, whether it is an official release or a maintenance checkpoint,
  and what evidence supports it. `docs/release-policy.md` governs the tiers and is
  binding.
- **Release tier is determined by user-visible effect, not by effort.** When the choice
  between an official release and a maintenance checkpoint is ambiguous, the higher tier
  applies.
- **Rollback targets MUST be real.** A recorded rollback target is the commit that was
  actually deployed, not the most recent tag, and MUST NOT silently regress live
  behaviour.
- **Gates before ceremony.** The verification set appropriate to the change MUST pass
  before deployment, and deployment evidence MUST be recorded rather than assumed.
- **Scope discipline.** Changes MUST stay within what the task requires. Refactors,
  abstractions, and compatibility shims are not added speculatively.
- **Unexpected state is investigated, not cleared.** Unfamiliar files, directories, or
  configuration encountered during operational work MUST be surfaced rather than deleted
  as an obstacle.

## Governance

This constitution supersedes ad-hoc practice. Where it conflicts with a more specific
written contract in `docs/contracts/` or an equivalent binding document, the more specific
contract controls, and the conflict MUST be recorded so one of the two can be corrected.

**Amendment procedure.** Amendments require a written rationale, an explicit version bump,
and propagation to any dependent template or runbook affected by the change. Amendments
that weaken a principle MUST state what replaces the guarantee being given up.

**Versioning policy.** Semantic versioning applies to this document:

- **MAJOR** — a principle is removed or redefined in a backward-incompatible way.
- **MINOR** — a principle or section is added, or guidance is materially expanded.
- **PATCH** — clarification, wording, or non-semantic refinement.

**Compliance review.** Work that touches legal output, custody, extraction, storage mode,
isolation, or deployment posture MUST be checked against these principles before it lands.
Violations are either fixed or recorded as an explicit, justified exception with a
follow-up — never left implicit.

**Version**: 1.0.0 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-08-29
