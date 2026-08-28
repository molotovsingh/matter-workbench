import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOneWayCutoverAuthorization } from "../services/document-intake-extraction/readiness/cutover-authorization.mjs";

const POLICY = { minimumShadowIntakes: 500, minimumShadowPages: 10_000, minimumSoakHours: 168 };

// V4-CUTOVER-001 tooling evidence only; shadow, soak, drain, and approvals remain pending.
test("one-way cutover authorization requires completed gates, finite shadow/soak, drain, and named approvals", () => {
  const authorization = evaluateOneWayCutoverAuthorization({
    acceptanceEvaluation: { productionReady: true, cutoverAllowed: true },
    policy: POLICY,
    shadowEvidence: {
      intakes: 500, pages: 10_000, omittedPages: 0, legalCriticalDivergences: 0,
      duplicateReadyEvents: 0, unreconciledCostEvents: 0, crossTenantViolations: 0,
    },
    soakEvidence: { completedHours: 168, openIncidents: 0 },
    legacyState: { activeJobs: 0, queuedJobs: 0 },
    approvals: approvals(),
  });
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.oneWay, true);
  assert.equal(authorization.fallbackPermitted, false);
  assert.equal(authorization.phases.at(-1), "fix_forward_only");
});

test("one-way cutover fails closed while gates, shadow, soak, integrity, drain, or approvals are incomplete", () => {
  const authorization = evaluateOneWayCutoverAuthorization({
    acceptanceEvaluation: { productionReady: false, cutoverAllowed: false },
    policy: POLICY,
    shadowEvidence: {
      intakes: 10, pages: 100, omittedPages: 1, legalCriticalDivergences: 1,
      duplicateReadyEvents: 1, unreconciledCostEvents: 1, crossTenantViolations: 1,
    },
    soakEvidence: { completedHours: 2, openIncidents: 1 },
    legacyState: { activeJobs: 1, queuedJobs: 2 },
    approvals: approvals().slice(0, 2),
  });
  assert.equal(authorization.authorized, false);
  for (const reason of [
    "acceptance_gates_incomplete", "shadow_intakes_below_policy", "shadow_pages_below_policy",
    "shadow_omitted_pages", "shadow_legal_critical_divergence", "shadow_duplicate_publication",
    "shadow_unreconciled_cost", "shadow_tenant_violation", "soak_duration_below_policy",
    "soak_incidents_open", "legacy_jobs_not_drained", "legacy_queue_not_drained", "required_approvals_missing",
  ]) assert.ok(authorization.reasons.includes(reason), reason);
});

function approvals() {
  return ["quality", "security", "operations", "product_owner", "cutover_authority"].map((role, index) => ({
    role,
    approvalId: `approval-${index + 1}`,
    approverId: `approver-${index + 1}`,
    approvedAt: "2026-08-24T12:00:00.000Z",
  }));
}
