import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import { deriveConfigurableSkillRunReceipt } from "../shared/configurable-skill-run-receipts.mjs";
import { makeHttpError, resolveRelativeInside } from "../shared/safe-paths.mjs";
import {
  CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION,
  CONFIGURABLE_SKILL_RUN_SCHEMA_VERSION,
  normalizeRunRecord,
} from "./configurable-skill-runs-service.mjs";
import { ensureRuntimeDbSafeRoleSql, wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export function createRuntimeDbConfigurableSkillRunsService({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
  now = () => new Date(),
  idFactory = () => randomUUID(),
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);
  const transientRuns = new Map();

  async function createRun(entry = {}) {
    ensureEnabled();
    const timestamp = now().toISOString();
    const record = normalizeRuntimeRun({
      ...entry,
      id: uuidValue(entry.id) || idFactory(),
      status: entry.status || "running",
      startedAt: entry.startedAt || timestamp,
      finishedAt: entry.finishedAt || "",
    });
    executeSql(insertRunSql({ tenantId, run: record }));
    transientRuns.set(record.id, record);
    return record;
  }

  async function updateRun(id, patch = {}) {
    ensureEnabled();
    const runId = uuidValue(id);
    if (!runId) throw makeHttpError("Run id is required", 400, "runtime_db.configurable_skill_run.id_required");
    const current = transientRuns.get(runId) || readRunFromDb(runId);
    if (!current) throw makeHttpError(`Configurable skill run ${runId} was not found`, 404, "runtime_db.configurable_skill_run.not_found");
    const next = normalizeRuntimeRun({
      ...current,
      ...patch,
      finishedAt: patch.finishedAt || (
        TERMINAL_STATUSES.has(patch.status) && !current.finishedAt
          ? now().toISOString()
          : current.finishedAt
      ),
    });
    const annotated = await annotateRun({
      ...next,
      availabilityMatterRoot: patch.availabilityMatterRoot,
    });
    executeSql(updateRunSql({ tenantId, run: annotated }));
    transientRuns.set(runId, next);
    return annotated;
  }

  async function recordCancelledRun(entry = {}) {
    const created = await createRun({
      ...entry,
      status: "cancelled",
      overwrite: "cancelled",
      finishedAt: now().toISOString(),
    });
    const annotated = await annotateRun(created);
    executeSql(updateRunSql({ tenantId, run: annotated }));
    transientRuns.set(annotated.id, annotated);
    return annotated;
  }

  async function listRuns({
    slash = "",
    skillId = "",
    matterFolder = "",
    limit = DEFAULT_LIMIT,
  } = {}) {
    ensureEnabled();
    const rows = queryJson(listRunsSql({
      tenantId,
      slash,
      skillId,
      matterFolder,
      limit: normalizeLimit(limit),
    }));
    const runs = await Promise.all((Array.isArray(rows) ? rows : []).map(annotateRun));
    return {
      schema_version: CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION,
      runs,
    };
  }

  function readRunFromDb(runId) {
    const rows = queryJson(listRunsSql({
      tenantId,
      runId,
      limit: 1,
    }));
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? normalizeRuntimeRun(row) : null;
  }

  async function annotateRun(run = {}) {
    const normalized = normalizeRuntimeRun(run);
    const availabilityMatterRoot = normalizeText(run.availabilityMatterRoot);
    const outputAvailability = {
      markdown: await outputPathAvailability(normalized, normalized.outputPaths.markdown, {
        availabilityMatterRoot,
        dbAvailability: readDbOutputAvailability,
      }),
      json: await outputPathAvailability(normalized, normalized.outputPaths.json, {
        availabilityMatterRoot,
        dbAvailability: readDbOutputAvailability,
      }),
    };
    const annotated = {
      ...normalized,
      outputAvailability,
    };
    return {
      ...annotated,
      receipt: deriveConfigurableSkillRunReceipt(annotated),
    };
  }

  function executeSql(sql) {
    queryJson(wrapRuntimeDbWriteTransaction(`${sql}\nselect '{}'::jsonb::text;\n`));
  }

  function queryJson(sql) {
    const { command, args, env } = psqlConnectionArgs(databaseUrl);
    const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
      input: ensureRuntimeDbSafeRoleSql(sql),
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    if (result.error) {
      throw makeHttpError(`runtime DB skill run query failed: ${redactRuntimeDbError(result.error.message)}`, 503, "runtime_db.configurable_skill_runs.query_failed");
    }
    if (result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
      throw makeHttpError(`runtime DB skill run query failed: ${redactRuntimeDbError(detail)}`, 503, "runtime_db.configurable_skill_runs.query_failed");
    }
    return parsePsqlJson(result.stdout || "");
  }

  function readDbOutputAvailability(run, relativePath) {
    if (!run.matterId) return "unknown";
    const result = queryJson(storageObjectAvailabilitySql({
      tenantId,
      matterId: run.matterId,
      matterNames: [run.matterFolder, run.matterName].filter(Boolean),
      relativePath,
    }));
    return normalizeOutputAvailability(result.availability);
  }

  function ensureEnabled() {
    if (!enabled) throw makeHttpError("Runtime DB skill run ledger is not configured", 503, "runtime_db.configurable_skill_runs.not_configured");
  }

  return {
    annotateRun,
    createRun,
    enabled,
    listRuns,
    recordCancelledRun,
    updateRun,
  };
}

function normalizeRuntimeRun(record = {}) {
  const normalized = normalizeRunRecord({
    ...record,
    id: uuidValue(record.id),
    matterId: uuidValue(record.matterId),
  });
  const skillVersion = normalizePositiveInteger(record.skillVersion, normalized.skillVersion || 1);
  const skillId = normalizeText(record.skillId);
  return {
    ...normalized,
    schema_version: CONFIGURABLE_SKILL_RUN_SCHEMA_VERSION,
    id: uuidValue(normalized.id),
    matterId: uuidValue(record.matterId),
    dbSkillId: uuidValue(record.dbSkillId || skillId) || deterministicUuid(`configurable-skill:${skillId}`),
    dbSkillVersionId: uuidValue(record.dbSkillVersionId) || deterministicUuid(`configurable-skill-version:${skillId}:${skillVersion}`),
    skillVersion,
  };
}

async function outputPathAvailability(run = {}, relativePath = "", { availabilityMatterRoot = "", dbAvailability = null } = {}) {
  const outputPath = normalizeText(relativePath);
  if (!outputPath) return "not_recorded";
  const matterRoot = normalizeText(availabilityMatterRoot) || run.matterRoot;
  if (matterRoot && !matterRoot.startsWith("postgres:")) {
    try {
      await access(resolveRelativeInside(matterRoot, outputPath));
      return "present";
    } catch (error) {
      if (error?.code === "ENOENT" || error?.statusCode === 400 || error?.statusCode === 403) return "missing";
      return "unknown";
    }
  }
  if (matterRoot?.startsWith("postgres:") && typeof dbAvailability === "function") {
    return dbAvailability(run, outputPath);
  }
  return normalizeOutputAvailability(run.outputAvailability?.[outputPath.endsWith(".json") ? "json" : "markdown"]);
}

function insertRunSql({ tenantId, run }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "insert into configurable_skill_runs (id, tenant_id, matter_id, skill_id, skill_version_id, status, receipt_json, started_at, finished_at, error_code, error_message)",
    `values (${sqlUuid(run.id)}, current_app_tenant_id(), ${sqlUuidOrNull(run.matterId)}, ${sqlUuid(run.dbSkillId)}, ${sqlUuid(run.dbSkillVersionId)}, ${sqlString(run.status)}, ${sqlJson(receiptJson(run))}, ${sqlTimestamp(run.startedAt)}, ${sqlTimestampOrNull(run.finishedAt)}, '', ${sqlString(run.errorMessage)})`,
    "on conflict (id) do update set",
    "  matter_id = excluded.matter_id,",
    "  skill_id = excluded.skill_id,",
    "  skill_version_id = excluded.skill_version_id,",
    "  status = excluded.status,",
    "  receipt_json = excluded.receipt_json,",
    "  started_at = excluded.started_at,",
    "  finished_at = excluded.finished_at,",
    "  error_code = excluded.error_code,",
    "  error_message = excluded.error_message;",
  ].join("\n");
}

function updateRunSql({ tenantId, run }) {
  const errorCode = run.status === "failed" ? "local_skill_run_failed" : "";
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "update configurable_skill_runs",
    "set",
    `  status = ${sqlString(run.status)},`,
    `  receipt_json = ${sqlJson(receiptJson(run))},`,
    `  finished_at = ${sqlTimestampOrNull(run.finishedAt)},`,
    `  error_code = ${sqlString(errorCode)},`,
    `  error_message = ${sqlString(run.errorMessage)}`,
    `where tenant_id = current_app_tenant_id() and id = ${sqlUuid(run.id)};`,
  ].join("\n");
}

function listRunsSql({ tenantId, slash = "", skillId = "", matterFolder = "", runId = "", limit = DEFAULT_LIMIT }) {
  const normalizedSlash = normalizeText(slash);
  const normalizedSkillId = normalizeText(skillId);
  const normalizedMatterFolder = normalizeText(matterFolder);
  const normalizedRunId = uuidValue(runId);
  const skillIdFilter = normalizedSkillId
    ? `and (cs.id = ${sqlUuid(uuidValue(normalizedSkillId) || deterministicUuid(`configurable-skill:${normalizedSkillId}`))} or csv.definition_json->>'local_id' = ${sqlString(normalizedSkillId)})`
    : "";
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with latest_import as (",
    "  select distinct on (matter_id) matter_id, source_root_hint",
    "  from matter_import_batches",
    "  where tenant_id = current_app_tenant_id()",
    "  order by matter_id, finished_at desc nulls last, created_at desc",
    ")",
    "select coalesce(jsonb_agg(jsonb_build_object(",
    "  'id', csr.id::text,",
    "  'matterId', coalesce(csr.matter_id::text, ''),",
    "  'skillId', coalesce(csv.definition_json->>'local_id', cs.id::text),",
    "  'skillVersion', coalesce(csv.version_number, 1),",
    "  'slash', cs.slash,",
    "  'title', cs.title,",
    "  'matterName', coalesce(m.name, csr.receipt_json#>>'{matter,matterName}', ''),",
    "  'matterFolder', coalesce(nullif(latest_import.source_root_hint, ''), m.name, csr.receipt_json#>>'{matter,folderName}', ''),",
    "  'matterRoot', case when m.name is null then '' else 'postgres:' || coalesce(nullif(latest_import.source_root_hint, ''), m.name) end,",
    "  'status', csr.status,",
    "  'startedAt', csr.started_at,",
    "  'finishedAt', csr.finished_at,",
    "  'outputPaths', coalesce(csr.receipt_json->'output_paths', '{}'::jsonb),",
    "  'outputAvailability', coalesce(csr.receipt_json->'output_availability', '{}'::jsonb),",
    "  'overwrite', coalesce(csr.receipt_json->>'overwrite', 'not_needed'),",
    "  'warnings', coalesce(csr.receipt_json->'warnings', '[]'::jsonb),",
    "  'aiRun', coalesce(csr.receipt_json->'ai_run', '{}'::jsonb),",
    "  'errorMessage', coalesce(csr.error_message, '')",
    ") order by coalesce(csr.finished_at, csr.started_at) desc, csr.id::text desc), '[]'::jsonb)::text",
    "from configurable_skill_runs csr",
    "join configurable_skills cs on cs.id = csr.skill_id and cs.tenant_id = csr.tenant_id",
    "left join configurable_skill_versions csv on csv.id = csr.skill_version_id and csv.tenant_id = csr.tenant_id",
    "left join matters m on m.id = csr.matter_id and m.tenant_id = csr.tenant_id",
    "left join latest_import on latest_import.matter_id = csr.matter_id",
    "where csr.tenant_id = current_app_tenant_id()",
    normalizedRunId ? `and csr.id = ${sqlUuid(normalizedRunId)}` : "",
    normalizedSlash ? `and cs.slash = ${sqlString(normalizedSlash)}` : "",
    skillIdFilter,
    normalizedMatterFolder ? `and coalesce(nullif(latest_import.source_root_hint, ''), m.name, '') = ${sqlString(normalizedMatterFolder)}` : "",
    `limit ${sqlInteger(limit)};`,
  ].filter(Boolean).join("\n");
}

function storageObjectAvailabilitySql({ tenantId, matterId, matterNames = [], relativePath = "" }) {
  const keys = [...new Set(matterNames
    .map((name) => normalizeObjectKey(name))
    .filter(Boolean)
    .map((name) => `${name}/${normalizeObjectKey(relativePath)}`))];
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select jsonb_build_object(",
    "  'availability', case when exists (",
    "    select 1",
    "    from storage_objects so",
    "    join storage_object_payloads sop on sop.storage_object_id = so.id and sop.tenant_id = so.tenant_id",
    "    where so.tenant_id = current_app_tenant_id()",
    `      and so.matter_id = ${sqlUuid(matterId)}`,
    `      and so.object_key = any (${sqlTextArray(keys)})`,
    "      and so.state in ('uploaded', 'verified')",
    "  ) then 'present' else 'missing' end",
    ")::text;",
  ].join("\n");
}

function receiptJson(run = {}) {
  return {
    ...run.receipt,
    overwrite: run.overwrite,
    slash: run.slash,
    title: run.title,
    matter: {
      matterName: run.matterName,
      folderName: run.matterFolder,
    },
    output_paths: run.outputPaths,
    output_availability: run.outputAvailability || {},
    warnings: run.warnings,
    ai_run: run.aiRun,
  };
}

function parsePsqlJson(stdout = "") {
  const text = String(stdout || "").trim();
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw makeHttpError("runtime DB skill run query returned no JSON.", 503, "runtime_db.configurable_skill_runs.no_json");
  const start = Math.min(...starts);
  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError("runtime DB skill run query returned invalid JSON.", 503, "runtime_db.configurable_skill_runs.invalid_json");
  }
}

function normalizeOutputAvailability(value = "") {
  const text = normalizeText(value);
  return ["present", "missing", "not_recorded", "unknown"].includes(text) ? text : "unknown";
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(number), MAX_LIMIT);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeObjectKey(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function uuidValue(value) {
  const text = normalizeText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlUuidOrNull(value) {
  return value ? sqlUuid(value) : "null";
}

function sqlTimestamp(value) {
  return `${sqlString(value || new Date(0).toISOString())}::timestamptz`;
}

function sqlTimestampOrNull(value) {
  return value ? sqlTimestamp(value) : "null";
}

function sqlInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "0";
}

function sqlTextArray(values = []) {
  if (!values.length) return "ARRAY[]::text[]";
  return `ARRAY[${values.map((value) => sqlString(value)).join(", ")}]::text[]`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value || {}))}::jsonb`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function redactRuntimeDbError(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***");
}
