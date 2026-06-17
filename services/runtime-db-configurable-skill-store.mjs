import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { isStoreReplacement } from "../shared/store-mutation.mjs";
import { normalizeStoredSkill } from "./configurable-skill-definition.mjs";
import { CONFIGURABLE_SKILLS_SCHEMA_VERSION } from "./configurable-skill-store.mjs";
import { ensureRuntimeDbSafeRoleSql, wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";

export function createRuntimeDbConfigurableSkillStore({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);
  const storePath = "postgres:configurable_skills";

  async function readStore() {
    const store = await readStoreWithFingerprint();
    return {
      schema_version: store.schema_version,
      skills: store.skills,
    };
  }

  async function readStoreWithFingerprint() {
    ensureEnabled();
    const payload = queryJson(readStoreSql({ tenantId }));
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.skills) ? payload.skills : [];
    return {
      schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
      catalogFingerprint: stringValue(payload?.catalogFingerprint) || catalogFingerprintFromRows(rows),
      skills: rows.map(normalizeDbSkill),
    };
  }

  async function writeStore(store = {}, { expectedCatalogFingerprint = "" } = {}) {
    ensureEnabled();
    const skills = Array.isArray(store.skills) ? store.skills.map(normalizeStoredSkill) : [];
    const sql = wrapRuntimeDbWriteTransaction([
      `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
      configurableSkillCatalogWriteGuardSql({ expectedCatalogFingerprint }),
      ...skills.flatMap((skill) => configurableSkillUpsertSql(skill)),
      "select '{}'::jsonb::text;",
      "",
    ].join("\n"));
    queryJson(sql);
  }

  async function updateStore(mutator) {
    ensureEnabled();
    if (typeof mutator !== "function") throw makeHttpError("Configurable skill mutator is required", 500, "runtime_db.configurable_skill_store.mutator_required");
    const store = await readStoreWithFingerprint();
    const result = await mutator(store);
    await writeStore(isStoreReplacement(result) ? result : store, { expectedCatalogFingerprint: store.catalogFingerprint });
    return result;
  }

  function queryJson(sql) {
    const { command, args, env } = psqlConnectionArgs(databaseUrl);
    const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
      input: ensureRuntimeDbSafeRoleSql(sql),
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    if (result.error) {
      throw makeHttpError(`runtime DB skill store query failed: ${redactRuntimeDbError(result.error.message)}`, 503, "runtime_db.configurable_skill_store.query_failed");
    }
    if (result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
      if (isStaleCatalogError(detail)) {
        throw makeHttpError("Runtime DB configurable skill catalog changed during update.", 409, "runtime_db.configurable_skill_store.stale_catalog");
      }
      throw makeHttpError(`runtime DB skill store query failed: ${redactRuntimeDbError(detail)}`, 503, "runtime_db.configurable_skill_store.query_failed");
    }
    return parsePsqlJson(result.stdout || "");
  }

  function ensureEnabled() {
    if (!enabled) throw makeHttpError("Runtime DB configurable skill store is not configured", 503, "runtime_db.configurable_skill_store.not_configured");
  }

  return {
    enabled,
    readStore,
    storePath,
    updateStore,
    writeStore,
  };
}

function readStoreSql({ tenantId }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with selected_versions as (",
    "  select",
    "    cs.id as skill_id,",
    "    coalesce(current_version.id, latest_version.id) as version_id,",
    "    coalesce(current_version.version_number, latest_version.version_number, 1) as version_number,",
    "    coalesce(current_version.definition_json, latest_version.definition_json, '{}'::jsonb) as definition_json,",
    "    coalesce(current_version.source_idea_id, latest_version.source_idea_id, '') as source_idea_id,",
    "    coalesce(current_version.policy_prompt_version, latest_version.policy_prompt_version, '') as policy_prompt_version",
    "  from configurable_skills cs",
    "  left join configurable_skill_versions current_version",
    "    on current_version.id = cs.current_version_id and current_version.tenant_id = cs.tenant_id",
    "  left join lateral (",
    "    select *",
    "    from configurable_skill_versions candidate",
    "    where candidate.tenant_id = cs.tenant_id and candidate.skill_id = cs.id",
    "    order by candidate.version_number desc",
    "    limit 1",
    "  ) latest_version on true",
    "  where cs.tenant_id = current_app_tenant_id()",
    "), skill_rows as (",
    "  select",
    "    cs.id,",
    "    cs.title,",
    "    cs.updated_at,",
    "    jsonb_build_object(",
    "      'id', cs.id::text,",
    "      'title', cs.title,",
    "      'slash', cs.slash,",
    "      'status', cs.status,",
    "      'previousStatus', coalesce(cs.previous_status, ''),",
    "      'statusChangedAt', coalesce(cs.status_changed_at::text, ''),",
    "      'statusChangeReason', coalesce(cs.status_change_reason, ''),",
    "      'createdAt', cs.created_at::text,",
    "      'updatedAt', cs.updated_at::text,",
    "      'versionNumber', sv.version_number,",
    "      'sourceIdeaId', coalesce(sv.source_idea_id, ''),",
    "      'policyPromptVersion', coalesce(sv.policy_prompt_version, ''),",
    "      'definitionJson', coalesce(sv.definition_json, '{}'::jsonb)",
    "    ) as skill_json",
    "  from configurable_skills cs",
    "  left join selected_versions sv on sv.skill_id = cs.id",
    "  where cs.tenant_id = current_app_tenant_id()",
    ")",
    "select jsonb_build_object(",
    `  'catalogFingerprint', ${configurableSkillCatalogFingerprintExpression()},`,
    "  'skills', coalesce((",
    "    select jsonb_agg(skill_json order by updated_at desc, title asc)",
    "    from skill_rows",
    "  ), '[]'::jsonb)",
    ")::text;",
    "",
  ].join("\n");
}

function configurableSkillCatalogWriteGuardSql({ expectedCatalogFingerprint = "" } = {}) {
  const fingerprint = stringValue(expectedCatalogFingerprint);
  return [
    "select pg_advisory_xact_lock(hashtext(current_app_tenant_id()::text), hashtext('configurable_skills'));",
    fingerprint ? [
      "do $mwb_configurable_skill_catalog_guard$",
      "declare",
      "  current_fingerprint text;",
      "begin",
      `  select ${configurableSkillCatalogFingerprintExpression()} into current_fingerprint;`,
      `  if current_fingerprint <> ${sqlString(fingerprint)} then`,
      "    raise exception 'runtime DB configurable skill catalog changed during update';",
      "  end if;",
      "end",
      "$mwb_configurable_skill_catalog_guard$;",
    ].join("\n") : "",
  ].filter(Boolean).join("\n");
}

function configurableSkillCatalogFingerprintExpression() {
  return [
    "coalesce((",
    "  select md5(coalesce(string_agg(concat_ws('|',",
    "    cs.id::text,",
    "    cs.updated_at::text,",
    "    coalesce(cs.current_version_id::text, ''),",
    "    coalesce(cv.version_number::text, ''),",
    "    md5(coalesce(cv.definition_json::text, ''))",
    "  ), E'\\n' order by cs.id::text), ''))",
    "  from configurable_skills cs",
    "  left join configurable_skill_versions cv",
    "    on cv.id = cs.current_version_id and cv.tenant_id = cs.tenant_id",
    "  where cs.tenant_id = current_app_tenant_id()",
    "), md5(''))",
  ].join("\n");
}

function configurableSkillUpsertSql(skill = {}) {
  const normalized = normalizeStoredSkill(skill);
  const skillId = dbSkillId(normalized.id);
  const versionId = dbSkillVersionId(normalized.id, normalized.version);
  const definition = skillDefinitionJson(normalized);
  return [
    "insert into configurable_skills (id, tenant_id, title, slash, status, current_version_id, previous_status, status_changed_at, status_changed_by, status_change_reason, created_at, updated_at)",
    `values (${sqlUuid(skillId)}, current_app_tenant_id(), ${sqlString(normalized.title)}, ${sqlString(normalized.slash)}, ${sqlString(normalized.status)}, null, ${sqlStringOrNull(normalized.lifecycle.previousStatus)}, ${sqlTimestampOrNull(normalized.lifecycle.statusChangedAt)}, null, ${sqlString(normalized.lifecycle.reason)}, ${sqlTimestampOrNow(normalized.createdAt)}, ${sqlTimestampOrNow(normalized.updatedAt)})`,
    "on conflict (id) do update set",
    "  title = excluded.title,",
    "  slash = excluded.slash,",
    "  status = excluded.status,",
    "  previous_status = excluded.previous_status,",
    "  status_changed_at = excluded.status_changed_at,",
    "  status_change_reason = excluded.status_change_reason,",
    "  updated_at = excluded.updated_at;",
    "insert into configurable_skill_versions (id, tenant_id, skill_id, version_number, status, definition_json, source_idea_id, policy_prompt_version, created_at)",
    `values (${sqlUuid(versionId)}, current_app_tenant_id(), ${sqlUuid(skillId)}, ${sqlInteger(normalized.version)}, ${sqlString(skillVersionStatus(normalized.status))}, ${sqlJson(definition)}, ${sqlStringOrNull(normalized.sourceIdeaId)}, ${sqlString(normalized.modelPolicy.policyPromptVersion)}, ${sqlTimestampOrNow(normalized.createdAt)})`,
    "on conflict (skill_id, version_number) do update set",
    "  status = excluded.status,",
    "  definition_json = excluded.definition_json,",
    "  source_idea_id = excluded.source_idea_id,",
    "  policy_prompt_version = excluded.policy_prompt_version;",
    "update configurable_skills",
    `set current_version_id = ${sqlUuid(versionId)}`,
    "where tenant_id = current_app_tenant_id()",
    `  and id = ${sqlUuid(skillId)};`,
  ];
}

function normalizeDbSkill(row = {}) {
  const definition = objectValue(row.definitionJson);
  const promptConfig = objectValue(definition.prompt_config);
  const modelPolicy = objectValue(definition.model_policy);
  const validation = objectValue(definition.validation);
  const localId = stringValue(definition.local_id) || stringValue(row.id);
  return normalizeStoredSkill({
    id: localId,
    title: row.title,
    slash: row.slash,
    description: definition.description,
    status: row.status,
    version: Number(row.versionNumber) || 1,
    familyId: definition.family_id || localId,
    previousSkillId: definition.previous_skill_id,
    replacedBySkillId: definition.replaced_by_skill_id,
    sourceIdeaId: row.sourceIdeaId,
    sourceSampleId: definition.source_sample_id,
    approvedSampleHash: definition.approved_sample_hash,
    targetLane: definition.target_lane,
    outputArtifact: definition.output_artifact,
    matterRequired: definition.matter_required,
    paidProviderCall: definition.paid_provider_call,
    sourceBacked: definition.source_backed,
    promptConfig: {
      prompt: promptConfig.prompt,
      citationPolicy: promptConfig.citationPolicy || promptConfig.citation_policy,
    },
    modelPolicy: {
      ...modelPolicy,
      policyPromptVersion: modelPolicy.policyPromptVersion || modelPolicy.policy_prompt_version || row.policyPromptVersion,
    },
    validation,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lifecycle: {
      statusChangedAt: row.statusChangedAt,
      statusChangedBy: row.statusChangedAt ? "local-user" : "",
      reason: row.statusChangeReason,
      previousStatus: row.previousStatus,
    },
  });
}

function skillDefinitionJson(skill = {}) {
  const normalized = normalizeStoredSkill(skill);
  return {
    local_id: normalized.id,
    family_id: normalized.familyId,
    previous_skill_id: normalized.previousSkillId,
    replaced_by_skill_id: normalized.replacedBySkillId,
    description: normalized.description,
    target_lane: normalized.targetLane,
    output_artifact: normalized.outputArtifact,
    matter_required: normalized.matterRequired,
    paid_provider_call: normalized.paidProviderCall,
    source_backed: normalized.sourceBacked,
    prompt_config: normalized.promptConfig,
    model_policy: normalized.modelPolicy,
    validation: normalized.validation,
    source_sample_id: normalized.sourceSampleId,
    approved_sample_hash: normalized.approvedSampleHash,
  };
}

function skillVersionStatus(skillStatus = "") {
  return skillStatus === "draft" ? "draft" : skillStatus === "disabled" ? "disabled" : "active";
}

function dbSkillId(localId = "") {
  const text = stringValue(localId);
  return uuidValue(text) || deterministicUuid(`configurable-skill:${text}`);
}

function dbSkillVersionId(localId = "", version = 1) {
  return deterministicUuid(`configurable-skill-version:${stringValue(localId)}:${positiveInteger(version, 1)}`);
}

function parsePsqlJson(stdout = "") {
  const text = String(stdout || "").trim();
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw makeHttpError("runtime DB skill store query returned no JSON.", 503, "runtime_db.configurable_skill_store.no_json");
  const start = Math.min(...starts);
  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError("runtime DB skill store query returned invalid JSON.", 503, "runtime_db.configurable_skill_store.invalid_json");
  }
}

function catalogFingerprintFromRows(rows = []) {
  return createHash("sha256")
    .update(JSON.stringify(Array.isArray(rows) ? rows : []))
    .digest("hex");
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uuidValue(value) {
  const text = stringValue(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.trunc(number);
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlStringOrNull(value) {
  const text = stringValue(value);
  return text ? sqlString(text) : "null";
}

function sqlTimestampOrNow(value) {
  const text = stringValue(value);
  return text ? `${sqlString(text)}::timestamptz` : "now()";
}

function sqlTimestampOrNull(value) {
  const text = stringValue(value);
  return text ? `${sqlString(text)}::timestamptz` : "null";
}

function sqlInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "0";
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? null))}::jsonb`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
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

function isStaleCatalogError(value) {
  return /runtime DB configurable skill catalog changed during update/i.test(String(value || ""));
}
