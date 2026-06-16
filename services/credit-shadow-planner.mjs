import { createHash } from "node:crypto";
import {
  CREDIT_CURRENCY,
  creditLedgerIdempotencyKey,
  resolveCreditPolicy,
} from "../shared/credit-policy.mjs";

export function buildShadowCreditPlan({
  providerRunPlan = {},
  costEventPlan = null,
  appDir = providerRunPlan.appDir || "",
  mattersHome = providerRunPlan.mattersHome || "",
} = {}) {
  const tenant = providerRunPlan.tenant || costEventPlan?.tenant || {
    id: deterministicUuid("tenant:local-shadow"),
    name: "Matter Workbench Local Shadow",
    type: "internal_test",
  };
  const account = tenantCreditAccount(tenant.id);
  const costEventsByProviderRunId = new Map((costEventPlan?.costEvents || [])
    .filter((event) => event?.providerRunId)
    .map((event) => [event.providerRunId, event]));
  const plan = {
    mode: "shadow",
    databaseWrites: false,
    appDir,
    mattersHome,
    tenant,
    creditAccounts: [account],
    providerRunCredits: [],
    creditLedgerEvents: [],
    warnings: [],
  };
  const seenLedgerIds = new Set();

  for (const providerRun of providerRunPlan.providerRuns || []) {
    const row = creditRowFromProviderRun({
      tenantId: tenant.id,
      accountId: account.id,
      providerRun,
      costEvent: costEventsByProviderRunId.get(providerRun.id) || null,
    });
    plan.providerRunCredits.push(row);
    if (row.warning) plan.warnings.push(row.warning);
    for (const event of row.ledgerEvents) {
      if (seenLedgerIds.has(event.id)) continue;
      seenLedgerIds.add(event.id);
      plan.creditLedgerEvents.push(event);
    }
  }

  plan.totals = creditTotals(plan);
  plan.groups = creditGroups(plan.providerRunCredits);
  plan.matterGroups = creditEntityGroups(plan.providerRunCredits, "matterId");
  plan.userGroups = creditEntityGroups(plan.providerRunCredits, "userId");
  plan.plannedRows = {
    creditAccounts: plan.creditAccounts.length,
    creditLedgerEvents: plan.creditLedgerEvents.length,
  };
  return plan;
}

export function shadowCreditReportFromPlan(plan = {}) {
  return {
    mode: plan.mode || "shadow",
    databaseWrites: Boolean(plan.databaseWrites),
    appDir: plan.appDir || "",
    mattersHome: plan.mattersHome || "",
    tenant: plan.tenant || {},
    totals: plan.totals || creditTotals(plan),
    plannedRows: plan.plannedRows || {},
    groups: plan.groups || creditGroups(plan.providerRunCredits || []),
    matterGroups: plan.matterGroups || creditEntityGroups(plan.providerRunCredits || [], "matterId"),
    userGroups: plan.userGroups || creditEntityGroups(plan.providerRunCredits || [], "userId"),
    warnings: plan.warnings || [],
  };
}

export function renderShadowCreditReport(plan = {}) {
  const report = shadowCreditReportFromPlan(plan);
  const lines = [
    "Matter Workbench shadow credit report",
    `mode: ${report.mode}`,
    `database_writes: ${report.databaseWrites ? "yes" : "no"}`,
    `tenant_id: ${report.tenant?.id || ""}`,
    "totals:",
    `  provider_runs: ${report.totals.providerRuns || 0}`,
    `  classified_runs: ${report.totals.classifiedRuns || 0}`,
    `  policy_review_runs: ${report.totals.policyReviewRuns || 0}`,
    `  billable_shadow_runs: ${report.totals.billableShadowRuns || 0}`,
    `  shadow_credits: ${formatNumber(report.totals.shadowCredits || 0)}`,
    `  actual_provider_cost: ${formatNullableAmount(report.totals.actualProviderCost)}`,
    `  unknown_cost_runs: ${report.totals.unknownCostRuns || 0}`,
    `  warnings: ${report.totals.warnings || 0}`,
    "groups:",
  ];
  for (const group of report.groups || []) {
    lines.push(`  ${group.sku}: runs=${group.runs} credits=${formatNumber(group.credits)} actual_cost=${formatNullableAmount(group.actualProviderCost)} provider=${group.provider || ""} model=${group.model || ""}`);
  }
  if (!report.groups?.length) lines.push("  (none)");
  lines.push("matter_groups:");
  for (const group of report.matterGroups || []) {
    lines.push(`  ${group.id}: runs=${group.runs} credits=${formatNumber(group.credits)} actual_cost=${formatNullableAmount(group.actualProviderCost)}`);
  }
  if (!report.matterGroups?.length) lines.push("  (none)");
  if (report.userGroups?.length) {
    lines.push("user_groups:");
    for (const group of report.userGroups) {
      lines.push(`  ${group.id}: runs=${group.runs} credits=${formatNumber(group.credits)} actual_cost=${formatNullableAmount(group.actualProviderCost)}`);
    }
  }
  if (report.warnings?.length) {
    lines.push("warnings:");
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join("\n");
}

function creditRowFromProviderRun({ tenantId, accountId, providerRun = {}, costEvent = null }) {
  const usageTask = normalizeText(providerRun.usageJson?.task || providerRun.usage_json?.task);
  const policy = resolveCreditPolicy({
    task: providerRun.task || usageTask,
    taskClass: providerRun.taskClass || providerRun.task_class,
    provider: providerRun.provider,
    model: providerRun.model,
  });
  const status = normalizeStatus(providerRun.status);
  const credits = policy.billable ? policy.plannedCredits : 0;
  const actualProviderCost = numberOrNull(costEvent?.amount ?? providerRun.costAmount ?? providerRun.cost_amount);
  const costConfidence = normalizeText(costEvent?.confidence || providerRun.costConfidence || providerRun.cost_confidence || "unknown") || "unknown";
  const needsPolicyDecision = policy.requiresPolicyDecision || status === "failed";
  const ledgerEvents = [];
  let warning = "";

  if (credits > 0 && ["succeeded", "failed"].includes(status)) {
    ledgerEvents.push(shadowLedgerEvent({
      tenantId,
      accountId,
      providerRun,
      costEvent,
      policy,
      credits,
      status,
      needsPolicyDecision,
    }));
  } else if (credits > 0 && ["started", "cancelled"].includes(status)) {
    warning = `No shadow debit for ${status} provider run ${providerRun.id || "unknown"} (${policy.sku}).`;
  } else if (policy.requiresPolicyDecision) {
    warning = `Credit policy could not classify provider run ${providerRun.id || "unknown"}.`;
  }

  return {
    providerRunId: normalizeText(providerRun.id),
    tenantId,
    accountId,
    matterId: normalizeText(providerRun.matterId || providerRun.matter_id),
    userId: normalizeText(providerRun.userId || providerRun.user_id),
    jobId: normalizeText(providerRun.jobId || providerRun.job_id),
    taskClass: normalizeText(providerRun.taskClass || providerRun.task_class),
    status,
    provider: normalizeText(providerRun.provider),
    model: normalizeText(providerRun.model),
    policy,
    sku: policy.sku,
    plannedCredits: policy.plannedCredits,
    shadowCredits: ledgerEvents.reduce((sum, event) => sum + Math.abs(Number(event.creditsDelta || 0)), 0),
    billable: policy.billable,
    requiresPolicyDecision: needsPolicyDecision,
    actualProviderCost,
    costConfidence,
    ledgerEvents,
    warning,
  };
}

function shadowLedgerEvent({ tenantId, accountId, providerRun, costEvent, policy, credits, status, needsPolicyDecision }) {
  const providerRunId = normalizeText(providerRun.id);
  const eventType = "shadow_debit";
  const idempotencyKey = creditLedgerIdempotencyKey({
    tenantId,
    providerRunId,
    jobId: providerRun.jobId || providerRun.job_id,
    eventType,
    sku: policy.sku,
  });
  return {
    id: deterministicUuid(`credit-ledger:${tenantId}:${idempotencyKey}`),
    tenantId,
    accountId,
    reservationId: "",
    grantId: "",
    matterId: normalizeText(providerRun.matterId || providerRun.matter_id),
    userId: normalizeText(providerRun.userId || providerRun.user_id),
    jobId: normalizeText(providerRun.jobId || providerRun.job_id),
    providerRunId,
    costEventId: normalizeText(costEvent?.id),
    eventType,
    creditsDelta: -Math.abs(credits),
    currency: CREDIT_CURRENCY,
    policyVersion: policy.policyVersion,
    sku: policy.sku,
    reason: status === "succeeded" ? "shadow usable provider-backed output" : "shadow failed provider run; charge policy pending",
    metadata: {
      shadow: true,
      provider: normalizeText(providerRun.provider),
      model: normalizeText(providerRun.model),
      taskClass: normalizeText(providerRun.taskClass || providerRun.task_class),
      providerRunStatus: status,
      needsPolicyDecision,
    },
    idempotencyKey,
    createdAt: normalizeText(providerRun.finishedAt || providerRun.finished_at || providerRun.startedAt || providerRun.started_at),
  };
}

function tenantCreditAccount(tenantId) {
  return {
    id: deterministicUuid(`credit-account:tenant-pool:${tenantId}`),
    tenantId,
    accountType: "tenant_pool",
    status: "active",
    currency: CREDIT_CURRENCY,
    idempotencyKey: `credit-account:tenant:${tenantId}`,
  };
}

function creditTotals(plan = {}) {
  const rows = plan.providerRunCredits || [];
  return {
    providerRuns: rows.length,
    classifiedRuns: rows.filter((row) => !row.policy.requiresPolicyDecision).length,
    policyReviewRuns: rows.filter((row) => row.requiresPolicyDecision).length,
    billableShadowRuns: rows.filter((row) => row.shadowCredits > 0).length,
    shadowCredits: rows.reduce((sum, row) => sum + row.shadowCredits, 0),
    actualProviderCost: sumNullable(rows.map((row) => row.actualProviderCost)),
    unknownCostRuns: rows.filter((row) => row.costConfidence !== "actual").length,
    warnings: (plan.warnings || []).length,
  };
}

function creditGroups(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.sku, row.provider, row.model].join("|");
    const current = groups.get(key) || {
      sku: row.sku,
      provider: row.provider,
      model: row.model,
      runs: 0,
      credits: 0,
      actualProviderCost: null,
      policyReviewRuns: 0,
    };
    accumulateGroup(current, row);
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.credits - a.credits || a.sku.localeCompare(b.sku));
}

function creditEntityGroups(rows = [], field) {
  const groups = new Map();
  for (const row of rows) {
    const id = normalizeText(row[field]);
    if (!id) continue;
    const current = groups.get(id) || {
      id,
      runs: 0,
      credits: 0,
      actualProviderCost: null,
      policyReviewRuns: 0,
    };
    accumulateGroup(current, row);
    groups.set(id, current);
  }
  return [...groups.values()].sort((a, b) => b.credits - a.credits || a.id.localeCompare(b.id));
}

function accumulateGroup(group, row) {
  group.runs += 1;
  group.credits += row.shadowCredits;
  if (row.actualProviderCost !== null) group.actualProviderCost = (group.actualProviderCost || 0) + row.actualProviderCost;
  if (row.requiresPolicyDecision) group.policyReviewRuns += 1;
}

function normalizeStatus(value) {
  const status = normalizeText(value).toLowerCase();
  if (["succeeded", "failed", "cancelled", "started"].includes(status)) return status;
  if (status === "running") return "started";
  return "succeeded";
}

function sumNullable(values) {
  let total = 0;
  let seen = false;
  for (const value of values) {
    const number = numberOrNull(value);
    if (number === null) continue;
    total += number;
    seen = true;
  }
  return seen ? total : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatNullableAmount(value) {
  const number = numberOrNull(value);
  return number === null ? "" : formatNumber(number);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
