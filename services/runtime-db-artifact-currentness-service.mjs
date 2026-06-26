import { spawnSync } from "node:child_process";

import { makeHttpError } from "../shared/safe-paths.mjs";
import { queryRuntimeDbJson } from "./runtime-db-query.mjs";
import { wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";
import {
  ARTIFACT_CURRENTNESS_PROJECTION_SCHEMA_VERSION,
  normalizeArtifactCurrentnessRecord,
  normalizeArtifactCurrentnessRecords,
} from "./artifact-currentness-service.mjs";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function createRuntimeDbArtifactCurrentnessService({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
  now = () => new Date(),
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);
  const storePath = "postgres:matter_artifact_currentness";

  async function upsertRecord(input = {}) {
    ensureEnabled();
    const record = normalizeArtifactCurrentnessRecord(input, { now });
    const row = queryJson(wrapRuntimeDbWriteTransaction(upsertArtifactCurrentnessSql({ tenantId, record })));
    return normalizeArtifactCurrentnessRecords([row], { now })[0] || record;
  }

  async function listRecords(filters = {}) {
    ensureEnabled();
    const rows = queryJson(listArtifactCurrentnessSql({
      tenantId,
      matterName: filters.matterName || filters.matter || "",
      artifactFamily: filters.artifactFamily || filters.artifact_family || "",
      limit: normalizeLimit(filters.limit),
    }));
    return {
      schema_version: ARTIFACT_CURRENTNESS_PROJECTION_SCHEMA_VERSION,
      matterName: normalizeText(filters.matterName || filters.matter || ""),
      records: normalizeArtifactCurrentnessRecords(Array.isArray(rows) ? rows : [], { now }),
    };
  }

  function upsertRecordMutationSql(input = {}) {
    const record = normalizeArtifactCurrentnessRecord(input, { now });
    return buildUpsertArtifactCurrentnessMutationSql({ record, returning: false });
  }

  function ensureEnabled() {
    if (!enabled) {
      throw makeHttpError("Runtime DB artifact currentness is not configured", 503, "runtime_db.artifact_currentness.not_configured");
    }
  }

  function queryJson(sql) {
    return queryRuntimeDbJson({
      databaseUrl,
      sql,
      spawn,
      errorPrefix: "runtime DB artifact currentness query failed",
      errorCode: "runtime_db.artifact_currentness.query_failed",
      noJsonMessage: "runtime DB artifact currentness query returned no JSON.",
      noJsonCode: "runtime_db.artifact_currentness.no_json",
      invalidJsonMessage: "runtime DB artifact currentness query returned invalid JSON.",
      invalidJsonCode: "runtime_db.artifact_currentness.invalid_json",
    });
  }

  return {
    enabled,
    listRecords,
    storePath,
    upsertRecord,
    upsertRecordMutationSql,
  };
}

export function upsertArtifactCurrentnessSql({ tenantId, record } = {}) {
  const normalized = normalizeArtifactCurrentnessRecord(record);
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    buildUpsertArtifactCurrentnessMutationSql({ record: normalized, returning: true }),
    "",
  ].join("\n");
}

export function upsertArtifactCurrentnessMutationSql(input = {}) {
  const record = input?.record && typeof input.record === "object" ? input.record : input;
  const normalized = normalizeArtifactCurrentnessRecord(record);
  return buildUpsertArtifactCurrentnessMutationSql({ record: normalized, returning: false });
}

function buildUpsertArtifactCurrentnessMutationSql({ record, returning = false } = {}) {
  const normalized = normalizeArtifactCurrentnessRecord(record);
  const matterPredicate = normalized.matterId
    ? `    and id = ${sqlUuid(normalized.matterId)}`
    : normalized.matterName
      ? `    and name = ${sqlString(normalized.matterName)}`
      : "    and false";
  const insert = [
    "with target_matter as (",
    "  select id, name",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    matterPredicate,
    "  order by updated_at desc",
    "  limit 1",
    "), upserted as (",
    "  insert into matter_artifact_currentness (tenant_id, matter_id, artifact_id, artifact_family, artifact_path, state, dependency_state, reason_code, source_event_id, affected_file_ids_json, metadata_json, observed_at, updated_at)",
    "  values (",
    "    current_app_tenant_id(),",
    "    (select id from target_matter),",
    `    ${sqlNullableUuid(normalized.artifactId)},`,
    `    ${sqlString(normalized.artifactFamily)},`,
    `    ${sqlString(normalized.artifactPath || "")},`,
    `    ${sqlString(normalized.state)},`,
    `    ${sqlString(normalized.dependencyState || "")},`,
    `    ${sqlString(normalized.reasonCode || "")},`,
    `    ${sqlNullableUuid(normalized.sourceEventId)},`,
    `    ${sqlJson(normalized.affectedFileIds || [])},`,
    `    ${sqlJson(normalized.metadata || {})},`,
    `    ${sqlTimestamp(normalized.observedAt)},`,
    `    ${sqlTimestamp(normalized.updatedAt || normalized.observedAt)}`,
    "  )",
    "  on conflict (tenant_id, matter_id, artifact_family, artifact_path) do update set",
    "    artifact_id = excluded.artifact_id,",
    "    state = excluded.state,",
    "    dependency_state = excluded.dependency_state,",
    "    reason_code = excluded.reason_code,",
    "    source_event_id = excluded.source_event_id,",
    "    affected_file_ids_json = excluded.affected_file_ids_json,",
    "    metadata_json = excluded.metadata_json,",
    "    observed_at = excluded.observed_at,",
    "    updated_at = excluded.updated_at",
    returning ? "  returning *" : "  returning id",
    ")",
  ];
  if (!returning) return [...insert, "select 1 from upserted limit 1;"].join("\n");
  return [
    ...insert,
    selectArtifactCurrentnessJson("upserted"),
  ].join("\n");
}

export function listArtifactCurrentnessSql({ tenantId, matterName = "", artifactFamily = "", limit = DEFAULT_LIMIT } = {}) {
  const normalizedMatterName = normalizeText(matterName);
  const normalizedArtifactFamily = normalizeText(artifactFamily);
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with selected as (",
    "  select currentness.*",
    "  from matter_artifact_currentness currentness",
    "  join matters matter on matter.id = currentness.matter_id and matter.tenant_id = currentness.tenant_id",
    "  where currentness.tenant_id = current_app_tenant_id()",
    normalizedMatterName ? `    and matter.name = ${sqlString(normalizedMatterName)}` : "",
    normalizedArtifactFamily ? `    and currentness.artifact_family = ${sqlString(normalizedArtifactFamily)}` : "",
    "  order by currentness.updated_at desc, currentness.artifact_family asc, currentness.artifact_path asc",
    `  limit ${sqlInteger(limit)}`,
    ")",
    "select coalesce(jsonb_agg(record_json order by record_json->>'updatedAt' desc), '[]'::jsonb)::text",
    "from (",
    `  select ${selectArtifactCurrentnessJsonExpression("selected")} as record_json`,
    "  from selected",
    ") record_rows;",
    "",
  ].filter(Boolean).join("\n");
}

function selectArtifactCurrentnessJson(alias) {
  return `select ${selectArtifactCurrentnessJsonExpression(alias)}::text from ${alias};`;
}

function selectArtifactCurrentnessJsonExpression(alias) {
  return [
    "jsonb_build_object(",
    "  'schema_version', 'artifact-currentness-record/v1',",
    `  'matterId', coalesce(${alias}.matter_id::text, ''),`,
    `  'artifactId', coalesce(${alias}.artifact_id::text, ''),`,
    `  'artifactFamily', ${alias}.artifact_family,`,
    `  'artifactPath', coalesce(${alias}.artifact_path, ''),`,
    `  'state', ${alias}.state,`,
    `  'dependencyState', coalesce(${alias}.dependency_state, ''),`,
    `  'reasonCode', coalesce(${alias}.reason_code, ''),`,
    `  'sourceEventId', coalesce(${alias}.source_event_id::text, ''),`,
    `  'affectedFileIds', ${alias}.affected_file_ids_json,`,
    `  'metadata', ${alias}.metadata_json,`,
    `  'observedAt', ${alias}.observed_at::text,`,
    `  'updatedAt', ${alias}.updated_at::text`,
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
  return text.slice(0, maxLength);
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlNullableUuid(value) {
  return normalizeText(value) ? sqlUuid(value) : "null";
}

function sqlInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : String(DEFAULT_LIMIT);
}

function sqlTimestamp(value) {
  return `${sqlString(value || new Date().toISOString())}::timestamptz`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}
