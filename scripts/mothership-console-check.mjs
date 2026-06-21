#!/usr/bin/env node
import process from "node:process";

export function parseMothershipConsoleCheckArgs(argv = [], env = process.env) {
  const parsed = {
    baseUrl: env.MOTHERSHIP_CONSOLE_BASE_URL || env.MOTHERSHIP_BASE_URL || "http://127.0.0.1:4192",
    requireAuth: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      const value = argv[i + 1];
      if (!value) throw new Error("--base-url requires a value");
      parsed.baseUrl = value;
      i += 1;
    } else if (arg === "--require-auth") {
      parsed.requireAuth = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  parsed.baseUrl = String(parsed.baseUrl || "").replace(/\/+$/, "");
  return parsed;
}

export async function runMothershipConsoleCheck({
  baseUrl = "http://127.0.0.1:4192",
  requireAuth = false,
  fetchImpl = fetch,
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
  const report = {
    passed: false,
    baseUrl: normalizedBaseUrl,
    healthOk: false,
    healthStatus: "",
    healthDatabase: "",
    rootOk: false,
    rootBytes: 0,
    rootHasConsoleTitle: false,
    rootHasMount: false,
    authStatusOk: false,
    authEnabled: false,
    authAuthenticated: false,
    requireAuth: Boolean(requireAuth),
    warning: "",
    error: "",
  };

  try {
    const health = await getJson(fetchImpl, `${normalizedBaseUrl}/health`);
    report.healthOk = health.status === "ready" && health.database === "ready";
    report.healthStatus = String(health.status || "");
    report.healthDatabase = String(health.database || "");
  } catch (error) {
    report.error = `Health check failed: ${error.message}`;
    return report;
  }

  try {
    const rootResponse = await fetchImpl(normalizedBaseUrl || "http://127.0.0.1:4192");
    report.rootOk = Boolean(rootResponse?.ok);
    const rootText = report.rootOk ? await rootResponse.text() : "";
    report.rootBytes = rootText.length;
    report.rootHasConsoleTitle = /Mothership Console/i.test(rootText);
    report.rootHasMount = /id=["']root["']/.test(rootText);
  } catch (error) {
    report.error = `Console root check failed: ${error.message}`;
    return report;
  }

  try {
    const auth = await getJson(fetchImpl, `${normalizedBaseUrl}/api/auth/status`);
    report.authStatusOk = true;
    report.authEnabled = Boolean(auth.enabled);
    report.authAuthenticated = Boolean(auth.authenticated);
  } catch (error) {
    report.error = `Console auth-status check failed: ${error.message}`;
    return report;
  }

  if (!report.rootOk) report.error = "Console root did not return HTTP 2xx.";
  else if (!report.rootHasConsoleTitle) report.error = "Console root did not contain the Mothership Console title.";
  else if (!report.rootHasMount) report.error = "Console root did not contain the React mount point.";
  else if (requireAuth && !report.authEnabled) report.error = "Console auth is not enabled but --require-auth was requested.";
  else if (!report.healthOk) report.error = "Mothership health is not ready.";

  if (!report.error && !report.authEnabled) {
    report.warning = "Console auth is disabled; safe only for loopback/private access.";
  }

  report.passed = !report.error;
  return report;
}

export function renderMothershipConsoleCheck(report = {}) {
  const lines = [
    "Matter Workbench mothership console check",
    `passed: ${report.passed ? "yes" : "no"}`,
    `base_url: ${report.baseUrl || ""}`,
    `health_ok: ${report.healthOk ? "yes" : "no"}`,
    `health_status: ${report.healthStatus || ""}`,
    `health_database: ${report.healthDatabase || ""}`,
    `root_ok: ${report.rootOk ? "yes" : "no"}`,
    `root_bytes: ${report.rootBytes || 0}`,
    `root_has_console_title: ${report.rootHasConsoleTitle ? "yes" : "no"}`,
    `root_has_mount: ${report.rootHasMount ? "yes" : "no"}`,
    `auth_status_ok: ${report.authStatusOk ? "yes" : "no"}`,
    `auth_enabled: ${report.authEnabled ? "yes" : "no"}`,
    `auth_authenticated: ${report.authAuthenticated ? "yes" : "no"}`,
    `require_auth: ${report.requireAuth ? "yes" : "no"}`,
  ];
  if (report.warning) lines.push(`warning: ${report.warning}`);
  if (report.error) lines.push(`error: ${report.error}`);
  return lines.join("\n");
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`${url}: HTTP ${response?.status || 0}`);
  return response.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const parsed = parseMothershipConsoleCheckArgs(process.argv.slice(2));
    const report = await runMothershipConsoleCheck(parsed);
    console.log(renderMothershipConsoleCheck(report));
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
