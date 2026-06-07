#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { readPrivateBetaUsersFile } from "../services/private-beta-auth-service.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-beta-auth-preflight/v1";

export function parsePrivateBetaAuthPreflightArgs(argv = [], env = process.env) {
  const parsed = {
    baseUrl: normalizeBaseUrl(env.MWB_PRIVATE_VM_BASE_URL || env.MWB_PRIVATE_BETA_PUBLIC_URL || env.MWB_PUBLIC_URL || "http://127.0.0.1:4191"),
    username: env.MWB_PRIVATE_BETA_USERNAME || "",
    password: env.MWB_PRIVATE_BETA_PASSWORD || "",
    usersFile: expandHomePath(env.MWB_PRIVATE_BETA_USERS_FILE || ""),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      parsed.baseUrl = normalizeBaseUrl(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--username") {
      parsed.username = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--password") {
      parsed.password = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--users-file") {
      parsed.usersFile = expandHomePath(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runPrivateBetaAuthPreflight({
  baseUrl = "http://127.0.0.1:4191",
  username = "",
  password = "",
  usersFile = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedUsername = String(username || "").trim();
  const expandedUsersFile = expandHomePath(usersFile);
  if (!normalizedBaseUrl) throw new Error("--base-url is required.");
  if (!normalizedUsername) throw new Error("--username or MWB_PRIVATE_BETA_USERNAME is required.");
  if (!password) throw new Error("--password or MWB_PRIVATE_BETA_PASSWORD is required.");
  if (typeof fetchImpl !== "function") throw new Error("fetch is required for private beta auth preflight.");

  const configuredUser = inspectConfiguredUser(expandedUsersFile, normalizedUsername);
  if (configuredUser.checked && (!configuredUser.present || configuredUser.disabled || configuredUser.error)) {
    return sanitizeReport({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      baseUrl: normalizedBaseUrl,
      username: normalizedUsername,
      configuredUser,
      login: { ok: false, status: 0 },
      authStatus: { ok: false },
      logout: { ok: false },
      error: configuredUser.error || (configuredUser.disabled ? "Configured private beta user is disabled." : "Configured private beta user is not usable."),
      repairHint: repairHint({ usersFile: expandedUsersFile, username: normalizedUsername }),
    });
  }

  const login = await postJson(fetchImpl, normalizedBaseUrl, "/api/auth/login", {
    username: normalizedUsername,
    password,
  }, {}, { allowError: true });
  const cookie = firstCookie(login.response.headers?.get?.("set-cookie") || "");
  if (!login.response.ok || !cookie) {
    const error = login.body?.error || `login failed with HTTP ${login.response.status}`;
    return sanitizeReport({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      baseUrl: normalizedBaseUrl,
      username: normalizedUsername,
      configuredUser,
      login: { ok: false, status: login.response.status, error },
      authStatus: { ok: false },
      logout: { ok: false },
      error,
      repairHint: repairHint({ usersFile: expandedUsersFile, username: normalizedUsername }),
    });
  }

  const authStatus = await getJson(fetchImpl, normalizedBaseUrl, "/api/auth/status", { Cookie: cookie });
  const statusOk = Boolean(authStatus.authenticated && authStatus.user?.username === normalizedUsername);
  const logout = await postJson(fetchImpl, normalizedBaseUrl, "/api/auth/logout", {}, { Cookie: cookie }, { allowError: true });
  const success = statusOk && logout.response.ok;
  return sanitizeReport({
    schemaVersion: SCHEMA_VERSION,
    success,
    baseUrl: normalizedBaseUrl,
    username: normalizedUsername,
    configuredUser,
    login: { ok: true, status: login.response.status },
    authStatus: {
      ok: statusOk,
      username: authStatus.user?.username || "",
      role: authStatus.user?.role || "",
    },
    logout: {
      ok: Boolean(logout.response.ok),
      status: logout.response.status,
    },
    error: success ? "" : "Private beta auth preflight did not produce a matching authenticated session.",
    repairHint: success ? "" : repairHint({ usersFile: expandedUsersFile, username: normalizedUsername }),
  });
}

export function renderPrivateBetaAuthPreflight(result = {}) {
  const lines = [
    "Matter Workbench private beta auth preflight",
    `success: ${result.success ? "yes" : "no"}`,
    `base_url: ${result.baseUrl || ""}`,
    `username: ${result.username || ""}`,
    `users_file_checked: ${result.configuredUser?.checked ? "yes" : "no"}`,
    `configured_user_present: ${result.configuredUser?.present ? "yes" : result.configuredUser?.checked ? "no" : "not checked"}`,
    `configured_user_disabled: ${result.configuredUser?.disabled ? "yes" : "no"}`,
    `login: ${result.login?.ok ? "ok" : "failed"}`,
    `auth_status: ${result.authStatus?.ok ? "ok" : "failed"}`,
    `logout: ${result.logout?.ok ? "ok" : "failed"}`,
  ];
  if (result.error) lines.push(`error: ${result.error}`);
  if (result.repairHint) lines.push(`repair: ${result.repairHint}`);
  return lines.map(redactLine);
}

function inspectConfiguredUser(usersFile, username) {
  if (!usersFile) return { checked: false, present: null, disabled: false, role: "", error: "" };
  try {
    const users = readPrivateBetaUsersFile(usersFile);
    const user = users.find((candidate) => String(candidate.username || "").toLowerCase() === username.toLowerCase());
    return {
      checked: true,
      present: Boolean(user),
      disabled: Boolean(user?.disabled),
      role: user?.role || "",
      error: user ? "" : `Configured username ${username} is not present in the private beta users file.`,
    };
  } catch (error) {
    return {
      checked: true,
      present: false,
      disabled: false,
      role: "",
      error: error?.message || "Private beta users file could not be read.",
    };
  }
}

async function getJson(fetchImpl, baseUrl, apiPath, headers = {}) {
  const response = await fetchImpl(`${baseUrl}${apiPath}`, { headers });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${apiPath} failed: ${payload?.error || response.status}`);
  return payload;
}

async function postJson(fetchImpl, baseUrl, apiPath, body, headers = {}, { allowError = false } = {}) {
  const response = await fetchImpl(`${baseUrl}${apiPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    if (!allowError) throw new Error(`${apiPath} returned non-JSON ${response.status}: ${text.slice(0, 300)}`);
    parsed = { error: text };
  }
  if (!response.ok && !allowError) throw new Error(`${apiPath} failed: ${parsed?.error || response.status}`);
  return { response, body: parsed };
}

function repairHint({ usersFile, username }) {
  if (!usersFile) return "Check MWB_PRIVATE_BETA_USERNAME and MWB_PRIVATE_BETA_PASSWORD in the runtime env.";
  return `Run: printf '%s\\n' '<runtime password>' | npm run private-beta:users -- set-password --file ${usersFile} --username ${username} --password-stdin`;
}

function firstCookie(setCookieHeader = "") {
  return String(setCookieHeader || "").split(";")[0].trim();
}

function sanitizeReport(report) {
  return JSON.parse(redactSensitiveText(JSON.stringify(report, null, 2)));
}

function redactLine(line) {
  return redactSensitiveText(String(line || ""));
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  return new URL(text).toString().replace(/\/+$/, "");
}

function expandHomePath(filePath) {
  const value = String(filePath || "").trim();
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
  return value;
}

if (process.argv[1] === __filename) {
  try {
    const options = parsePrivateBetaAuthPreflightArgs(process.argv.slice(2));
    const result = await runPrivateBetaAuthPreflight(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const line of renderPrivateBetaAuthPreflight(result)) console.log(line);
    }
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    console.error(redactLine(error?.message || "private beta auth preflight failed"));
    process.exitCode = 1;
  }
}
