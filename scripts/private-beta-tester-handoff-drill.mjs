#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  hashPrivateBetaPassword,
  readPrivateBetaUsersFile,
} from "../services/private-beta-auth-service.mjs";
import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const SCHEMA_VERSION = "private-beta-tester-handoff-drill/v1";
const USERS_SCHEMA_VERSION = "private-beta-users/v1";

export function parsePrivateBetaTesterHandoffDrillArgs(argv = [], env = process.env) {
  const parsed = {
    baseUrl: normalizeBaseUrl(env.MWB_PRIVATE_VM_BASE_URL || env.MWB_PRIVATE_BETA_PUBLIC_URL || env.MWB_PUBLIC_URL || "http://127.0.0.1:4191"),
    usersFile: expandHomePath(env.MWB_PRIVATE_BETA_USERS_FILE || ""),
    feedbackPath: expandHomePath(env.MWB_PRIVATE_BETA_FEEDBACK_PATH || ""),
    outDir: path.resolve(env.MWB_PRIVATE_BETA_TESTER_HANDOFF_DIR || ".local/private-beta-tester-handoff-drills"),
    timestamp: "",
    username: "",
    password: "",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      parsed.baseUrl = normalizeBaseUrl(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--users-file") {
      parsed.usersFile = expandHomePath(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--feedback-ledger") {
      parsed.feedbackPath = expandHomePath(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--out-dir") {
      parsed.outDir = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--timestamp") {
      parsed.timestamp = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--username") {
      parsed.username = normalizeUsername(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--password") {
      parsed.password = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runPrivateBetaTesterHandoffDrill({
  baseUrl = "http://127.0.0.1:4191",
  usersFile = "",
  feedbackPath = "",
  outDir = path.resolve(".local/private-beta-tester-handoff-drills"),
  timestamp = new Date().toISOString(),
  username = "",
  password = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const expandedUsersFile = expandHomePath(usersFile);
  const expandedFeedbackPath = expandHomePath(feedbackPath);
  if (!expandedUsersFile) throw new Error("--users-file or MWB_PRIVATE_BETA_USERS_FILE is required.");
  if (!expandedFeedbackPath) throw new Error("--feedback-ledger or MWB_PRIVATE_BETA_FEEDBACK_PATH is required.");
  if (typeof fetchImpl !== "function") throw new Error("fetch is required for the tester handoff drill.");

  const temporaryUsername = normalizeUsername(username || `codex-handoff-${Date.now()}`);
  const temporaryPassword = password || `CodexTemp-${randomUUID()}`;
  const usersBackup = await readOptionalText(expandedUsersFile);
  const feedbackBackup = await readOptionalText(expandedFeedbackPath);
  const checks = {};
  let cleanup = {
    usersFileRestored: false,
    feedbackLedgerRestored: false,
  };
  let authHeaders = {};

  try {
    await addTemporaryTester({
      usersFile: expandedUsersFile,
      username: temporaryUsername,
      password: temporaryPassword,
    });

    const login = await postJson(fetchImpl, normalizedBaseUrl, "/api/auth/login", {
      username: temporaryUsername,
      password: temporaryPassword,
    });
    const cookie = sessionCookieFromResponse(login.response);
    checks.login = {
      ok: Boolean(cookie),
      status: login.response.status,
    };
    if (!checks.login.ok) throw new Error("login did not return a private beta session cookie");
    authHeaders = { Cookie: cookie };

    const authStatus = await getJson(fetchImpl, normalizedBaseUrl, "/api/auth/status", authHeaders);
    checks.authStatus = {
      ok: Boolean(authStatus.authenticated && authStatus.user?.username === temporaryUsername),
      username: authStatus.user?.username || "",
    };
    if (!checks.authStatus.ok) throw new Error(`unexpected auth status for temporary tester: ${JSON.stringify(authStatus)}`);

    const root = await fetchImpl(`${normalizedBaseUrl}/`, { headers: authHeaders });
    const rootText = await root.text();
    checks.rootReactEntry = {
      ok: root.ok && /Matter Workbench|<div id="root">/i.test(rootText),
      status: root.status,
    };
    if (!checks.rootReactEntry.ok) throw new Error(`root did not return recognizable React shell HTML: ${root.status}`);

    const matters = await getJson(fetchImpl, normalizedBaseUrl, "/api/matters", authHeaders);
    const matterCount = Array.isArray(matters.matters) ? matters.matters.length : Array.isArray(matters) ? matters.length : 0;
    checks.mattersList = {
      ok: matterCount > 0,
      count: matterCount,
    };
    if (!checks.mattersList.ok) throw new Error("matters list returned no matters");

    const feedbackPayload = {
      choice: "confused",
      tryingToDo: "Run a Codex temporary tester handoff drill",
      happenedInstead: "This disposable note verifies the private beta feedback path and should be removed after the drill.",
      context: {
        screen: "handoff-drill",
        route: "/",
        activeMatterName: "Codex temporary handoff drill",
        recentActivity: ["temporary tester login", "feedback intake path check"],
      },
    };
    const created = await postJson(fetchImpl, normalizedBaseUrl, "/api/private-beta/feedback", feedbackPayload, authHeaders);
    const feedbackId = created.body.feedback?.id || created.body.id || "";
    checks.feedbackCreated = {
      ok: Boolean(feedbackId),
      id: feedbackId,
    };
    if (!checks.feedbackCreated.ok) throw new Error(`feedback id missing: ${JSON.stringify(created.body)}`);

    const listed = await getJson(fetchImpl, normalizedBaseUrl, "/api/private-beta/feedback?limit=5", authHeaders);
    checks.feedbackListed = {
      ok: Boolean(listed.feedback?.some((item) => item.id === feedbackId)),
    };
    if (!checks.feedbackListed.ok) throw new Error(`created feedback ${feedbackId} was not returned by list endpoint`);

    const feedbackLedger = JSON.parse(await readFile(expandedFeedbackPath, "utf8"));
    checks.feedbackLedger = {
      ok: Boolean(feedbackLedger.feedback?.some((item) => item.id === feedbackId)),
      path: expandedFeedbackPath,
    };
    if (!checks.feedbackLedger.ok) throw new Error(`created feedback ${feedbackId} was not found in ${expandedFeedbackPath}`);

    const sync = await postJson(fetchImpl, normalizedBaseUrl, "/api/private-beta/feedback/sync", {}, authHeaders);
    checks.feedbackSyncEndpoint = {
      ok: sync.body.schema_version === "private-beta-feedback-sync-result/v1",
      attempted: Number(sync.body.attempted || 0),
      sent: Number(sync.body.sent || 0),
      queued: Number(sync.body.queued || 0),
      skipped: Number(sync.body.skipped || 0),
    };
    if (!checks.feedbackSyncEndpoint.ok) throw new Error(`unexpected feedback sync response: ${JSON.stringify(sync.body)}`);

    const signals = await getJson(fetchImpl, normalizedBaseUrl, "/api/private-beta/signals?limit=5", authHeaders);
    checks.signalEndpoint = {
      ok: signals.schema_version === "private-beta-signal-ledger/v1",
      count: Array.isArray(signals.signals) ? signals.signals.length : 0,
    };
    if (!checks.signalEndpoint.ok) throw new Error(`unexpected signal list response: ${JSON.stringify(signals)}`);
  } finally {
    cleanup = await restoreState({
      usersFile: expandedUsersFile,
      usersBackup,
      feedbackPath: expandedFeedbackPath,
      feedbackBackup,
    });
  }

  const postCleanupStatus = await getJson(fetchImpl, normalizedBaseUrl, "/api/auth/status", authHeaders);
  checks.tempSessionInvalidated = {
    ok: postCleanupStatus.authenticated === false,
  };
  if (!checks.tempSessionInvalidated.ok) {
    throw new Error("temporary tester session remained authenticated after account cleanup");
  }

  const rejectedLogin = await postJson(fetchImpl, normalizedBaseUrl, "/api/auth/login", {
    username: temporaryUsername,
    password: temporaryPassword,
  }, {}, { allowError: true });
  checks.tempTesterRemoved = {
    ok: rejectedLogin.response.status === 401,
    status: rejectedLogin.response.status,
  };
  if (!checks.tempTesterRemoved.ok) {
    throw new Error(`expected removed temporary tester login to fail with 401, got ${rejectedLogin.response.status}`);
  }

  const result = sanitizeEvidence({
    schemaVersion: SCHEMA_VERSION,
    success: true,
    generatedAt,
    baseUrl: normalizedBaseUrl,
    temporaryTester: {
      username: temporaryUsername,
      passwordStoredInEvidence: false,
    },
    checks,
    cleanup,
  });
  result.files = await writeEvidence({ result, outDir, generatedAt });
  return result;
}

export function renderPrivateBetaTesterHandoffDrill(result = {}) {
  const lines = [
    "Matter Workbench private beta tester handoff drill",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `base_url: ${result.baseUrl || ""}`,
    `temporary_user: ${result.temporaryTester?.username || ""}`,
    `login: ${result.checks?.login?.ok ? "ok" : "failed"}`,
    `auth_status: ${result.checks?.authStatus?.ok ? "ok" : "failed"}`,
    `react_root: ${result.checks?.rootReactEntry?.ok ? "ok" : "failed"}`,
    `matters_count: ${result.checks?.mattersList?.count ?? 0}`,
    `feedback_created: ${result.checks?.feedbackCreated?.id || ""}`,
    `feedback_listed: ${result.checks?.feedbackListed?.ok ? "ok" : "failed"}`,
    `feedback_sync_endpoint: ${result.checks?.feedbackSyncEndpoint?.ok ? "ok" : "failed"}`,
    `signal_endpoint: ${result.checks?.signalEndpoint?.ok ? "ok" : "failed"}`,
    `temp_tester_removed: ${result.checks?.tempTesterRemoved?.ok ? "ok" : "failed"}`,
  ];
  if (result.files?.markdown) lines.push(`evidence_md: ${result.files.markdown}`);
  if (result.files?.json) lines.push(`evidence_json: ${result.files.json}`);
  return lines.map(redactLine);
}

async function addTemporaryTester({ usersFile, username, password }) {
  const existingText = await readOptionalText(usersFile);
  let store;
  if (existingText === null) {
    store = { schemaVersion: USERS_SCHEMA_VERSION, users: [] };
  } else {
    readPrivateBetaUsersFile(usersFile);
    store = JSON.parse(existingText);
  }
  if (!Array.isArray(store.users)) {
    throw new Error("Private beta users file must contain a users array.");
  }
  const existing = store.users.find((user) => String(user.username || "").toLowerCase() === username.toLowerCase());
  if (existing) {
    throw new Error(`Temporary tester username already exists: ${username}`);
  }
  const now = new Date().toISOString();
  store.schemaVersion = USERS_SCHEMA_VERSION;
  store.users.push({
    username,
    displayName: "",
    role: "tester",
    disabled: false,
    passwordHash: hashPrivateBetaPassword(password),
    createdAt: now,
    updatedAt: now,
  });
  store.users.sort((left, right) => String(left.username).localeCompare(String(right.username)));
  await writeFileAtomic(usersFile, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8" });
}

async function restoreState({ usersFile, usersBackup, feedbackPath, feedbackBackup }) {
  await restoreOptionalText(usersFile, usersBackup);
  await restoreOptionalText(feedbackPath, feedbackBackup);
  return {
    usersFileRestored: true,
    feedbackLedgerRestored: true,
  };
}

async function restoreOptionalText(filePath, text) {
  if (text === null) {
    await rm(filePath, { force: true });
    return;
  }
  await writeFileAtomic(filePath, text, { encoding: "utf8" });
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function getJson(fetchImpl, baseUrl, apiPath, headers = {}) {
  const response = await fetchImpl(`${baseUrl}${apiPath}`, { headers });
  return responseJson(response, `GET ${apiPath}`);
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
  const parsed = await responseJson(response, `POST ${apiPath}`, { allowError });
  return { response, body: parsed };
}

async function responseJson(response, label, { allowError = false } = {}) {
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    if (!response.ok && allowError) return { error: text };
    throw new Error(`${label} returned non-JSON ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!response.ok && !allowError) {
    throw new Error(`${label} failed: ${response.status}${parsed?.error ? ` ${parsed.error}` : ""}`);
  }
  return parsed;
}

function sessionCookieFromResponse(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  return setCookie.split(";")[0] || "";
}

async function writeEvidence({ result, outDir, generatedAt }) {
  const slug = timestampSlug(generatedAt);
  const packDir = path.join(outDir, `private-beta-tester-handoff-drill-${slug}`);
  await mkdir(packDir, { recursive: true });
  const jsonPath = path.join(packDir, "private-beta-tester-handoff-drill.json");
  const markdownPath = path.join(packDir, "private-beta-tester-handoff-drill.md");
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(result), "utf8");
  return {
    json: jsonPath,
    markdown: markdownPath,
  };
}

function renderMarkdown(result) {
  const lines = [
    "# Private Beta Tester Handoff Drill",
    "",
    `Generated: ${result.generatedAt}`,
    `Base URL: ${result.baseUrl}`,
    `Temporary user: ${result.temporaryTester?.username || ""}`,
    "",
    "## Checks",
    "",
    `- Login succeeded: ${Boolean(result.checks?.login?.ok)}`,
    `- Auth status reflected tester: ${Boolean(result.checks?.authStatus?.ok)}`,
    `- React/root entry loaded: ${Boolean(result.checks?.rootReactEntry?.ok)}`,
    `- Matters API count: ${result.checks?.mattersList?.count ?? 0}`,
    `- Feedback created: ${result.checks?.feedbackCreated?.id || ""}`,
    `- Feedback listed: ${Boolean(result.checks?.feedbackListed?.ok)}`,
    `- Feedback sync endpoint responded: ${Boolean(result.checks?.feedbackSyncEndpoint?.ok)}`,
    `- Signal endpoint responded: ${Boolean(result.checks?.signalEndpoint?.ok)}`,
    `- Signal count observed: ${result.checks?.signalEndpoint?.count ?? 0}`,
    `- Feedback ledger verified: ${Boolean(result.checks?.feedbackLedger?.ok)}`,
    `- Temp tester removed: ${Boolean(result.checks?.tempTesterRemoved?.ok)}`,
    "",
    "## Cleanup",
    "",
    `- Users file restored: ${Boolean(result.cleanup?.usersFileRestored)}`,
    `- Feedback ledger restored: ${Boolean(result.cleanup?.feedbackLedgerRestored)}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function sanitizeEvidence(value) {
  return JSON.parse(redactSensitiveText(JSON.stringify(value, null, 2)));
}

function redactLine(line) {
  return redactSensitiveText(String(line || ""));
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  const url = new URL(text);
  return url.toString().replace(/\/+$/, "");
}

function normalizeUsername(username) {
  const value = String(username || "").trim();
  if (!value) throw new Error("Username is required.");
  if (!/^[A-Za-z0-9._@-]{2,80}$/.test(value)) {
    throw new Error("Username may use letters, numbers, dot, underscore, dash, or @, and must be 2-80 characters.");
  }
  return value;
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
  return value;
}

function expandHomePath(filePath) {
  const value = String(filePath || "").trim();
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const options = parsePrivateBetaTesterHandoffDrillArgs(process.argv.slice(2));
    const result = await runPrivateBetaTesterHandoffDrill(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const line of renderPrivateBetaTesterHandoffDrill(result)) console.log(line);
    }
  } catch (error) {
    console.error(redactSensitiveText(error?.message || "private beta tester handoff drill failed"));
    process.exitCode = 1;
  }
}
