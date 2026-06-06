#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);

export function parseServiceCheckArgs(argv = [], env = process.env) {
  const parsed = {
    baseUrl: env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191",
    matterName: env.MWB_PRIVATE_VM_SMOKE_MATTER || "",
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
  fetchImpl = fetch,
} = {}) {
  const root = await fetchImpl(baseUrl);
  const rootText = root.ok ? await root.text() : "";
  if (!root.ok) return failedReport({ baseUrl, error: `Root returned HTTP ${root.status}` });

  const mattersPayload = await getJson(fetchImpl, `${baseUrl}/api/matters`);
  const matters = Array.isArray(mattersPayload.matters) ? mattersPayload.matters : [];
  if (!matters.length) return failedReport({ baseUrl, rootOk: true, rootBytes: rootText.length, error: "No matters returned by /api/matters." });

  const target = matterName
    ? matters.find((matter) => matter.name === matterName || matter.matterName === matterName)
    : matters[0];
  if (!target) {
    return failedReport({
      baseUrl,
      rootOk: true,
      rootBytes: rootText.length,
      matterCount: matters.length,
      error: `Matter not found: ${matterName}`,
    });
  }

  const targetName = target.name || target.matterName || "";
  const workspace = await postJson(fetchImpl, `${baseUrl}/api/switch-matter`, { name: targetName });
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

  const preview = await getJson(fetchImpl, `${baseUrl}/api/file?${new URLSearchParams({ matterName: targetName, path: previewPath })}`);
  const content = typeof preview.content === "string" ? preview.content : "";
  const passed = Boolean(rootText.length && matters.length && targetName && content.length);

  return {
    passed,
    baseUrl,
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
