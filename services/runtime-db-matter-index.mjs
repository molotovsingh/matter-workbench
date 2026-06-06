import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

export function createRuntimeDbMatterIndex({
  env = process.env,
  spawn = spawnSync,
} = {}) {
  if (!isRuntimeDbModeEnabled(env)) {
    return disabledRuntimeMatterIndex();
  }
  if (!isRuntimeCutoverApproved(env)) {
    throw new Error("MWB_RUNTIME_DB=postgres requires MWB_DB_RUNTIME_CUTOVER_APPROVED=yes.");
  }

  const databaseUrl = String(env.MWB_DATABASE_URL || env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("MWB_RUNTIME_DB=postgres requires MWB_DATABASE_URL or DATABASE_URL.");
  }

  const tenantId = String(env.MWB_RUNTIME_DB_TENANT_ID || defaultRuntimeDbTenantId()).trim();
  const storageMode = isRuntimeDbStorageModeEnabled(env) ? "postgres" : "local-filesystem";

  async function listMatterFolders() {
    return queryMatterRows({ databaseUrl, tenantId, spawn }).map(normalizeMatterRow);
  }

  async function findMatterFolder(name) {
    const rows = queryMatterRows({ databaseUrl, tenantId, spawn, name }).map(normalizeMatterRow);
    return rows[0] || null;
  }

  return {
    enabled: true,
    databaseUrlRedacted: redactDatabaseUrl(databaseUrl),
    storageMode,
    tenantId,
    listMatterFolders,
    findMatterFolder,
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
  };
}

function queryMatterRows({ databaseUrl, tenantId, spawn, name = "" } = {}) {
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: buildMatterRowsSql({ tenantId, name }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    throw makeHttpError(`runtime DB query failed: ${redactRuntimeDbError(result.error.message)}`, 503);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw makeHttpError(`runtime DB query failed: ${redactRuntimeDbError(detail)}`, 503);
  }
  return parsePsqlJsonArray(result.stdout || "");
}

function buildMatterRowsSql({ tenantId, name = "" } = {}) {
  const filter = String(name || "").trim();
  const filterClause = filter
    ? `and (m.name = ${sqlString(filter)} or latest_import.source_root_hint = ${sqlString(filter)})`
    : "";
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
    "    coalesce(m.jurisdiction, '') as jurisdiction",
    "  from matters m",
    "  left join latest_import on latest_import.matter_id = m.id",
    "  where m.tenant_id = current_app_tenant_id()",
    "    and m.status = 'active'",
    `    ${filterClause}`,
    ")",
    "select coalesce(jsonb_agg(jsonb_build_object(",
    "  'id', id,",
    "  'name', folder_name,",
    "  'matterName', matter_name,",
    "  'clientName', client_name,",
    "  'oppositeParty', opposite_party,",
    "  'matterType', matter_type,",
    "  'jurisdiction', jurisdiction",
    ") order by lower(folder_name)), '[]'::jsonb)::text from matter_rows;",
    "",
  ].join("\n");
}

function normalizeMatterRow(row = {}) {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    matterName: stringValue(row.matterName),
    clientName: stringValue(row.clientName),
    oppositeParty: stringValue(row.oppositeParty),
    matterType: stringValue(row.matterType),
    jurisdiction: stringValue(row.jurisdiction),
  };
}

function parsePsqlJsonArray(stdout = "") {
  const text = String(stdout || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw makeHttpError("runtime DB query returned no matter JSON.", 503);
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError("runtime DB query returned invalid matter JSON.", 503);
  }
  if (!Array.isArray(parsed)) {
    throw makeHttpError("runtime DB query returned non-array matter JSON.", 503);
  }
  return parsed;
}

function isRuntimeCutoverApproved(env = process.env) {
  return /^(1|true|yes|approved)$/i.test(String(env.MWB_DB_RUNTIME_CUTOVER_APPROVED || "").trim());
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
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
