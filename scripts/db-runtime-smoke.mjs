#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";

import { createWorkbenchServer } from "../server.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";

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
    const smokeFetch = await createRuntimeSmokeFetch({ fetchImpl, baseUrl, env });
    const matters = await getJson(smokeFetch, baseUrl, "/api/matters");
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

    const workspace = await postJson(smokeFetch, baseUrl, "/api/switch-matter", { name: target.name });
    const config = await getJson(smokeFetch, baseUrl, "/api/config");
    const fileCount = Number(workspace.fileCount ?? countWorkspaceNodes(workspace.tree || workspace.files || []));
    const runtimeDbStorageMode = app.runtimeMatterIndex.storageMode || "local-filesystem";
    let filePreviewPath = "";
    let storageFilePreviewReadable = false;
    let storageRawReadable = false;
    if (runtimeDbStorageMode === "postgres") {
      filePreviewPath = firstPreviewableFilePath(workspace.tree || workspace.files || []);
      if (filePreviewPath) {
        const query = new URLSearchParams({ path: filePreviewPath }).toString();
        const preview = await getJson(smokeFetch, baseUrl, `/api/file?${query}`);
        storageFilePreviewReadable = typeof preview.content === "string";
        const rawResponse = await smokeFetch(`${baseUrl}/api/file-raw?${query}`);
        storageRawReadable = rawResponse.ok && (await rawResponse.arrayBuffer()).byteLength >= 0;
      }
    }
    const storageChecksPass = runtimeDbStorageMode !== "postgres" || (storageFilePreviewReadable && storageRawReadable);
    return {
      passed: Boolean(config.activeMatterName && fileCount >= 0 && storageChecksPass),
      runtimeDbEnabled: true,
      runtimeDbStorageMode,
      tenantId: app.runtimeMatterIndex.tenantId || "",
      matterCount: matterRows.length,
      targetMatter: target.name || "",
      activeMatter: config.activeMatterName || "",
      workspaceReadable: Boolean(workspace.metadata || workspace.matter || Array.isArray(workspace.tree) || Array.isArray(workspace.files)),
      fileCount,
      filePreviewPath,
      storageFilePreviewReadable,
      storageRawReadable,
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

async function createRuntimeSmokeFetch({ fetchImpl, baseUrl, env = {} }) {
  if (!privateBetaAuthRequired(env)) return fetchImpl;
  const username = String(env.MWB_PRIVATE_BETA_USERNAME || "").trim();
  const password = String(env.MWB_PRIVATE_BETA_PASSWORD || "");
  if (!username || !password) throw new Error("Runtime DB smoke private-beta auth requires both username and password.");

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

function privateBetaAuthRequired(env = {}) {
  const mode = String(env.MWB_PRIVATE_BETA_AUTH || "").trim().toLowerCase();
  return ["required", "true", "1", "yes", "on"].includes(mode);
}

export function renderRuntimeDbSmokeReport(report = {}) {
  const lines = [
    "Matter Workbench runtime DB smoke",
    `passed: ${report.passed ? "yes" : "no"}`,
    `runtime_db_enabled: ${report.runtimeDbEnabled ? "yes" : "no"}`,
    `runtime_db_storage_mode: ${report.runtimeDbStorageMode || ""}`,
    `tenant_id: ${report.tenantId || ""}`,
    `matter_count: ${report.matterCount || 0}`,
    `target_matter: ${report.targetMatter || ""}`,
    `active_matter: ${report.activeMatter || ""}`,
    `workspace_readable: ${report.workspaceReadable ? "yes" : "no"}`,
    `file_count: ${Number.isFinite(report.fileCount) ? report.fileCount : 0}`,
    `file_preview_path: ${report.filePreviewPath || ""}`,
    `storage_file_preview_readable: ${report.storageFilePreviewReadable ? "yes" : "no"}`,
    `storage_raw_readable: ${report.storageRawReadable ? "yes" : "no"}`,
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
    runtimeDbStorageMode: fields.runtimeDbStorageMode || "",
    tenantId: fields.tenantId || "",
    matterCount: fields.matterCount || 0,
    targetMatter: fields.targetMatter || "",
    activeMatter: fields.activeMatter || "",
    workspaceReadable: false,
    fileCount: 0,
    filePreviewPath: fields.filePreviewPath || "",
    storageFilePreviewReadable: false,
    storageRawReadable: false,
    error: fields.error || "Runtime DB smoke failed.",
  };
}

function countWorkspaceNodes(nodes = []) {
  if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) return countWorkspaceNodes(nodes.children || []);
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (Array.isArray(node.children)) count += countWorkspaceNodes(node.children);
  }
  return count;
}

function firstPreviewableFilePath(treeOrNodes = []) {
  const nodes = Array.isArray(treeOrNodes)
    ? treeOrNodes
    : Array.isArray(treeOrNodes?.children)
      ? treeOrNodes.children
      : [];
  for (const node of nodes) {
    if (node?.kind === "file" && node.previewable && node.previewKind === "text" && node.path) return node.path;
    const childPath = firstPreviewableFilePath(node?.children || []);
    if (childPath) return childPath;
  }
  return "";
}

function redactRuntimeSmokeLine(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***")
    .replace(/\bdb\.example\b/g, "[redacted-host]");
}

async function main() {
  await loadDatabaseScriptEnv();
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
