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
import {
  collectLocalProviderRunHydrationPlan,
} from "./db-hydrate-local-provider-runs.mjs";

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

export async function collectLocalJobHydrationPlan({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
  matterPlan = null,
  providerRunPlan = null,
} = {}) {
  const resolvedMatterPlan = matterPlan || await collectLocalMatterHydrationPlan({ mattersHome });
  const resolvedProviderRunPlan = providerRunPlan || await collectLocalProviderRunHydrationPlan({ appDir, mattersHome });
  return buildShadowJobPlan({
    appDir,
    mattersHome,
    matterPlan: resolvedMatterPlan,
    providerRunPlan: resolvedProviderRunPlan,
  });
}

export function buildShadowJobPlan({
  appDir = "",
  mattersHome = "",
  matterPlan = {},
  providerRunPlan = {},
} = {}) {
  const tenant = providerRunPlan.tenant || matterPlan.tenant || {
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
    processingJobs: [],
    providerRunJobLinks: [],
    warnings: [],
  };
  const artifactKindById = buildNativeArtifactKindIndex(matterPlan.matters || []);
  const seen = new Set();

  for (const providerRun of providerRunPlan.providerRuns || []) {
    const jobKind = jobKindForProviderRun(providerRun, artifactKindById);
    if (!jobKind) {
      plan.warnings.push(`No processing job kind for provider run ${providerRun.id || "(missing id)"} task=${providerRun.taskClass || ""}.`);
      continue;
    }
    const processingJob = processingJobFromProviderRun({
      tenantId: tenant.id,
      providerRun,
      kind: jobKind,
    });
    if (seen.has(processingJob.id)) continue;
    seen.add(processingJob.id);
    plan.processingJobs.push(processingJob);
    plan.providerRunJobLinks.push({
      providerRunId: stringValue(providerRun.id),
      jobId: processingJob.id,
    });
  }

  plan.totals = {
    processingJobs: plan.processingJobs.length,
    providerRunJobLinks: plan.providerRunJobLinks.length,
    warnings: plan.warnings.length,
  };
  plan.plannedRows = {
    processingJobs: plan.processingJobs.length,
    providerRunJobLinks: plan.providerRunJobLinks.length,
  };
  return plan;
}

export function jobHydrationReportFromPlan(plan = {}) {
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

export function buildLocalJobHydrationSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Job hydration plan is missing tenant.id.");
  const lines = [
    "begin;",
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, true);`,
  ];

  for (const job of plan.processingJobs || []) {
    lines.push(processingJobSql(job));
  }
  for (const link of plan.providerRunJobLinks || []) {
    lines.push(`update provider_runs set job_id = ${sqlUuid(link.jobId)} where id = ${sqlUuid(link.providerRunId)} and tenant_id = current_app_tenant_id();`);
  }

  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

export function applyLocalJobHydrationPlan({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before applying job shadow hydration.");
  const { args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn("psql", [...args, "-v", "ON_ERROR_STOP=1"], {
    input: buildLocalJobHydrationSql(plan),
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

export function buildJobHydrationCountSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Job hydration plan is missing tenant.id.");
  const jobIds = (plan.processingJobs || []).map((job) => job.id).filter(Boolean);
  const providerRunIds = (plan.providerRunJobLinks || []).map((link) => link.providerRunId).filter(Boolean);

  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select 'processing_jobs' as key, count(*)::int as count from processing_jobs where id = any (" + sqlUuidArray(jobIds) + ")",
    "union all",
    "select 'provider_run_job_links' as key, count(*)::int as count from provider_runs where id = any (" + sqlUuidArray(providerRunIds) + ") and job_id is not null;",
    "",
  ].join("\n");
}

export function verifyLocalJobHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before verifying job shadow hydration.");
  const { args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn("psql", [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|"], {
    input: buildJobHydrationCountSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const counts = parsePipeCounts(result.stdout || "");
  const expected = expectedJobHydrationCounts(plan);
  const mismatches = countMismatches({ expected, counts });
  return { matched: mismatches.length === 0, expected, counts, mismatches };
}

export function buildJobInspectionSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Job hydration plan is missing tenant.id.");
  const jobIds = (plan.processingJobs || []).map((job) => job.id).filter(Boolean);
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with job_rows as (",
    "  select kind, status, count(*)::int as count",
    "  from processing_jobs",
    "  where tenant_id = current_app_tenant_id()",
    `    and id = any (${sqlUuidArray(jobIds)})`,
    "  group by kind, status",
    ")",
    "select coalesce(jsonb_agg(to_jsonb(job_rows) order by kind, status), '[]'::jsonb)::text from job_rows;",
    "",
  ].join("\n");
}

export function inspectLocalJobHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before inspecting job shadow hydration.");
  const { args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn("psql", [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: buildJobInspectionSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const groups = parsePsqlJsonArray(result.stdout || "").map((row) => ({
    kind: stringValue(row.kind),
    status: stringValue(row.status),
    count: Number(row.count) || 0,
  }));
  return {
    tenantId: plan?.tenant?.id || "",
    groups,
    totals: {
      processingJobs: groups.reduce((sum, row) => sum + row.count, 0),
    },
  };
}

export function renderShadowJobReport(report = {}) {
  const totals = report.totals || emptyTotals();
  const lines = [
    "Matter Workbench local job DB hydration",
    `mode: ${report.mode || "dry-run"}`,
    `database_writes: ${report.databaseWrites ? "yes" : "no"}`,
    `matters_home: ${report.mattersHome || ""}`,
    "totals:",
    `  processing_jobs: ${totals.processingJobs || 0}`,
    `  provider_run_job_links: ${totals.providerRunJobLinks || 0}`,
    `  warnings: ${totals.warnings || 0}`,
    "planned_rows:",
    `  processing_jobs: ${report.plannedRows?.processingJobs || 0}`,
    `  provider_run_job_links: ${report.plannedRows?.providerRunJobLinks || 0}`,
  ];
  for (const warning of report.warnings || []) lines.push(`warning: ${warning}`);
  return lines;
}

export function renderJobHydrationVerification(result = {}) {
  const lines = [
    "Matter Workbench job shadow hydration verification",
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

export function renderJobHydrationInspection(result = {}) {
  const lines = [
    "Matter Workbench job shadow DB inspection",
    `tenant_id: ${result.tenantId || ""}`,
    `processing_jobs: ${result.totals?.processingJobs || 0}`,
    "groups:",
  ];
  for (const group of result.groups || []) {
    lines.push(`  ${group.kind} ${group.status}: ${group.count}`);
  }
  if (!result.groups?.length) lines.push("  (none)");
  return lines;
}

function buildNativeArtifactKindIndex(matters = []) {
  const index = new Map();
  for (const matter of matters) {
    const matterId = stringValue(matter.id);
    if (!matterId) continue;
    if (matter.artifacts?.sourceIndex?.present) {
      index.set(deterministicUuid(`artifact:${matterId}:source_index:json`), "source_labels");
    }
    if (matter.artifacts?.listOfDates?.present) {
      index.set(deterministicUuid(`artifact:${matterId}:list_of_dates:json`), "list_of_dates");
    }
  }
  return index;
}

function jobKindForProviderRun(providerRun = {}, artifactKindById = new Map()) {
  const taskClass = stringValue(providerRun.taskClass);
  if (taskClass === "native_source_skill") {
    return artifactKindById.get(stringValue(providerRun.outputArtifactId)) || "";
  }
  if (taskClass === "skill_creation" || taskClass === "skill_modification" || taskClass === "skill_execution") {
    return "custom_skill";
  }
  if (taskClass === "validation") return "validation";
  return "";
}

function processingJobFromProviderRun({ tenantId, providerRun, kind }) {
  const providerRunId = stringValue(providerRun.id);
  const status = processingJobStatus(providerRun.status);
  return {
    id: deterministicUuid(`processing-job:provider-run:${providerRunId}`),
    tenantId,
    matterId: stringValue(providerRun.matterId),
    kind,
    status,
    idempotencyKey: `local-shadow:provider-run:${providerRunId}`,
    startedAt: timestampOrEmpty(providerRun.startedAt),
    finishedAt: status === "running" ? "" : timestampOrEmpty(providerRun.finishedAt || providerRun.startedAt),
    errorCode: stringValue(providerRun.errorCode, 200),
    errorMessage: stringValue(providerRun.errorMessage, 800),
    createdAt: timestampOrEmpty(providerRun.startedAt || providerRun.finishedAt),
  };
}

function processingJobStatus(value) {
  const normalized = stringValue(value).toLowerCase();
  if (normalized === "succeeded" || normalized === "failed" || normalized === "cancelled") return normalized;
  if (normalized === "retrying") return "retrying";
  return "running";
}

function processingJobSql(job) {
  return `insert into processing_jobs (id, tenant_id, matter_id, kind, status, idempotency_key, started_at, finished_at, error_code, error_message, created_at) values (${sqlUuid(job.id)}, ${sqlUuid(job.tenantId)}, ${sqlUuidOrNull(job.matterId)}, ${sqlString(job.kind)}, ${sqlString(job.status)}, ${sqlString(job.idempotencyKey)}, ${sqlTimestampOrNow(job.startedAt)}, ${sqlTimestampOrNull(job.finishedAt)}, ${sqlString(job.errorCode)}, ${sqlString(job.errorMessage)}, ${sqlTimestampOrNow(job.createdAt)}) on conflict (id) do update set matter_id = excluded.matter_id, kind = excluded.kind, status = excluded.status, idempotency_key = excluded.idempotency_key, started_at = excluded.started_at, finished_at = excluded.finished_at, error_code = excluded.error_code, error_message = excluded.error_message, created_at = excluded.created_at;`;
}

function expectedJobHydrationCounts(plan = {}) {
  return {
    processing_jobs: plan.plannedRows?.processingJobs || 0,
    provider_run_job_links: plan.plannedRows?.providerRunJobLinks || 0,
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
  if (start < 0 || end < start) throw new Error("psql inspection returned no JSON job summary.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("psql inspection returned a non-array job summary.");
  return parsed;
}

function emptyTotals() {
  return {
    processingJobs: 0,
    providerRunJobLinks: 0,
    warnings: 0,
  };
}

function stringValue(value, maxLength = 1000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function timestampOrEmpty(value) {
  const text = stringValue(value);
  if (!text) return "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
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

function sqlTimestampOrNow(value) {
  const text = timestampOrEmpty(value);
  return text ? `${sqlString(text)}::timestamptz` : "now()";
}

function sqlTimestampOrNull(value) {
  const text = timestampOrEmpty(value);
  return text ? `${sqlString(text)}::timestamptz` : "null";
}

function psqlConnectionArgs(databaseUrl) {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return {
    args: [
      "-h",
      url.hostname,
      "-p",
      url.port || "5432",
      "-U",
      decodeURIComponent(url.username),
      "-d",
      database,
    ],
    env: {
      ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {}),
    },
  };
}

function redactSecret(value) {
  return String(value || "").replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = await collectLocalJobHydrationPlan({ appDir: args.appDir, mattersHome: args.mattersHome });
  if (args.inspect) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = inspectLocalJobHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderJobHydrationInspection(result)) console.log(line);
    return;
  }
  if (args.verify) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = verifyLocalJobHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderJobHydrationVerification(result)) console.log(line);
    if (!result.matched) process.exitCode = 1;
    return;
  }
  if (!args.dryRun) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = applyLocalJobHydrationPlan({ databaseUrl, plan });
    const report = { ...jobHydrationReportFromPlan(plan), mode: "apply", databaseWrites: true };
    if (args.json) console.log(JSON.stringify({ ...report, insertedRows: result.insertedRows }, null, 2));
    else {
      for (const line of renderShadowJobReport(report)) console.log(line);
      console.log("job_shadow_hydration: applied");
    }
    return;
  }
  const report = jobHydrationReportFromPlan(plan);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else for (const line of renderShadowJobReport(report)) console.log(line);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
