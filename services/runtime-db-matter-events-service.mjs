import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { queryRuntimeDbJson } from "./runtime-db-query.mjs";
import { wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";
import {
  MATTER_EVENT_SCHEMA_VERSION,
  MATTER_EVENTS_SCHEMA_VERSION,
  normalizeMatterEvent,
  normalizeMatterEvents,
} from "./matter-events-service.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function createRuntimeDbMatterEventsService({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
  now = () => new Date(),
  idFactory = () => randomUUID(),
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);
  const storePath = "postgres:matter_events";

  async function appendEvent(input = {}) {
    ensureEnabled();
    const event = normalizeMatterEvent(input, { now, idFactory });
    const row = queryJson(wrapRuntimeDbWriteTransaction(appendEventSql({ tenantId, event })));
    return normalizeMatterEvents([row])[0] || event;
  }

  async function listEvents(filters = {}) {
    ensureEnabled();
    const rows = queryJson(listEventsSql({
      tenantId,
      matterName: filters.matterName || filters.matter || "",
      eventType: filters.eventType || filters.type || "",
      limit: normalizeLimit(filters.limit),
    }));
    return {
      schema_version: MATTER_EVENTS_SCHEMA_VERSION,
      events: normalizeMatterEvents(Array.isArray(rows) ? rows : []),
    };
  }

  function queryJson(sql) {
    return queryRuntimeDbJson({
      databaseUrl,
      sql,
      spawn,
      errorPrefix: "runtime DB matter events query failed",
      errorCode: "runtime_db.matter_events.query_failed",
      noJsonMessage: "runtime DB matter events query returned no JSON.",
      noJsonCode: "runtime_db.matter_events.no_json",
      invalidJsonMessage: "runtime DB matter events query returned invalid JSON.",
      invalidJsonCode: "runtime_db.matter_events.invalid_json",
    });
  }

  function ensureEnabled() {
    if (!enabled) throw makeHttpError("Runtime DB matter events are not configured", 503, "runtime_db.matter_events.not_configured");
  }

  function appendEventMutationSql(input = {}) {
    const event = normalizeMatterEvent(input, { now, idFactory });
    return buildAppendEventMutationSql({ event });
  }

  return {
    appendEvent,
    appendEventMutationSql,
    enabled,
    listEvents,
    storePath,
  };
}

export function appendEventSql({ tenantId, event }) {
  const normalized = normalizeMatterEvent(event, { idFactory: () => randomUUID() });
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    buildAppendEventMutationSql({ event: normalized, returning: true }),
    "",
  ].join("\n");
}

export function appendEventMutationSql(input = {}) {
  const event = input?.event && typeof input.event === "object" ? input.event : input;
  const normalized = normalizeMatterEvent(event, { idFactory: () => randomUUID() });
  return buildAppendEventMutationSql({ event: normalized, returning: false });
}

function buildAppendEventMutationSql({ event, returning = false }) {
  const normalized = normalizeMatterEvent(event, { idFactory: () => randomUUID() });
  const insert = [
    "with target_matter as (",
    "  select id, name",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    normalized.matterId ? `    and id = ${sqlUuid(normalized.matterId)}` : normalized.matterName ? `    and name = ${sqlString(normalized.matterName)}` : "    and false",
    "  order by updated_at desc",
    "  limit 1",
    "), inserted as (",
    "  insert into matter_events (id, tenant_id, matter_id, matter_name, event_type, summary_key, actor_json, source_json, object_type, object_id, object_json, payload_json, idempotency_key, occurred_at, created_at)",
    "  values (",
    `    ${sqlUuid(normalized.eventId)},`,
    "    current_app_tenant_id(),",
    "    (select id from target_matter),",
    `    coalesce(nullif(${sqlString(normalized.matterName)}, ''), (select name from target_matter), ''),`,
    `    ${sqlString(normalized.eventType)},`,
    `    ${sqlString(normalized.summaryKey || "")},`,
    `    ${sqlJson(normalized.actor || {})},`,
    `    ${sqlJson(normalized.source || {})},`,
    `    ${sqlString(normalized.object?.type || "")},`,
    `    ${sqlString(normalized.object?.id || "")},`,
    `    ${sqlJson(normalized.object || {})},`,
    `    ${sqlJson(normalized.payload || {})},`,
    `    ${sqlString(normalized.idempotencyKey)},`,
    `    ${sqlTimestamp(normalized.occurredAt)},`,
    `    ${sqlTimestamp(normalized.createdAt || normalized.occurredAt)}`,
    "  )",
    "  on conflict (tenant_id, idempotency_key) do nothing",
    returning ? "  returning *" : "  returning id",
    ")",
  ];
  if (!returning) return [...insert, "select 1 from inserted limit 1;"].join("\n");
  return [
    ...insert,
    ", selected as (",
    "  select * from inserted",
    "  union all",
    "  select *",
    "  from matter_events",
    "  where tenant_id = current_app_tenant_id()",
    `    and idempotency_key = ${sqlString(normalized.idempotencyKey)}`,
    "    and not exists (select 1 from inserted)",
    "  limit 1",
    ")",
    selectMatterEventJson("selected"),
  ].join("\n");
}

export function listEventsSql({ tenantId, matterName = "", eventType = "", limit = DEFAULT_LIMIT } = {}) {
  const normalizedMatterName = normalizeText(matterName);
  const normalizedEventType = normalizeText(eventType);
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with selected as (",
    "  select *",
    "  from matter_events",
    "  where tenant_id = current_app_tenant_id()",
    normalizedMatterName ? `    and matter_name = ${sqlString(normalizedMatterName)}` : "",
    normalizedEventType ? `    and event_type = ${sqlString(normalizedEventType)}` : "",
    "  order by occurred_at desc, created_at desc, id desc",
    `  limit ${sqlInteger(limit)}`,
    ")",
    "select coalesce(jsonb_agg(event_json order by event_json->>'occurredAt' desc), '[]'::jsonb)::text",
    "from (",
    `  select ${selectMatterEventJsonExpression("selected")} as event_json`,
    "  from selected",
    ") event_rows;",
    "",
  ].filter(Boolean).join("\n");
}

function selectMatterEventJson(alias) {
  return `select ${selectMatterEventJsonExpression(alias)}::text from ${alias};`;
}

function selectMatterEventJsonExpression(alias) {
  return [
    "jsonb_build_object(",
    `  'schema_version', ${sqlString(MATTER_EVENT_SCHEMA_VERSION)},`,
    `  'eventId', ${alias}.id::text,`,
    `  'eventType', ${alias}.event_type,`,
    `  'occurredAt', ${alias}.occurred_at::text,`,
    `  'createdAt', ${alias}.created_at::text,`,
    `  'matterId', coalesce(${alias}.matter_id::text, ''),`,
    `  'matterName', coalesce(${alias}.matter_name, ''),`,
    `  'actor', ${alias}.actor_json,`,
    `  'source', ${alias}.source_json,`,
    `  'summaryKey', coalesce(${alias}.summary_key, ''),`,
    `  'object', ${alias}.object_json,`,
    `  'payload', ${alias}.payload_json,`,
    `  'idempotencyKey', ${alias}.idempotency_key`,
    ")",
  ].join("\n");
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(number), MAX_LIMIT);
}

function normalizeText(value, maxLength = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : String(DEFAULT_LIMIT);
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}

function sqlTimestamp(value) {
  return `${sqlString(value)}::timestamptz`;
}
