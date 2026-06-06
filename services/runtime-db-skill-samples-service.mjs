import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import { normalizeAiRunMetadata, AI_RUN_LEDGER_FIELDS } from "../shared/ai-run-metadata.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { SKILL_SAMPLE_STATE } from "../shared/skill-sample-states.mjs";
import { SKILL_SAMPLES_SCHEMA_VERSION, hashDesignBrief } from "./skill-samples-service.mjs";

const MAX_SAMPLE_MARKDOWN_LENGTH = 60_000;

export function createRuntimeDbSkillSamplesService({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
  now = () => new Date(),
  idFactory = () => `sample_${randomUUID()}`,
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);
  const storePath = "postgres:skill_samples";

  async function recordSample({ idea = {}, sample = {} } = {}) {
    ensureEnabled();
    const ideaId = stringValue(idea.id || sample.idea?.id);
    if (!ideaId) throw makeHttpError("Skill idea id is required for sample storage", 400);
    const timestamp = now().toISOString();
    const sampleId = stringValue(sample.sample_id || sample.id || idFactory());
    const markdown = boundedSampleMarkdown(sample.sampleMarkdown || sample.sample_markdown);
    const stored = normalizeStoredSample({
      id: sampleId,
      ideaId,
      version: 1,
      createdAt: stringValue(sample.generated_at) || timestamp,
      updatedAt: timestamp,
      approved: false,
      approvedAt: "",
      designBriefHash: hashDesignBrief(idea.designBrief || sample.idea?.designBrief || {}),
      matter: normalizeSampleMatter(sample.matter),
      sampleMarkdown: markdown,
      feedback: sample.feedback,
      aiRun: sample.aiRun || sample.ai_run,
      warnings: sample.warnings,
      rawSample: { ...sample, sample_markdown: markdown },
    });
    const row = queryJson(recordSampleSql({ tenantId, sample: stored }));
    return {
      schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
      sample: row?.id ? normalizeStoredSample(row) : stored,
    };
  }

  async function approveSample({ ideaId, sampleId, designBrief = {} } = {}) {
    ensureEnabled();
    const normalizedIdeaId = stringValue(ideaId);
    const normalizedSampleId = stringValue(sampleId);
    if (!normalizedIdeaId) throw makeHttpError("Skill idea id is required", 400);
    if (!normalizedSampleId) throw makeHttpError("Sample id is required", 400);
    const currentHash = hashDesignBrief(designBrief);
    const row = queryJson(approveSampleSql({
      tenantId,
      ideaId: normalizedIdeaId,
      sampleId: normalizedSampleId,
      designBriefHash: currentHash,
    }));
    if (row && Object.keys(row).length && !row.id) throw makeHttpError("Skill sample not found", 404);
    return {
      schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
      sample: row?.id ? normalizeStoredSample(row) : normalizeStoredSample({
        id: normalizedSampleId,
        ideaId: normalizedIdeaId,
        approved: true,
        approvedAt: now().toISOString(),
        designBriefHash: currentHash,
      }),
    };
  }

  async function getApprovedCurrentSample({ ideaId, designBrief = {} } = {}) {
    ensureEnabled();
    const normalizedIdeaId = stringValue(ideaId);
    if (!normalizedIdeaId) throw makeHttpError("Skill idea id is required", 400);
    const currentHash = hashDesignBrief(designBrief);
    const row = queryJson(approvedSampleSql({ tenantId, ideaId: normalizedIdeaId }));
    if (!row?.id) throw makeHttpError("No approved sample found for this skill idea", 409);
    const sample = normalizeStoredSample(row);
    if (sample.designBriefHash !== currentHash) {
      throw makeHttpError("Approved sample is stale because the design brief changed", 409);
    }
    return sample;
  }

  async function listSamples({ ideaId = "" } = {}) {
    ensureEnabled();
    const rows = queryJson(listSamplesSql({ tenantId, ideaId: stringValue(ideaId) }));
    return {
      schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
      samples: (Array.isArray(rows) ? rows : []).map(normalizeStoredSample),
    };
  }

  async function listSamplesForIdea({ ideaId = "", designBrief = {} } = {}) {
    const normalizedIdeaId = stringValue(ideaId);
    if (!normalizedIdeaId) throw makeHttpError("Skill idea id is required", 400);
    const currentHash = hashDesignBrief(designBrief);
    const result = await listSamples({ ideaId: normalizedIdeaId });
    return {
      schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
      ideaId: normalizedIdeaId,
      designBriefHash: currentHash,
      samples: result.samples.map((sample) => decorateSampleWithState(sample, currentHash)),
    };
  }

  function queryJson(sql) {
    const { command, args, env } = psqlConnectionArgs(databaseUrl);
    const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
      input: sql,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    if (result.error) {
      throw makeHttpError(`runtime DB skill samples query failed: ${redactRuntimeDbError(result.error.message)}`, 503);
    }
    if (result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
      throw makeHttpError(`runtime DB skill samples query failed: ${redactRuntimeDbError(detail)}`, 503);
    }
    return parsePsqlJson(result.stdout || "");
  }

  function ensureEnabled() {
    if (!enabled) throw makeHttpError("Runtime DB skill samples service is not configured", 503);
  }

  return {
    approveSample,
    enabled,
    getApprovedCurrentSample,
    hashDesignBrief,
    listSamples,
    listSamplesForIdea,
    recordSample,
    storePath,
  };
}

function listSamplesSql({ tenantId, ideaId = "" }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select coalesce(jsonb_agg(sample_row_json order by version desc, id), '[]'::jsonb)::text",
    "from (",
    `  ${sampleRowsSelectSql()}`,
    "  where ss.tenant_id = current_app_tenant_id()",
    ideaId ? `    and ss.idea_id = ${sqlString(ideaId)}` : "",
    ") rows;",
    "",
  ].filter(Boolean).join("\n");
}

function approvedSampleSql({ tenantId, ideaId }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select coalesce((",
    "  select sample_row_json",
    "  from (",
    `    ${sampleRowsSelectSql()}`,
    "    where ss.tenant_id = current_app_tenant_id()",
    `      and ss.idea_id = ${sqlString(ideaId)}`,
    "      and ss.approved = true",
    "    order by ss.version desc",
    "    limit 1",
    "  ) rows",
    "), '{}'::jsonb)::text;",
    "",
  ].join("\n");
}

function recordSampleSql({ tenantId, sample }) {
  const objectKey = `local-skill-samples/${sample.id}.md`;
  const bytes = Buffer.from(sample.sampleMarkdown);
  const sha256 = sha256Bytes(bytes);
  const storageObjectId = deterministicUuid(`runtime-skill-sample-object:${sample.id}`);
  const payloadId = deterministicUuid(`runtime-skill-sample-payload:${sample.id}`);
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with next_version as (",
    "  select coalesce(max(version), 0) + 1 as version",
    "  from skill_samples",
    "  where tenant_id = current_app_tenant_id()",
    `    and idea_id = ${sqlString(sample.ideaId)}`,
    "), storage_upsert as (",
    "  insert into storage_objects (id, tenant_id, object_key, bucket, storage_provider, object_role, state, mime_type, size_bytes, sha256, idempotency_key, uploaded_at, verified_at)",
    `  values (${sqlUuid(storageObjectId)}, current_app_tenant_id(), ${sqlString(objectKey)}, 'local-db-runtime', 'postgres', 'skill_sample', 'verified', 'text/markdown', ${sqlInteger(bytes.length)}, ${sqlString(sha256)}, ${sqlString(`runtime-db:${objectKey}`)}, now(), now())`,
    "  on conflict (tenant_id, object_key) do update set",
    "    bucket = excluded.bucket,",
    "    storage_provider = excluded.storage_provider,",
    "    object_role = excluded.object_role,",
    "    state = excluded.state,",
    "    mime_type = excluded.mime_type,",
    "    size_bytes = excluded.size_bytes,",
    "    sha256 = excluded.sha256,",
    "    idempotency_key = excluded.idempotency_key,",
    "    uploaded_at = excluded.uploaded_at,",
    "    verified_at = excluded.verified_at",
    "  returning id",
    "), payload_upsert as (",
    "  insert into storage_object_payloads (id, tenant_id, storage_object_id, payload, sha256, size_bytes, verified_at)",
    `  values (${sqlUuid(payloadId)}, current_app_tenant_id(), ${sqlUuid(storageObjectId)}, decode(${sqlString(bytes.toString("hex"))}, 'hex'), ${sqlString(sha256)}, ${sqlInteger(bytes.length)}, now())`,
    "  on conflict (tenant_id, storage_object_id) do update set",
    "    payload = excluded.payload,",
    "    sha256 = excluded.sha256,",
    "    size_bytes = excluded.size_bytes,",
    "    verified_at = excluded.verified_at",
    "  returning storage_object_id",
    "), upserted as (",
    "  insert into skill_samples (id, tenant_id, idea_id, version, approved, approved_at, design_brief_hash, sample_markdown_object_key, sample_hash, feedback, warnings_json, raw_sample_json, storage_object_id, created_at, updated_at)",
    `  values (${sqlString(sample.id)}, current_app_tenant_id(), ${sqlString(sample.ideaId)}, (select version from next_version), false, null, ${sqlString(sample.designBriefHash)}, ${sqlString(objectKey)}, ${sqlString(sha256)}, ${sqlString(sample.feedback)}, ${sqlJson(sample.warnings)}, ${sqlJson(sample.rawSample)}, ${sqlUuid(storageObjectId)}, ${sqlTimestampOrNow(sample.createdAt)}, ${sqlTimestampOrNow(sample.updatedAt)})`,
    "  on conflict (idea_id, version) do update set",
    "    approved = excluded.approved,",
    "    approved_at = excluded.approved_at,",
    "    sample_markdown_object_key = excluded.sample_markdown_object_key,",
    "    sample_hash = excluded.sample_hash,",
    "    feedback = excluded.feedback,",
    "    warnings_json = excluded.warnings_json,",
    "    raw_sample_json = excluded.raw_sample_json,",
    "    storage_object_id = excluded.storage_object_id,",
    "    updated_at = excluded.updated_at",
    "  returning *",
    ")",
    "select coalesce((",
    "  select sample_row_json",
    "  from (",
    `    ${sampleRowsSelectSql("upserted")}`,
    "  ) rows",
    "), '{}'::jsonb)::text;",
    "",
  ].join("\n");
}

function approveSampleSql({ tenantId, ideaId, sampleId, designBriefHash }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with target as (",
    "  select id",
    "  from skill_samples",
    "  where tenant_id = current_app_tenant_id()",
    `    and idea_id = ${sqlString(ideaId)}`,
    `    and id = ${sqlString(sampleId)}`,
    `    and design_brief_hash = ${sqlString(designBriefHash)}`,
    "  limit 1",
    "), cleared as (",
    "  update skill_samples",
    "  set approved = false, approved_at = null, updated_at = now()",
    "  where tenant_id = current_app_tenant_id()",
    `    and idea_id = ${sqlString(ideaId)}`,
    "    and exists (select 1 from target)",
    "  returning id",
    "), updated as (",
    "  update skill_samples",
    "  set approved = true, approved_at = now(), updated_at = now()",
    "  where tenant_id = current_app_tenant_id()",
    "    and id = (select id from target)",
    "  returning *",
    ")",
    "select coalesce((",
    "  select sample_row_json",
    "  from (",
    `    ${sampleRowsSelectSql("updated")}`,
    "  ) rows",
    "), '{}'::jsonb)::text;",
    "",
  ].join("\n");
}

function sampleRowsSelectSql(source = "skill_samples") {
  const tableRef = source === "skill_samples" ? "skill_samples ss" : `${source} ss`;
  return [
    "select",
    "  jsonb_build_object(",
    "    'id', ss.id,",
    "    'ideaId', ss.idea_id,",
    "    'version', ss.version,",
    "    'approved', ss.approved,",
    "    'approvedAt', coalesce(ss.approved_at::text, ''),",
    "    'designBriefHash', ss.design_brief_hash,",
    "    'matterName', coalesce(m.name, ss.raw_sample_json#>>'{matter,matter_name}', ''),",
    "    'matterFolderName', coalesce(m.name, ss.raw_sample_json#>>'{matter,folder_name}', ''),",
    "    'sampleMarkdown', coalesce(convert_from(sop.payload, 'UTF8'), ss.raw_sample_json->>'sample_markdown', ''),",
    "    'feedback', coalesce(ss.feedback, ''),",
    "    'aiRun', coalesce(ss.raw_sample_json->'ai_run', ss.raw_sample_json->'aiRun', '{}'::jsonb),",
    "    'warnings', coalesce(ss.warnings_json, '[]'::jsonb),",
    "    'rawSample', coalesce(ss.raw_sample_json, '{}'::jsonb),",
    "    'createdAt', ss.created_at::text,",
    "    'updatedAt', ss.updated_at::text",
    "  ) as sample_row_json,",
    "  ss.version,",
    "  ss.id",
    `from ${tableRef}`,
    "left join matters m on m.id = ss.matter_id and m.tenant_id = ss.tenant_id",
    "left join storage_objects so on so.id = ss.storage_object_id and so.tenant_id = ss.tenant_id",
    "left join storage_object_payloads sop on sop.storage_object_id = so.id and sop.tenant_id = so.tenant_id",
  ].join("\n");
}

function normalizeStoredSample(sample = {}) {
  return {
    id: stringValue(sample.id || sample.sample_id),
    ideaId: stringValue(sample.ideaId || sample.idea_id),
    version: positiveInteger(sample.version, 1),
    createdAt: stringValue(sample.createdAt),
    updatedAt: stringValue(sample.updatedAt || sample.createdAt),
    approved: Boolean(sample.approved),
    approvedAt: stringValue(sample.approvedAt),
    designBriefHash: stringValue(sample.designBriefHash),
    matter: normalizeSampleMatter(sample.matter || {
      matter_name: sample.matterName,
      folder_name: sample.matterFolderName,
    }),
    sampleMarkdown: boundedSampleMarkdown(sample.sampleMarkdown || sample.sample_markdown),
    feedback: stringValue(sample.feedback),
    aiRun: normalizeAiRunMetadata(sample.aiRun || sample.ai_run, {
      fields: AI_RUN_LEDGER_FIELDS,
      includeEmptyFields: true,
    }),
    warnings: Array.isArray(sample.warnings) ? sample.warnings.map((warning) => String(warning || "")).filter(Boolean).slice(0, 10) : [],
    rawSample: objectValue(sample.rawSample || sample.raw_sample),
  };
}

function normalizeSampleMatter(matter = {}) {
  return {
    matter_name: stringValue(matter.matter_name || matter.matterName),
    folder_name: stringValue(matter.folder_name || matter.folderName),
  };
}

function decorateSampleWithState(sample, currentHash) {
  const current = sample.designBriefHash === currentHash;
  const state = sample.approved
    ? current ? SKILL_SAMPLE_STATE.APPROVED_CURRENT : SKILL_SAMPLE_STATE.APPROVED_STALE
    : current ? SKILL_SAMPLE_STATE.CURRENT : SKILL_SAMPLE_STATE.STALE;
  return {
    ...sample,
    current,
    state,
  };
}

function boundedSampleMarkdown(value) {
  const markdown = String(value || "").trim();
  if (markdown.length > MAX_SAMPLE_MARKDOWN_LENGTH) {
    throw makeHttpError(`Skill sample Markdown must be ${MAX_SAMPLE_MARKDOWN_LENGTH} characters or less`, 400);
  }
  return markdown;
}

function parsePsqlJson(stdout = "") {
  const text = String(stdout || "").trim();
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw makeHttpError("runtime DB skill samples query returned no JSON.", 503);
  const start = Math.min(...starts);
  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError("runtime DB skill samples query returned invalid JSON.", 503);
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.trunc(number);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlTimestampOrNow(value) {
  const text = stringValue(value);
  return text ? `${sqlString(text)}::timestamptz` : "now()";
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

function redactRuntimeDbError(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***");
}
