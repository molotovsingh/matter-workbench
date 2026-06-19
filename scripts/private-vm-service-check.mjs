#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";
import { containsUserFacingRestrictedAiLanguage } from "../shared/user-facing-ai-language-policy.js";

const __filename = fileURLToPath(import.meta.url);

export function parseServiceCheckArgs(argv = [], env = process.env) {
  const parsed = {
    baseUrl: env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191",
    matterName: env.MWB_PRIVATE_VM_SMOKE_MATTER || "",
    authUsername: env.MWB_PRIVATE_BETA_USERNAME || "",
    authPassword: env.MWB_PRIVATE_BETA_PASSWORD || "",
    authPasswordStdin: false,
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
      throw new Error("private-vm:service-check does not accept password arguments. Use MWB_PRIVATE_BETA_PASSWORD in the protected runtime env or --auth-password-stdin.");
    } else if (arg === "--auth-password-stdin") {
      parsed.authPasswordStdin = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  parsed.baseUrl = parsed.baseUrl.replace(/\/+$/, "");
  return parsed;
}

export async function resolveServiceCheckArgs(parsed = {}, stdin = process.stdin) {
  if (!parsed.authPasswordStdin) return parsed;
  const authPassword = (await readStdin(stdin)).replace(/\r?\n$/, "");
  return {
    ...parsed,
    authPassword,
    authPasswordStdin: false,
  };
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
  if (root.error) return failedReport({ baseUrl, authenticated: authSession.authenticated, error: `Root fetch failed: ${root.error}` });
  const rootText = root.ok ? await root.text() : "";
  if (!root.ok) return failedReport({ baseUrl, authenticated: authSession.authenticated, error: `Root returned HTTP ${root.status}` });
  const readiness = await probeUserReadiness(authSession.fetch, baseUrl);
  const readinessWarning = readinessWarningFor(readiness);

  let mattersPayload;
  try {
    mattersPayload = await getJson(authSession.fetch, `${baseUrl}/api/matters`);
  } catch (error) {
    return failedReport({
      baseUrl,
      authenticated: authSession.authenticated,
      rootOk: true,
      rootBytes: rootText.length,
      error: error.message,
      readiness,
    });
  }
  const matters = Array.isArray(mattersPayload.matters) ? mattersPayload.matters : [];
  if (!matters.length) return failedReport({ baseUrl, authenticated: authSession.authenticated, rootOk: true, rootBytes: rootText.length, runtimeDbEnabled: Boolean(mattersPayload.enabled), mattersHome: mattersPayload.mattersHome ?? null, error: "No matters returned by /api/matters.", readiness });
  const matterNames = matters
    .map((matter) => matter.name || matter.matterName || "")
    .filter(Boolean);
  const activeMatter = typeof mattersPayload.active === "string" ? mattersPayload.active : "";
  const previousActiveMatter = matterNames.includes(activeMatter) ? activeMatter : "";

  const target = matterName
    ? matters.find((matter) => matter.name === matterName || matter.matterName === matterName)
    : matters[0];
  if (!target) {
    const availableMatterNames = matters
      .map((matter) => matter.name || matter.matterName || "")
      .filter(Boolean);
    return failedReport({
      baseUrl,
      authenticated: authSession.authenticated,
      rootOk: true,
      rootBytes: rootText.length,
      runtimeDbEnabled: Boolean(mattersPayload.enabled),
      mattersHome: mattersPayload.mattersHome ?? null,
      matterCount: matters.length,
      availableMatterNames,
      error: `Matter not found: ${matterName}`,
      readiness,
    });
  }

  const targetName = target.name || target.matterName || "";
  let workspace;
  try {
    workspace = await postJson(authSession.fetch, `${baseUrl}/api/switch-matter`, { name: targetName });
  } catch (error) {
    const restoreWarning = await restoreActiveMatterBestEffort(authSession.fetch, baseUrl, previousActiveMatter, targetName);
    return failedReport({
      baseUrl,
      authenticated: authSession.authenticated,
      rootOk: true,
      rootBytes: rootText.length,
      runtimeDbEnabled: Boolean(mattersPayload.enabled),
      mattersHome: mattersPayload.mattersHome ?? null,
      matterCount: matters.length,
      targetMatter: targetName,
      error: joinWarnings(error.message, restoreWarning),
      readiness,
    });
  }
  const previewPath = firstPreviewableFilePath(workspace.tree || workspace.files || []);
  if (!previewPath) {
    const restoreWarning = await restoreActiveMatterBestEffort(authSession.fetch, baseUrl, previousActiveMatter, targetName);
    return {
      passed: true,
      baseUrl,
      authenticated: authSession.authenticated,
      rootOk: true,
      rootBytes: rootText.length,
      runtimeDbEnabled: Boolean(mattersPayload.enabled),
      mattersHome: mattersPayload.mattersHome ?? null,
      matterCount: matters.length,
      targetMatter: targetName,
      workspaceReadable: true,
      previewPath: "",
      filePreviewReadable: false,
      previewBytes: 0,
      ...readinessReportFields(readiness),
      warning: joinWarnings("No previewable file found in workspace tree.", restoreWarning, readinessWarning),
      error: "",
    };
  }

  let preview;
  try {
    preview = await getJson(authSession.fetch, `${baseUrl}/api/file?${new URLSearchParams({ matterName: targetName, path: previewPath })}`);
  } catch (error) {
    const restoreWarning = await restoreActiveMatterBestEffort(authSession.fetch, baseUrl, previousActiveMatter, targetName);
    return failedReport({
      baseUrl,
      authenticated: authSession.authenticated,
      rootOk: true,
      rootBytes: rootText.length,
      runtimeDbEnabled: Boolean(mattersPayload.enabled),
      mattersHome: mattersPayload.mattersHome ?? null,
      matterCount: matters.length,
      targetMatter: targetName,
      workspaceReadable: true,
      previewPath,
      error: joinWarnings(error.message, restoreWarning),
      readiness,
    });
  }
  const content = typeof preview.content === "string" ? preview.content : "";
  const passed = Boolean(rootText.length && matters.length && targetName && content.length && (!readiness.available || readiness.ok));
  const restoreWarning = await restoreActiveMatterBestEffort(authSession.fetch, baseUrl, previousActiveMatter, targetName);

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
    ...readinessReportFields(readiness),
    warning: joinWarnings(restoreWarning, readinessWarning),
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
    `user_readiness_available: ${report.userReadinessAvailable ? "yes" : "no"}`,
    `user_readiness_status: ${report.userReadinessStatus || ""}`,
    `user_readiness_schema: ${report.userReadinessSchema || ""}`,
    `user_readiness_checks: ${report.userReadinessChecks || 0}`,
    `user_readiness_assistant: ${report.userReadinessAssistant || ""}`,
    `user_readiness_language_leak: ${report.userReadinessLanguageLeak ? "yes" : "no"}`,
  ];
  if (report.userReadinessError) lines.push(`user_readiness_error: ${report.userReadinessError}`);
  if (report.availableMatterNames?.length) lines.push(`available_matter_names: ${report.availableMatterNames.join("; ")}`);
  if (report.warning) lines.push(`warning: ${report.warning}`);
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

async function probeUserReadiness(fetchImpl, baseUrl) {
  try {
    const payload = await getJson(fetchImpl, `${baseUrl}/api/user-readiness`);
    const checks = Array.isArray(payload.checks) ? payload.checks : [];
    const assistantCheck = checks.find((check) => check?.id === "assistant_readiness") || null;
    const languageLeak = containsUserFacingRestrictedAiLanguage(payload);
    return {
      available: true,
      ok: payload.schema_version === "user-readiness/v1" && !languageLeak,
      schema: typeof payload.schema_version === "string" ? payload.schema_version : "",
      status: typeof payload.status === "string" ? payload.status : "",
      checks: checks.length,
      assistant: assistantCheck ? `${assistantCheck.status || "unknown"}: ${assistantCheck.message || ""}` : "",
      languageLeak,
      error: "",
    };
  } catch (error) {
    return {
      available: false,
      ok: false,
      status: "",
      schema: "",
      checks: 0,
      assistant: "",
      languageLeak: false,
      error: redactServiceCheckLine(error.message || "user readiness check failed"),
    };
  }
}

function readinessReportFields(readiness = {}) {
  return {
    userReadinessAvailable: Boolean(readiness.available),
    userReadinessOk: Boolean(readiness.ok),
    userReadinessStatus: readiness.status || "",
    userReadinessSchema: readiness.schema || "",
    userReadinessChecks: readiness.checks || 0,
    userReadinessAssistant: readiness.assistant || "",
    userReadinessLanguageLeak: Boolean(readiness.languageLeak),
    userReadinessError: readiness.error || "",
  };
}

function readinessWarningFor(readiness = {}) {
  if (readiness.languageLeak) return "User readiness contains restricted technical language.";
  if (!readiness.available) return "";
  if (!readiness.ok) return "User readiness response did not match the expected safe schema.";
  if (readiness.status && readiness.status !== "ready") return `User readiness status is ${readiness.status}.`;
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

async function restoreActiveMatterBestEffort(fetchImpl, baseUrl, previousActiveMatter, targetName) {
  if (!previousActiveMatter || previousActiveMatter === targetName) return "";
  try {
    await postJson(fetchImpl, `${baseUrl}/api/switch-matter`, { name: previousActiveMatter });
    return "";
  } catch (error) {
    return `Could not restore previously active matter after service check: ${error.message}`;
  }
}

function joinWarnings(...warnings) {
  return warnings.filter(Boolean).join(" ");
}

function failedReport(fields = {}) {
  return {
    passed: false,
    baseUrl: fields.baseUrl || "",
    authenticated: Boolean(fields.authenticated),
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
    ...readinessReportFields(fields.readiness),
    warning: fields.warning || "",
    error: fields.error || "Private VM service check failed.",
  };
}

function redactServiceCheckLine(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***");
}

async function main() {
  const args = await resolveServiceCheckArgs(parseServiceCheckArgs(process.argv.slice(2)));
  const report = await runPrivateVmServiceCheck(args);
  for (const line of renderPrivateVmServiceCheck(report)) console.log(line);
  if (!report.passed) process.exitCode = 1;
}

async function readStdin(stdin) {
  let input = "";
  stdin.setEncoding?.("utf8");
  for await (const chunk of stdin) input += chunk;
  return input;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactServiceCheckLine(error.message));
    process.exitCode = 1;
  });
}
