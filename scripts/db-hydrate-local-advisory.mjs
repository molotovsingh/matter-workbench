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
import { buildMatterAttentionReport } from "./matter-attention-report.mjs";

const __filename = fileURLToPath(import.meta.url);
const LOCAL_ATTENTION_EVIDENCE_PREFIX = "local-attention:";
const ALLOWED_CATEGORIES = new Set([
  "intake",
  "extraction",
  "source_labels",
  "chronology",
  "provider",
  "custom_skill",
  "artifact",
  "security",
  "system",
]);
const ALLOWED_SEVERITIES = new Set(["blocker", "warning", "info"]);

export function parseArgs(argv = []) {
  const parsed = {
    dryRun: true,
    verify: false,
    inspect: false,
    json: false,
    appDir: process.cwd(),
    mattersHome: defaultMattersHome(),
    matter: "",
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
    } else if (arg === "--matter") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matter requires a value");
      parsed.matter = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function collectLocalAdvisoryHydrationPlan({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
  matter = "",
} = {}) {
  const matterPlan = await collectLocalMatterHydrationPlan({ mattersHome });
  const attentionReport = await buildMatterAttentionReport({ appDir, mattersHome, matter });
  return buildShadowAdvisoryPlan({ matterPlan, attentionReport, appDir, mattersHome });
}

export function buildShadowAdvisoryPlan({
  matterPlan = {},
  attentionReport = {},
  appDir = "",
  mattersHome = "",
} = {}) {
  const matterIndex = buildMatterIndex(matterPlan.matters || []);
  const warnings = [];
  const matters = [];

  for (const matterReport of attentionReport.matters || []) {
    const matterName = stringValue(matterReport.matterName);
    const matter = matterIndex.get(normalizeKey(matterName));
    if (!matter) {
      warnings.push(`${matterName || "(unknown matter)"} has advisory items but no mirrored matter row; skipped.`);
      continue;
    }
    const items = (matterReport.items || []).map((item) => normalizeAdvisoryItem({ item, matterId: matter.id }));
    const summary = summarizeItems(items);
    matters.push({
      id: matter.id,
      name: matter.name,
      folderName: matter.folderName,
      summary,
      items,
      renderedSummaryJson: {
        schema_version: "shadow-advisory-summary/v1",
        matterName: matter.name,
        summary,
        items: items.map((item) => ({
          id: item.localId,
          severity: item.severity,
          category: item.category,
          code: item.code,
          title: item.title,
          detail: item.detail,
          action: item.action,
          evidence: item.evidence,
        })),
      },
    });
  }

  const totals = matters.reduce((acc, matter) => {
    acc.matters += 1;
    acc.items += matter.items.length;
    acc.blocker += matter.summary.blocker;
    acc.warning += matter.summary.warning;
    acc.info += matter.summary.info;
    return acc;
  }, emptyTotals());

  return {
    mode: "dry-run",
    databaseWrites: false,
    appDir,
    mattersHome,
    generatedAt: attentionReport.generated_at || "",
    tenant: matterPlan.tenant || {
      id: deterministicUuid("tenant:local-shadow"),
      name: "Matter Workbench Local Shadow",
      type: "internal_test",
    },
    totals,
    plannedRows: {
      incidents: totals.items,
      preparationAdvisorySnapshots: totals.matters,
    },
    matters,
    warnings,
  };
}

export function advisoryHydrationReportFromPlan(plan = {}) {
  return {
    mode: plan.mode || "dry-run",
    databaseWrites: Boolean(plan.databaseWrites),
    appDir: plan.appDir || "",
    mattersHome: plan.mattersHome || "",
    generatedAt: plan.generatedAt || "",
    totals: plan.totals || emptyTotals(),
    plannedRows: plan.plannedRows || {},
    warnings: plan.warnings || [],
    matters: (plan.matters || []).map((matter) => ({
      name: matter.name,
      folderName: matter.folderName,
      summary: matter.summary,
      itemCount: matter.items?.length || 0,
    })),
  };
}

export function buildLocalAdvisoryHydrationSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Advisory hydration plan is missing tenant.id.");
  const lines = [
    "begin;",
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, true);`,
  ];

  for (const matter of plan.matters || []) {
    const sourceIds = (matter.items || []).map((item) => item.sourceId).filter(Boolean);
    for (const item of matter.items || []) {
      lines.push([
        "select upsert_incident(",
        `  p_matter_id => ${sqlUuid(matter.id)},`,
        `  p_source_type => ${sqlString(item.sourceType)},`,
        `  p_source_id => ${sqlUuid(item.sourceId)},`,
        `  p_category => ${sqlString(item.category)},`,
        `  p_code => ${sqlString(item.code)},`,
        `  p_title => ${sqlString(item.title)},`,
        `  p_detail => ${sqlStringOrNull(item.detail)},`,
        `  p_evidence_ref => ${sqlString(item.evidenceRef)},`,
        `  p_severity => ${sqlString(item.severity)}`,
        ");",
      ].join("\n"));
    }
    lines.push([
      "update incidents",
      "set status = 'resolved',",
      "    resolved_at = now()",
      "where tenant_id = current_app_tenant_id()",
      `  and matter_id = ${sqlUuid(matter.id)}`,
      "  and source_type = 'manual'",
      `  and evidence_ref like ${sqlString(`${LOCAL_ATTENTION_EVIDENCE_PREFIX}%`)}`,
      `  and source_id <> all (${sqlUuidArray(sourceIds)});`,
    ].join("\n"));
    lines.push([
      "select create_preparation_advisory_snapshot(",
      `  p_matter_id => ${sqlUuid(matter.id)},`,
      "  p_preparation_run_id => null,",
      "  p_generated_by_job_id => null,",
      `  p_rendered_summary_json => ${sqlJsonb(matter.renderedSummaryJson || {})},`,
      "  p_app_version => 'local-shadow',",
      `  p_policy_versions_json => ${sqlJsonb({ attention_schema: "matter-attention/v1", source: "local-shadow" })}`,
      ");",
    ].join("\n"));
  }

  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

export function applyLocalAdvisoryHydrationPlan({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before applying advisory shadow hydration.");
  const { args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn("psql", [...args, "-v", "ON_ERROR_STOP=1"], {
    input: buildLocalAdvisoryHydrationSql(plan),
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

export function buildAdvisoryHydrationCountSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Advisory hydration plan is missing tenant.id.");
  const matterIds = (plan.matters || []).map((matter) => matter.id).filter(Boolean);
  const matterFilter = matterIds.length ? `matter_id = any (${sqlUuidArray(matterIds)})` : "false";
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with latest_snapshots as (",
    "  select distinct on (matter_id)",
    "    matter_id, blocker_count, warning_count, info_count",
    "  from preparation_advisory_snapshots",
    "  where tenant_id = current_app_tenant_id()",
    `    and ${matterFilter}`,
    "  order by matter_id, created_at desc",
    "), count_rows as (",
    "  select 'open_local_attention_incidents' as key, count(*)::int as count",
    "  from incidents",
    "  where tenant_id = current_app_tenant_id()",
    `    and ${matterFilter}`,
    "    and source_type = 'manual'",
    "    and status = 'open'",
    `    and evidence_ref like ${sqlString(`${LOCAL_ATTENTION_EVIDENCE_PREFIX}%`)}`,
    "  union all",
    "  select 'latest_advisory_snapshot_matters' as key, count(*)::int as count from latest_snapshots",
    "  union all",
    "  select 'latest_snapshot_blockers' as key, coalesce(sum(blocker_count), 0)::int as count from latest_snapshots",
    "  union all",
    "  select 'latest_snapshot_warnings' as key, coalesce(sum(warning_count), 0)::int as count from latest_snapshots",
    "  union all",
    "  select 'latest_snapshot_info' as key, coalesce(sum(info_count), 0)::int as count from latest_snapshots",
    ")",
    "select key, count from count_rows;",
    "",
  ].join("\n");
}

export function verifyLocalAdvisoryHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before verifying advisory shadow hydration.");
  const { args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn("psql", [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|"], {
    input: buildAdvisoryHydrationCountSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const counts = parsePipeCounts(result.stdout || "");
  const expected = expectedAdvisoryHydrationCounts(plan);
  const mismatches = countMismatches({ expected, counts });
  return {
    matched: mismatches.length === 0,
    expected,
    counts,
    mismatches,
  };
}

export function buildAdvisoryInspectionSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Advisory hydration plan is missing tenant.id.");
  const matterIds = (plan.matters || []).map((matter) => matter.id).filter(Boolean);
  const matterFilter = matterIds.length ? `pas.matter_id = any (${sqlUuidArray(matterIds)})` : "false";
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with latest_snapshots as (",
    "  select distinct on (pas.matter_id)",
    "    m.name as matter_name,",
    "    pas.blocker_count,",
    "    pas.warning_count,",
    "    pas.info_count,",
    "    cardinality(pas.incident_ids)::int as incident_count,",
    "    pas.created_at",
    "  from preparation_advisory_snapshots pas",
    "  join matters m on m.id = pas.matter_id and m.tenant_id = pas.tenant_id",
    "  where pas.tenant_id = current_app_tenant_id()",
    `    and ${matterFilter}`,
    "  order by pas.matter_id, pas.created_at desc",
    ")",
    "select coalesce(jsonb_agg(to_jsonb(latest_snapshots) order by matter_name), '[]'::jsonb)::text from latest_snapshots;",
    "",
  ].join("\n");
}

export function inspectLocalAdvisoryHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before inspecting advisory shadow hydration.");
  const { args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn("psql", [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: buildAdvisoryInspectionSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const snapshots = parsePsqlJsonArray(result.stdout || "").map(normalizeInspectionSnapshot);
  return {
    tenantId: plan?.tenant?.id || "",
    snapshots,
    totals: snapshots.reduce((acc, snapshot) => {
      acc.blocker += snapshot.blocker;
      acc.warning += snapshot.warning;
      acc.info += snapshot.info;
      acc.incidents += snapshot.incidentCount;
      return acc;
    }, { blocker: 0, warning: 0, info: 0, incidents: 0 }),
  };
}

export function renderShadowAdvisoryReport(report = {}) {
  const totals = report.totals || emptyTotals();
  const lines = [
    "Matter Workbench local advisory DB hydration",
    `mode: ${report.mode || "dry-run"}`,
    `database_writes: ${report.databaseWrites ? "yes" : "no"}`,
    `matters_home: ${report.mattersHome || ""}`,
    "totals:",
    `  matters: ${totals.matters || 0}`,
    `  incidents: ${totals.items || 0}`,
    `  blockers: ${totals.blocker || 0}`,
    `  warnings: ${totals.warning || 0}`,
    `  info: ${totals.info || 0}`,
    "planned_rows:",
    `  incidents: ${report.plannedRows?.incidents || 0}`,
    `  preparation_advisory_snapshots: ${report.plannedRows?.preparationAdvisorySnapshots || 0}`,
    "matters:",
  ];
  for (const matter of report.matters || []) {
    const summary = matter.summary || {};
    const itemCount = matter.items?.length ?? matter.itemCount ?? 0;
    lines.push(`  ${matter.name} items=${itemCount} blockers=${summary.blocker || 0} warnings=${summary.warning || 0} info=${summary.info || 0}`);
  }
  if (!report.matters?.length) lines.push("  (none)");
  for (const warning of report.warnings || []) lines.push(`warning: ${warning}`);
  return lines;
}

export function renderAdvisoryHydrationVerification(result = {}) {
  const lines = [
    "Matter Workbench advisory shadow hydration verification",
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

export function renderAdvisoryHydrationInspection(result = {}) {
  const lines = [
    "Matter Workbench advisory shadow DB inspection",
    `tenant_id: ${result.tenantId || ""}`,
    `snapshots: ${result.snapshots?.length || 0}`,
    "totals:",
    `  blockers: ${result.totals?.blocker || 0}`,
    `  warnings: ${result.totals?.warning || 0}`,
    `  info: ${result.totals?.info || 0}`,
    `  incidents: ${result.totals?.incidents || 0}`,
    "latest_snapshots:",
  ];
  for (const snapshot of result.snapshots || []) {
    lines.push(`  ${snapshot.matterName} blockers=${snapshot.blocker} warnings=${snapshot.warning} info=${snapshot.info} incidents=${snapshot.incidentCount}`);
  }
  if (!result.snapshots?.length) lines.push("  (none)");
  return lines;
}

function buildMatterIndex(matters = []) {
  const index = new Map();
  for (const matter of matters) {
    for (const key of [matter.name, matter.folderName]) {
      const normalized = normalizeKey(key);
      if (normalized) index.set(normalized, matter);
    }
  }
  return index;
}

function normalizeAdvisoryItem({ item = {}, matterId }) {
  const localId = stringValue(item.id) || deterministicUuid(`attention-item:${matterId}:${item.code}:${item.title}`);
  const evidenceRef = `${LOCAL_ATTENTION_EVIDENCE_PREFIX}${localId}${evidenceSummary(item.evidence) ? ` ${evidenceSummary(item.evidence)}` : ""}`;
  return {
    localId,
    sourceId: deterministicUuid(`local-attention:${matterId}:${localId}`),
    sourceType: "manual",
    category: normalizeCategory(item.category),
    severity: normalizeSeverity(item.severity),
    code: stringValue(item.code) || "attention",
    title: stringValue(item.title) || "Matter needs attention",
    detail: stringValue(item.detail),
    action: stringValue(item.action),
    evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 5) : [],
    evidenceRef,
  };
}

function summarizeItems(items = []) {
  const summary = { total: items.length, blocker: 0, warning: 0, info: 0, state: "clear" };
  for (const item of items) summary[item.severity] += 1;
  summary.state = summary.blocker ? "blocked" : summary.warning ? "attention_needed" : "clear";
  return summary;
}

function evidenceSummary(evidence = []) {
  return (Array.isArray(evidence) ? evidence : [])
    .slice(0, 2)
    .map((entry) => [entry.path, entry.row, entry.status, entry.runId, entry.source_id]
      .map(stringValue)
      .filter(Boolean)
      .join(" "))
    .filter(Boolean)
    .join("; ");
}

function expectedAdvisoryHydrationCounts(plan = {}) {
  return {
    open_local_attention_incidents: plan.totals?.items || 0,
    latest_advisory_snapshot_matters: plan.totals?.matters || 0,
    latest_snapshot_blockers: plan.totals?.blocker || 0,
    latest_snapshot_warnings: plan.totals?.warning || 0,
    latest_snapshot_info: plan.totals?.info || 0,
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
  if (start < 0 || end < start) throw new Error("psql inspection returned no JSON advisory summary.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("psql inspection returned a non-array advisory summary.");
  return parsed;
}

function normalizeInspectionSnapshot(row = {}) {
  return {
    matterName: stringValue(row.matter_name),
    blocker: Number(row.blocker_count) || 0,
    warning: Number(row.warning_count) || 0,
    info: Number(row.info_count) || 0,
    incidentCount: Number(row.incident_count) || 0,
    createdAt: stringValue(row.created_at),
  };
}

function emptyTotals() {
  return { matters: 0, items: 0, blocker: 0, warning: 0, info: 0 };
}

function normalizeCategory(value) {
  const category = stringValue(value);
  return ALLOWED_CATEGORIES.has(category) ? category : "system";
}

function normalizeSeverity(value) {
  const severity = stringValue(value);
  return ALLOWED_SEVERITIES.has(severity) ? severity : "warning";
}

function normalizeKey(value) {
  return stringValue(value).toLowerCase();
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
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

function sqlJsonb(value) {
  return `${sqlString(JSON.stringify(value || {}))}::jsonb`;
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
  const plan = await collectLocalAdvisoryHydrationPlan({
    appDir: args.appDir,
    mattersHome: args.mattersHome,
    matter: args.matter,
  });
  if (args.inspect) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = inspectLocalAdvisoryHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderAdvisoryHydrationInspection(result)) console.log(line);
    return;
  }
  if (args.verify) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = verifyLocalAdvisoryHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderAdvisoryHydrationVerification(result)) console.log(line);
    if (!result.matched) process.exitCode = 1;
    return;
  }
  if (!args.dryRun) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = applyLocalAdvisoryHydrationPlan({ databaseUrl, plan });
    const report = { ...advisoryHydrationReportFromPlan(plan), mode: "apply", databaseWrites: true };
    if (args.json) console.log(JSON.stringify({ ...report, insertedRows: result.insertedRows }, null, 2));
    else {
      for (const line of renderShadowAdvisoryReport(report)) console.log(line);
      console.log("advisory_shadow_hydration: applied");
    }
    return;
  }
  const report = advisoryHydrationReportFromPlan(plan);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else for (const line of renderShadowAdvisoryReport(report)) console.log(line);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
