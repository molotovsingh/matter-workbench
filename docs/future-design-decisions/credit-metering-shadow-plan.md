# Credit Metering Shadow Plan

Date: 2026-06-16
Status: Shadow implementation branch / no enforcement
Branch: `codex/credit-metering-shadow`
Base: `8a27c8f Extract runtime DB object key policy`

## Purpose

Matter Workbench will likely need credits for later monetisation across users,
matters, and organisations. This work should not distract the Beta 3 line. The
first credit slice should therefore run in a separate worktree and stay
shadow-only: measure and rehearse what would be charged without blocking users,
changing provider routing, or creating billing obligations.

This plan keeps three concepts separate:

```text
provider_runs / cost_events = technical evidence of provider spend
credit_ledger               = commercial product accounting
billing/payments             = later external money movement
```

Do not use `cost_events` as the billing ledger. Treat it as evidence feeding a
future credit ledger.

## Non-Goals For This Branch

- No real-money billing.
- No Stripe/Razorpay/payment gateway integration.
- No hard blocking when credits are low.
- No user-facing depletion counters by default.
- No arbitrary OpenRouter fallback enablement.
- No changes to Beta 3 upload/runtime-storage/release behavior.
- No raw prompt, source text, work-product, `.env`, or provider key logging.

## Existing Foundations

The current codebase already has useful primitives:

- tenant/user/org foundations:
  - `tenants`
  - `users`
  - `tenant_memberships`
  - `matter_memberships`
  - `tenants.account_scope`
  - `tenants.organization_slug`
  - `tenants.max_member_count`
  - `tenants.primary_owner_user_id`
- provider and spend evidence:
  - `provider_runs`
  - `cost_events`
  - `processing_jobs`
  - `audit_events`
- AI run metadata in artifacts and receipts:
  - Source Index `ai_run`
  - List of Dates `ai_run`
  - skill sample `ai_run`
  - configurable skill run receipts
- shadow hydration scripts:
  - `db:provider-runs:hydrate:dry-run`
  - `db:costs:hydrate:dry-run`
  - `db:shadow:report`

The missing product layer is an idempotent credit ledger and a policy that maps
AI work to product credits.

## Design Principles

1. **Shadow first.** Record what would have happened before charging anyone.
2. **Ledger first.** Use append-only ledger rows; balances are projections or
   cache, not the source of truth.
3. **Idempotency everywhere.** Every reserve/debit/release/refund needs a stable
   `idempotency_key` unique per tenant.
4. **Credits are not provider cost.** A 12-credit chronology can remain 12
   credits even if the approved standby provider was used.
5. **Audit provider route.** Artifacts and ledgers should record provider,
   model, policy version, fallback reason, and cost confidence where available.
6. **No legal-work-product leakage.** Credit metadata must not store prompts,
   source text, generated legal output, or raw user chat.
7. **Per-org first, per-user/matter controls later.** The org pool is the
   commercial anchor; user and matter limits are governance overlays.

## Proposed Architecture

```text
AI task runs
   |
   v
provider result metadata
   |
   v
provider_runs + cost_events        existing technical evidence
   |
   v
credit policy resolver             maps task/route/status to credits
   |
   v
credit shadow planner              reserve/debit/refund/release plan
   |
   v
credit_ledger                      append-only commercial ledger
   |
   v
admin reports / future enforcement
```

## Phase 0 — Planning Worktree

Done by this plan:

```bash
git worktree add ../matter-workbench-credits -b codex/credit-metering-shadow
```

Keep this branch isolated from Beta 3 release work.

## Phase 1 — Static Credit Policy, No DB Writes

Implemented in this branch:

```text
shared/credit-policy.mjs
test/credit-policy.test.mjs
docs/future-design-decisions/credit-system.md
```

The policy should answer:

```js
resolveCreditPolicy({
  task,
  provider,
  model,
  routeTier,
  artifactFamily,
  operation,
});
```

Suggested output shape:

```js
{
  policyVersion: "credit-policy/v0-shadow",
  sku: "list_of_dates.premium",
  chargeMode: "per_run",
  plannedCredits: 12,
  minimumCredits: 12,
  maximumCredits: 12,
  chargeOn: "usable_output",
  refundOn: ["failed_before_provider", "cancelled_before_provider"],
  notes: "Shadow-only initial price; not a bill."
}
```

Initial task map should be deliberately simple:

| Task / surface | Initial credit posture |
| --- | ---: |
| deterministic commands | 0 |
| source description batch/run | shadow only, small fixed unit |
| List of Dates / source-backed analysis | shadow only, premium fixed unit |
| Matter Copilot answer | shadow only, low fixed unit |
| skill sample output | shadow only, medium fixed unit |
| configurable skill run | shadow only, medium/premium fixed unit |
| skill authoring / future build | shadow only, premium fixed unit |

Do not expose this as billing.

## Phase 2 — Credit Ledger Migration

Implemented in this branch:

```text
db/migrations/019_credit_ledger.sql
test/database-credit-ledger-migration.test.mjs
```

Minimum tables:

```text
credit_accounts
credit_grants
credit_reservations
credit_ledger
```

### `credit_accounts`

Purpose: the account whose balance is projected. Start with tenant/org accounts.

Suggested fields:

```text
id uuid primary key
tenant_id uuid not null references tenants(id)
account_type text check in ('tenant_pool', 'user_limit', 'matter_budget')
user_id uuid null references users(id)
matter_id uuid null references matters(id)
status text check in ('active', 'suspended', 'closed')
currency text not null default 'MWB_CREDIT'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Initial branch can implement only `tenant_pool`; keep `user_limit` and
`matter_budget` as schema-ready but not runtime-enforced.

Important constraints:

```text
unique active tenant_pool per tenant
user_id must be set for user_limit
matter_id must be set for matter_budget
```

### `credit_grants`

Purpose: monthly grants, beta grants, admin top-ups, promotional allowances.

Suggested fields:

```text
id uuid primary key
tenant_id uuid not null references tenants(id)
account_id uuid not null references credit_accounts(id)
credits numeric not null check (credits > 0)
grant_type text check in ('beta_seed', 'monthly_plan', 'admin_adjustment', 'promo', 'migration')
idempotency_key text not null
source_ref text
expires_at timestamptz null
created_by_user_id uuid null references users(id)
created_at timestamptz not null default now()
unique (tenant_id, idempotency_key)
```

A grant should also append a `credit_ledger` row. Do not mutate only an account
balance.

### `credit_reservations`

Purpose: hold credits before a provider-backed job runs.

Suggested fields:

```text
id uuid primary key
tenant_id uuid not null references tenants(id)
account_id uuid not null references credit_accounts(id)
matter_id uuid null references matters(id)
user_id uuid null references users(id)
job_id uuid null references processing_jobs(id)
provider_run_id uuid null references provider_runs(id)
credits_reserved numeric not null check (credits_reserved > 0)
status text check in ('reserved', 'committed', 'released', 'refunded', 'expired')
idempotency_key text not null
policy_version text not null
sku text not null
reason text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique (tenant_id, idempotency_key)
```

### `credit_ledger`

Purpose: append-only commercial source of truth.

Suggested fields:

```text
id uuid primary key
tenant_id uuid not null references tenants(id)
account_id uuid not null references credit_accounts(id)
reservation_id uuid null references credit_reservations(id)
grant_id uuid null references credit_grants(id)
matter_id uuid null references matters(id)
user_id uuid null references users(id)
job_id uuid null references processing_jobs(id)
provider_run_id uuid null references provider_runs(id)
cost_event_id uuid null references cost_events(id)
event_type text check in ('grant', 'reserve', 'debit', 'release', 'refund', 'adjustment', 'shadow_debit', 'shadow_refund')
credits_delta numeric not null
currency text not null default 'MWB_CREDIT'
policy_version text
sku text
reason text
metadata_json jsonb not null default '{}'::jsonb
idempotency_key text not null
created_at timestamptz not null default now()
unique (tenant_id, idempotency_key)
```

For shadow mode, use `shadow_debit` / `shadow_refund` or a metadata flag:

```json
{ "shadow": true }
```

Prefer explicit event types while the system is being proven.

### Tenant isolation

Apply the same style as existing migrations:

- enable and force RLS;
- policy using `current_app_tenant_id()`;
- tenant-linked foreign keys where cross-table references are used;
- indexes for account, job, provider run, matter, user, and idempotency lookup.

Migration tests should mirror the existing style:

```text
test/database-credit-ledger-migration.test.mjs
```

## Phase 3 — Shadow Credit Planner From Existing Evidence

Implemented in this branch:

```text
services/credit-shadow-planner.mjs
scripts/db-credit-shadow-report.mjs
test/credit-shadow-planner.test.mjs
test/db-credit-shadow-report.test.mjs
```

Inputs:

```text
provider_runs
cost_events
artifact family/task metadata
```

Output:

```text
would_have_charged credits by tenant/user/matter/task/provider/model
unknown-policy rows
zero-credit deterministic rows, if included
```

Do not write provider prompts or outputs.

Useful report sections:

```text
Shadow Credit Report
- tenants with provider-backed usage
- credits by task/SKU
- credits by matter
- credits by user where known
- provider cost where known
- unknown cost confidence
- rows skipped because task/provider could not be classified
```

## Phase 4 — Runtime Metering Service, Still No Enforcement

Add a service that future provider-backed flows can use without knowing billing
details:

```text
services/ai-metering-service.mjs
```

Suggested API:

```js
const run = await metering.beginProviderRun({
  tenantId,
  userId,
  matterId,
  jobId,
  task,
  provider,
  model,
  policyVersion,
  policyPromptVersion,
  promptVersion,
  idempotencyKey,
});

await metering.finishProviderRun({
  providerRunId: run.id,
  status: "succeeded",
  usage,
  cost,
  returnedProvider,
  returnedModel,
  outputArtifactId,
});

await metering.recordShadowCredits({
  providerRunId: run.id,
  policyInput,
  outcome: "usable_output",
});
```

This should initially be injectable/no-op for local Beta 3 routes unless runtime
DB metering is explicitly enabled.

## Phase 5 — Admin-Only Read Model

Add read-only summary helpers. Do not enforce.

Possible route later:

```text
GET /api/admin/credit-shadow-summary
```

For this branch, a script/report may be enough.

Minimum outputs:

```text
org shadow credits used this month
credits by matter
credits by user
credits by task/SKU
actual provider cost where known
unknown-cost rows
```

## Phase 6 — Later Enforcement, Not This Branch

Only after shadow reports look sane:

1. reserve credits before expensive jobs;
2. commit debit after usable output;
3. release reservation after pre-provider failure;
4. refund partial/failed post-provider work according to policy;
5. add admin controls for user caps and matter budgets;
6. add user-facing warnings;
7. add payment integration last.

## Idempotency Rules

Every write path must have a stable key:

```text
credit-account:tenant:<tenant_id>
credit-grant:beta-seed:<tenant_id>:<period>
credit-reserve:<job_id>:<sku>
credit-debit:<provider_run_id>:<sku>
credit-release:<reservation_id>:<reason>
credit-refund:<provider_run_id>:<reason>
credit-shadow-debit:<provider_run_id>:<sku>
```

Required uniqueness:

```sql
unique (tenant_id, idempotency_key)
```

Do not rely on UI click prevention or worker retry behavior to avoid double
charges.

## Failure / Refund Semantics

Initial shadow policy:

| Outcome | Shadow event |
| --- | --- |
| deterministic/local command | no debit |
| provider unavailable before request | no debit, optional shadow release |
| provider request sent but invalid output | shadow debit or reduced debit, mark `needs_policy_decision` |
| usable artifact written | full shadow debit |
| user cancelled before provider call | no debit |
| user cancelled after provider call | shadow debit, mark `needs_policy_decision` |
| duplicate retry with same idempotency key | same ledger row, no duplicate debit |

This table should stay conservative until real provider billing evidence is
available.

## Testing Plan

Targeted tests for the branch:

```bash
node --test \
  test/credit-policy.test.mjs \
  test/database-credit-ledger-migration.test.mjs \
  test/credit-shadow-planner.test.mjs \
  test/db-credit-shadow-report.test.mjs \
  test/db-hydrate-local-provider-runs.test.mjs \
  test/db-hydrate-local-cost-events.test.mjs
```

Before merging to main/Beta line:

```bash
npm test --silent
npm run ui:typecheck --silent
npm run ui:build --silent
git diff --check
```

## Acceptance Criteria For This Branch

- Branch can be reviewed without touching Beta 3 release code.
- Credit policy maps current AI tasks to stable shadow SKUs.
- Credit ledger migration is tenant-scoped, RLS-protected, and idempotent.
- Shadow planner/report can compute credits from existing provider-run/cost
  evidence.
- No enforcement is enabled.
- No API keys, prompts, source text, or legal outputs are logged to credit rows.
- Tests cover duplicate idempotency, refunds/releases, unknown costs, and
  tenant isolation.

## Open Questions

- Should failed post-provider calls count as credits if the provider probably
  charged money but the output was unusable?
- Should credits vary by document count/source count, or stay fixed by task for
  user predictability?
- Should Matter Copilot answers be one credit each, or bundle into a daily
  allowance?
- Should matter budgets be hard caps or warning thresholds during private beta?
- Should credits be integer-only or decimal? Use `numeric` now, but product UX
  should probably show whole credits.
- Should externally billed currency be INR/USD while internal credit currency
  remains `MWB_CREDIT`?

## Recommended Immediate Sequence

1. Add `shared/credit-policy.mjs` and tests.
2. Add `019_credit_ledger.sql` and migration tests.
3. Add shadow planner over provider-run/cost evidence.
4. Add report script.
5. Only then consider runtime metering hooks.

Keep the first PR small enough that Beta 3 developers can ignore it safely.
