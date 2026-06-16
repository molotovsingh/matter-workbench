import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDIT_POLICY_VERSION,
  CREDIT_SKUS,
  creditLedgerIdempotencyKey,
  resolveCreditPolicy,
} from "../shared/credit-policy.mjs";

test("credit policy maps source-backed legal analysis to a premium shadow SKU", () => {
  const policy = resolveCreditPolicy({
    task: "source_backed_analysis",
    provider: "openrouter",
    model: "openai/gpt-4.1",
  });

  assert.equal(policy.policyVersion, CREDIT_POLICY_VERSION);
  assert.equal(policy.mode, "shadow");
  assert.equal(policy.shadowOnly, true);
  assert.equal(policy.sku, CREDIT_SKUS.SOURCE_BACKED_ANALYSIS);
  assert.equal(policy.routeTier, "premium");
  assert.equal(policy.plannedCredits, 12);
  assert.equal(policy.billable, true);
  assert.equal(policy.chargeOn, "usable_output");
  assert.deepEqual(policy.refundOn, ["failed_before_provider", "cancelled_before_provider"]);
  assert.equal(policy.provider, "openrouter");
  assert.equal(policy.model, "openai/gpt-4.1");
});

test("credit policy classifies provider-run task classes when task metadata is absent", () => {
  assert.equal(resolveCreditPolicy({ taskClass: "copilot" }).sku, CREDIT_SKUS.COPILOT_ANSWER);
  assert.equal(resolveCreditPolicy({ taskClass: "skill_execution" }).sku, CREDIT_SKUS.CONFIGURABLE_SKILL_RUN);
  assert.equal(resolveCreditPolicy({ taskClass: "skill_creation" }).sku, CREDIT_SKUS.SKILL_AUTHORING);
  assert.equal(resolveCreditPolicy({ taskClass: "native_source_skill" }).sku, CREDIT_SKUS.SOURCE_BACKED_ANALYSIS);
});

test("credit policy keeps deterministic work at zero credits", () => {
  const policy = resolveCreditPolicy({ operation: "deterministic" });

  assert.equal(policy.sku, CREDIT_SKUS.DETERMINISTIC_LOCAL);
  assert.equal(policy.plannedCredits, 0);
  assert.equal(policy.billable, false);
  assert.equal(policy.chargeMode, "none");
  assert.equal(policy.chargeOn, "never");
});

test("credit policy marks unknown provider-backed tasks for review instead of charging", () => {
  const policy = resolveCreditPolicy({ task: "new_unclassified_ai_task", provider: "openai-direct", model: "gpt-x" });

  assert.equal(policy.sku, CREDIT_SKUS.UNKNOWN_AI);
  assert.equal(policy.plannedCredits, 0);
  assert.equal(policy.billable, false);
  assert.equal(policy.requiresPolicyDecision, true);
  assert.equal(policy.chargeMode, "needs_policy_decision");
});

test("credit ledger idempotency keys are stable and require a tenant, source, and sku", () => {
  assert.equal(
    creditLedgerIdempotencyKey({
      tenantId: "tenant-1",
      providerRunId: "provider-run-1",
      eventType: "shadow_debit",
      sku: "source_backed_analysis.premium",
    }),
    "credit:shadow_debit:provider-run-1:source_backed_analysis_premium",
  );

  assert.throws(() => creditLedgerIdempotencyKey({ providerRunId: "run", sku: "sku" }), /tenantId is required/);
  assert.throws(() => creditLedgerIdempotencyKey({ tenantId: "tenant", sku: "sku" }), /providerRunId or jobId is required/);
  assert.throws(() => creditLedgerIdempotencyKey({ tenantId: "tenant", providerRunId: "run" }), /sku is required/);
});
