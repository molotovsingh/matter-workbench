#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  collectLocalMatterHydrationPlan,
  defaultMattersHome,
} from "./db-hydrate-local-matters.mjs";

const __filename = fileURLToPath(import.meta.url);
const COMMAND_LOG_RELATIVE = path.join(".local", "command-interactions.jsonl");

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

export async function collectLocalAuditEventHydrationPlan({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
  matterPlan = null,
} = {}) {
  const resolvedMatterPlan = matterPlan || await collectLocalMatterHydrationPlan({ mattersHome });
  const interactions = await readCommandInteractions(path.join(appDir, COMMAND_LOG_RELATIVE));
  return buildShadowAuditEventPlan({ matterPlan: resolvedMatterPlan, interactions, appDir, mattersHome });
}

export function buildShadowAuditEventPlan({
  matterPlan = {},
  interactions = [],
  appDir = "",
  mattersHome = "",
} = {}) {
  const tenant = matterPlan.tenant || {
    id: deterministicUuid("tenant:local-shadow"),
    name: "Matter Workbench Local Shadow",
    type: "internal_test",
  };
  const matterIndex = buildMatterIndex(matterPlan.matters || []);
  const plan = {
    mode: "dry-run",
    databaseWrites: false,
    appDir,
    mattersHome,
    tenant,
    auditEvents: [],
    warnings: [],
  };

  interactions.forEach((interaction, index) => {
    if (!isMeaningfulInteraction(interaction)) return;
    const auditEvent = auditEventFromInteraction({ tenantId: tenant.id, interaction, index, matterIndex });
    if (auditEvent) plan.auditEvents.push(auditEvent);
  });

  plan.totals = {
    auditEvents: plan.auditEvents.length,
    matterLinkedAuditEvents: plan.auditEvents.filter((event) => event.matterId).length,
    providerInvokedAuditEvents: plan.auditEvents.filter((event) => event.metadata.provider_run_invoked).length,
    warnings: plan.warnings.length,
  };
  plan.plannedRows = {
    auditEvents: plan.auditEvents.length,
    matterLinkedAuditEvents: plan.auditEvents.filter((event) => event.matterId).length,
    providerInvokedAuditEvents: plan.auditEvents.filter((event) => event.metadata.provider_run_invoked).length,
  };
  return plan;
}

export function auditEventHydrationReportFromPlan(plan = {}) {
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

export function buildLocalAuditEventHydrationSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Audit-event hydration plan is missing tenant.id.");
  const lines = [
    "begin;",
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, true);`,
  ];

  for (const auditEvent of plan.auditEvents || []) {
    lines.push(auditEventSql(auditEvent));
  }

  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

export function applyLocalAuditEventHydrationPlan({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before applying audit-event shadow hydration.");
  const { args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn("psql", [...args, "-v", "ON_ERROR_STOP=1"], {
    input: buildLocalAuditEventHydrationSql(plan),
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

export function buildAuditEventHydrationCountSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Audit-event hydration plan is missing tenant.id.");
  const auditEventIds = (plan.auditEvents || []).map((event) => event.id).filter(Boolean);

  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select 'audit_events' as key, count(*)::int as count from audit_events where id = any (" + sqlUuidArray(auditEventIds) + ")",
    "union all",
    "select 'matter_linked_audit_events' as key, count(*)::int as count from audit_events where id = any (" + sqlUuidArray(auditEventIds) + ") and matter_id is not null",
    "union all",
    "select 'provider_invoked_audit_events' as key, count(*)::int as count from audit_events where id = any (" + sqlUuidArray(auditEventIds) + ") and metadata_json->>'provider_run_invoked' = 'true';",
    "",
  ].join("\n");
}

export function verifyLocalAuditEventHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before verifying audit-event shadow hydration.");
  const { args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn("psql", [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|"], {
    input: buildAuditEventHydrationCountSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const counts = parsePipeCounts(result.stdout || "");
  const expected = expectedAuditEventHydrationCounts(plan);
  const mismatches = countMismatches({ expected, counts });
  return { matched: mismatches.length === 0, expected, counts, mismatches };
}

export function buildAuditEventInspectionSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Audit-event hydration plan is missing tenant.id.");
  const auditEventIds = (plan.auditEvents || []).map((event) => event.id).filter(Boolean);
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with audit_rows as (",
    "  select action, (metadata_json->>'provider_run_invoked')::boolean as provider_run_invoked, count(*)::int as count",
    "  from audit_events",
    "  where tenant_id = current_app_tenant_id()",
    `    and id = any (${sqlUuidArray(auditEventIds)})`,
    "  group by action, provider_run_invoked",
    ")",
    "select coalesce(jsonb_agg(to_jsonb(audit_rows) order by action, provider_run_invoked), '[]'::jsonb)::text from audit_rows;",
    "",
  ].join("\n");
}

export function inspectLocalAuditEventHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before inspecting audit-event shadow hydration.");
  const { args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn("psql", [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: buildAuditEventInspectionSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const groups = parsePsqlJsonArray(result.stdout || "").map((row) => ({
    action: stringValue(row.action),
    providerRunInvoked: Boolean(row.provider_run_invoked),
    count: Number(row.count) || 0,
  }));
  return {
    tenantId: plan?.tenant?.id || "",
    groups,
    totals: {
      auditEvents: groups.reduce((sum, row) => sum + row.count, 0),
      providerInvokedAuditEvents: groups.reduce((sum, row) => row.providerRunInvoked ? sum + row.count : sum, 0),
    },
  };
}

export function renderShadowAuditEventReport(report = {}) {
  const totals = report.totals || emptyTotals();
  const lines = [
    "Matter Workbench local audit-event DB hydration",
    `mode: ${report.mode || "dry-run"}`,
    `database_writes: ${report.databaseWrites ? "yes" : "no"}`,
    `matters_home: ${report.mattersHome || ""}`,
    "totals:",
    `  audit_events: ${totals.auditEvents || 0}`,
    `  matter_linked_audit_events: ${totals.matterLinkedAuditEvents || 0}`,
    `  provider_invoked_audit_events: ${totals.providerInvokedAuditEvents || 0}`,
    `  warnings: ${totals.warnings || 0}`,
    "planned_rows:",
    `  audit_events: ${report.plannedRows?.auditEvents || 0}`,
    `  matter_linked_audit_events: ${report.plannedRows?.matterLinkedAuditEvents || 0}`,
    `  provider_invoked_audit_events: ${report.plannedRows?.providerInvokedAuditEvents || 0}`,
  ];
  for (const warning of report.warnings || []) lines.push(`warning: ${warning}`);
  return lines;
}

export function renderAuditEventHydrationVerification(result = {}) {
  const lines = [
    "Matter Workbench audit-event shadow hydration verification",
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

export function renderAuditEventHydrationInspection(result = {}) {
  const lines = [
    "Matter Workbench audit-event shadow DB inspection",
    `tenant_id: ${result.tenantId || ""}`,
    `audit_events: ${result.totals?.auditEvents || 0}`,
    `provider_invoked_audit_events: ${result.totals?.providerInvokedAuditEvents || 0}`,
    "groups:",
  ];
  for (const group of result.groups || []) {
    lines.push(`  ${group.action} provider_run_invoked=${group.providerRunInvoked ? "yes" : "no"} count=${group.count}`);
  }
  if (!result.groups?.length) lines.push("  (none)");
  return lines;
}

async function readCommandInteractions(logPath) {
  let text = "";
  try {
    text = await readFile(logPath, "utf8");
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap(parseInteractionLine);
}

function parseInteractionLine(line) {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
}

function buildMatterIndex(matters = []) {
  const index = new Map();
  for (const matter of matters) {
    const id = stringValue(matter.id);
    if (!id) continue;
    for (const key of [
      matter.folderName,
      matter.folder_name,
      matter.name,
      matter.matterName,
      matter.matter_name,
    ]) {
      const normalized = normalizeLookupKey(key);
      if (normalized) index.set(normalized, id);
    }
  }
  return index;
}

function auditEventFromInteraction({ tenantId, interaction, index, matterIndex }) {
  const timestamp = timestampOrEmpty(interaction.timestamp);
  const action = auditAction(interaction);
  const matterId = resolveMatterId(interaction.matter, matterIndex);
  const metadata = auditMetadata(interaction);
  return {
    id: deterministicUuid([
      "audit-event:command-interaction",
      timestamp || index,
      matterId,
      action,
      stringValue(interaction.matched_command ?? interaction.matchedCommand),
      stringValue(interaction.rendered_state ?? interaction.renderedState),
      stringValue(interaction.status),
      String(index),
    ].join(":")),
    tenantId,
    actorType: "system",
    matterId,
    action,
    targetType: "command_interaction",
    targetId: "",
    metadata,
    createdAt: timestamp,
  };
}

function isMeaningfulInteraction(interaction = {}) {
  return Boolean(
    stringValue(interaction.typed_input ?? interaction.typedInput)
    || stringValue(interaction.matched_command ?? interaction.matchedCommand)
    || stringValue(interaction.rendered_state ?? interaction.renderedState)
    || stringValue(interaction.status)
    || Boolean(interaction.provider_run_invoked ?? interaction.providerRunInvoked)
    || normalizeErrors(interaction.errors ?? interaction.error).length
  );
}

function auditAction(interaction = {}) {
  const status = safeActionSegment(interaction.status);
  if (status) return `command.${status}`;
  const matched = safeActionSegment(interaction.matched_command ?? interaction.matchedCommand);
  if (matched) return `command.${matched}`;
  const rendered = safeActionSegment(interaction.rendered_state ?? interaction.renderedState);
  if (rendered) return `command.${rendered}`;
  return "command.logged";
}

function auditMetadata(interaction = {}) {
  const router = objectValue(interaction.router_decision ?? interaction.routerDecision);
  return {
    schema_version: stringValue(interaction.schema_version),
    matched_command: stringValue(interaction.matched_command ?? interaction.matchedCommand, 240),
    rendered_state: stringValue(interaction.rendered_state ?? interaction.renderedState, 240),
    status: stringValue(interaction.status, 240),
    skill_idea_id: stringValue(interaction.skill_idea_id ?? interaction.skillIdeaId, 240),
    provider_run_invoked: Boolean(interaction.provider_run_invoked ?? interaction.providerRunInvoked),
    planner_source: stringValue(interaction.planner_source ?? interaction.plannerSource, 240),
    planner_model: stringValue(interaction.planner_model ?? interaction.plannerModel, 240),
    has_typed_input: Boolean(stringValue(interaction.typed_input ?? interaction.typedInput)),
    error_count: normalizeErrors(interaction.errors ?? interaction.error).length,
    router_decision: router.decision ? {
      decision: stringValue(router.decision, 240),
      matched_skill: stringValue(router.matched_skill ?? router.matchedSkill, 240),
      confidence: numberOrNull(router.confidence),
      recommended_action: stringValue(router.recommended_action ?? router.recommendedAction, 240),
    } : null,
  };
}

function normalizeErrors(errors) {
  return Array.isArray(errors) ? errors.filter(Boolean) : errors ? [errors] : [];
}

function resolveMatterId(matter = {}, matterIndex) {
  const source = objectValue(matter);
  for (const key of [
    source.folder_name,
    source.folderName,
    source.matter_name,
    source.matterName,
  ]) {
    const id = matterIndex.get(normalizeLookupKey(key));
    if (id) return id;
  }
  return "";
}

function auditEventSql(event) {
  return `insert into audit_events (id, tenant_id, actor_type, matter_id, action, target_type, target_id, metadata_json, created_at) values (${sqlUuid(event.id)}, ${sqlUuid(event.tenantId)}, ${sqlString(event.actorType)}, ${sqlUuidOrNull(event.matterId)}, ${sqlString(event.action)}, ${sqlString(event.targetType)}, ${sqlUuidOrNull(event.targetId)}, ${sqlJson(event.metadata)}, ${sqlTimestampOrNow(event.createdAt)}) on conflict (id) do update set matter_id = excluded.matter_id, action = excluded.action, target_type = excluded.target_type, target_id = excluded.target_id, metadata_json = excluded.metadata_json, created_at = excluded.created_at;`;
}

function expectedAuditEventHydrationCounts(plan = {}) {
  return {
    audit_events: plan.plannedRows?.auditEvents || 0,
    matter_linked_audit_events: plan.plannedRows?.matterLinkedAuditEvents || 0,
    provider_invoked_audit_events: plan.plannedRows?.providerInvokedAuditEvents || 0,
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
  if (start < 0 || end < start) throw new Error("psql inspection returned no JSON audit-event summary.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("psql inspection returned a non-array audit-event summary.");
  return parsed;
}

function emptyTotals() {
  return {
    auditEvents: 0,
    matterLinkedAuditEvents: 0,
    providerInvokedAuditEvents: 0,
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

function normalizeLookupKey(value) {
  return stringValue(value).toLowerCase();
}

function safeActionSegment(value) {
  return stringValue(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_./:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
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

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}

function sqlTimestampOrNow(value) {
  const text = timestampOrEmpty(value);
  return text ? `${sqlString(text)}::timestamptz` : "now()";
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
  const plan = await collectLocalAuditEventHydrationPlan({ appDir: args.appDir, mattersHome: args.mattersHome });
  if (args.inspect) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = inspectLocalAuditEventHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderAuditEventHydrationInspection(result)) console.log(line);
    return;
  }
  if (args.verify) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = verifyLocalAuditEventHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderAuditEventHydrationVerification(result)) console.log(line);
    if (!result.matched) process.exitCode = 1;
    return;
  }
  if (!args.dryRun) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = applyLocalAuditEventHydrationPlan({ databaseUrl, plan });
    const report = { ...auditEventHydrationReportFromPlan(plan), mode: "apply", databaseWrites: true };
    if (args.json) console.log(JSON.stringify({ ...report, insertedRows: result.insertedRows }, null, 2));
    else {
      for (const line of renderShadowAuditEventReport(report)) console.log(line);
      console.log("audit_event_shadow_hydration: applied");
    }
    return;
  }
  const report = auditEventHydrationReportFromPlan(plan);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else for (const line of renderShadowAuditEventReport(report)) console.log(line);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
