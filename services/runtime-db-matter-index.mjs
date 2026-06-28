import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import { makeHttpError, validateMatterName } from "../shared/safe-paths.mjs";
import { runtimeDatabaseUrl } from "./runtime-db-config.mjs";
import { ensureRuntimeDbSafeRoleSql } from "./runtime-db-sql-safety.mjs";
import { currentRequestContext, runtimeDbUserFromRequestContext } from "./request-context.mjs";

export function createRuntimeDbMatterIndex({
  env = process.env,
  spawn = spawnSync,
  requestContextProvider = currentRequestContext,
} = {}) {
  if (!isRuntimeDbModeEnabled(env)) {
    return disabledRuntimeMatterIndex();
  }
  if (!isRuntimeCutoverApproved(env)) {
    throw new Error("MWB_RUNTIME_DB=postgres requires MWB_DB_RUNTIME_CUTOVER_APPROVED=yes.");
  }

  const databaseUrl = runtimeDatabaseUrl(env);
  if (!databaseUrl) {
    throw new Error("MWB_RUNTIME_DB=postgres requires MWB_RUNTIME_DATABASE_URL, MWB_DATABASE_URL, or DATABASE_URL.");
  }

  const tenantId = String(env.MWB_RUNTIME_DB_TENANT_ID || defaultRuntimeDbTenantId()).trim();
  const storageMode = isRuntimeDbStorageModeEnabled(env) ? "postgres" : "local-filesystem";

  function currentViewer() {
    return runtimeDbUserFromRequestContext(requestContextProvider?.() || {});
  }

  async function listMatterFolders({ includeArchived = false } = {}) {
    return queryMatterRows({ databaseUrl, tenantId, spawn, viewer: currentViewer(), includeArchived }).map(normalizeMatterRow);
  }

  async function findMatterFolder(name, { includeArchived = false } = {}) {
    const rows = queryMatterRows({ databaseUrl, tenantId, spawn, name, viewer: currentViewer(), includeArchived }).map(normalizeMatterRow);
    return rows[0] || null;
  }

  async function archiveMatter(name) {
    const matterName = validateMatterName(name);
    const updated = mutateMatterLifecycle({ databaseUrl, tenantId, spawn, name: matterName, viewer: currentViewer(), fromStatus: "active", toStatus: "archived" });
    if (updated) return normalizeMatterRow(updated);
    const alreadyArchived = await findMatterFolder(matterName, { includeArchived: true });
    if (alreadyArchived?.status === "archived") return alreadyArchived;
    throw makeHttpError("Matter not found", 404, "runtime_db.matter_index.not_found");
  }

  async function reopenMatter(name) {
    const matterName = validateMatterName(name);
    const updated = mutateMatterLifecycle({ databaseUrl, tenantId, spawn, name: matterName, viewer: currentViewer(), fromStatus: "archived", toStatus: "active" });
    if (updated) return normalizeMatterRow(updated);
    const alreadyActive = await findMatterFolder(matterName);
    if (alreadyActive) return alreadyActive;
    throw makeHttpError("Matter not found", 404, "runtime_db.matter_index.not_found");
  }

  return {
    enabled: true,
    databaseUrlRedacted: redactDatabaseUrl(databaseUrl),
    storageMode,
    tenantId,
    listMatterFolders,
    findMatterFolder,
    archiveMatter,
    reopenMatter,
  };
}

export function isRuntimeDbModeEnabled(env = process.env) {
  return String(env.MWB_RUNTIME_DB || "").trim().toLowerCase() === "postgres";
}

export function defaultRuntimeDbTenantId() {
  return deterministicUuid("tenant:local-shadow");
}

export function isRuntimeDbStorageModeEnabled(env = process.env) {
  return String(env.MWB_RUNTIME_DB_STORAGE || "").trim().toLowerCase() === "postgres";
}

function disabledRuntimeMatterIndex() {
  return {
    enabled: false,
    storageMode: "local-filesystem",
    async listMatterFolders() {
      return [];
    },
    async findMatterFolder() {
      return null;
    },
    async archiveMatter() {
      throw makeHttpError("Runtime matter index is disabled.", 409, "runtime_db.matter_index.disabled");
    },
    async reopenMatter() {
      throw makeHttpError("Runtime matter index is disabled.", 409, "runtime_db.matter_index.disabled");
    },
  };
}

function queryMatterRows({ databaseUrl, tenantId, spawn, name = "", viewer = null, includeArchived = false } = {}) {
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: ensureRuntimeDbSafeRoleSql(buildMatterRowsSql({ tenantId, name, viewer, includeArchived })),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    throw makeHttpError(`runtime DB query failed: ${redactRuntimeDbError(result.error.message)}`, 503, "runtime_db.matter_index.query_failed");
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw makeHttpError(`runtime DB query failed: ${redactRuntimeDbError(detail)}`, 503, "runtime_db.matter_index.query_failed");
  }
  return parsePsqlJsonArray(result.stdout || "");
}

function buildMatterRowsSql({ tenantId, name = "", viewer = null, includeArchived = false } = {}) {
  const filter = String(name || "").trim();
  const filterClause = filter
    ? `and (m.name = ${sqlString(filter)} or latest_import.source_root_hint = ${sqlString(filter)})`
    : "";
  const visibilityClause = matterVisibilitySql(viewer);
  const statusClause = includeArchived
    ? "m.status in ('active', 'archived')"
    : "m.status = 'active'";
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with latest_import as (",
    "  select distinct on (matter_id)",
    "    matter_id,",
    "    source_root_hint",
    "  from matter_import_batches",
    "  where tenant_id = current_app_tenant_id()",
    "  order by matter_id, finished_at desc nulls last, created_at desc",
    "), matter_rows as (",
    "  select",
    "    m.id::text as id,",
    "    coalesce(nullif(latest_import.source_root_hint, ''), m.name) as folder_name,",
    "    m.name as matter_name,",
    "    coalesce(m.client_name, '') as client_name,",
    "    coalesce(m.opposite_party, '') as opposite_party,",
    "    coalesce(m.matter_type, '') as matter_type,",
    "    coalesce(m.jurisdiction, '') as jurisdiction,",
    "    coalesce(m.status, 'active') as status,",
    "    coalesce(m.archived_at::text, '') as archived_at",
    "  from matters m",
    "  left join latest_import on latest_import.matter_id = m.id",
    "  where m.tenant_id = current_app_tenant_id()",
    `    and ${statusClause}`,
    visibilityClause,
    `    ${filterClause}`,
    ")",
    "select coalesce(jsonb_agg(jsonb_build_object(",
    "  'id', id,",
    "  'name', folder_name,",
    "  'matterName', matter_name,",
    "  'clientName', client_name,",
    "  'oppositeParty', opposite_party,",
    "  'matterType', matter_type,",
    "  'jurisdiction', jurisdiction,",
    "  'status', status,",
    "  'archivedAt', archived_at",
    ") order by lower(folder_name)), '[]'::jsonb)::text from matter_rows;",
    "",
  ].join("\n");
}

function mutateMatterLifecycle({ databaseUrl, tenantId, spawn, name = "", viewer = null, fromStatus, toStatus } = {}) {
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: ensureRuntimeDbSafeRoleSql(buildMatterLifecycleMutationSql({ tenantId, name, viewer, fromStatus, toStatus })),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    throw makeHttpError(`runtime DB query failed: ${redactRuntimeDbError(result.error.message)}`, 503, "runtime_db.matter_index.query_failed");
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw makeHttpError(`runtime DB query failed: ${redactRuntimeDbError(detail)}`, 503, "runtime_db.matter_index.query_failed");
  }
  return parsePsqlJsonArray(result.stdout || "")[0] || null;
}

function buildMatterLifecycleMutationSql({ tenantId, name = "", viewer = null, fromStatus, toStatus } = {}) {
  const filter = String(name || "").trim();
  const visibilityClause = matterVisibilitySql(viewer);
  const archivedAtSql = toStatus === "archived" ? "now()" : "null";
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with latest_import as (",
    "  select distinct on (matter_id)",
    "    matter_id,",
    "    source_root_hint",
    "  from matter_import_batches",
    "  where tenant_id = current_app_tenant_id()",
    "  order by matter_id, finished_at desc nulls last, created_at desc",
    "), candidate as (",
    "  select",
    "    m.id,",
    "    coalesce(nullif(latest_import.source_root_hint, ''), m.name) as folder_name",
    "  from matters m",
    "  left join latest_import on latest_import.matter_id = m.id",
    "  where m.tenant_id = current_app_tenant_id()",
    `    and m.status = ${sqlString(fromStatus)}`,
    `    and (m.name = ${sqlString(filter)} or latest_import.source_root_hint = ${sqlString(filter)})`,
    visibilityClause,
    "  order by lower(coalesce(nullif(latest_import.source_root_hint, ''), m.name))",
    "  limit 1",
    "), updated as (",
    "  update matters m",
    "  set",
    `    status = ${sqlString(toStatus)},`,
    `    archived_at = ${archivedAtSql},`,
    "    updated_at = now()",
    "  from candidate",
    "  where m.tenant_id = current_app_tenant_id()",
    "    and m.id = candidate.id",
    "  returning",
    "    m.id::text as id,",
    "    candidate.folder_name as folder_name,",
    "    m.name as matter_name,",
    "    coalesce(m.client_name, '') as client_name,",
    "    coalesce(m.opposite_party, '') as opposite_party,",
    "    coalesce(m.matter_type, '') as matter_type,",
    "    coalesce(m.jurisdiction, '') as jurisdiction,",
    "    coalesce(m.status, 'active') as status,",
    "    coalesce(m.archived_at::text, '') as archived_at",
    ")",
    "select coalesce(jsonb_agg(jsonb_build_object(",
    "  'id', id,",
    "  'name', folder_name,",
    "  'matterName', matter_name,",
    "  'clientName', client_name,",
    "  'oppositeParty', opposite_party,",
    "  'matterType', matter_type,",
    "  'jurisdiction', jurisdiction,",
    "  'status', status,",
    "  'archivedAt', archived_at",
    ")), '[]'::jsonb)::text from updated;",
    "",
  ].join("\n");
}

function matterVisibilitySql(viewer = null) {
  if (!viewer?.id) return "";
  const viewerId = sqlUuid(viewer.id);
  const legacyOwnerClause = viewer.role === "superuser"
    ? "\n      or m.created_by_user_id is null"
    : "";
  return [
    "    and (",
    `      m.created_by_user_id = ${viewerId}`,
    "      or exists (",
    "        select 1",
    "        from matter_memberships mm",
    "        where mm.tenant_id = m.tenant_id",
    "          and mm.matter_id = m.id",
    `          and mm.user_id = ${viewerId}`,
    "          and mm.status = 'active'",
    "      )" + legacyOwnerClause,
    "    )",
  ].join("\n");
}

function normalizeMatterRow(row = {}) {
  const normalized = {
    id: stringValue(row.id),
    name: stringValue(row.name),
    matterName: stringValue(row.matterName),
    clientName: stringValue(row.clientName),
    oppositeParty: stringValue(row.oppositeParty),
    matterType: stringValue(row.matterType),
    jurisdiction: stringValue(row.jurisdiction),
  };
  const status = stringValue(row.status) || "active";
  if (status === "archived") normalized.status = "archived";
  const archivedAt = stringValue(row.archivedAt);
  if (archivedAt) normalized.archivedAt = archivedAt;
  return normalized;
}

function parsePsqlJsonArray(stdout = "") {
  const text = String(stdout || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw makeHttpError("runtime DB query returned no matter JSON.", 503, "runtime_db.matter_index.no_json");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError("runtime DB query returned invalid matter JSON.", 503, "runtime_db.matter_index.invalid_json");
  }
  if (!Array.isArray(parsed)) {
    throw makeHttpError("runtime DB query returned non-array matter JSON.", 503, "runtime_db.matter_index.non_array_json");
  }
  return parsed;
}

function isRuntimeCutoverApproved(env = process.env) {
  return /^(1|true|yes|approved)$/i.test(String(env.MWB_DB_RUNTIME_CUTOVER_APPROVED || "").trim());
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function redactRuntimeDbError(value) {
  return redactDatabaseUrl(String(value || ""))
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***");
}

function redactDatabaseUrl(value) {
  return String(value || "").replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@");
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
