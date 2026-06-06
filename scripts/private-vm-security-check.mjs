#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { runPrivateVmServiceCheck } from "./private-vm-service-check.mjs";

const __filename = fileURLToPath(import.meta.url);

export function parseSecurityCheckArgs(argv = [], env = process.env) {
  const parsed = {
    baseUrl: env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191",
    runtimeEnvPath: env.MWB_PRIVATE_VM_RUNTIME_ENV || path.join(os.homedir(), ".config", "matter-workbench", "runtime.env"),
    serviceUnitPath: env.MWB_PRIVATE_VM_SERVICE_UNIT || "deployment/private-vm/matter-workbench-runtime.service",
    auditJsonPath: env.MWB_PRIVATE_VM_AUDIT_JSON || "",
    auditDispositionPath: env.MWB_PRIVATE_VM_AUDIT_DISPOSITION || "",
    authUsername: env.MWB_PRIVATE_BETA_USERNAME || "",
    authPassword: env.MWB_PRIVATE_BETA_PASSWORD || "",
    skipRuntimeEnv: false,
    skipServiceCheck: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      const value = argv[i + 1];
      if (!value) throw new Error("--base-url requires a value");
      parsed.baseUrl = value.replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--runtime-env") {
      const value = argv[i + 1];
      if (!value) throw new Error("--runtime-env requires a value");
      parsed.runtimeEnvPath = value;
      i += 1;
    } else if (arg === "--service-unit") {
      const value = argv[i + 1];
      if (!value) throw new Error("--service-unit requires a value");
      parsed.serviceUnitPath = value;
      i += 1;
    } else if (arg === "--audit-json") {
      const value = argv[i + 1];
      if (!value) throw new Error("--audit-json requires a value");
      parsed.auditJsonPath = value;
      i += 1;
    } else if (arg === "--audit-disposition") {
      const value = argv[i + 1];
      if (!value) throw new Error("--audit-disposition requires a value");
      parsed.auditDispositionPath = value;
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
    } else if (arg === "--skip-runtime-env") {
      parsed.skipRuntimeEnv = true;
    } else if (arg === "--skip-service-check") {
      parsed.skipServiceCheck = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runPrivateVmSecurityCheck({
  baseUrl = "http://127.0.0.1:4191",
  runtimeEnvPath = path.join(os.homedir(), ".config", "matter-workbench", "runtime.env"),
  serviceUnitPath = "deployment/private-vm/matter-workbench-runtime.service",
  auditJsonPath = "",
  auditDispositionPath = "",
  authUsername = "",
  authPassword = "",
  skipRuntimeEnv = false,
  skipServiceCheck = false,
  serviceCheckFn = runPrivateVmServiceCheck,
} = {}) {
  const checks = [];

  checks.push(analyzeAccessPosture(baseUrl));
  checks.push(skipRuntimeEnv ? skippedCheck("runtime_env_permissions", "skipped by --skip-runtime-env") : await analyzeRuntimeEnvFile(runtimeEnvPath));
  checks.push(await analyzeServiceUnit(serviceUnitPath));
  checks.push(analyzeRuntimeDbRoleProof());
  checks.push(auditJsonPath ? await analyzeAuditJsonFile(auditJsonPath, auditDispositionPath) : skippedCheck("npm_audit", "skipped: pass --audit-json after running npm audit --omit=dev --json"));

  if (skipServiceCheck) {
    checks.push(skippedCheck("live_service_smoke", "skipped by --skip-service-check"));
  } else {
    checks.push(await analyzeLiveService({ baseUrl, authUsername, authPassword, serviceCheckFn }));
  }

  return {
    passed: checks.every((check) => check.ok),
    baseUrl,
    generatedAt: new Date().toISOString(),
    checks,
  };
}

export function analyzeAccessPosture(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return failedCheck("access_posture", "Base URL is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return failedCheck("access_posture", "Base URL must use http or https.");
  }

  const host = stripIpv6Brackets(url.hostname.toLowerCase());
  const privateHost = isLoopbackHost(host) || isPrivateIpv4(host) || isPrivateIpv6(host);
  if (!privateHost) {
    return failedCheck(
      "access_posture",
      `Host ${host} is not a private or loopback address. Do not expose this service publicly without auth, TLS, and a hosted security design.`,
    );
  }

  return passedCheck("access_posture", `Host ${host} is private or loopback.`);
}

export async function analyzeRuntimeEnvFile(runtimeEnvPath) {
  try {
    const info = await stat(runtimeEnvPath);
    const mode = `0${(info.mode & 0o777).toString(8)}`;
    if (!info.isFile()) return failedCheck("runtime_env_permissions", `${runtimeEnvPath} is not a regular file.`);
    if (mode !== "0600") {
      return failedCheck("runtime_env_permissions", `${runtimeEnvPath} must be mode 0600; current mode is ${mode}.`, { mode });
    }
    return passedCheck("runtime_env_permissions", `${runtimeEnvPath} is a 0600 runtime env file.`, { mode });
  } catch (error) {
    return failedCheck("runtime_env_permissions", `${runtimeEnvPath} could not be checked: ${error.message}`);
  }
}

export async function analyzeServiceUnit(serviceUnitPath) {
  let unit = "";
  try {
    unit = await readFile(serviceUnitPath, "utf8");
  } catch (error) {
    return failedCheck("systemd_service_template", `${serviceUnitPath} could not be read: ${error.message}`);
  }

  const findings = [];
  if (!/EnvironmentFile=%h\/\.config\/matter-workbench\/runtime\.env/.test(unit)) findings.push("missing protected EnvironmentFile");
  if (!/WorkingDirectory=%h\/matter-workbench-deployments\/current\/app/.test(unit)) findings.push("missing deployment symlink WorkingDirectory");
  if (!/ExecStart=.*scripts\/start-runtime-server\.mjs.*--host 0\.0\.0\.0.*--port 4191/.test(unit)) findings.push("missing expected runtime server ExecStart");
  if (!/^Restart=on-failure$/m.test(unit)) findings.push("missing Restart=on-failure");
  if (!/^NoNewPrivileges=true$/m.test(unit)) findings.push("missing NoNewPrivileges=true");
  if (!/^PrivateTmp=true$/m.test(unit)) findings.push("missing PrivateTmp=true");
  if (/Environment=.*(?:DATABASE_URL|API_KEY|PASSWORD|SECRET)=/i.test(unit)) findings.push("contains inline secret-like Environment values");

  if (findings.length) {
    return failedCheck("systemd_service_template", `Service template is not hardened enough: ${findings.join("; ")}.`);
  }
  return passedCheck("systemd_service_template", "Service template uses protected env file, restart policy, and basic process hardening.");
}

export function analyzeRuntimeDbRoleProof() {
  return passedCheck(
    "runtime_db_role_proof",
    "Runtime DB least-privilege proof is delegated to db:runtime:write-smoke, which fails closed for superuser or BYPASSRLS roles.",
    { proofCommand: "npm run db:runtime:write-smoke" },
  );
}

export async function analyzeAuditJsonFile(auditJsonPath, auditDispositionPath = "") {
  try {
    const dispositionText = auditDispositionPath ? await readFile(auditDispositionPath, "utf8") : "";
    return analyzeAuditJson(JSON.parse(await readFile(auditJsonPath, "utf8")), { dispositionText });
  } catch (error) {
    return failedCheck("npm_audit", `${auditJsonPath} could not be read as npm audit JSON: ${error.message}`);
  }
}

export function analyzeAuditJson(payload = {}, { dispositionText = "" } = {}) {
  const counts = payload.metadata?.vulnerabilities || {};
  const summary = [
    `${counts.total || 0} total`,
    `${counts.critical || 0} critical`,
    `${counts.high || 0} high`,
    `${counts.moderate || 0} moderate`,
    `${counts.low || 0} low`,
  ].join(", ");
  const risky = (counts.critical || 0) + (counts.high || 0);
  const riskyItems = Object.values(payload.vulnerabilities || {})
    .filter((item) => ["high", "critical"].includes(item?.severity));
  const details = riskyItems.map((item) => `${item.name || "unknown"}: ${item.severity}`);

  if (risky > 0) {
    const missingDisposition = riskyItems.filter((item) => !hasPackageDisposition(dispositionText, item.name));
    if (dispositionText && missingDisposition.length === 0) {
      return passedCheck("npm_audit", `npm audit has high or critical findings with documented disposition (${summary}).`, {
        summary,
        details,
      });
    }
    return failedCheck("npm_audit", `npm audit has high or critical vulnerabilities (${summary}). Record a disposition before beta access expands.`, {
      summary,
      details,
    });
  }
  return passedCheck("npm_audit", `npm audit has no high or critical vulnerabilities (${summary}).`, { summary, details });
}

function hasPackageDisposition(dispositionText, packageName = "") {
  if (!packageName) return false;
  return new RegExp(`(^|[^a-zA-Z0-9_.-])${escapeRegExp(packageName)}([^a-zA-Z0-9_.-]|$)`).test(dispositionText);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderPrivateVmSecurityCheck(report = {}) {
  const lines = [
    "Matter Workbench private VM access/security check",
    `passed: ${report.passed ? "yes" : "no"}`,
    `base_url: ${report.baseUrl || ""}`,
    `generated_at: ${report.generatedAt || ""}`,
  ];

  for (const check of report.checks || []) {
    lines.push("");
    lines.push(`${check.ok ? "ok" : "fail"}: ${check.id}`);
    lines.push(`  ${check.message || ""}`);
    if (check.mode) lines.push(`  mode: ${check.mode}`);
    if (check.summary) lines.push(`  audit_summary: ${check.summary}`);
    if (check.proofCommand) lines.push(`  proof_command: ${check.proofCommand}`);
    for (const detail of check.details || []) lines.push(`  detail: ${detail}`);
  }

  return lines.map((line) => redactSensitiveText(String(line || "")));
}

async function analyzeLiveService({ baseUrl, authUsername, authPassword, serviceCheckFn }) {
  try {
    const report = await serviceCheckFn({ baseUrl, authUsername, authPassword });
    if (!report.passed) return failedCheck("live_service_smoke", report.error || "Private VM service check failed.");
    return passedCheck("live_service_smoke", `Live service check passed; ${report.matterCount || 0} matters visible.`, {
      details: report.targetMatter ? [`target matter: ${report.targetMatter}`] : [],
    });
  } catch (error) {
    return failedCheck("live_service_smoke", `Private VM service check could not run: ${error.message}`);
  }
}

function passedCheck(id, message, extras = {}) {
  return { id, ok: true, message, ...extras };
}

function failedCheck(id, message, extras = {}) {
  return { id, ok: false, message: redactSensitiveText(String(message || "")), ...extras };
}

function skippedCheck(id, message) {
  return { id, ok: true, skipped: true, message };
}

function stripIpv6Brackets(host) {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

function isLoopbackHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isPrivateIpv6(host) {
  return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

function isPrivateIpv4(host) {
  const octets = host.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

async function main() {
  const args = parseSecurityCheckArgs(process.argv.slice(2));
  const report = await runPrivateVmSecurityCheck(args);
  for (const line of renderPrivateVmSecurityCheck(report)) console.log(line);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactSensitiveText(error.message || String(error)));
    process.exitCode = 1;
  });
}
