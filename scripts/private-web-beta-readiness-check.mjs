#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";

import { readPrivateBetaUsersFile } from "../services/private-beta-auth-service.mjs";
import { runtimeDatabaseUrl, runtimeDatabaseUrlSource } from "../services/runtime-db-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-web-beta-readiness/v1";

export function parsePrivateWebBetaReadinessArgs(argv = [], env = process.env) {
  const parsed = {
    publicUrl: normalizeUrl(env.MWB_PRIVATE_BETA_PUBLIC_URL || env.MWB_PUBLIC_URL || ""),
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--public-url") {
      const value = argv[i + 1];
      if (!value) throw new Error("--public-url requires a value");
      parsed.publicUrl = normalizeUrl(value);
      i += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export function evaluatePrivateWebBetaReadiness({ env = process.env, publicUrl = "", now = new Date().toISOString() } = {}) {
  const effectivePublicUrl = normalizeUrl(publicUrl || env.MWB_PRIVATE_BETA_PUBLIC_URL || env.MWB_PUBLIC_URL || "");
  const checks = [
    checkPublicUrl(effectivePublicUrl),
    checkPrivateAccess(env),
    checkSecureCookie(env, effectivePublicUrl),
    checkRuntimeDb(env),
    checkMothershipSync(env),
    checkTelemetryMode(env),
    checkProviderKeys(env),
    checkOperatorEvidence(),
  ];
  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status === "block" ? "blockers" : check.status === "warn" ? "warnings" : "passed"] += 1;
      return acc;
    },
    { blockers: 0, warnings: 0, passed: 0 },
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now,
    ready: summary.blockers === 0,
    publicUrl: effectivePublicUrl,
    summary,
    checks,
  };
}

export function renderPrivateWebBetaReadiness(report = {}) {
  const lines = [
    "Matter Workbench private web beta readiness",
    `ready: ${report.ready ? "yes" : "no"}`,
    `public_url: ${report.publicUrl || "(not set)"}`,
    `blockers: ${report.summary?.blockers ?? 0}`,
    `warnings: ${report.summary?.warnings ?? 0}`,
    `passed: ${report.summary?.passed ?? 0}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks || []) {
    lines.push(`- ${check.status.toUpperCase()} ${check.id}: ${check.message}`);
  }

  if (!report.ready) {
    lines.push("", "Stop rule: do not hand this URL to private web beta testers until blocker checks pass.");
  }

  return lines;
}

function checkPublicUrl(publicUrl) {
  if (!publicUrl) return block("public_url", "Set MWB_PRIVATE_BETA_PUBLIC_URL to the HTTPS URL testers will open.");
  let parsed;
  try {
    parsed = new URL(publicUrl);
  } catch {
    return block("public_url", "MWB_PRIVATE_BETA_PUBLIC_URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    return block("public_url", "Private web beta must be served through HTTPS before tester access.");
  }
  return pass("public_url", `Tester URL is HTTPS for host ${parsed.hostname}.`);
}

function checkPrivateAccess(env) {
  const mode = String(env.MWB_PRIVATE_BETA_AUTH || "").trim().toLowerCase();
  const authRequired = ["required", "true", "1", "yes", "on"].includes(mode);
  const usersFile = String(env.MWB_PRIVATE_BETA_USERS_FILE || "").trim();
  const usernamePresent = Boolean(String(env.MWB_PRIVATE_BETA_USERNAME || "").trim());
  const passwordPresent = Boolean(String(env.MWB_PRIVATE_BETA_PASSWORD || ""));
  if (!authRequired) return block("private_access", "Set MWB_PRIVATE_BETA_AUTH=required before web beta access.");
  if (usersFile) {
    try {
      const activeUsers = readPrivateBetaUsersFile(usersFile).filter((user) => !user.disabled);
      if (!activeUsers.length) {
        return block("private_access", "MWB_PRIVATE_BETA_USERS_FILE is configured but has no active tester accounts.");
      }
      return pass("private_access", "Private beta login gate is required and a tester account file is configured.");
    } catch (error) {
      return block("private_access", `MWB_PRIVATE_BETA_USERS_FILE is not usable: ${error.message}`);
    }
  }
  if (!usernamePresent || !passwordPresent) {
    return block("private_access", "Set MWB_PRIVATE_BETA_USERS_FILE or MWB_PRIVATE_BETA_USERNAME and MWB_PRIVATE_BETA_PASSWORD for the access gate.");
  }
  return pass("private_access", "Private beta login gate is required and credentials are configured.");
}

function checkSecureCookie(env, publicUrl) {
  const explicit = String(env.MWB_PRIVATE_BETA_COOKIE_SECURE || "").trim().toLowerCase();
  const explicitSecure = ["1", "true", "yes", "on"].includes(explicit);
  const explicitInsecure = ["0", "false", "no", "off"].includes(explicit);
  const envPublicUrl = normalizeUrl(env.MWB_PRIVATE_BETA_PUBLIC_URL || env.MWB_PUBLIC_URL || "");
  const inferredSecure = /^https:\/\//i.test(envPublicUrl);

  if (explicitInsecure) return block("secure_cookie", "MWB_PRIVATE_BETA_COOKIE_SECURE is explicitly disabled; do not use that for HTTPS web beta.");
  if (explicitSecure || inferredSecure) return pass("secure_cookie", "Session cookie will be marked Secure for HTTPS beta access.");
  if (/^https:\/\//i.test(publicUrl)) {
    return block("secure_cookie", "Set MWB_PRIVATE_BETA_PUBLIC_URL=https://... or MWB_PRIVATE_BETA_COOKIE_SECURE=true so the auth cookie is Secure.");
  }
  return block("secure_cookie", "Secure cookie cannot be inferred without an HTTPS public URL.");
}

function checkRuntimeDb(env) {
  const runtimeMode = String(env.MWB_RUNTIME_DB || "").trim().toLowerCase();
  const storageMode = String(env.MWB_RUNTIME_DB_STORAGE || "").trim().toLowerCase();
  const approved = truthy(env.MWB_DB_RUNTIME_CUTOVER_APPROVED);
  const dbUrl = runtimeDatabaseUrl(env);
  const source = runtimeDatabaseUrlSource(env);
  const missing = [];
  if (runtimeMode !== "postgres") missing.push("MWB_RUNTIME_DB=postgres");
  if (storageMode !== "postgres") missing.push("MWB_RUNTIME_DB_STORAGE=postgres");
  if (!approved) missing.push("MWB_DB_RUNTIME_CUTOVER_APPROVED=yes");
  if (!dbUrl) missing.push("MWB_RUNTIME_DATABASE_URL");

  if (missing.length) {
    return block("runtime_db", `Runtime DB custody is not ready: missing ${missing.join(", ")}.`);
  }
  if (source !== "MWB_RUNTIME_DATABASE_URL") {
    return warn("runtime_db", `Runtime DB is enabled, but URL comes from ${source}; prefer MWB_RUNTIME_DATABASE_URL for the non-superuser app role.`);
  }
  return pass("runtime_db", "Runtime DB and Postgres payload custody are explicitly enabled.");
}

function checkMothershipSync(env) {
  const feedbackUrl = normalizeUrl(env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL || "");
  const feedbackToken = String(env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN || "").trim();
  const signalUrl = normalizeUrl(env.MWB_PRIVATE_BETA_SIGNAL_SYNC_URL || "");
  const signalToken = String(env.MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN || "").trim();
  const installId = String(env.MWB_PRIVATE_BETA_INSTALL_ID || "").trim();

  if (!feedbackUrl || !feedbackToken) {
    return block("mothership_sync", "Configure MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL and MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN.");
  }
  if (!isHttps(feedbackUrl)) return block("mothership_sync", "Feedback mothership URL must use HTTPS.");
  if ((signalUrl && !signalToken) || (!signalUrl && signalToken)) {
    return block("mothership_sync", "Configure both MWB_PRIVATE_BETA_SIGNAL_SYNC_URL and MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN, or neither to use feedback fallback.");
  }
  if (signalUrl && !isHttps(signalUrl)) return block("mothership_sync", "Signal mothership URL must use HTTPS.");
  if (!installId) return warn("mothership_sync", "Mothership sync is configured, but MWB_PRIVATE_BETA_INSTALL_ID is missing.");
  if (!signalUrl) return pass("mothership_sync", "Feedback sync is configured; signal fallback will use the feedback mothership.");
  return pass("mothership_sync", "Feedback and diagnostic signal mothership sync are configured.");
}

function checkTelemetryMode(env) {
  const mode = String(env.MWB_PRIVATE_BETA_TELEMETRY_MODE || "").trim().toLowerCase();
  if (mode === "firm_internal") return pass("telemetry_mode", "Firm-internal telemetry mode is enabled for richer trusted beta debugging.");
  if (mode === "safe") return warn("telemetry_mode", "Telemetry mode is safe; firm-internal beta debugging will have less context.");
  return warn("telemetry_mode", "MWB_PRIVATE_BETA_TELEMETRY_MODE is not set; default safe telemetry may be too thin for firm-internal beta.");
}

function checkProviderKeys(env) {
  const expected = ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "GEMINI_API_KEY"];
  const missing = expected.filter((key) => !String(env[key] || "").trim());
  if (missing.length) {
    return warn("provider_keys", `Provider keys missing for ${missing.join(", ")}; some beta workflows may fail.`);
  }
  return pass("provider_keys", "Core provider keys are present for Copilot, OCR, source labels, and chronology workflows.");
}

function checkOperatorEvidence() {
  return warn(
    "operator_evidence",
    "Run private-vm:security-check, private-vm:recoverability-pack, db:runtime:write-smoke, and private-beta:rc-closure-pack before final tester handoff.",
  );
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function pass(id, message, extra = {}) {
  return { id, status: "pass", message, ...extra };
}

function warn(id, message, extra = {}) {
  return { id, status: "warn", message, ...extra };
}

function block(id, message, extra = {}) {
  return { id, status: "block", message, ...extra };
}

if (process.argv[1] === __filename) {
  try {
    const args = parsePrivateWebBetaReadinessArgs(process.argv.slice(2));
    const report = evaluatePrivateWebBetaReadiness({ publicUrl: args.publicUrl });
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderPrivateWebBetaReadiness(report).join("\n"));
    }
    process.exitCode = report.ready ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
