#!/usr/bin/env node
import pg from "pg";
import { pathToFileURL } from "node:url";

import { defaultRuntimeDbTenantId } from "../services/runtime-db-matter-index.mjs";

const ACTIVE_PROCESSING_JOB_STATUSES = Object.freeze(["queued", "running", "retrying"]);
const BLOCKED_EXIT_CODE = 75;

export async function listActiveRuntimeProcessingJobs({
  env = process.env,
  createClient = (config) => new pg.Client(config),
} = {}) {
  if (!runtimeDbModeEnabled(env)) {
    return { enabled: false, tenantId: "", jobs: [] };
  }

  const databaseUrl = runtimeDatabaseUrl(env);
  if (!databaseUrl) {
    throw new Error("Runtime processing-job drain check requires a configured database URL.");
  }

  const tenantId = String(env.MWB_RUNTIME_DB_TENANT_ID || defaultRuntimeDbTenantId()).trim();
  const client = createClient({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    const result = await client.query([
      "select id::text, kind, status, matter_id::text, attempt_count, max_attempts, created_at",
      "from processing_jobs",
      "where tenant_id = $1::uuid",
      "  and status = any($2::text[])",
      "order by priority desc, created_at asc",
      "limit 100",
    ].join("\n"), [tenantId, ACTIVE_PROCESSING_JOB_STATUSES]);
    return {
      enabled: true,
      tenantId,
      jobs: Array.isArray(result.rows) ? result.rows.map(normalizeJob) : [],
    };
  } finally {
    await client.end();
  }
}

export async function runPrivateVmProcessingDrainCheck({
  env = process.env,
  createClient,
  stdout = (line) => console.log(line),
  stderr = (line) => console.error(line),
} = {}) {
  const result = await listActiveRuntimeProcessingJobs({ env, createClient });
  if (!result.enabled) {
    stdout("Runtime DB processing is not enabled; no active-job deploy guard required.");
    return 0;
  }
  if (!result.jobs.length) {
    stdout("Runtime processing queue is drained; deployment may continue.");
    return 0;
  }

  stderr(`Refusing deployment activation: ${result.jobs.length} runtime processing job(s) are queued or running.`);
  for (const job of result.jobs) {
    stderr(`- ${job.id}\t${job.kind}\t${job.status}\tattempt ${job.attemptCount}/${job.maxAttempts}`);
  }
  stderr("Wait for Activity to finish, then rerun the same deployment command. The current release was not restarted.");
  return BLOCKED_EXIT_CODE;
}

function runtimeDbModeEnabled(env = {}) {
  return [env.MWB_RUNTIME_DB, env.MWB_RUNTIME_DB_STORAGE]
    .some((value) => String(value || "").trim().toLowerCase() === "postgres");
}

function runtimeDatabaseUrl(env = {}) {
  return String(
    env.MWB_MIGRATION_DATABASE_URL
      || env.MWB_RUNTIME_DATABASE_URL
      || env.MWB_DATABASE_URL
      || env.DATABASE_URL
      || "",
  ).trim();
}

function normalizeJob(row = {}) {
  return {
    id: String(row.id || ""),
    kind: String(row.kind || "unknown"),
    status: String(row.status || "unknown"),
    matterId: String(row.matter_id || ""),
    attemptCount: Number(row.attempt_count) || 0,
    maxAttempts: Number(row.max_attempts) || 0,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await runPrivateVmProcessingDrainCheck();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}
