import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import {
  SKILL_IDEA_STATUS,
  SKILL_IDEA_STATUS_VALUES,
  normalizeSkillIdeaStatus,
} from "../shared/skill-idea-statuses.mjs";
import {
  calculateSkillIdeaReadiness,
  normalizeSkillIdeaDesignBrief,
} from "../shared/skill-idea-design-brief.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { SKILL_IDEAS_SCHEMA_VERSION } from "./skill-ideas-service.mjs";
import { ensureRuntimeDbSafeRoleSql, wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";

const SKILL_IDEA_STATUSES = new Set(SKILL_IDEA_STATUS_VALUES);
const MAX_IDEA_TEXT_LENGTH = 2000;

export function createRuntimeDbSkillIdeasService({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
  now = () => new Date(),
  idFactory = () => `idea_${randomUUID()}`,
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);
  const storePath = "postgres:skill_ideas";

  async function listIdeas() {
    ensureEnabled();
    const rows = queryJson(listIdeasSql({ tenantId }));
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      ideas: (Array.isArray(rows) ? rows : []).map(normalizeDbIdea),
    };
  }

  async function getIdea(id) {
    ensureEnabled();
    const normalizedId = stringValue(id);
    if (!normalizedId) throw makeHttpError("Skill idea id is required", 400);
    const row = queryJson(getIdeaSql({ tenantId, id: normalizedId }));
    if (!row?.id) throw makeHttpError("Skill idea not found", 404);
    return normalizeDbIdea(row);
  }

  async function createIdea({ text, matter = null, designBrief = {} } = {}) {
    ensureEnabled();
    const normalizedText = normalizeIdeaText(text);
    const timestamp = now().toISOString();
    const idea = normalizeStoredIdea({
      id: idFactory(),
      text: normalizedText,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: SKILL_IDEA_STATUS.INCOMPLETE,
      matter: normalizeMatterSummary(matter),
      designBrief,
    });
    const row = queryJson(wrapRuntimeDbWriteTransaction(upsertIdeaSql({ tenantId, idea })));
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      idea: row?.id ? normalizeDbIdea(row) : idea,
    };
  }

  async function updateIdeaDesignBrief(id, designBrief = {}) {
    ensureEnabled();
    const normalizedId = stringValue(id);
    if (!normalizedId) throw makeHttpError("Skill idea id is required", 400);
    const normalizedDesignBrief = normalizeDesignBrief(designBrief);
    const readiness = calculateSkillIdeaReadiness(normalizedDesignBrief);
    const row = queryJson(wrapRuntimeDbWriteTransaction(updateIdeaDesignBriefSql({
      tenantId,
      id: normalizedId,
      designBrief: normalizedDesignBrief,
      readiness,
    })));
    if (row && Object.keys(row).length && !row.id) throw makeHttpError("Skill idea not found", 404);
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      idea: row?.id ? normalizeDbIdea(row) : normalizeStoredIdea({
        id: normalizedId,
        status: readiness.ready ? SKILL_IDEA_STATUS.READY_FOR_REVIEW : SKILL_IDEA_STATUS.INCOMPLETE,
        designBrief: normalizedDesignBrief,
        updatedAt: now().toISOString(),
      }),
    };
  }

  async function updateIdeaStatus(id, status) {
    ensureEnabled();
    const normalizedId = stringValue(id);
    if (!normalizedId) throw makeHttpError("Skill idea id is required", 400);
    const normalizedStatus = stringValue(status);
    if (!SKILL_IDEA_STATUSES.has(normalizedStatus)) {
      throw makeHttpError(`Invalid skill idea status: ${normalizedStatus || "blank"}`, 400);
    }
    if (normalizedStatus === SKILL_IDEA_STATUS.READY_FOR_REVIEW) {
      const current = await getIdea(normalizedId);
      if (!current.readiness.ready) throw makeHttpError("Skill idea is not ready for review", 400);
    }
    const row = queryJson(wrapRuntimeDbWriteTransaction(updateIdeaStatusSql({ tenantId, id: normalizedId, status: normalizedStatus })));
    if (row && Object.keys(row).length && !row.id) throw makeHttpError("Skill idea not found", 404);
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      idea: row?.id ? normalizeDbIdea(row) : normalizeStoredIdea({
        id: normalizedId,
        status: normalizedStatus,
        updatedAt: now().toISOString(),
      }),
    };
  }

  function queryJson(sql) {
    const { command, args, env } = psqlConnectionArgs(databaseUrl);
    const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
      input: ensureRuntimeDbSafeRoleSql(sql),
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    if (result.error) {
      throw makeHttpError(`runtime DB skill ideas query failed: ${redactRuntimeDbError(result.error.message)}`, 503);
    }
    if (result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
      throw makeHttpError(`runtime DB skill ideas query failed: ${redactRuntimeDbError(detail)}`, 503);
    }
    return parsePsqlJson(result.stdout || "");
  }

  function ensureEnabled() {
    if (!enabled) throw makeHttpError("Runtime DB skill ideas service is not configured", 503);
  }

  return {
    createIdea,
    enabled,
    getIdea,
    listIdeas,
    storePath,
    updateIdeaDesignBrief,
    updateIdeaStatus,
  };
}

function listIdeasSql({ tenantId }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    `select coalesce(jsonb_agg(${skillIdeaRowJsonSql("si")} order by si.created_at desc), '[]'::jsonb)::text`,
    "from skill_ideas si",
    "where si.tenant_id = current_app_tenant_id();",
    "",
  ].join("\n");
}

function getIdeaSql({ tenantId, id }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select coalesce((",
    `  select ${skillIdeaRowJsonSql("si")}`,
    "  from skill_ideas si",
    "  where si.tenant_id = current_app_tenant_id()",
    `    and si.id = ${sqlString(id)}`,
    "  limit 1",
    "), '{}'::jsonb)::text;",
    "",
  ].join("\n");
}

function upsertIdeaSql({ tenantId, idea }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with target_matter as (",
    "  select id",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    `    and (name = ${sqlString(idea.matter.folderName)} or name = ${sqlString(idea.matter.matterName)})`,
    "  order by updated_at desc",
    "  limit 1",
    "), upserted as (",
    "  insert into skill_ideas (id, tenant_id, matter_id, text, status, matter_name, matter_folder_name, design_brief_json, readiness_json, created_at, updated_at)",
    `  values (${sqlString(idea.id)}, current_app_tenant_id(), (select id from target_matter), ${sqlString(idea.text)}, ${sqlString(idea.status)}, ${sqlString(idea.matter.matterName)}, ${sqlString(idea.matter.folderName)}, ${sqlJson(idea.designBrief)}, ${sqlJson(idea.readiness)}, ${sqlTimestampOrNow(idea.createdAt)}, ${sqlTimestampOrNow(idea.updatedAt)})`,
    "  on conflict (id) do update set",
    "    matter_id = excluded.matter_id,",
    "    text = excluded.text,",
    "    status = excluded.status,",
    "    matter_name = excluded.matter_name,",
    "    matter_folder_name = excluded.matter_folder_name,",
    "    design_brief_json = excluded.design_brief_json,",
    "    readiness_json = excluded.readiness_json,",
    "    updated_at = excluded.updated_at",
    "  returning *",
    ")",
    `select ${skillIdeaRowJsonSql("upserted")}::text from upserted;`,
    "",
  ].join("\n");
}

function updateIdeaDesignBriefSql({ tenantId, id, designBrief, readiness }) {
  const nextStatus = readiness.ready ? SKILL_IDEA_STATUS.READY_FOR_REVIEW : SKILL_IDEA_STATUS.INCOMPLETE;
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with updated as (",
    "  update skill_ideas",
    "  set",
    `    design_brief_json = ${sqlJson(designBrief)},`,
    `    readiness_json = ${sqlJson(readiness)},`,
    `    status = case when status = 'ready_for_review' and ${sqlBoolean(!readiness.ready)} then ${sqlString(SKILL_IDEA_STATUS.INCOMPLETE)} else status end,`,
    "    updated_at = now()",
    "  where tenant_id = current_app_tenant_id()",
    `    and id = ${sqlString(id)}`,
    "  returning *",
    ")",
    `select coalesce((select ${skillIdeaRowJsonSql("updated")} from updated), '{}'::jsonb)::text;`,
    "",
  ].join("\n");
}

function updateIdeaStatusSql({ tenantId, id, status }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with updated as (",
    "  update skill_ideas",
    `  set status = ${sqlString(status)}, updated_at = now()`,
    "  where tenant_id = current_app_tenant_id()",
    `    and id = ${sqlString(id)}`,
    "  returning *",
    ")",
    `select coalesce((select ${skillIdeaRowJsonSql("updated")} from updated), '{}'::jsonb)::text;`,
    "",
  ].join("\n");
}

function skillIdeaRowJsonSql(alias) {
  return [
    "jsonb_build_object(",
    `  'id', ${alias}.id,`,
    `  'text', ${alias}.text,`,
    `  'status', ${alias}.status,`,
    `  'matterName', coalesce(${alias}.matter_name, ''),`,
    `  'matterFolderName', coalesce(${alias}.matter_folder_name, ''),`,
    `  'designBriefJson', coalesce(${alias}.design_brief_json, '{}'::jsonb),`,
    `  'readinessJson', coalesce(${alias}.readiness_json, '{}'::jsonb),`,
    `  'createdAt', ${alias}.created_at::text,`,
    `  'updatedAt', ${alias}.updated_at::text`,
    ")",
  ].join("\n");
}

function normalizeDbIdea(row = {}) {
  return normalizeStoredIdea({
    id: row.id,
    text: row.text,
    status: row.status,
    matter: {
      matterName: row.matterName,
      folderName: row.matterFolderName,
    },
    designBrief: row.designBriefJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function normalizeStoredIdea(idea = {}) {
  const designBrief = normalizeDesignBrief(idea.designBrief);
  const readiness = calculateSkillIdeaReadiness(designBrief);
  let status = normalizeSkillIdeaStatus(idea.status);
  if (status === SKILL_IDEA_STATUS.READY_FOR_REVIEW && !readiness.ready) {
    status = SKILL_IDEA_STATUS.INCOMPLETE;
  }
  return {
    id: stringValue(idea.id),
    text: stringValue(idea.text),
    createdAt: stringValue(idea.createdAt),
    updatedAt: stringValue(idea.updatedAt || idea.createdAt),
    status,
    matter: normalizeMatterSummary(idea.matter),
    designBrief,
    readiness,
  };
}

function normalizeIdeaText(text) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) throw makeHttpError("Skill idea text is required", 400);
  if (normalized.length > MAX_IDEA_TEXT_LENGTH) {
    throw makeHttpError(`Skill idea text must be ${MAX_IDEA_TEXT_LENGTH} characters or less`, 400);
  }
  return normalized;
}

function normalizeMatterSummary(matter) {
  if (!matter || typeof matter !== "object") return { matterName: "", folderName: "" };
  return {
    matterName: stringValue(matter.matterName),
    folderName: stringValue(matter.folderName),
  };
}

function normalizeDesignBrief(designBrief) {
  return normalizeSkillIdeaDesignBrief(designBrief, {
    makeError: (message, statusCode) => makeHttpError(message, statusCode),
  });
}

function parsePsqlJson(stdout = "") {
  const text = String(stdout || "").trim();
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw makeHttpError("runtime DB skill ideas query returned no JSON.", 503);
  const start = Math.min(...starts);
  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError("runtime DB skill ideas query returned invalid JSON.", 503);
  }
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? null))}::jsonb`;
}

function sqlTimestampOrNow(value) {
  const text = stringValue(value);
  return text ? `${sqlString(text)}::timestamptz` : "now()";
}

function sqlBoolean(value) {
  return value ? "true" : "false";
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function redactRuntimeDbError(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***");
}
