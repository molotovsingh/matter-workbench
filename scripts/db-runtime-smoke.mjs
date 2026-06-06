#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";

import { createWorkbenchServer } from "../server.mjs";

const __filename = fileURLToPath(import.meta.url);

export async function runRuntimeDbSmoke({
  env = process.env,
  serverOptions = {},
  fetchImpl = fetch,
} = {}) {
  let app;
  try {
    app = await createWorkbenchServer({
      ...serverOptions,
      env,
      host: "127.0.0.1",
      port: 0,
    });
  } catch (error) {
    return failedReport({
      runtimeDbEnabled: false,
      error: redactRuntimeSmokeLine(error.message),
    });
  }

  if (!app.runtimeMatterIndex?.enabled) {
    return failedReport({
      runtimeDbEnabled: false,
      error: "Runtime DB is not enabled. Set MWB_RUNTIME_DB=postgres before running this smoke.",
    });
  }

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const matters = await getJson(fetchImpl, baseUrl, "/api/matters");
    const matterRows = Array.isArray(matters.matters) ? matters.matters : [];
    if (!matterRows.length) {
      return failedReport({ runtimeDbEnabled: true, error: "Runtime DB returned no active matters." });
    }

    const requestedMatter = String(env.MWB_RUNTIME_DB_SMOKE_MATTER || "").trim();
    const target = requestedMatter
      ? matterRows.find((matter) => matter.name === requestedMatter || matter.matterName === requestedMatter)
      : matterRows[0];
    if (!target) {
      return failedReport({
        runtimeDbEnabled: true,
        matterCount: matterRows.length,
        error: `Runtime DB smoke matter not found: ${requestedMatter}`,
      });
    }

    const workspace = await postJson(fetchImpl, baseUrl, "/api/switch-matter", { name: target.name });
    const config = await getJson(fetchImpl, baseUrl, "/api/config");
    const fileCount = Number(workspace.fileCount ?? countWorkspaceNodes(workspace.tree || workspace.files || []));
    return {
      passed: Boolean(config.activeMatterName && fileCount >= 0),
      runtimeDbEnabled: true,
      tenantId: app.runtimeMatterIndex.tenantId || "",
      matterCount: matterRows.length,
      targetMatter: target.name || "",
      activeMatter: config.activeMatterName || "",
      workspaceReadable: Boolean(workspace.metadata || workspace.matter || Array.isArray(workspace.tree) || Array.isArray(workspace.files)),
      fileCount,
      error: "",
    };
  } catch (error) {
    return failedReport({
      runtimeDbEnabled: true,
      error: redactRuntimeSmokeLine(error.message),
    });
  } finally {
    app.server.close();
  }
}

export function renderRuntimeDbSmokeReport(report = {}) {
  const lines = [
    "Matter Workbench runtime DB smoke",
    `passed: ${report.passed ? "yes" : "no"}`,
    `runtime_db_enabled: ${report.runtimeDbEnabled ? "yes" : "no"}`,
    `tenant_id: ${report.tenantId || ""}`,
    `matter_count: ${report.matterCount || 0}`,
    `target_matter: ${report.targetMatter || ""}`,
    `active_matter: ${report.activeMatter || ""}`,
    `workspace_readable: ${report.workspaceReadable ? "yes" : "no"}`,
    `file_count: ${Number.isFinite(report.fileCount) ? report.fileCount : 0}`,
  ];
  if (report.error) lines.push(`error: ${report.error}`);
  return lines.map(redactRuntimeSmokeLine);
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

function failedReport(fields = {}) {
  return {
    passed: false,
    runtimeDbEnabled: Boolean(fields.runtimeDbEnabled),
    tenantId: fields.tenantId || "",
    matterCount: fields.matterCount || 0,
    targetMatter: fields.targetMatter || "",
    activeMatter: fields.activeMatter || "",
    workspaceReadable: false,
    fileCount: 0,
    error: fields.error || "Runtime DB smoke failed.",
  };
}

function countWorkspaceNodes(nodes = []) {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (Array.isArray(node.children)) count += countWorkspaceNodes(node.children);
  }
  return count;
}

function redactRuntimeSmokeLine(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***")
    .replace(/\bdb\.example\b/g, "[redacted-host]");
}

async function main() {
  const report = await runRuntimeDbSmoke();
  for (const line of renderRuntimeDbSmokeReport(report)) console.log(line);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactRuntimeSmokeLine(error.message));
    process.exitCode = 1;
  });
}
