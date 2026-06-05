#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { defaultMattersHome } from "./db-hydrate-local-matters.mjs";
import {
  buildShadowProviderRunPlan,
  collectLocalProviderRunHydrationPlan,
} from "./db-hydrate-local-provider-runs.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { psqlConnectionArgs } from "./db-psql.mjs";

const __filename = fileURLToPath(import.meta.url);

export function parseArgs(argv = []) {
  const parsed = {
    dryRun: true,
    verify: false,
    inspect: false,
    json: false,
    appDir: process.cwd(),
    mattersHome: defaultMattersHome(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      parsed.verify = false;
      parsed.inspect = false;
    } else if (arg === "--apply") {
      parsed.dryRun = false;
      parsed.verify = false;
      parsed.inspect = false;
    } else if (arg === "--verify") {
      parsed.dryRun = true;
      parsed.verify = true;
      parsed.inspect = false;
    } else if (arg === "--inspect") {
      parsed.dryRun = true;
      parsed.verify = false;
      parsed.inspect = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--app-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--app-dir requires a value");
      parsed.appDir = path.resolve(value);
      i += 1;
    } else if (arg === "--matters-home") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matters-home requires a value");
      parsed.mattersHome = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function collectLocalCostEventHydrationPlan({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
  providerRunPlan = null,
} = {}) {
  const resolvedProviderRunPlan = providerRunPlan || await collectLocalProviderRunHydrationPlan({ appDir, mattersHome });
  return buildShadowCostEventPlan({ providerRunPlan: resolvedProviderRunPlan, appDir, mattersHome });
}

export function buildShadowCostEventPlan({
  providerRunPlan = buildShadowProviderRunPlan(),
  appDir = "",
  mattersHome = "",
} = {}) {
  const tenant = providerRunPlan.tenant || {
    id: deterministicUuid("tenant:local-shadow"),
    name: "Matter Workbench Local Shadow",
    type: "internal_test",
  };
  const plan = {
    mode: "dry-run",
    databaseWrites: false,
    appDir,
    mattersHome,
    tenant,
    costEvents: [],
    warnings: [],
  };
  const seen = new Set();

  for (const providerRun of providerRunPlan.providerRuns || []) {
    const costEvent = costEventFromProviderRun({ tenantId: tenant.id, providerRun });
    if (!costEvent || seen.has(costEvent.id)) continue;
    seen.add(costEvent.id);
    plan.costEvents.push(costEvent);
  }

  plan.totals = {
    costEvents: plan.costEvents.length,
    providerRunCostLinks: plan.costEvents.filter((event) => event.providerRunId).length,
    warnings: plan.warnings.length,
  };
  plan.plannedRows = {
    costEvents: plan.costEvents.length,
    providerRunCostLinks: plan.costEvents.filter((event) => event.providerRunId).length,
  };
  return plan;
}

export function costEventHydrationReportFromPlan(plan = {}) {
  return {
    mode: plan.mode || "dry-run",
    databaseWrites: Boolean(plan.databaseWrites),
    appDir: plan.appDir || "",
    mattersHome: plan.mattersHome || "",
    totals: plan.totals || emptyTotals(),
    plannedRows: plan.plannedRows || {},
    warnings: plan.warnings || [],
  };
}

export function buildLocalCostEventHydrationSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Cost-event hydration plan is missing tenant.id.");
  const lines = [
    "begin;",
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, true);`,
  ];

  for (const costEvent of plan.costEvents || []) {
    lines.push(costEventSql(costEvent));
  }

  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

export function applyLocalCostEventHydrationPlan({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before applying cost-event shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1"], {
    input: buildLocalCostEventHydrationSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  return {
    databaseWrites: true,
    insertedRows: plan?.plannedRows || {},
    stdout: result.stdout || "",
  };
}

export function buildCostEventHydrationCountSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Cost-event hydration plan is missing tenant.id.");
  const costEventIds = (plan.costEvents || []).map((event) => event.id).filter(Boolean);
  const providerRunIds = (plan.costEvents || []).map((event) => event.providerRunId).filter(Boolean);

  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select 'cost_events' as key, count(*)::int as count from cost_events where id = any (" + sqlUuidArray(costEventIds) + ")",
    "union all",
    "select 'provider_run_cost_links' as key, count(*)::int as count from cost_events where provider_run_id = any (" + sqlUuidArray(providerRunIds) + ");",
    "",
  ].join("\n");
}

export function verifyLocalCostEventHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before verifying cost-event shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|"], {
    input: buildCostEventHydrationCountSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const counts = parsePipeCounts(result.stdout || "");
  const expected = expectedCostEventHydrationCounts(plan);
  const mismatches = countMismatches({ expected, counts });
  return { matched: mismatches.length === 0, expected, counts, mismatches };
}

export function buildCostEventInspectionSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Cost-event hydration plan is missing tenant.id.");
  const costEventIds = (plan.costEvents || []).map((event) => event.id).filter(Boolean);
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with cost_rows as (",
    "  select scope, confidence, coalesce(provider, '') as provider, coalesce(model, '') as model, count(*)::int as count, sum(amount) as amount",
    "  from cost_events",
    "  where tenant_id = current_app_tenant_id()",
    `    and id = any (${sqlUuidArray(costEventIds)})`,
    "  group by scope, confidence, provider, model",
    ")",
    "select coalesce(jsonb_agg(to_jsonb(cost_rows) order by scope, confidence, provider, model), '[]'::jsonb)::text from cost_rows;",
    "",
  ].join("\n");
}

export function inspectLocalCostEventHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before inspecting cost-event shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: buildCostEventInspectionSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const groups = parsePsqlJsonArray(result.stdout || "").map((row) => ({
    scope: stringValue(row.scope),
    confidence: stringValue(row.confidence),
    provider: stringValue(row.provider),
    model: stringValue(row.model),
    count: Number(row.count) || 0,
    amount: numberOrNull(row.amount),
  }));
  return {
    tenantId: plan?.tenant?.id || "",
    groups,
    totals: {
      costEvents: groups.reduce((sum, row) => sum + row.count, 0),
      actualAmount: groups.reduce((sum, row) => row.confidence === "actual" && row.amount !== null ? sum + row.amount : sum, 0),
    },
  };
}

export function renderShadowCostEventReport(report = {}) {
  const totals = report.totals || emptyTotals();
  const lines = [
    "Matter Workbench local cost-event DB hydration",
    `mode: ${report.mode || "dry-run"}`,
    `database_writes: ${report.databaseWrites ? "yes" : "no"}`,
    `matters_home: ${report.mattersHome || ""}`,
    "totals:",
    `  cost_events: ${totals.costEvents || 0}`,
    `  provider_run_cost_links: ${totals.providerRunCostLinks || 0}`,
    `  warnings: ${totals.warnings || 0}`,
    "planned_rows:",
    `  cost_events: ${report.plannedRows?.costEvents || 0}`,
    `  provider_run_cost_links: ${report.plannedRows?.providerRunCostLinks || 0}`,
  ];
  for (const warning of report.warnings || []) lines.push(`warning: ${warning}`);
  return lines;
}

export function renderCostEventHydrationVerification(result = {}) {
  const lines = [
    "Matter Workbench cost-event shadow hydration verification",
    `matched: ${result.matched ? "yes" : "no"}`,
    "row_counts:",
  ];
  for (const [key, expected] of Object.entries(result.expected || {})) {
    lines.push(`  ${key}: expected=${expected} actual=${result.counts?.[key] || 0}`);
  }
  if (result.mismatches?.length) {
    lines.push("mismatches:");
    for (const mismatch of result.mismatches) {
      lines.push(`  ${mismatch.key}: expected=${mismatch.expected} actual=${mismatch.actual}`);
    }
  }
  return lines;
}

export function renderCostEventHydrationInspection(result = {}) {
  const lines = [
    "Matter Workbench cost-event shadow DB inspection",
    `tenant_id: ${result.tenantId || ""}`,
    `cost_events: ${result.totals?.costEvents || 0}`,
    `actual_amount: ${result.totals?.actualAmount || 0}`,
    "groups:",
  ];
  for (const group of result.groups || []) {
    lines.push(`  ${group.scope} ${group.confidence} ${group.provider}/${group.model}: count=${group.count} amount=${group.amount ?? ""}`);
  }
  if (!result.groups?.length) lines.push("  (none)");
  return lines;
}

function costEventFromProviderRun({ tenantId, providerRun }) {
  const providerRunId = stringValue(providerRun.id);
  if (!providerRunId) return null;
  const amount = numberOrNull(providerRun.costAmount);
  return {
    id: deterministicUuid(`cost-event:provider-run:${providerRunId}`),
    tenantId,
    matterId: stringValue(providerRun.matterId),
    providerRunId,
    scope: stringValue(providerRun.matterId) ? "matter" : "tenant",
    amount,
    currency: amount === null ? "" : stringValue(providerRun.costCurrency) || "USD",
    confidence: normalizeConfidence(providerRun.costConfidence),
    inputTokens: positiveIntegerOrNull(providerRun.inputTokens),
    outputTokens: positiveIntegerOrNull(providerRun.outputTokens),
    provider: stringValue(providerRun.provider),
    model: stringValue(providerRun.model),
    createdAt: timestampOrEmpty(providerRun.startedAt) || timestampOrEmpty(providerRun.finishedAt),
  };
}

function costEventSql(event) {
  return `insert into cost_events (id, tenant_id, matter_id, provider_run_id, scope, amount, currency, confidence, input_tokens, output_tokens, provider, model, created_at) values (${sqlUuid(event.id)}, ${sqlUuid(event.tenantId)}, ${sqlUuidOrNull(event.matterId)}, ${sqlUuid(event.providerRunId)}, ${sqlString(event.scope)}, ${sqlNumericOrNull(event.amount)}, ${sqlStringOrNull(event.currency)}, ${sqlString(event.confidence)}, ${sqlIntegerOrNull(event.inputTokens)}, ${sqlIntegerOrNull(event.outputTokens)}, ${sqlStringOrNull(event.provider)}, ${sqlStringOrNull(event.model)}, ${sqlTimestampOrNow(event.createdAt)}) on conflict (id) do update set matter_id = excluded.matter_id, provider_run_id = excluded.provider_run_id, scope = excluded.scope, amount = excluded.amount, currency = excluded.currency, confidence = excluded.confidence, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, provider = excluded.provider, model = excluded.model, created_at = excluded.created_at;`;
}

function normalizeConfidence(value) {
  const text = stringValue(value);
  return ["actual", "estimated", "planned", "unknown"].includes(text) ? text : "unknown";
}

function expectedCostEventHydrationCounts(plan = {}) {
  return {
    cost_events: plan.plannedRows?.costEvents || 0,
    provider_run_cost_links: plan.plannedRows?.providerRunCostLinks || 0,
  };
}

function countMismatches({ expected = {}, counts = {} } = {}) {
  const mismatches = [];
  for (const [key, expectedCount] of Object.entries(expected)) {
    const actual = counts[key] || 0;
    if (actual !== expectedCount) mismatches.push({ key, expected: expectedCount, actual });
  }
  return mismatches;
}

function parsePipeCounts(stdout = "") {
  const counts = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("|")) continue;
    const [key, value] = trimmed.split("|");
    const count = Number.parseInt(value, 10);
    if (!key || !Number.isFinite(count)) continue;
    counts[key] = count;
  }
  return counts;
}

function parsePsqlJsonArray(stdout = "") {
  const text = String(stdout || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("psql inspection returned no JSON cost-event summary.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("psql inspection returned a non-array cost-event summary.");
  return parsed;
}

function emptyTotals() {
  return {
    costEvents: 0,
    providerRunCostLinks: 0,
    warnings: 0,
  };
}

function stringValue(value, maxLength = 1000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function positiveIntegerOrNull(value) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function timestampOrEmpty(value) {
  const text = stringValue(value);
  if (!text) return "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlUuidOrNull(value) {
  const text = stringValue(value);
  return text ? sqlUuid(text) : "null";
}

function sqlUuidArray(values = []) {
  if (!values.length) return "ARRAY[]::uuid[]";
  return `ARRAY[${values.map((value) => sqlUuid(value)).join(", ")}]`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlStringOrNull(value) {
  const text = stringValue(value);
  return text ? sqlString(text) : "null";
}

function sqlIntegerOrNull(value) {
  return value === null || value === undefined ? "null" : String(Number.parseInt(String(value), 10));
}

function sqlNumericOrNull(value) {
  return value === null || value === undefined ? "null" : String(Number(value));
}

function sqlTimestampOrNow(value) {
  const text = timestampOrEmpty(value);
  return text ? `${sqlString(text)}::timestamptz` : "now()";
}

function redactSecret(value) {
  return String(value || "").replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@");
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseArgs(process.argv.slice(2));
  const plan = await collectLocalCostEventHydrationPlan({ appDir: args.appDir, mattersHome: args.mattersHome });
  if (args.inspect) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = inspectLocalCostEventHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderCostEventHydrationInspection(result)) console.log(line);
    return;
  }
  if (args.verify) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = verifyLocalCostEventHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderCostEventHydrationVerification(result)) console.log(line);
    if (!result.matched) process.exitCode = 1;
    return;
  }
  if (!args.dryRun) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = applyLocalCostEventHydrationPlan({ databaseUrl, plan });
    const report = { ...costEventHydrationReportFromPlan(plan), mode: "apply", databaseWrites: true };
    if (args.json) console.log(JSON.stringify({ ...report, insertedRows: result.insertedRows }, null, 2));
    else {
      for (const line of renderShadowCostEventReport(report)) console.log(line);
      console.log("cost_event_shadow_hydration: applied");
    }
    return;
  }
  const report = costEventHydrationReportFromPlan(plan);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else for (const line of renderShadowCostEventReport(report)) console.log(line);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
