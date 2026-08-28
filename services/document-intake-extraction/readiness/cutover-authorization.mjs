const REQUIRED_APPROVALS = Object.freeze(["quality", "security", "operations", "product_owner", "cutover_authority"]);

export function evaluateOneWayCutoverAuthorization({
  acceptanceEvaluation,
  policy = {},
  shadowEvidence = {},
  soakEvidence = {},
  legacyState = {},
  approvals = [],
} = {}) {
  const reasons = [];
  if (acceptanceEvaluation?.productionReady !== true || acceptanceEvaluation?.cutoverAllowed !== true) reasons.push("acceptance_gates_incomplete");
  const minimumShadowIntakes = positiveInteger(policy.minimumShadowIntakes, "policy.minimumShadowIntakes");
  const minimumShadowPages = positiveInteger(policy.minimumShadowPages, "policy.minimumShadowPages");
  const minimumSoakHours = positiveNumber(policy.minimumSoakHours, "policy.minimumSoakHours");
  if (nonNegativeInteger(shadowEvidence.intakes, "shadowEvidence.intakes") < minimumShadowIntakes) reasons.push("shadow_intakes_below_policy");
  if (nonNegativeInteger(shadowEvidence.pages, "shadowEvidence.pages") < minimumShadowPages) reasons.push("shadow_pages_below_policy");
  for (const [field, reason] of [
    ["omittedPages", "shadow_omitted_pages"],
    ["legalCriticalDivergences", "shadow_legal_critical_divergence"],
    ["duplicateReadyEvents", "shadow_duplicate_publication"],
    ["unreconciledCostEvents", "shadow_unreconciled_cost"],
    ["crossTenantViolations", "shadow_tenant_violation"],
  ]) {
    if (nonNegativeInteger(shadowEvidence[field], `shadowEvidence.${field}`) > 0) reasons.push(reason);
  }
  if (nonNegativeNumber(soakEvidence.completedHours, "soakEvidence.completedHours") < minimumSoakHours) reasons.push("soak_duration_below_policy");
  if (nonNegativeInteger(soakEvidence.openIncidents, "soakEvidence.openIncidents") > 0) reasons.push("soak_incidents_open");
  if (nonNegativeInteger(legacyState.activeJobs, "legacyState.activeJobs") > 0) reasons.push("legacy_jobs_not_drained");
  if (nonNegativeInteger(legacyState.queuedJobs, "legacyState.queuedJobs") > 0) reasons.push("legacy_queue_not_drained");
  const normalizedApprovals = approvals.map(normalizeApproval);
  const approvalMap = new Map(normalizedApprovals.map((approval) => [approval.role, approval]));
  if (approvalMap.size !== normalizedApprovals.length) reasons.push("duplicate_approval_role");
  const missingApprovals = REQUIRED_APPROVALS.filter((role) => !approvalMap.has(role));
  if (missingApprovals.length) reasons.push("required_approvals_missing");
  return {
    schemaVersion: "document-intake-extraction.cutover-authorization/v1",
    authorized: reasons.length === 0,
    oneWay: true,
    fallbackPermitted: false,
    policy: { minimumShadowIntakes, minimumShadowPages, minimumSoakHours },
    missingApprovals,
    reasons,
    phases: [
      "freeze_legacy_intake",
      "verify_legacy_drain",
      "activate_v4_caller",
      "verify_v4_health_and_publication",
      "remove_legacy_runtime",
      "fix_forward_only",
    ],
  };
}

function normalizeApproval(input = {}, index) {
  const role = String(input.role || "");
  if (!REQUIRED_APPROVALS.includes(role)) throw new Error(`approvals[${index}].role is invalid`);
  const approvalId = String(input.approvalId || "").trim();
  const approverId = String(input.approverId || "").trim();
  if (!approvalId || !approverId || /(?:todo|tbd|unknown|placeholder)/i.test(`${approvalId} ${approverId}`)) {
    throw new Error(`approvals[${index}] requires real non-secret identifiers`);
  }
  const approvedAt = new Date(input.approvedAt);
  if (!Number.isFinite(approvedAt.getTime())) throw new Error(`approvals[${index}].approvedAt is invalid`);
  return { role, approvalId: approvalId.slice(0, 240), approverId: approverId.slice(0, 240), approvedAt: approvedAt.toISOString() };
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${field} must be a non-negative integer`);
  return number;
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

function nonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be non-negative`);
  return number;
}
