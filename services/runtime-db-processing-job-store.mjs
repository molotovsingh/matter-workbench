import { randomUUID } from "node:crypto";

const PROCESSING_JOB_ROW_FIELDS = [
  "id::text",
  "matter_id::text",
  "kind",
  "status",
  "idempotency_key",
  "attempt_count",
  "max_attempts",
  "progress_json",
  "created_at",
  "updated_at",
  "started_at",
  "finished_at",
  "error_code",
  "error_message",
];

export function createRuntimeDbProcessingJobStore({
  withRuntimeDbClient,
  ensureEnabled = () => {},
  actorProvider = () => null,
  persistActor = async () => {},
  normalizeMatter = (matter) => matter,
  idFactory = () => randomUUID(),
} = {}) {
  if (typeof withRuntimeDbClient !== "function") {
    throw new Error("withRuntimeDbClient is required for the runtime DB processing job store");
  }

  async function enqueueProcessingJob({ matter, kind, idempotencyKey, metadata = {}, priority = 0 } = {}) {
    const normalizedMatter = normalizeMatter(matter || {});
    if (!normalizedMatter?.id) return null;
    const actor = actorProvider();
    return withRuntimeDbClient(async (client) => {
      await persistActor(client, actor);
      const result = await client.query([
        "insert into processing_jobs (tenant_id, matter_id, kind, status, idempotency_key, created_by_user_id, priority, progress_json, created_at, updated_at)",
        "values (current_app_tenant_id(), $1::uuid, $2, 'queued', $3, $4::uuid, $5::int, $6::jsonb, now(), now())",
        "on conflict (tenant_id, idempotency_key) do update set",
        "  matter_id = excluded.matter_id,",
        "  priority = greatest(processing_jobs.priority, excluded.priority),",
        "  progress_json = case when processing_jobs.status in ('failed','cancelled') then excluded.progress_json else processing_jobs.progress_json || excluded.progress_json end,",
        "  status = case when processing_jobs.status in ('failed','cancelled') then 'queued' else processing_jobs.status end,",
        "  attempt_count = case when processing_jobs.status in ('failed','cancelled') then 0 else processing_jobs.attempt_count end,",
        "  run_after = case when processing_jobs.status in ('failed','cancelled') then now() else processing_jobs.run_after end,",
        "  started_at = case when processing_jobs.status in ('failed','cancelled') then null else processing_jobs.started_at end,",
        "  finished_at = case when processing_jobs.status in ('failed','cancelled') then null else processing_jobs.finished_at end,",
        "  locked_by = case when processing_jobs.status in ('failed','cancelled') then null else processing_jobs.locked_by end,",
        "  locked_at = case when processing_jobs.status in ('failed','cancelled') then null else processing_jobs.locked_at end,",
        "  lock_expires_at = case when processing_jobs.status in ('failed','cancelled') then null else processing_jobs.lock_expires_at end,",
        "  last_heartbeat_at = case when processing_jobs.status in ('failed','cancelled') then null else processing_jobs.last_heartbeat_at end,",
        "  error_code = case when processing_jobs.status in ('failed','cancelled') then null else processing_jobs.error_code end,",
        "  error_message = case when processing_jobs.status in ('failed','cancelled') then null else processing_jobs.error_message end,",
        "  updated_at = now()",
        `returning ${processingJobColumnList()}`,
      ].join("\n"), [
        normalizedMatter.id,
        cleanText(kind, 80),
        cleanText(idempotencyKey, 240) || `runtime-job:${normalizedMatter.id}:${kind}:${idFactory()}`,
        actor?.id || null,
        priority,
        JSON.stringify(metadata || {}),
      ]);
      return normalizeRuntimeProcessingJobRow(result.rows[0]);
    });
  }

  async function listProcessingJobs({ matterName = "", kind = "", status = "", limit = 100 } = {}) {
    ensureEnabled();
    return withRuntimeDbClient(async (client) => {
      const result = await client.query([
        `select ${processingJobColumnList("j", { includeMatterName: true })}`,
        "from processing_jobs j",
        "left join matters m on m.id = j.matter_id and m.tenant_id = j.tenant_id",
        "where j.tenant_id = current_app_tenant_id()",
        "  and ($1 = '' or m.name = $1)",
        "  and ($2 = '' or j.kind = $2)",
        "  and ($3 = '' or j.status = $3)",
        "order by coalesce(j.updated_at, j.created_at) desc",
        "limit $4::int",
      ].join("\n"), [cleanText(matterName, 300), cleanText(kind, 80), cleanText(status, 80), Math.max(1, Math.min(Number(limit) || 100, 500))]);
      return { schema_version: "runtime-db-processing-jobs/v1", jobs: result.rows.map(normalizeRuntimeProcessingJobRow) };
    });
  }

  async function claimNextProcessingJob({ workerId = "runtime-worker", kinds = ["extract"], lockMs = 5 * 60 * 1000 } = {}) {
    ensureEnabled();
    return withRuntimeDbClient(async (client) => {
      await client.query(expireProcessingJobLeasesSql());
      const result = await client.query([
        "with candidate as (",
        "  select id",
        "  from processing_jobs",
        "  where tenant_id = current_app_tenant_id()",
        "    and status in ('queued','retrying')",
        "    and run_after <= now()",
        "    and attempt_count < max_attempts",
        "    and kind = any($2::text[])",
        "  order by priority desc, created_at asc",
        "  limit 1",
        "  for update skip locked",
        ")",
        "update processing_jobs j",
        "set status = 'running',",
        "    started_at = coalesce(j.started_at, now()),",
        "    locked_by = $1,",
        "    locked_at = now(),",
        "    lock_expires_at = now() + ($3::int || ' milliseconds')::interval,",
        "    last_heartbeat_at = now(),",
        "    attempt_count = j.attempt_count + 1,",
        "    updated_at = now()",
        "from candidate c",
        "where j.id = c.id and j.tenant_id = current_app_tenant_id()",
        `returning ${processingJobColumnList("j")}`,
      ].join("\n"), [cleanText(workerId, 120), kinds.map((item) => cleanText(item, 80)).filter(Boolean), Math.max(1000, Number(lockMs) || 300000)]);
      const job = normalizeRuntimeProcessingJobRow(result.rows[0]);
      if (!job?.id) return null;
      const matterResult = await client.query([
        "select id::text, name, name as matter_name, coalesce(client_name,'') as client_name, coalesce(opposite_party,'') as opposite_party, coalesce(matter_type,'') as matter_type, coalesce(jurisdiction,'') as jurisdiction, coalesce(brief_description,'') as brief_description",
        "from matters",
        "where tenant_id = current_app_tenant_id() and id = $1::uuid",
        "limit 1",
      ].join("\n"), [job.matterId]);
      return {
        ...job,
        matter: matterResult.rows[0] ? normalizeMatter({
          id: matterResult.rows[0].id,
          name: matterResult.rows[0].name,
          matterName: matterResult.rows[0].matter_name,
          clientName: matterResult.rows[0].client_name,
          oppositeParty: matterResult.rows[0].opposite_party,
          matterType: matterResult.rows[0].matter_type,
          jurisdiction: matterResult.rows[0].jurisdiction,
          briefDescription: matterResult.rows[0].brief_description,
        }) : null,
      };
    });
  }

  async function completeProcessingJob(jobId, patch = {}) {
    ensureEnabled();
    return withRuntimeDbClient(async (client) => {
      const result = await client.query([
        "update processing_jobs",
        "set status = 'succeeded', finished_at = now(), locked_by = null, locked_at = null, lock_expires_at = null, last_heartbeat_at = now(), progress_json = progress_json || $2::jsonb, updated_at = now()",
        "where tenant_id = current_app_tenant_id() and id = $1::uuid",
        `returning ${processingJobColumnList()}`,
      ].join("\n"), [jobId, JSON.stringify(patch.progress || {})]);
      return normalizeRuntimeProcessingJobRow(result.rows[0]);
    });
  }

  async function failProcessingJob(jobId, error, patch = {}) {
    ensureEnabled();
    const message = cleanText(error?.message || error || "Processing failed", 500);
    const code = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(String(error?.code || ""))
      ? String(error.code)
      : cleanText(patch.errorCode || "processing.failed", 120);
    return withRuntimeDbClient(async (client) => {
      const result = await client.query([
        "update processing_jobs",
        "set status = case when attempt_count < max_attempts then 'retrying' else 'failed' end,",
        "    run_after = case when attempt_count < max_attempts then now() + interval '30 seconds' else run_after end,",
        "    finished_at = case when attempt_count < max_attempts then null else now() end,",
        "    locked_by = null, locked_at = null, lock_expires_at = null, last_heartbeat_at = now(),",
        "    error_code = $2, error_message = $3, progress_json = progress_json || $4::jsonb, updated_at = now()",
        "where tenant_id = current_app_tenant_id() and id = $1::uuid",
        `returning ${processingJobColumnList()}`,
      ].join("\n"), [jobId, code, message, JSON.stringify(patch.progress || {})]);
      return normalizeRuntimeProcessingJobRow(result.rows[0]);
    });
  }

  return {
    claimNextProcessingJob,
    completeProcessingJob,
    enqueueProcessingJob,
    failProcessingJob,
    listProcessingJobs,
  };
}

export function expireProcessingJobLeasesSql() {
  return [
    "update processing_jobs",
    "set status = case when attempt_count >= max_attempts then 'failed' else 'retrying' end,",
    "    finished_at = case when attempt_count >= max_attempts then now() else null end,",
    "    error_code = case when attempt_count >= max_attempts then coalesce(nullif(error_code, ''), 'processing.lease_expired') else error_code end,",
    "    error_message = case when attempt_count >= max_attempts then coalesce(nullif(error_message, ''), 'Processing job exhausted its attempts after an expired worker lease.') else error_message end,",
    "    locked_by = null, locked_at = null, lock_expires_at = null, updated_at = now()",
    "where tenant_id = current_app_tenant_id()",
    "  and status = 'running'",
    "  and lock_expires_at is not null",
    "  and lock_expires_at < now();",
    "update processing_jobs",
    "set status = 'failed',",
    "    finished_at = coalesce(finished_at, now()),",
    "    error_code = coalesce(nullif(error_code, ''), 'processing.attempts_exhausted'),",
    "    error_message = coalesce(nullif(error_message, ''), 'Processing job exhausted its configured attempts.'),",
    "    locked_by = null, locked_at = null, lock_expires_at = null, updated_at = now()",
    "where tenant_id = current_app_tenant_id()",
    "  and status in ('queued', 'retrying')",
    "  and attempt_count >= max_attempts",
  ].join("\n");
}

export function normalizeRuntimeProcessingJobRow(row = {}) {
  if (!row) return null;
  return {
    id: stringValue(row.id),
    matterId: stringValue(row.matter_id ?? row.matterId),
    matterName: stringValue(row.matter_name ?? row.matterName),
    kind: stringValue(row.kind),
    status: stringValue(row.status),
    idempotencyKey: stringValue(row.idempotency_key ?? row.idempotencyKey),
    attemptCount: positiveInteger(row.attempt_count ?? row.attemptCount, 0),
    maxAttempts: positiveInteger(row.max_attempts ?? row.maxAttempts, 0),
    progress: parseJsonObject(row.progress_json ?? row.progressJson),
    createdAt: isoStringOrEmpty(row.created_at ?? row.createdAt),
    updatedAt: isoStringOrEmpty(row.updated_at ?? row.updatedAt),
    startedAt: isoStringOrEmpty(row.started_at ?? row.startedAt),
    finishedAt: isoStringOrEmpty(row.finished_at ?? row.finishedAt),
    errorCode: stringValue(row.error_code ?? row.errorCode),
    errorMessage: stringValue(row.error_message ?? row.errorMessage),
  };
}

function processingJobColumnList(alias = "", { includeMatterName = false } = {}) {
  const qualifier = alias ? `${alias}.` : "";
  const columns = PROCESSING_JOB_ROW_FIELDS.map((field) => `${qualifier}${field}`);
  if (includeMatterName) columns.splice(2, 0, "m.name as matter_name");
  return columns.join(", ");
}

function cleanText(value, maxLength = 200) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isoStringOrEmpty(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function stringValue(value) {
  return String(value ?? "").trim();
}
