import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShadowCreditPlan,
  renderShadowCreditReport,
} from "../services/credit-shadow-planner.mjs";

const tenant = { id: "00000000-0000-5000-8000-000000000010", name: "Shadow Tenant" };

test("shadow credit planner derives idempotent debit rows from provider runs", () => {
  const plan = buildShadowCreditPlan({
    providerRunPlan: {
      tenant,
      providerRuns: [
        providerRun({
          id: "00000000-0000-5000-8000-000000000101",
          task: "source_backed_analysis",
          taskClass: "native_source_skill",
          matterId: "00000000-0000-5000-8000-000000000201",
          provider: "openrouter",
          model: "openai/gpt-4.1",
          costAmount: 0.04,
          costConfidence: "actual",
        }),
        providerRun({
          id: "00000000-0000-5000-8000-000000000102",
          task: "copilot_answer",
          taskClass: "copilot",
          provider: "openrouter",
          model: "openai/gpt-4.1",
          costAmount: null,
          costConfidence: "unknown",
        }),
      ],
    },
  });

  assert.equal(plan.creditAccounts.length, 1);
  assert.equal(plan.creditAccounts[0].accountType, "tenant_pool");
  assert.equal(plan.providerRunCredits.length, 2);
  assert.equal(plan.creditLedgerEvents.length, 2);
  assert.equal(plan.totals.shadowCredits, 13);
  assert.equal(plan.totals.billableShadowRuns, 2);
  assert.equal(plan.totals.actualProviderCost, 0.04);
  assert.equal(plan.totals.unknownCostRuns, 1);
  assert.equal(plan.matterGroups.length, 1);
  assert.equal(plan.matterGroups[0].id, "00000000-0000-5000-8000-000000000201");
  assert.equal(plan.matterGroups[0].credits, 12);

  const [lodDebit] = plan.creditLedgerEvents;
  assert.equal(lodDebit.eventType, "shadow_debit");
  assert.equal(lodDebit.creditsDelta, -12);
  assert.equal(lodDebit.currency, "MWB_CREDIT");
  assert.equal(lodDebit.sku, "source_backed_analysis.premium");
  assert.equal(lodDebit.idempotencyKey, "credit:shadow_debit:00000000-0000-5000-8000-000000000101:source_backed_analysis_premium");
  assert.equal(lodDebit.metadata.shadow, true);
  assert.equal(lodDebit.metadata.provider, "openrouter");
});

test("shadow credit planner marks failed provider runs for policy decision without debiting", () => {
  const plan = buildShadowCreditPlan({
    providerRunPlan: {
      tenant,
      providerRuns: [
        providerRun({
          id: "00000000-0000-5000-8000-000000000103",
          status: "failed",
          task: "skill_sample_output",
          taskClass: "skill_creation",
          provider: "openai-direct",
          model: "gpt-5.4",
        }),
      ],
    },
  });

  assert.equal(plan.creditLedgerEvents.length, 0);
  assert.equal(plan.totals.shadowCredits, 0);
  assert.equal(plan.totals.billableShadowRuns, 0);
  assert.equal(plan.totals.policyReviewRuns, 1);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /failure charge policy is pending/i);
});

test("shadow credit planner does not debit started or unclassified runs", () => {
  const plan = buildShadowCreditPlan({
    providerRunPlan: {
      tenant,
      providerRuns: [
        providerRun({
          id: "00000000-0000-5000-8000-000000000104",
          status: "started",
          task: "source_description",
          taskClass: "native_source_skill",
        }),
        providerRun({
          id: "00000000-0000-5000-8000-000000000105",
          task: "new_unknown_task",
          taskClass: "",
        }),
      ],
    },
  });

  assert.equal(plan.creditLedgerEvents.length, 0);
  assert.equal(plan.totals.shadowCredits, 0);
  assert.equal(plan.totals.policyReviewRuns, 1);
  assert.equal(plan.warnings.length, 2);
});

test("shadow credit planner does not debit unknown provider run statuses", () => {
  const plan = buildShadowCreditPlan({
    providerRunPlan: {
      tenant,
      providerRuns: [
        providerRun({
          id: "00000000-0000-5000-8000-000000000106",
          status: "provider_retrying",
          task: "source_backed_analysis",
          taskClass: "native_source_skill",
        }),
      ],
    },
  });

  assert.equal(plan.providerRunCredits[0].status, "unknown");
  assert.equal(plan.providerRunCredits[0].requiresPolicyDecision, true);
  assert.equal(plan.creditLedgerEvents.length, 0);
  assert.equal(plan.totals.shadowCredits, 0);
  assert.equal(plan.totals.policyReviewRuns, 1);
  assert.match(plan.warnings[0], /unknown status/i);
});

test("shadow credit report renders grouped credits without legal work product", () => {
  const plan = buildShadowCreditPlan({
    providerRunPlan: {
      tenant,
      providerRuns: [providerRun({ task: "source_backed_analysis", taskClass: "native_source_skill" })],
    },
  });
  const report = renderShadowCreditReport(plan);

  assert.match(report, /Matter Workbench shadow credit report/);
  assert.match(report, /shadow_credits: 12/);
  assert.match(report, /source_backed_analysis\.premium/);
  assert.match(report, /matter_groups:/);
  assert.doesNotMatch(report, /prompt/i);
  assert.doesNotMatch(report, /source text/i);
});

function providerRun(overrides = {}) {
  return {
    id: "00000000-0000-5000-8000-000000000199",
    tenantId: tenant.id,
    matterId: "",
    taskClass: "native_source_skill",
    provider: "openrouter",
    model: "openai/gpt-4.1",
    status: "succeeded",
    usageJson: { task: "source_backed_analysis", usage: { promptTokens: 100, completionTokens: 20, cost: 0.04 } },
    inputTokens: 100,
    outputTokens: 20,
    costAmount: 0.04,
    costConfidence: "actual",
    startedAt: "2026-06-16T09:00:00.000Z",
    finishedAt: "2026-06-16T09:01:00.000Z",
    ...overrides,
    usageJson: {
      task: overrides.task ?? overrides.usageJson?.task ?? "source_backed_analysis",
      usage: overrides.usageJson?.usage || { promptTokens: 100, completionTokens: 20, cost: overrides.costAmount ?? 0.04 },
    },
  };
}
