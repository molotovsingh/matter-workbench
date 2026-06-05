#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  collectLocalMatterHydrationPlan,
  defaultMattersHome,
} from "./db-hydrate-local-matters.mjs";
import { collectLocalSkillHydrationPlan } from "./db-hydrate-local-skills.mjs";
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

export async function collectLocalProviderRunHydrationPlan({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
} = {}) {
  const matterPlan = await collectLocalMatterHydrationPlan({ mattersHome });
  const skillPlan = await collectLocalSkillHydrationPlan({ appDir, mattersHome });
  return buildShadowProviderRunPlan({ matterPlan, skillPlan, appDir, mattersHome });
}

export function buildShadowProviderRunPlan({
  matterPlan = {},
  skillPlan = {},
  appDir = "",
  mattersHome = "",
} = {}) {
  const tenant = matterPlan.tenant || skillPlan.tenant || {
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
    providerRuns: [],
    matterArtifactLinks: [],
    skillSampleLinks: [],
    configurableSkillRunLinks: [],
    warnings: [],
  };
  const seen = new Set();

  for (const matter of matterPlan.matters || []) {
    appendMatterArtifactProviderRuns(plan, { tenantId: tenant.id, matter, seen });
  }
  for (const sample of skillPlan.samples || []) {
    appendSkillSampleProviderRun(plan, { tenantId: tenant.id, sample, seen });
  }
  for (const run of skillPlan.runs || []) {
    appendConfigurableSkillRunProviderRun(plan, { tenantId: tenant.id, run, seen });
  }

  plan.totals = {
    providerRuns: plan.providerRuns.length,
    matterArtifactLinks: plan.matterArtifactLinks.length,
    skillSampleLinks: plan.skillSampleLinks.length,
    configurableSkillRunLinks: plan.configurableSkillRunLinks.length,
    warnings: plan.warnings.length,
  };
  plan.plannedRows = {
    providerRuns: plan.providerRuns.length,
    matterArtifactProviderLinks: plan.matterArtifactLinks.length,
    skillSampleAiRunLinks: plan.skillSampleLinks.length,
    configurableSkillRunProviderLinks: plan.configurableSkillRunLinks.length,
  };
  return plan;
}

export function providerRunHydrationReportFromPlan(plan = {}) {
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

export function buildLocalProviderRunHydrationSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Provider-run hydration plan is missing tenant.id.");
  const lines = [
    "begin;",
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, true);`,
  ];

  for (const run of plan.providerRuns || []) {
    lines.push(providerRunSql(run));
  }
  for (const link of plan.skillSampleLinks || []) {
    lines.push(`update skill_samples set ai_run_id = ${sqlUuid(link.providerRunId)} where id = ${sqlString(link.sampleId)} and tenant_id = current_app_tenant_id();`);
  }
  for (const link of plan.configurableSkillRunLinks || []) {
    lines.push(`update configurable_skill_runs set provider_run_id = ${sqlUuid(link.providerRunId)} where id = ${sqlUuid(link.runId)} and tenant_id = current_app_tenant_id();`);
  }

  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

export function applyLocalProviderRunHydrationPlan({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before applying provider-run shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1"], {
    input: buildLocalProviderRunHydrationSql(plan),
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

export function buildProviderRunHydrationCountSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Provider-run hydration plan is missing tenant.id.");
  const providerRunIds = (plan.providerRuns || []).map((run) => run.id).filter(Boolean);
  const artifactIds = (plan.matterArtifactLinks || []).map((link) => link.artifactId).filter(Boolean);
  const sampleIds = (plan.skillSampleLinks || []).map((link) => link.sampleId).filter(Boolean);
  const runIds = (plan.configurableSkillRunLinks || []).map((link) => link.runId).filter(Boolean);

  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select 'provider_runs' as key, count(*)::int as count from provider_runs where id = any (" + sqlUuidArray(providerRunIds) + ")",
    "union all",
    "select 'matter_artifact_provider_links' as key, count(*)::int as count from provider_runs where output_artifact_id = any (" + sqlUuidArray(artifactIds) + ")",
    "union all",
    "select 'skill_sample_ai_run_links' as key, count(*)::int as count from skill_samples where id = any (" + sqlTextArray(sampleIds) + ") and ai_run_id is not null",
    "union all",
    "select 'configurable_skill_run_provider_links' as key, count(*)::int as count from configurable_skill_runs where id = any (" + sqlUuidArray(runIds) + ") and provider_run_id is not null;",
    "",
  ].join("\n");
}

export function verifyLocalProviderRunHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before verifying provider-run shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|"], {
    input: buildProviderRunHydrationCountSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const counts = parsePipeCounts(result.stdout || "");
  const expected = expectedProviderRunHydrationCounts(plan);
  const mismatches = countMismatches({ expected, counts });
  return { matched: mismatches.length === 0, expected, counts, mismatches };
}

export function buildProviderRunInspectionSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Provider-run hydration plan is missing tenant.id.");
  const providerRunIds = (plan.providerRuns || []).map((run) => run.id).filter(Boolean);
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with provider_rows as (",
    "  select task_class, provider, model, count(*)::int as count",
    "  from provider_runs",
    "  where tenant_id = current_app_tenant_id()",
    `    and id = any (${sqlUuidArray(providerRunIds)})`,
    "  group by task_class, provider, model",
    ")",
    "select coalesce(jsonb_agg(to_jsonb(provider_rows) order by task_class, provider, model), '[]'::jsonb)::text from provider_rows;",
    "",
  ].join("\n");
}

export function inspectLocalProviderRunHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before inspecting provider-run shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: buildProviderRunInspectionSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const groups = parsePsqlJsonArray(result.stdout || "").map((row) => ({
    taskClass: stringValue(row.task_class),
    provider: stringValue(row.provider),
    model: stringValue(row.model),
    count: Number(row.count) || 0,
  }));
  return {
    tenantId: plan?.tenant?.id || "",
    groups,
    totals: {
      providerRuns: groups.reduce((sum, row) => sum + row.count, 0),
    },
  };
}

export function renderShadowProviderRunReport(report = {}) {
  const totals = report.totals || emptyTotals();
  const lines = [
    "Matter Workbench local provider-run DB hydration",
    `mode: ${report.mode || "dry-run"}`,
    `database_writes: ${report.databaseWrites ? "yes" : "no"}`,
    `matters_home: ${report.mattersHome || ""}`,
    "totals:",
    `  provider_runs: ${totals.providerRuns || 0}`,
    `  matter_artifact_links: ${totals.matterArtifactLinks || 0}`,
    `  skill_sample_links: ${totals.skillSampleLinks || 0}`,
    `  configurable_skill_run_links: ${totals.configurableSkillRunLinks || 0}`,
    `  warnings: ${totals.warnings || 0}`,
    "planned_rows:",
    `  provider_runs: ${report.plannedRows?.providerRuns || 0}`,
    `  matter_artifact_provider_links: ${report.plannedRows?.matterArtifactProviderLinks || 0}`,
    `  skill_sample_ai_run_links: ${report.plannedRows?.skillSampleAiRunLinks || 0}`,
    `  configurable_skill_run_provider_links: ${report.plannedRows?.configurableSkillRunProviderLinks || 0}`,
  ];
  for (const warning of report.warnings || []) lines.push(`warning: ${warning}`);
  return lines;
}

export function renderProviderRunHydrationVerification(result = {}) {
  const lines = [
    "Matter Workbench provider-run shadow hydration verification",
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

export function renderProviderRunHydrationInspection(result = {}) {
  const lines = [
    "Matter Workbench provider-run shadow DB inspection",
    `tenant_id: ${result.tenantId || ""}`,
    `provider_runs: ${result.totals?.providerRuns || 0}`,
    "groups:",
  ];
  for (const group of result.groups || []) {
    lines.push(`  ${group.taskClass} ${group.provider}/${group.model}: ${group.count}`);
  }
  if (!result.groups?.length) lines.push("  (none)");
  return lines;
}

function appendMatterArtifactProviderRuns(plan, { tenantId, matter, seen }) {
  const artifacts = [
    ["source_index", matter.artifacts?.sourceIndex],
    ["list_of_dates", matter.artifacts?.listOfDates],
  ];
  for (const [family, artifact] of artifacts) {
    if (!artifact?.present || !artifact?.path) continue;
    const aiRun = normalizeAiRun(artifact.aiRun);
    if (!isUsableAiRun(aiRun)) continue;
    const artifactId = deterministicUuid(`artifact:${matter.id}:${family}:json`);
    const providerRun = providerRunFromAiRun({
      tenantId,
      matterId: matter.id,
      aiRun,
      taskClass: "native_source_skill",
      status: "succeeded",
      startedAt: artifact.generatedAt,
      finishedAt: artifact.generatedAt,
      outputArtifactId: artifactId,
      idSeed: `provider-run:artifact:${matter.id}:${family}:${artifact.path}:${artifact.generatedAt || ""}`,
    });
    addProviderRun(plan, providerRun, seen);
    plan.matterArtifactLinks.push({
      artifactId,
      providerRunId: providerRun.id,
    });
  }
}

function appendSkillSampleProviderRun(plan, { tenantId, sample, seen }) {
  const aiRun = normalizeAiRun(sample.aiRun);
  if (!isUsableAiRun(aiRun)) return;
  const providerRun = providerRunFromAiRun({
    tenantId,
    matterId: sample.matterId,
    aiRun,
    taskClass: "skill_creation",
    status: "succeeded",
    startedAt: sample.createdAt,
    finishedAt: sample.approvedAt || sample.updatedAt || sample.createdAt,
    idSeed: `provider-run:skill-sample:${sample.id}`,
  });
  addProviderRun(plan, providerRun, seen);
  plan.skillSampleLinks.push({ sampleId: sample.id, providerRunId: providerRun.id });
}

function appendConfigurableSkillRunProviderRun(plan, { tenantId, run, seen }) {
  const aiRun = normalizeAiRun(run.aiRun);
  if (!isUsableAiRun(aiRun)) return;
  const providerRun = providerRunFromAiRun({
    tenantId,
    matterId: run.matterId,
    aiRun,
    taskClass: "skill_execution",
    status: providerRunStatus(run.status),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorCode: run.status === "failed" ? "local_skill_run_failed" : "",
    errorMessage: run.errorMessage,
    idSeed: `provider-run:configurable-skill-run:${run.localId || run.id}`,
  });
  addProviderRun(plan, providerRun, seen);
  plan.configurableSkillRunLinks.push({ runId: run.id, providerRunId: providerRun.id });
}

function addProviderRun(plan, providerRun, seen) {
  if (seen.has(providerRun.id)) return;
  seen.add(providerRun.id);
  plan.providerRuns.push(providerRun);
}

function providerRunFromAiRun({
  tenantId,
  matterId = "",
  aiRun,
  taskClass,
  status,
  startedAt = "",
  finishedAt = "",
  errorCode = "",
  errorMessage = "",
  outputArtifactId = "",
  idSeed,
}) {
  const usage = objectValue(aiRun.usage);
  const inputTokens = positiveIntegerOrNull(usage.promptTokens ?? usage.inputTokens);
  const outputTokens = positiveIntegerOrNull(usage.completionTokens ?? usage.outputTokens);
  const costAmount = numberOrNull(usage.cost ?? usage.costAmount);
  return {
    id: deterministicUuid(idSeed),
    tenantId,
    matterId: stringValue(matterId),
    taskClass,
    provider: stringValue(aiRun.provider),
    model: stringValue(aiRun.model),
    policyPromptVersion: stringValue(aiRun.policyPromptVersion),
    promptVersion: stringValue(aiRun.policyVersion || aiRun.promptVersion),
    status,
    outputArtifactId: stringValue(outputArtifactId),
    errorCode: stringValue(errorCode, 200),
    errorMessage: stringValue(errorMessage, 800),
    usageJson: safeUsageJson(aiRun),
    inputTokens,
    outputTokens,
    costAmount,
    costCurrency: costAmount === null ? "" : "USD",
    costConfidence: costAmount === null ? "unknown" : "actual",
    startedAt: timestampOrEmpty(startedAt),
    finishedAt: timestampOrEmpty(finishedAt || startedAt),
  };
}

function providerRunSql(run) {
  return `insert into provider_runs (id, tenant_id, matter_id, output_artifact_id, task_class, provider, model, policy_prompt_version, prompt_version, status, error_code, error_message, usage_json, input_tokens, output_tokens, cost_amount, cost_currency, cost_confidence, started_at, finished_at) values (${sqlUuid(run.id)}, ${sqlUuid(run.tenantId)}, ${sqlUuidOrNull(run.matterId)}, ${sqlUuidOrNull(run.outputArtifactId)}, ${sqlString(run.taskClass)}, ${sqlString(run.provider)}, ${sqlString(run.model)}, ${sqlString(run.policyPromptVersion)}, ${sqlString(run.promptVersion)}, ${sqlString(run.status)}, ${sqlString(run.errorCode)}, ${sqlString(run.errorMessage)}, ${sqlJson(run.usageJson)}, ${sqlIntegerOrNull(run.inputTokens)}, ${sqlIntegerOrNull(run.outputTokens)}, ${sqlNumericOrNull(run.costAmount)}, ${sqlStringOrNull(run.costCurrency)}, ${sqlString(run.costConfidence)}, ${sqlTimestampOrNow(run.startedAt)}, ${sqlTimestampOrNull(run.finishedAt)}) on conflict (id) do update set matter_id = excluded.matter_id, output_artifact_id = excluded.output_artifact_id, task_class = excluded.task_class, provider = excluded.provider, model = excluded.model, policy_prompt_version = excluded.policy_prompt_version, prompt_version = excluded.prompt_version, status = excluded.status, error_code = excluded.error_code, error_message = excluded.error_message, usage_json = excluded.usage_json, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, cost_amount = excluded.cost_amount, cost_currency = excluded.cost_currency, cost_confidence = excluded.cost_confidence, started_at = excluded.started_at, finished_at = excluded.finished_at;`;
}

function normalizeAiRun(value) {
  const source = objectValue(value);
  return {
    provider: stringValue(source.provider),
    model: stringValue(source.model),
    task: stringValue(source.task),
    policyPromptVersion: stringValue(source.policyPromptVersion),
    policyVersion: stringValue(source.policyVersion),
    promptVersion: stringValue(source.promptVersion),
    usage: objectValue(source.usage),
    returnedModel: stringValue(source.returnedModel),
    returnedProvider: stringValue(source.returnedProvider),
  };
}

function isUsableAiRun(aiRun) {
  return Boolean(stringValue(aiRun.provider) && stringValue(aiRun.model));
}

function safeUsageJson(aiRun) {
  const usage = objectValue(aiRun.usage);
  return {
    task: stringValue(aiRun.task),
    returnedModel: stringValue(aiRun.returnedModel),
    returnedProvider: stringValue(aiRun.returnedProvider),
    usage: {
      promptTokens: positiveIntegerOrNull(usage.promptTokens ?? usage.inputTokens),
      completionTokens: positiveIntegerOrNull(usage.completionTokens ?? usage.outputTokens),
      totalTokens: positiveIntegerOrNull(usage.totalTokens),
      cost: numberOrNull(usage.cost ?? usage.costAmount),
    },
  };
}

function providerRunStatus(status) {
  const normalized = stringValue(status);
  if (normalized === "running") return "started";
  if (normalized === "failed") return "failed";
  if (normalized === "cancelled") return "cancelled";
  return "succeeded";
}

function expectedProviderRunHydrationCounts(plan = {}) {
  return {
    provider_runs: plan.plannedRows?.providerRuns || 0,
    matter_artifact_provider_links: plan.plannedRows?.matterArtifactProviderLinks || 0,
    skill_sample_ai_run_links: plan.plannedRows?.skillSampleAiRunLinks || 0,
    configurable_skill_run_provider_links: plan.plannedRows?.configurableSkillRunProviderLinks || 0,
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
  if (start < 0 || end < start) throw new Error("psql inspection returned no JSON provider-run summary.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("psql inspection returned a non-array provider-run summary.");
  return parsed;
}

function emptyTotals() {
  return {
    providerRuns: 0,
    matterArtifactLinks: 0,
    skillSampleLinks: 0,
    configurableSkillRunLinks: 0,
    warnings: 0,
  };
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function sqlTextArray(values = []) {
  if (!values.length) return "ARRAY[]::text[]";
  return `ARRAY[${values.map((value) => sqlString(value)).join(", ")}]::text[]`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlStringOrNull(value) {
  const text = stringValue(value);
  return text ? sqlString(text) : "null";
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
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

function sqlTimestampOrNull(value) {
  const text = timestampOrEmpty(value);
  return text ? `${sqlString(text)}::timestamptz` : "null";
}

function redactSecret(value) {
  return String(value || "").replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@");
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseArgs(process.argv.slice(2));
  const plan = await collectLocalProviderRunHydrationPlan({ appDir: args.appDir, mattersHome: args.mattersHome });
  if (args.inspect) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = inspectLocalProviderRunHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderProviderRunHydrationInspection(result)) console.log(line);
    return;
  }
  if (args.verify) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = verifyLocalProviderRunHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderProviderRunHydrationVerification(result)) console.log(line);
    if (!result.matched) process.exitCode = 1;
    return;
  }
  if (!args.dryRun) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = applyLocalProviderRunHydrationPlan({ databaseUrl, plan });
    const report = { ...providerRunHydrationReportFromPlan(plan), mode: "apply", databaseWrites: true };
    if (args.json) console.log(JSON.stringify({ ...report, insertedRows: result.insertedRows }, null, 2));
    else {
      for (const line of renderShadowProviderRunReport(report)) console.log(line);
      console.log("provider_run_shadow_hydration: applied");
    }
    return;
  }
  const report = providerRunHydrationReportFromPlan(plan);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else for (const line of renderShadowProviderRunReport(report)) console.log(line);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
