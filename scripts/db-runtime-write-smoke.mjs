#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createWorkbenchServer } from "../server.mjs";
import { psqlConnectionArgs } from "./db-psql.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { defaultRuntimeDbTenantId } from "../services/runtime-db-matter-index.mjs";
import { runtimeDatabaseUrl, runtimeDatabaseUrlSource } from "../services/runtime-db-config.mjs";
import { ensureRuntimeDbSafeRoleSql, wrapRuntimeDbWriteTransaction } from "../services/runtime-db-sql-safety.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const __filename = fileURLToPath(import.meta.url);

export async function runRuntimeDbWriteSmoke({
  env = process.env,
  createServer = createWorkbenchServer,
  fetchImpl = fetch,
  execSql = executePsqlJson,
  now = () => new Date(),
} = {}) {
  const databaseUrl = runtimeDatabaseUrl(env);
  const tenantId = String(env.MWB_RUNTIME_DB_TENANT_ID || defaultRuntimeDbTenantId()).trim();
  const startedAt = now();
  const testRunId = `runtime-db-write-smoke-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  const matterName = `Runtime DB Write Smoke ${testRunId.slice(-20)}`;
  const sourcePath = "00_Inbox/Intake 01 - Initial/Source Files/smoke.txt";

  const report = {
    passed: false,
    mode: "runtime DB live write smoke",
    databaseUrlSource: runtimeDatabaseUrlSource(env),
    tenantId,
    testRunId,
    matterName,
    roleGuardPassed: false,
    uploadCreated: false,
    addFilesCreated: false,
    workspaceReadable: false,
    filePreviewReadable: false,
    followUpPreviewReadable: false,
    rawFileReadable: false,
    dbRowsVerified: false,
    rollbackVerified: false,
    cleanupDeleted: false,
    counts: {},
    error: "",
  };

  if (!databaseUrl) {
    report.error = "Set MWB_RUNTIME_DATABASE_URL, MWB_DATABASE_URL, or DATABASE_URL before running the runtime DB write smoke.";
    return report;
  }

  try {
    const role = await execSql({
      databaseUrl,
      sql: buildRuntimeRoleCheckSql({ tenantId }),
    });
    report.roleGuardPassed = Boolean(role?.currentUser && role.superuser === false && role.bypassRls === false);
    if (!report.roleGuardPassed) {
      report.error = "Runtime DB role is not safe for production runtime use.";
      return report;
    }

    const smokeEnv = {
      ...env,
      MWB_RUNTIME_DB: "postgres",
      MWB_RUNTIME_DB_STORAGE: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_RUNTIME_DATABASE_URL: databaseUrl,
      MWB_RUNTIME_DB_TENANT_ID: tenantId,
    };
    const app = await createServer({
      env: smokeEnv,
      host: "127.0.0.1",
      port: 0,
    });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    try {
      const smokeFetch = await createRuntimeSmokeFetch({ fetchImpl, baseUrl, env: smokeEnv });
      const created = await postSmokeMatter({ fetchImpl: smokeFetch, baseUrl, matterName });
      report.uploadCreated = Boolean(created?.folderName === matterName || created?.inputLabel === `postgres:${matterName}`);

      const added = await postSmokeAddFiles({ fetchImpl: smokeFetch, baseUrl, matterName });
      report.addFilesCreated = Boolean(
        (added?.folderName === matterName || added?.inputLabel === `postgres:${matterName}`)
        && added?.intakeAdded?.unique >= 1
      );
      const followUpPath = added?.intakeAdded?.intakeDirName
        ? `00_Inbox/${added.intakeAdded.intakeDirName}/Source Files/follow-up.txt`
        : "";

      const workspace = await postJson(smokeFetch, baseUrl, "/api/switch-matter", { name: matterName });
      report.workspaceReadable = Boolean(workspace?.metadata || workspace?.tree || workspace?.files);

      const preview = await getJson(smokeFetch, baseUrl, `/api/file?${new URLSearchParams({ path: sourcePath })}`);
      report.filePreviewReadable = /runtime DB write smoke source text/i.test(String(preview?.content || ""));
      if (followUpPath) {
        const followUpPreview = await getJson(smokeFetch, baseUrl, `/api/file?${new URLSearchParams({ path: followUpPath })}`);
        report.followUpPreviewReadable = /runtime DB write smoke follow-up text/i.test(String(followUpPreview?.content || ""));
      }

      const raw = await smokeFetch(`${baseUrl}/api/file-raw?${new URLSearchParams({ path: sourcePath })}`);
      report.rawFileReadable = Boolean(raw.ok && (await raw.text()).includes("runtime DB write smoke source text"));
    } finally {
      await new Promise((resolve) => app.server.close(resolve));
    }

    const counts = await execSql({
      databaseUrl,
      sql: buildWriteSmokeCountsSql({ tenantId, matterName }),
    });
    report.counts = counts || {};
    report.dbRowsVerified = Boolean(
      counts?.matterCount === 1
      && counts?.documents >= 2
      && counts?.storageObjects >= 3
      && counts?.payloadRows >= 3
      && counts?.payloadBytes > 0
      && counts?.importBatches >= 2
    );

    await assertRollbackProbe({ databaseUrl, tenantId, testRunId, execSql });
    report.rollbackVerified = true;

    await execSql({
      databaseUrl,
      sql: buildDeleteSmokeMatterSql({ tenantId, matterName }),
    });
    const cleanup = await execSql({
      databaseUrl,
      sql: buildWriteSmokeCountsSql({ tenantId, matterName }),
    });
    report.cleanupDeleted = Boolean(cleanup?.matterCount === 0 && cleanup?.activeMatterCount === 0);

    report.passed = Boolean(
      report.roleGuardPassed
      && report.uploadCreated
      && report.addFilesCreated
      && report.workspaceReadable
      && report.filePreviewReadable
      && report.followUpPreviewReadable
      && report.rawFileReadable
      && report.dbRowsVerified
      && report.rollbackVerified
      && report.cleanupDeleted
    );
    if (!report.passed) report.error = "Runtime DB write smoke did not satisfy every acceptance check.";
    return report;
  } catch (error) {
    report.error = redactRuntimeWriteSmokeLine(error.message);
    return report;
  }
}

export function renderRuntimeDbWriteSmokeReport(report = {}) {
  const lines = [
    "Matter Workbench runtime DB write smoke",
    `passed: ${report.passed ? "yes" : "no"}`,
    `mode: ${report.mode || "runtime DB live write smoke"}`,
    `database_url_source: ${report.databaseUrlSource || ""}`,
    `tenant_id: ${report.tenantId || ""}`,
    `test_run_id: ${report.testRunId || ""}`,
    `matter_name: ${report.matterName || ""}`,
    `role_guard_passed: ${report.roleGuardPassed ? "yes" : "no"}`,
    `upload_created: ${report.uploadCreated ? "yes" : "no"}`,
    `add_files_created: ${report.addFilesCreated ? "yes" : "no"}`,
    `workspace_readable: ${report.workspaceReadable ? "yes" : "no"}`,
    `file_preview_readable: ${report.filePreviewReadable ? "yes" : "no"}`,
    `follow_up_preview_readable: ${report.followUpPreviewReadable ? "yes" : "no"}`,
    `raw_file_readable: ${report.rawFileReadable ? "yes" : "no"}`,
    `db_rows_verified: ${report.dbRowsVerified ? "yes" : "no"}`,
    `rollback_verified: ${report.rollbackVerified ? "yes" : "no"}`,
    `cleanup_deleted: ${report.cleanupDeleted ? "yes" : "no"}`,
    `counts: ${JSON.stringify(report.counts || {})}`,
  ];
  if (report.error) lines.push(`error: ${report.error}`);
  return lines.map(redactRuntimeWriteSmokeLine);
}

async function postSmokeMatter({ fetchImpl, baseUrl, matterName }) {
  const form = new FormData();
  form.set("name", matterName);
  form.set("metadata", JSON.stringify({
    matterName,
    clientName: "Runtime DB Smoke Client",
    oppositeParty: "Runtime DB Smoke Opposite",
    matterType: "Internal Runtime DB Smoke",
    jurisdiction: "Local",
    briefDescription: "Disposable runtime DB write-smoke matter.",
  }));
  form.set("paths", JSON.stringify(["smoke.txt"]));
  form.append(
    "files",
    new Blob(["runtime DB write smoke source text\n"], { type: "text/plain" }),
    "smoke.txt",
  );
  return await postMultipart(fetchImpl, baseUrl, "/api/matters/new", form);
}

async function postSmokeAddFiles({ fetchImpl, baseUrl, matterName }) {
  const form = new FormData();
  form.set("matterName", matterName);
  form.set("label", "Follow Up");
  form.set("paths", JSON.stringify(["follow-up.txt"]));
  form.append(
    "files",
    new Blob(["runtime DB write smoke follow-up text\n"], { type: "text/plain" }),
    "follow-up.txt",
  );
  return await postMultipart(fetchImpl, baseUrl, "/api/matters/add-files", form);
}

async function createRuntimeSmokeFetch({ fetchImpl, baseUrl, env = {} }) {
  const username = String(env.MWB_PRIVATE_BETA_USERNAME || "").trim();
  const password = String(env.MWB_PRIVATE_BETA_PASSWORD || "");
  if (!username && !password) return fetchImpl;
  if (!username || !password) throw new Error("Runtime DB write smoke private-beta auth requires both username and password.");

  const response = await fetchImpl(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(`/api/auth/login: ${payload?.error || response.status}`);
  const cookie = firstCookie(response.headers?.get?.("set-cookie") || "");
  if (!cookie) throw new Error("/api/auth/login returned no session cookie");

  return (url, options = {}) => fetchImpl(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      cookie,
    },
  });
}

function firstCookie(value = "") {
  return String(value).split(";")[0].trim();
}

async function getJson(fetchImpl, baseUrl, pathName) {
  const response = await fetchImpl(`${baseUrl}${pathName}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${pathName}: ${payload.error || response.status}`);
  return payload;
}

async function postJson(fetchImpl, baseUrl, pathName, body = {}) {
  const response = await fetchImpl(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${pathName}: ${payload.error || response.status}`);
  return payload;
}

async function postMultipart(fetchImpl, baseUrl, pathName, form) {
  const response = await fetchImpl(`${baseUrl}${pathName}`, {
    method: "POST",
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${pathName}: ${payload.error || response.status}`);
  return payload;
}

async function assertRollbackProbe({ databaseUrl, tenantId, testRunId, execSql }) {
  try {
    await execSql({
      databaseUrl,
      sql: buildRollbackProbeSql({ tenantId, testRunId }),
    });
  } catch {
    // The SQL intentionally raises after inserting. The proof is absence of the row.
  }
  const verification = await execSql({
    databaseUrl,
    sql: buildRollbackProbeCountSql({ tenantId, testRunId }),
  });
  if (verification?.rollbackProbeRows !== 0) {
    throw new Error("Runtime DB rollback probe left rows behind.");
  }
}

function buildRuntimeRoleCheckSql({ tenantId }) {
  return ensureRuntimeDbSafeRoleSql([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select jsonb_build_object(",
    "  'currentUser', current_user,",
    "  'superuser', coalesce(r.rolsuper, false),",
    "  'bypassRls', coalesce(r.rolbypassrls, false)",
    ")::text",
    "from pg_roles r",
    "where r.rolname = current_user;",
  ].join("\n"));
}

function buildWriteSmokeCountsSql({ tenantId, matterName }) {
  return ensureRuntimeDbSafeRoleSql([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with target as (",
    "  select id, status",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    `    and name = ${sqlString(matterName)}`,
    ")",
    "select jsonb_build_object(",
    "  'matterCount', (select count(*)::int from target),",
    "  'activeMatterCount', (select count(*)::int from target where status = 'active'),",
    "  'documents', (select count(*)::int from documents d join target t on t.id = d.matter_id where d.tenant_id = current_app_tenant_id()),",
    "  'storageObjects', (select count(*)::int from storage_objects so join target t on t.id = so.matter_id where so.tenant_id = current_app_tenant_id()),",
    "  'payloadRows', (select count(*)::int from storage_object_payloads sop join target t on t.id = sop.matter_id where sop.tenant_id = current_app_tenant_id()),",
    "  'payloadBytes', coalesce((select sum(sop.size_bytes)::int from storage_object_payloads sop join target t on t.id = sop.matter_id where sop.tenant_id = current_app_tenant_id()), 0),",
    "  'importBatches', (select count(*)::int from matter_import_batches mib join target t on t.id = mib.matter_id where mib.tenant_id = current_app_tenant_id())",
    ")::text;",
  ].join("\n"));
}

function buildRollbackProbeSql({ tenantId, testRunId }) {
  return wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "insert into audit_events (tenant_id, actor_type, action, target_type, metadata_json, created_at)",
    `values (current_app_tenant_id(), 'system', 'runtime_db_write_smoke_rollback_probe', 'runtime_db_write_smoke', jsonb_build_object('testRunId', ${sqlString(testRunId)}), now());`,
    "select 1 / 0;",
  ].join("\n"));
}

function buildRollbackProbeCountSql({ tenantId, testRunId }) {
  return ensureRuntimeDbSafeRoleSql([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select jsonb_build_object(",
    "  'rollbackProbeRows', count(*)::int",
    ")::text",
    "from audit_events",
    "where tenant_id = current_app_tenant_id()",
    "  and action = 'runtime_db_write_smoke_rollback_probe'",
    `  and metadata_json->>'testRunId' = ${sqlString(testRunId)};`,
  ].join("\n"));
}

function buildDeleteSmokeMatterSql({ tenantId, matterName }) {
  return wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "create temporary table mwb_runtime_smoke_target on commit drop as",
    "select id",
    "from matters",
    "where tenant_id = current_app_tenant_id()",
    `  and name = ${sqlString(matterName)}`,
    "  and name like 'Runtime DB Write Smoke %';",
    "delete from cost_events ce using mwb_runtime_smoke_target t where ce.tenant_id = current_app_tenant_id() and ce.matter_id = t.id;",
    "delete from configurable_skill_runs csr using mwb_runtime_smoke_target t where csr.tenant_id = current_app_tenant_id() and csr.matter_id = t.id;",
    "delete from skill_samples ss using mwb_runtime_smoke_target t where ss.tenant_id = current_app_tenant_id() and ss.matter_id = t.id;",
    "delete from skill_ideas si using mwb_runtime_smoke_target t where si.tenant_id = current_app_tenant_id() and si.matter_id = t.id;",
    "delete from source_descriptors sd using mwb_runtime_smoke_target t where sd.tenant_id = current_app_tenant_id() and sd.matter_id = t.id;",
    "delete from document_text_blocks dtb using mwb_runtime_smoke_target t where dtb.tenant_id = current_app_tenant_id() and dtb.matter_id = t.id;",
    "delete from extraction_records er using mwb_runtime_smoke_target t where er.tenant_id = current_app_tenant_id() and er.matter_id = t.id;",
    "delete from artifact_validation_results avr using mwb_runtime_smoke_target t where avr.tenant_id = current_app_tenant_id() and avr.matter_id = t.id;",
    "delete from preparation_advisory_snapshots pas using mwb_runtime_smoke_target t where pas.tenant_id = current_app_tenant_id() and pas.matter_id = t.id;",
    "delete from attention_acknowledgements aa using incidents i, mwb_runtime_smoke_target t where aa.tenant_id = current_app_tenant_id() and aa.incident_id = i.id and i.matter_id = t.id;",
    "delete from incidents i using mwb_runtime_smoke_target t where i.tenant_id = current_app_tenant_id() and i.matter_id = t.id;",
    "delete from provider_runs pr using mwb_runtime_smoke_target t where pr.tenant_id = current_app_tenant_id() and pr.matter_id = t.id;",
    "delete from job_outbox jo using processing_jobs pj, mwb_runtime_smoke_target t where jo.tenant_id = current_app_tenant_id() and jo.job_id = pj.id and pj.matter_id = t.id;",
    "delete from processing_jobs pj using mwb_runtime_smoke_target t where pj.tenant_id = current_app_tenant_id() and pj.matter_id = t.id;",
    "delete from matter_artifacts ma using mwb_runtime_smoke_target t where ma.tenant_id = current_app_tenant_id() and ma.matter_id = t.id;",
    "delete from storage_object_payloads sop using mwb_runtime_smoke_target t where sop.tenant_id = current_app_tenant_id() and sop.matter_id = t.id;",
    "delete from matter_import_items mii using mwb_runtime_smoke_target t where mii.tenant_id = current_app_tenant_id() and mii.matter_id = t.id;",
    "delete from matter_import_batches mib using mwb_runtime_smoke_target t where mib.tenant_id = current_app_tenant_id() and mib.matter_id = t.id;",
    "delete from document_blobs db using mwb_runtime_smoke_target t where db.tenant_id = current_app_tenant_id() and db.matter_id = t.id;",
    "delete from storage_objects so using mwb_runtime_smoke_target t where so.tenant_id = current_app_tenant_id() and so.matter_id = t.id;",
    "delete from documents d using mwb_runtime_smoke_target t where d.tenant_id = current_app_tenant_id() and d.matter_id = t.id;",
    "delete from upload_sessions us using mwb_runtime_smoke_target t where us.tenant_id = current_app_tenant_id() and us.matter_id = t.id;",
    "delete from matter_memberships mm using mwb_runtime_smoke_target t where mm.tenant_id = current_app_tenant_id() and mm.matter_id = t.id;",
    "delete from matter_intakes mi using mwb_runtime_smoke_target t where mi.tenant_id = current_app_tenant_id() and mi.matter_id = t.id;",
    "delete from audit_events ae using mwb_runtime_smoke_target t where ae.tenant_id = current_app_tenant_id() and ae.matter_id = t.id;",
    "delete from matters m using mwb_runtime_smoke_target t where m.tenant_id = current_app_tenant_id() and m.id = t.id;",
    "select '{}'::jsonb::text;",
  ].join("\n"));
}

function executePsqlJson({ databaseUrl, sql }) {
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawnSync(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed: ${redactRuntimeWriteSmokeLine(result.error.message)}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactRuntimeWriteSmokeLine(detail)}`);
  }
  return parsePsqlJsonObject(result.stdout || "");
}

function parsePsqlJsonObject(stdout) {
  const text = String(stdout || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("psql returned no JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function redactRuntimeWriteSmokeLine(value) {
  return redactSensitiveText(String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***"));
}

async function writeReportArtifacts(report, outDir) {
  const targetDir = path.resolve(outDir);
  await mkdir(targetDir, { recursive: true });
  const safeId = String(report.testRunId || new Date().toISOString()).replace(/[^a-zA-Z0-9_.-]/g, "-");
  const jsonPath = path.join(targetDir, `${safeId}.json`);
  const mdPath = path.join(targetDir, `${safeId}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(mdPath, `${renderRuntimeDbWriteSmokeReport(report).join("\n")}\n`);
  return { jsonPath, mdPath };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function main() {
  await loadDatabaseScriptEnv();
  const report = await runRuntimeDbWriteSmoke();
  for (const line of renderRuntimeDbWriteSmokeReport(report)) console.log(line);
  const outDir = optionValue("--out-dir");
  if (outDir) {
    const artifacts = await writeReportArtifacts(report, outDir);
    console.log(`report_json: ${artifacts.jsonPath}`);
    console.log(`report_md: ${artifacts.mdPath}`);
  }
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactRuntimeWriteSmokeLine(error.message));
    process.exitCode = 1;
  });
}
