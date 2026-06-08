#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);

export function parseServiceCheckArgs(argv = [], env = process.env) {
  const parsed = {
    baseUrl: env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191",
    matterName: env.MWB_PRIVATE_VM_SMOKE_MATTER || "",
    authUsername: env.MWB_PRIVATE_BETA_USERNAME || "",
    authPassword: env.MWB_PRIVATE_BETA_PASSWORD || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      const value = argv[i + 1];
      if (!value) throw new Error("--base-url requires a value");
      parsed.baseUrl = value;
      i += 1;
    } else if (arg === "--matter") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matter requires a value");
      parsed.matterName = value;
      i += 1;
    } else if (arg === "--auth-username") {
      const value = argv[i + 1];
      if (!value) throw new Error("--auth-username requires a value");
      parsed.authUsername = value;
      i += 1;
    } else if (arg === "--auth-password") {
      const value = argv[i + 1];
      if (!value) throw new Error("--auth-password requires a value");
      parsed.authPassword = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  parsed.baseUrl = parsed.baseUrl.replace(/\/+$/, "");
  return parsed;
}

export async function runPrivateVmServiceCheck({
  baseUrl = "http://127.0.0.1:4191",
  matterName = "",
  authUsername = "",
  authPassword = "",
  fetchImpl = fetch,
} = {}) {
  const authSession = await createAuthenticatedFetch({ baseUrl, authUsername, authPassword, fetchImpl });
  const root = await fetchSafely(authSession.fetch, baseUrl);
  if (root.error) return failedReport({ baseUrl, error: `Root fetch failed: ${root.error}` });
  const rootText = root.ok ? await root.text() : "";
  if (!root.ok) return failedReport({ baseUrl, error: `Root returned HTTP ${root.status}` });

  let mattersPayload;
  try {
    mattersPayload = await getJson(authSession.fetch, `${baseUrl}/api/matters`);
  } catch (error) {
    return failedReport({
      baseUrl,
      rootOk: true,
      rootBytes: rootText.length,
      error: error.message,
    });
  }
  const matters = Array.isArray(mattersPayload.matters) ? mattersPayload.matters : [];
  if (!matters.length) return failedReport({ baseUrl, rootOk: true, rootBytes: rootText.length, error: "No matters returned by /api/matters." });

  const target = matterName
    ? matters.find((matter) => matter.name === matterName || matter.matterName === matterName)
    : matters[0];
  if (!target) {
    const availableMatterNames = matters
      .map((matter) => matter.name || matter.matterName || "")
      .filter(Boolean);
    return failedReport({
      baseUrl,
      rootOk: true,
      rootBytes: rootText.length,
      matterCount: matters.length,
      availableMatterNames,
      error: `Matter not found: ${matterName}`,
    });
  }

  const targetName = target.name || target.matterName || "";
  let workspace;
  try {
    workspace = await postJson(authSession.fetch, `${baseUrl}/api/switch-matter`, { name: targetName });
  } catch (error) {
    return failedReport({
      baseUrl,
      rootOk: true,
      rootBytes: rootText.length,
      matterCount: matters.length,
      targetMatter: targetName,
      error: error.message,
    });
  }
  const previewPath = firstPreviewableFilePath(workspace.tree || workspace.files || []);
  if (!previewPath) {
    return failedReport({
      baseUrl,
      rootOk: true,
      rootBytes: rootText.length,
      matterCount: matters.length,
      targetMatter: targetName,
      workspaceReadable: true,
      error: "No previewable file found in workspace tree.",
    });
  }

  let preview;
  try {
    preview = await getJson(authSession.fetch, `${baseUrl}/api/file?${new URLSearchParams({ matterName: targetName, path: previewPath })}`);
  } catch (error) {
    return failedReport({
      baseUrl,
      rootOk: true,
      rootBytes: rootText.length,
      matterCount: matters.length,
      targetMatter: targetName,
      workspaceReadable: true,
      previewPath,
      error: error.message,
    });
  }
  const content = typeof preview.content === "string" ? preview.content : "";
  const passed = Boolean(rootText.length && matters.length && targetName && content.length);

  return {
    passed,
    baseUrl,
    authenticated: authSession.authenticated,
    rootOk: root.ok,
    rootBytes: rootText.length,
    runtimeDbEnabled: Boolean(mattersPayload.enabled),
    mattersHome: mattersPayload.mattersHome ?? null,
    matterCount: matters.length,
    targetMatter: targetName,
    workspaceReadable: Boolean(workspace.tree || workspace.files),
    previewPath,
    filePreviewReadable: Boolean(content.length),
    previewBytes: content.length,
    error: passed ? "" : "Private VM service check failed.",
  };
}

export function renderPrivateVmServiceCheck(report = {}) {
  const lines = [
    "Matter Workbench private VM service check",
    `passed: ${report.passed ? "yes" : "no"}`,
    `base_url: ${report.baseUrl || ""}`,
    `authenticated: ${report.authenticated ? "yes" : "no"}`,
    `root_ok: ${report.rootOk ? "yes" : "no"}`,
    `root_bytes: ${report.rootBytes || 0}`,
    `runtime_db_enabled: ${report.runtimeDbEnabled ? "yes" : "no"}`,
    `matters_home: ${report.mattersHome === null ? "null" : report.mattersHome || ""}`,
    `matter_count: ${report.matterCount || 0}`,
    `target_matter: ${report.targetMatter || ""}`,
    `workspace_readable: ${report.workspaceReadable ? "yes" : "no"}`,
    `preview_path: ${report.previewPath || ""}`,
    `file_preview_readable: ${report.filePreviewReadable ? "yes" : "no"}`,
    `preview_bytes: ${report.previewBytes || 0}`,
  ];
  if (report.availableMatterNames?.length) lines.push(`available_matter_names: ${report.availableMatterNames.join("; ")}`);
  if (report.error) lines.push(`error: ${report.error}`);
  return lines.map(redactServiceCheckLine);
}

export function firstPreviewableFilePath(treeOrNodes = []) {
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

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${url}: ${payload.error || response.status}`);
  return payload;
}

async function fetchSafely(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, options);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.message || "fetch failed",
    };
  }
}

async function createAuthenticatedFetch({ baseUrl, authUsername, authPassword, fetchImpl }) {
  let cookie = "";
  if (authUsername || authPassword) {
    const response = await fetchImpl(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: authUsername, password: authPassword }),
    });
    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      throw new Error(`Private beta login failed: ${payload || response.status}`);
    }
    cookie = firstCookie(response.headers?.get?.("set-cookie") || "");
  }

  return {
    authenticated: Boolean(cookie),
    fetch: (url, options = {}) => {
      if (!cookie) return fetchImpl(url, options);
      return fetchImpl(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          cookie,
        },
      });
    },
  };
}

function firstCookie(setCookieHeader = "") {
  return String(setCookieHeader || "").split(";")[0].trim();
}

async function postJson(fetchImpl, url, body = {}) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${url}: ${payload.error || response.status}`);
  return payload;
}

function failedReport(fields = {}) {
  return {
    passed: false,
    baseUrl: fields.baseUrl || "",
    rootOk: Boolean(fields.rootOk),
    rootBytes: fields.rootBytes || 0,
    runtimeDbEnabled: Boolean(fields.runtimeDbEnabled),
    mattersHome: fields.mattersHome ?? "",
    matterCount: fields.matterCount || 0,
    availableMatterNames: Array.isArray(fields.availableMatterNames) ? fields.availableMatterNames : [],
    targetMatter: fields.targetMatter || "",
    workspaceReadable: Boolean(fields.workspaceReadable),
    previewPath: fields.previewPath || "",
    filePreviewReadable: false,
    previewBytes: 0,
    error: fields.error || "Private VM service check failed.",
  };
}

function redactServiceCheckLine(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***");
}

async function main() {
  const args = parseServiceCheckArgs(process.argv.slice(2));
  const report = await runPrivateVmServiceCheck(args);
  for (const line of renderPrivateVmServiceCheck(report)) console.log(line);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactServiceCheckLine(error.message));
    process.exitCode = 1;
  });
}
