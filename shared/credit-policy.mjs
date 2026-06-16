export const CREDIT_POLICY_VERSION = "credit-policy/v0-shadow";
export const CREDIT_CURRENCY = "MWB_CREDIT";

export const CREDIT_SKUS = Object.freeze({
  DETERMINISTIC_LOCAL: "deterministic.local",
  ROUTER_LIGHT: "router.light",
  SKILL_INTERVIEW_PLANNER: "skill_interview.planner",
  SOURCE_DESCRIPTION: "source_description.standard",
  SOURCE_BACKED_ANALYSIS: "source_backed_analysis.premium",
  COPILOT_ANSWER: "copilot.answer",
  SKILL_SAMPLE_OUTPUT: "skill_sample_output.review",
  CONFIGURABLE_SKILL_RUN: "configurable_skill_run.standard",
  SKILL_AUTHORING: "skill_authoring.premium",
  VALIDATION: "validation.ai",
  UNKNOWN_AI: "unknown.ai",
});

const TASK_PROFILE_BY_TASK = new Map([
  ["deterministic", zeroProfile(CREDIT_SKUS.DETERMINISTIC_LOCAL, "local")],
  ["local", zeroProfile(CREDIT_SKUS.DETERMINISTIC_LOCAL, "local")],
  ["skill_router", profile(CREDIT_SKUS.ROUTER_LIGHT, 0, "router")],
  ["skill_design_interview", profile(CREDIT_SKUS.SKILL_INTERVIEW_PLANNER, 2, "planner")],
  ["skill_sample_output", profile(CREDIT_SKUS.SKILL_SAMPLE_OUTPUT, 3, "review")],
  ["skill_authoring", profile(CREDIT_SKUS.SKILL_AUTHORING, 10, "premium")],
  ["configurable_skill_run", profile(CREDIT_SKUS.CONFIGURABLE_SKILL_RUN, 6, "standard")],
  ["copilot_answer", profile(CREDIT_SKUS.COPILOT_ANSWER, 1, "interactive")],
  ["source_description", profile(CREDIT_SKUS.SOURCE_DESCRIPTION, 3, "standard")],
  ["source_backed_analysis", profile(CREDIT_SKUS.SOURCE_BACKED_ANALYSIS, 12, "premium")],
  ["create_listofdates_pass1", profile(CREDIT_SKUS.SOURCE_BACKED_ANALYSIS, 12, "premium")],
  ["create_listofdates_pass2", profile(CREDIT_SKUS.SOURCE_BACKED_ANALYSIS, 12, "premium")],
]);

const TASK_PROFILE_BY_CLASS = new Map([
  ["copilot", profile(CREDIT_SKUS.COPILOT_ANSWER, 1, "interactive")],
  ["skill_creation", profile(CREDIT_SKUS.SKILL_AUTHORING, 10, "premium")],
  ["skill_modification", profile(CREDIT_SKUS.SKILL_AUTHORING, 10, "premium")],
  ["skill_execution", profile(CREDIT_SKUS.CONFIGURABLE_SKILL_RUN, 6, "standard")],
  ["native_source_skill", profile(CREDIT_SKUS.SOURCE_BACKED_ANALYSIS, 12, "premium")],
  ["validation", profile(CREDIT_SKUS.VALIDATION, 1, "validation")],
]);

const TASK_PROFILE_BY_ARTIFACT = new Map([
  ["source_index", profile(CREDIT_SKUS.SOURCE_DESCRIPTION, 3, "standard")],
  ["list_of_dates", profile(CREDIT_SKUS.SOURCE_BACKED_ANALYSIS, 12, "premium")],
  ["custom_skill_output", profile(CREDIT_SKUS.CONFIGURABLE_SKILL_RUN, 6, "standard")],
]);

export function resolveCreditPolicy(input = {}) {
  const task = normalizeKey(input.task || input.aiTask || input.usageTask);
  const taskClass = normalizeKey(input.taskClass || input.providerRunTaskClass);
  const artifactFamily = normalizeKey(input.artifactFamily || input.artifact_family);
  const operation = normalizeKey(input.operation);

  const matchedProfile = TASK_PROFILE_BY_TASK.get(task)
    || TASK_PROFILE_BY_CLASS.get(taskClass)
    || TASK_PROFILE_BY_ARTIFACT.get(artifactFamily)
    || (operation === "deterministic" ? TASK_PROFILE_BY_TASK.get("deterministic") : null)
    || unknownProfile();

  const plannedCredits = matchedProfile.plannedCredits;
  return Object.freeze({
    policyVersion: CREDIT_POLICY_VERSION,
    currency: CREDIT_CURRENCY,
    mode: "shadow",
    shadowOnly: true,
    sku: matchedProfile.sku,
    routeTier: matchedProfile.routeTier,
    chargeMode: matchedProfile.chargeMode,
    plannedCredits,
    minimumCredits: plannedCredits,
    maximumCredits: plannedCredits,
    chargeOn: matchedProfile.chargeOn,
    refundOn: matchedProfile.refundOn,
    billable: plannedCredits > 0,
    requiresPolicyDecision: Boolean(matchedProfile.requiresPolicyDecision),
    task,
    taskClass,
    artifactFamily,
    provider: normalizeText(input.provider),
    model: normalizeText(input.model),
    notes: matchedProfile.notes,
  });
}

export function creditLedgerIdempotencyKey({ tenantId = "", providerRunId = "", jobId = "", eventType = "shadow_debit", sku = "" } = {}) {
  const sourceId = normalizeText(providerRunId) || normalizeText(jobId);
  if (!normalizeText(tenantId)) throw new Error("tenantId is required for credit idempotency");
  if (!sourceId) throw new Error("providerRunId or jobId is required for credit idempotency");
  if (!normalizeText(sku)) throw new Error("sku is required for credit idempotency");
  return `credit:${normalizeKey(eventType)}:${sourceId}:${normalizeKey(sku)}`;
}

function profile(sku, plannedCredits, routeTier, extra = {}) {
  return Object.freeze({
    sku,
    plannedCredits,
    routeTier,
    chargeMode: "per_run",
    chargeOn: "usable_output",
    refundOn: ["failed_before_provider", "cancelled_before_provider"],
    requiresPolicyDecision: false,
    notes: "Shadow-only initial credit price; not a bill.",
    ...extra,
  });
}

function zeroProfile(sku, routeTier) {
  return profile(sku, 0, routeTier, {
    chargeMode: "none",
    chargeOn: "never",
    refundOn: [],
    notes: "Local or deterministic work is not credit-metered.",
  });
}

function unknownProfile() {
  return profile(CREDIT_SKUS.UNKNOWN_AI, 0, "unknown", {
    chargeMode: "needs_policy_decision",
    chargeOn: "manual_review",
    refundOn: [],
    requiresPolicyDecision: true,
    notes: "Shadow planner could not classify this provider-backed task.",
  });
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s./-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function normalizeText(value) {
  return String(value || "").trim();
}
