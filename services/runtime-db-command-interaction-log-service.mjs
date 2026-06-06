import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import {
  COMMAND_INTERACTION_LOG_SCHEMA_VERSION,
  normalizeInteraction,
} from "./command-interaction-log-service.mjs";

const DEFAULT_RECENT_INTERACTION_LIMIT = 200;

export function createRuntimeDbCommandInteractionLogService({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
  now = () => new Date(),
  idFactory = () => randomUUID(),
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);
  const logPath = "postgres:audit_events/command_interaction";

  async function appendInteraction(entry = {}) {
    ensureEnabled();
    const record = normalizeInteraction(entry, { now });
    queryJson(appendInteractionSql({ tenantId, id: idFactory(), record }));
    return {
      schema_version: COMMAND_INTERACTION_LOG_SCHEMA_VERSION,
      logged: true,
      path: logPath,
      timestamp: record.timestamp,
    };
  }

  async function readRecentInteractions({ limit = DEFAULT_RECENT_INTERACTION_LIMIT } = {}) {
    ensureEnabled();
    const rows = queryJson(readRecentInteractionsSql({ tenantId, limit: normalizeLimit(limit) }));
    return (Array.isArray(rows) ? rows : []).map((row) => normalizeInteraction(row));
  }

  function queryJson(sql) {
    const { command, args, env } = psqlConnectionArgs(databaseUrl);
    const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
      input: sql,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    if (result.error) {
      throw makeHttpError(`runtime DB command log query failed: ${redactRuntimeDbError(result.error.message)}`, 503);
    }
    if (result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
      throw makeHttpError(`runtime DB command log query failed: ${redactRuntimeDbError(detail)}`, 503);
    }
    return parsePsqlJson(result.stdout || "");
  }

  function ensureEnabled() {
    if (!enabled) throw makeHttpError("Runtime DB command interaction log is not configured", 503);
  }

  return {
    appendInteraction,
    enabled,
    logPath,
    readRecentInteractions,
  };
}

function appendInteractionSql({ tenantId, id, record }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with target_matter as (",
    "  select id",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    `    and (name = ${sqlString(record.matter.folder_name)} or name = ${sqlString(record.matter.matter_name)})`,
    "  order by updated_at desc",
    "  limit 1",
    ")",
    "insert into audit_events (id, tenant_id, actor_type, matter_id, action, target_type, metadata_json, created_at)",
    `values (${sqlUuid(id)}, current_app_tenant_id(), 'user', (select id from target_matter), 'command_interaction', ${sqlString(record.matched_command || record.typed_input || "command")}, ${sqlJson(record)}, ${sqlTimestampOrNow(record.timestamp)})`,
    "on conflict (id) do update set",
    "  matter_id = excluded.matter_id,",
    "  action = excluded.action,",
    "  target_type = excluded.target_type,",
    "  metadata_json = excluded.metadata_json,",
    "  created_at = excluded.created_at;",
    "select '{}'::jsonb::text;",
    "",
  ].join("\n");
}

function readRecentInteractionsSql({ tenantId, limit }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with latest as (",
    "  select metadata_json, created_at",
    "  from audit_events",
    "  where tenant_id = current_app_tenant_id()",
    "    and action = 'command_interaction'",
    "  order by created_at desc",
    `  limit ${sqlInteger(limit)}`,
    ")",
    "select coalesce(jsonb_agg(metadata_json order by created_at asc), '[]'::jsonb)::text from latest;",
    "",
  ].join("\n");
}

function parsePsqlJson(stdout = "") {
  const text = String(stdout || "").trim();
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw makeHttpError("runtime DB command log query returned no JSON.", 503);
  const start = Math.min(...starts);
  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError("runtime DB command log query returned invalid JSON.", 503);
  }
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_RECENT_INTERACTION_LIMIT;
  return Math.trunc(number);
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : String(DEFAULT_RECENT_INTERACTION_LIMIT);
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}

function sqlTimestampOrNow(value) {
  const text = String(value || "").trim();
  return text ? `${sqlString(text)}::timestamptz` : "now()";
}

function redactRuntimeDbError(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***");
}
