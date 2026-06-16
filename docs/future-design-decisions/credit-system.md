# Future Design Decision: Credit System

Date: 2026-06-16
Status: Shadow metering in progress
Branch: `codex/credit-metering-shadow`

## Summary

Matter Workbench should eventually support organisation-level credits, user
limits, and matter budgets for provider-backed legal work. The first
implementation is deliberately shadow-only: it estimates what product credits
would have been used without blocking users, charging money, or changing model
routing.

The credit system separates three ledgers:

```text
provider_runs / cost_events -> technical spend evidence
credit_ledger               -> product credit accounting
billing provider            -> later real-money collection
```

`cost_events` must not become the billing ledger. It records provider cost and
usage evidence. `credit_ledger` records product-level commercial events such as
grants, reservations, debits, releases, refunds, adjustments, and shadow debits.

## Current Shadow Slice

Implemented shadow primitives:

- `shared/credit-policy.mjs` maps current AI tasks and provider-run classes to
  stable shadow SKUs.
- `db/migrations/019_credit_ledger.sql` creates tenant-scoped credit tables.
- `services/credit-shadow-planner.mjs` converts provider-run/cost evidence into
  shadow credit rows.
- `scripts/db-credit-shadow-report.mjs` prints a no-write report.

The report command is:

```bash
npm run db:credits:shadow:report
npm --silent run db:credits:shadow:report -- --json
```

Use the `npm --silent` form for machine-readable JSON so npm's banner text does
not contaminate stdout.

It does not write database rows. Failed, started, cancelled, or unclassified
provider runs are reported for policy review but are not counted as shadow
debits.

## Initial Shadow SKUs

| Surface | SKU | Credits | Notes |
| --- | --- | ---: | --- |
| Deterministic/local work | `deterministic.local` | 0 | Not credit-metered. |
| Skill router | `router.light` | 0 | Cheap routing; not charged in the first shadow policy. |
| Skill interview planner | `skill_interview.planner` | 2 | Only when model-backed planner is used. |
| Source labels | `source_description.standard` | 3 | Initial fixed per-run shadow price. |
| List of Dates/source-backed analysis | `source_backed_analysis.premium` | 12 | Premium legal-analysis route. |
| Matter Copilot answer | `copilot.answer` | 1 | Interactive per-answer unit. |
| Skill sample output | `skill_sample_output.review` | 3 | Review sample, not skill creation. |
| Configurable skill run | `configurable_skill_run.standard` | 6 | Provider-backed run over matter context. |
| Skill authoring/modification | `skill_authoring.premium` | 10 | Future premium creation/modification route. |
| Unknown AI task | `unknown.ai` | 0 | Requires policy review; no automatic charge. |

These numbers are not final pricing. They are stable units for observing usage.

## Database Shape

`019_credit_ledger.sql` adds:

```text
credit_accounts
credit_grants
credit_reservations
credit_ledger
```

The first supported account type is the organisation/tenant pool:

```text
credit_accounts.account_type = 'tenant_pool'
```

The schema is ready for later overlays:

```text
user_limit
matter_budget
```

Every write path uses:

```text
unique (tenant_id, idempotency_key)
```

The ledger also constrains event signs: grants/releases/refunds are positive,
reserves/debits/shadow debits are negative, and adjustments cannot be zero.

This is mandatory before enforcement because retries and double-clicks must not
double-charge credits.

## Enforcement Posture

Current branch:

```text
shadow only
```

Later enforcement should follow this flow:

```text
estimate -> reserve -> provider call -> commit debit or release/refund
```

Do not enforce balances until:

1. live provider-run recording is authoritative;
2. shadow reports look sane on real beta usage;
3. failed/cancelled/refund semantics are approved;
4. admin-visible budgets exist;
5. product copy makes credits predictable for lawyers.

## Provider Fallback Relationship

Credits should price the approved route tier, not whichever backend provider was
used. For example, a premium chronology can remain one fixed credit price even
if an approved standby provider route is used after primary provider failure.
The artifact and ledgers should still record:

```text
actual provider
actual model
fallback reason
policy version
cost confidence
```

Avoid arbitrary provider fallback for lawyer-facing work. Use app-owned,
pre-certified fallback routes only.

## Privacy Rules

Credit metadata must not store:

- API keys;
- prompts;
- raw uploaded source text;
- generated legal work product;
- full matter context packets;
- privileged chat history.

It may store:

- tenant/user/matter identifiers;
- job/provider run identifiers;
- provider/model names;
- task/SKU;
- credit deltas;
- provider usage/cost numbers;
- policy versions;
- status/failure codes.

## Next Steps

1. Keep this branch isolated from Beta 3 release work.
2. Use `db:credits:shadow:report` against hydrated shadow evidence.
3. Add runtime provider-run recording before any credit enforcement.
4. Add admin-only summaries before user-facing credit balances.
5. Add real payment integration last.
