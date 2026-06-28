#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText, REDACTED_SECRET } from "../shared/secret-redaction.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { runRuntimeDbBrowserAcceptancePack } from "./runtime-db-browser-acceptance-pack.mjs";
import { runPrivateVmServiceCheck } from "./private-vm-service-check.mjs";
import { runPrivateVmOpsPack } from "./private-vm-ops-pack.mjs";
import { runPrivateVmSecurityCheck } from "./private-vm-security-check.mjs";
import { runPrivateVmRecoverabilityPack } from "./private-vm-recoverability-pack.mjs";
import { runPrivateBetaTesterHandoffDrill } from "./private-beta-tester-handoff-drill.mjs";
import { runPrivateBetaAuthPreflight } from "./private-beta-auth-preflight.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-beta-rc-closure-pack/v1";
const DEFAULT_RELEASE = "v1.0.0-beta.68";

const DEFAULT_LOCAL_GATES = [
  { label: "ui_typecheck", command: "npm", args: ["run", "ui:typecheck", "--silent"] },
  { label: "ui_build", command: "npm", args: ["run", "ui:build", "--silent"] },
  { label: "full_test_suite", command: "node", args: ["scripts/node-test-file-runner.mjs"] },
];

export function parseRcClosurePackArgs(argv = [], env = process.env) {
  const parsed = {
    outDir: path.resolve(".local", "private-beta-rc-closure-packs"),
    timestamp: "",
    release: env.MWB_PRIVATE_BETA_RC_RELEASE || DEFAULT_RELEASE,
    baseUrl: env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191",
    deploymentRoot: env.MWB_PRIVATE_VM_DEPLOYMENT_ROOT || "",
    runtimeEnvPath: env.MWB_PRIVATE_VM_RUNTIME_ENV || "",
    auditJsonPath: env.MWB_PRIVATE_VM_AUDIT_JSON || "",
    auditDispositionPath: env.MWB_PRIVATE_VM_AUDIT_DISPOSITION || "",
    mattersHome: env.MWB_PRIVATE_VM_MATTERS_HOME || "",
    runtimeBrowserEvidenceJson: env.MWB_RUNTIME_DB_BROWSER_ACCEPTANCE_JSON || "",
    gitBranch: env.MWB_PRIVATE_BETA_RC_GIT_BRANCH || "",
    gitCommit: env.MWB_PRIVATE_BETA_RC_GIT_COMMIT || "",
    gitStatusShort: env.MWB_PRIVATE_BETA_RC_GIT_STATUS_SHORT || "",
    authUsername: env.MWB_PRIVATE_BETA_USERNAME || "",
    authPassword: env.MWB_PRIVATE_BETA_PASSWORD || "",
    authUsersFile: env.MWB_PRIVATE_BETA_USERS_FILE || "",
    testerUsersFile: env.MWB_PRIVATE_BETA_USERS_FILE || "",
    testerFeedbackPath: env.MWB_PRIVATE_BETA_FEEDBACK_PATH || "",
    skipLocalGates: false,
    skipRuntimeBrowser: false,
    skipOperatorAuth: false,
    skipServiceCheck: false,
    skipTesterHandoff: false,
    skipOpsPack: false,
    skipSecurityCheck: false,
    skipRecoverabilityPack: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      parsed.outDir = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--timestamp") {
      parsed.timestamp = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--release") {
      parsed.release = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--base-url") {
      parsed.baseUrl = requiredValue(argv, i, arg).replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--deployment-root") {
      parsed.deploymentRoot = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--runtime-env") {
      parsed.runtimeEnvPath = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--audit-json") {
      parsed.auditJsonPath = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--audit-disposition") {
      parsed.auditDispositionPath = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--matters-home") {
      parsed.mattersHome = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--runtime-browser-evidence-json") {
      parsed.runtimeBrowserEvidenceJson = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--git-branch") {
      parsed.gitBranch = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--git-commit") {
      parsed.gitCommit = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--git-status-short") {
      parsed.gitStatusShort = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--auth-username") {
      parsed.authUsername = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--auth-password") {
      parsed.authPassword = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--auth-users-file") {
      parsed.authUsersFile = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--tester-users-file") {
      parsed.testerUsersFile = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--tester-feedback-ledger") {
      parsed.testerFeedbackPath = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--skip-local-gates") {
      parsed.skipLocalGates = true;
    } else if (arg === "--skip-runtime-browser") {
      parsed.skipRuntimeBrowser = true;
    } else if (arg === "--skip-operator-auth") {
      parsed.skipOperatorAuth = true;
    } else if (arg === "--skip-service-check") {
      parsed.skipServiceCheck = true;
    } else if (arg === "--skip-tester-handoff") {
      parsed.skipTesterHandoff = true;
    } else if (arg === "--skip-ops-pack") {
      parsed.skipOpsPack = true;
    } else if (arg === "--skip-security-check") {
      parsed.skipSecurityCheck = true;
    } else if (arg === "--skip-recoverability-pack") {
      parsed.skipRecoverabilityPack = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runPrivateBetaRcClosurePack({
  outDir = path.resolve(".local", "private-beta-rc-closure-packs"),
  timestamp = new Date().toISOString(),
  release = DEFAULT_RELEASE,
  baseUrl = "http://127.0.0.1:4191",
  deploymentRoot = "",
  runtimeEnvPath = "",
  auditJsonPath = "",
  auditDispositionPath = "",
  mattersHome = "",
  runtimeBrowserEvidenceJson = "",
  gitBranch = "",
  gitCommit = "",
  gitStatusShort = "",
  authUsername = "",
  authPassword = "",
  authUsersFile = "",
  testerUsersFile = "",
  testerFeedbackPath = "",
  skipLocalGates = false,
  skipRuntimeBrowser = false,
  skipOperatorAuth = false,
  skipServiceCheck = false,
  skipTesterHandoff = false,
  skipOpsPack = false,
  skipSecurityCheck = false,
  skipRecoverabilityPack = false,
  gitInfoFn = defaultGitInfo,
  localGateRunner = runCommand,
  runtimeBrowserPackFn = runRuntimeDbBrowserAcceptancePack,
  operatorAuthPreflightFn = runPrivateBetaAuthPreflight,
  serviceCheckFn = runPrivateVmServiceCheck,
  testerHandoffDrillFn = runPrivateBetaTesterHandoffDrill,
  opsPackFn = runPrivateVmOpsPack,
  securityCheckFn = runPrivateVmSecurityCheck,
  recoverabilityPackFn = runPrivateVmRecoverabilityPack,
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const packDir = path.join(outDir, `private-beta-rc-closure-pack-${slug}`);
  await mkdir(packDir, { recursive: true });

  const git = sanitizeEvidence(await runStep("git_state", async () => {
    const info = await gitInfoFn();
    const supplied = Boolean(gitBranch || gitCommit || gitStatusShort);
    const merged = {
      ...info,
      branch: gitBranch || info.branch || "",
      commit: gitCommit || info.commit || "",
      statusShort: supplied ? gitStatusShort : info.statusShort || "",
      metadataSource: supplied ? "supplied" : "git",
    };
    return {
      ok: Boolean(merged.commit && merged.branch),
      ...merged,
      clean: !String(merged.statusShort || "").trim(),
    };
  }));

  const localGates = skipLocalGates
    ? skippedSection("local_verification", "skipped by --skip-local-gates")
    : await runLocalGates({ localGateRunner });

  const runtimeDbBrowser = skipRuntimeBrowser
    ? skippedSection("runtime_db_browser", "skipped by --skip-runtime-browser")
    : await runStep("runtime_db_browser", async () => normalizeRuntimeBrowser(await runtimeBrowserPackFn({
      outDir: path.join(packDir, "runtime-db-browser"),
      timestamp: generatedAt,
    })), { evidenceJsonPath: runtimeBrowserEvidenceJson });

  const operatorAuth = skipOperatorAuth
    ? skippedSection("operator_auth", "skipped by --skip-operator-auth")
    : await runStep("operator_auth", async () => normalizeOperatorAuth(await operatorAuthPreflightFn({
      baseUrl,
      username: authUsername,
      password: authPassword,
      usersFile: authUsersFile,
    })));

  const privateVmService = skipServiceCheck
    ? skippedSection("private_vm_service", "skipped by --skip-service-check")
    : await runStep("private_vm_service", async () => normalizeServiceCheck(await serviceCheckFn({
      baseUrl,
      authUsername,
      authPassword,
    })));

  const testerHandoff = skipTesterHandoff
    ? skippedSection("tester_handoff", "skipped by --skip-tester-handoff")
    : await runStep("tester_handoff", async () => normalizeTesterHandoff(await testerHandoffDrillFn({
      baseUrl,
      usersFile: testerUsersFile,
      feedbackPath: testerFeedbackPath,
      outDir: path.join(packDir, "tester-handoff"),
      timestamp: generatedAt,
    })));

  const privateVmOps = skipOpsPack
    ? skippedSection("private_vm_ops", "skipped by --skip-ops-pack")
    : await runStep("private_vm_ops", async () => {
      const options = {
        outDir: path.join(packDir, "private-vm-ops"),
        timestamp: generatedAt,
        baseUrl,
        authUsername,
        authPassword,
      };
      if (deploymentRoot) options.deploymentRoot = deploymentRoot;
      return normalizeOpsPack(await opsPackFn(options));
    });

  const privateVmSecurity = skipSecurityCheck
    ? skippedSection("private_vm_security", "skipped by --skip-security-check")
    : await runStep("private_vm_security", async () => {
      const options = {
        baseUrl,
        authUsername,
        authPassword,
      };
      if (runtimeEnvPath) options.runtimeEnvPath = runtimeEnvPath;
      if (auditJsonPath) options.auditJsonPath = auditJsonPath;
      if (auditDispositionPath) options.auditDispositionPath = auditDispositionPath;
      return normalizeSecurityCheck(await securityCheckFn(options));
    });

  const privateVmRecoverability = skipRecoverabilityPack
    ? skippedSection("private_vm_recoverability", "skipped by --skip-recoverability-pack")
    : await runStep("private_vm_recoverability", async () => {
      const options = {
        outDir: path.join(packDir, "private-vm-recoverability"),
        timestamp: generatedAt,
        baseUrl,
        authUsername,
        authPassword,
      };
      if (mattersHome) options.mattersHome = mattersHome;
      return normalizeRecoverabilityPack(await recoverabilityPackFn(options));
    });

  const checks = [
    normalizeCheck("git_state", git.ok, git),
    normalizeCheck("local_verification", localGates.ok, localGates),
    normalizeCheck("runtime_db_browser", runtimeDbBrowser.ok, runtimeDbBrowser),
    normalizeCheck("operator_auth", operatorAuth.ok, operatorAuth),
    normalizeCheck("private_vm_service", privateVmService.ok, privateVmService),
    normalizeCheck("tester_handoff", testerHandoff.ok, testerHandoff),
    normalizeCheck("private_vm_ops", privateVmOps.ok, privateVmOps),
    normalizeCheck("private_vm_security", privateVmSecurity.ok, privateVmSecurity),
    normalizeCheck("private_vm_recoverability", privateVmRecoverability.ok, privateVmRecoverability),
  ];
  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.id);
  const result = sanitizeEvidence({
    schemaVersion: SCHEMA_VERSION,
    release,
    generatedAt,
    packDir,
    baseUrl,
    success: failedChecks.length === 0,
    failedChecks,
    git,
    localGates,
    runtimeDbBrowser,
    operatorAuth,
    privateVmService,
    testerHandoff,
    privateVmOps,
    privateVmSecurity,
    privateVmRecoverability,
    checks,
  });
  result.files = await writeEvidence(result);
  return result;
}

export function renderPrivateBetaRcClosurePackResult(result = {}) {
  const lines = [
    "Matter Workbench private beta RC closure pack",
    `success: ${result.success ? "yes" : "no"}`,
    `release: ${result.release || ""}`,
    `generated_at: ${result.generatedAt || ""}`,
    `branch: ${result.git?.branch || ""}`,
    `commit: ${result.git?.commit || ""}`,
    `git_clean: ${result.git?.clean ? "yes" : "no"}`,
    `local_verification: ${result.localGates?.ok ? "ok" : "failed"}`,
    `runtime_db_browser: ${result.runtimeDbBrowser?.ok ? "ok" : "failed"}`,
    `operator_auth: ${result.operatorAuth?.ok ? "ok" : "failed"}`,
    `private_vm_service: ${result.privateVmService?.ok ? "ok" : "failed"}`,
    `tester_handoff: ${result.testerHandoff?.ok ? "ok" : "failed"}`,
    `private_vm_ops: ${result.privateVmOps?.ok ? "ok" : "failed"}`,
    `private_vm_security: ${result.privateVmSecurity?.ok ? "ok" : "failed"}`,
    `private_vm_recoverability: ${result.privateVmRecoverability?.ok ? "ok" : "failed"}`,
  ];
  if (result.failedChecks?.length) lines.push(`failed_checks: ${result.failedChecks.join(", ")}`);
  if (result.files?.markdown) lines.push(`evidence_md: ${result.files.markdown}`);
  if (result.files?.json) lines.push(`evidence_json: ${result.files.json}`);
  return lines.map(redactLine);
}

async function runLocalGates({ localGateRunner }) {
  const checks = [];
  const env = localGateEnv();
  for (const gate of DEFAULT_LOCAL_GATES) {
    checks.push(await runStep(gate.label, async () => {
      const result = await localGateRunner({ ...gate, env });
      return {
        ok: Boolean(result.ok),
        command: [gate.command, ...gate.args].join(" "),
        exitCode: result.exitCode ?? result.code ?? (result.ok ? 0 : 1),
        stdoutTail: tailText(result.stdout || ""),
        stderrTail: tailText(result.stderr || ""),
      };
    }));
  }
  return {
    label: "local_verification",
    ok: checks.every((check) => check.ok),
    checks,
  };
}

function localGateEnv(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  const exactKeys = [
    "DATABASE_URL",
    "MATTERS_HOME",
    "MWB_DATABASE_URL",
    "MWB_DB_RUNTIME_CUTOVER_APPROVED",
    "MWB_MATTERS_HOME",
    "MWB_RUNTIME_DATABASE_URL",
    "MWB_RUNTIME_DB",
    "MWB_RUNTIME_DB_STORAGE",
    "MWB_RUNTIME_DB_TENANT_ID",
    "PGDATABASE",
    "PGHOST",
    "PGPASSWORD",
    "PGPORT",
    "PGUSER",
    "SOURCE_BACKED_ANALYSIS_PROVIDER",
    "MISTRAL_API_KEY",
    "MISTRAL_OCR_ENABLED",
    "GEMINI_API_KEY",
    "GEMINI_OCR_REPAIR_ENABLED",
    "GEMINI_OCR_REPAIR_MODEL",
    "GEMINI_OCR_REPAIR_FAST_MODEL",
  ];
  for (const key of exactKeys) delete env[key];
  for (const key of Object.keys(env)) {
    if (key.startsWith("MWB_PRIVATE_BETA_")) delete env[key];
    if (key.startsWith("OPENROUTER_")) delete env[key];
  }
  return env;
}

async function runStep(label, fn, options = {}) {
  try {
    const result = options.evidenceJsonPath
      ? await loadEvidenceJson(options.evidenceJsonPath)
      : await fn();
    return {
      label,
      ok: Boolean(result.ok),
      ...(options.evidenceJsonPath ? { evidenceJsonPath: options.evidenceJsonPath } : {}),
      ...result,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      error: redactLine(error?.message || `${label} failed`),
    };
  }
}

async function loadEvidenceJson(evidenceJsonPath) {
  const payload = JSON.parse(await readFile(evidenceJsonPath, "utf8"));
  if (payload.schemaVersion === "runtime-db-browser-acceptance-pack/v1") {
    return normalizeRuntimeBrowser(payload);
  }
  throw new Error(`Unsupported evidence JSON for closure pack: ${payload.schemaVersion || "missing schemaVersion"}`);
}

function normalizeRuntimeBrowser(report = {}) {
  return {
    ok: Boolean(report.passed),
    passed: Boolean(report.passed),
    runtimeDbEnabled: Boolean(report.runtimeDb?.enabled),
    runtimeDbMode: report.runtimeDb?.mode || "",
    runtimeDbStorageMode: report.runtimeDb?.storageMode || "",
    writeSmokePassed: Boolean(report.writeSmoke?.passed),
    browserPassed: Boolean(report.browser?.passed),
    browserDriver: report.browser?.driver || "",
    browserChecks: (report.browser?.checks || []).map((check) => ({
      key: check.key || "",
      passed: Boolean(check.passed),
      detail: check.detail || "",
    })),
    consoleErrors: report.browser?.consoleErrors || [],
    files: report.files || {},
    error: report.error || "",
  };
}

function normalizeServiceCheck(report = {}) {
  return {
    ok: Boolean(report.passed),
    passed: Boolean(report.passed),
    runtimeDbEnabled: Boolean(report.runtimeDbEnabled),
    matterCount: report.matterCount || 0,
    targetMatter: report.targetMatter || "",
    filePreviewReadable: Boolean(report.filePreviewReadable),
    authenticated: Boolean(report.authenticated),
    error: report.error || "",
  };
}

function normalizeOperatorAuth(report = {}) {
  return {
    ok: Boolean(report.success),
    success: Boolean(report.success),
    username: report.username || "",
    configuredUserPresent: Boolean(report.configuredUser?.present),
    configuredUserDisabled: Boolean(report.configuredUser?.disabled),
    loginOk: Boolean(report.login?.ok),
    authStatusOk: Boolean(report.authStatus?.ok),
    logoutOk: Boolean(report.logout?.ok),
    repairHint: report.repairHint || "",
    error: report.success ? "" : report.error || "private beta auth preflight failed",
  };
}

function normalizeTesterHandoff(report = {}) {
  return {
    ok: Boolean(report.success),
    success: Boolean(report.success),
    temporaryTester: report.temporaryTester?.username || "",
    matterCount: report.checks?.mattersList?.count || 0,
    feedbackCreated: report.checks?.feedbackCreated?.id || "",
    feedbackListed: Boolean(report.checks?.feedbackListed?.ok),
    feedbackSyncEndpoint: Boolean(report.checks?.feedbackSyncEndpoint?.ok),
    signalEndpoint: Boolean(report.checks?.signalEndpoint?.ok),
    tempTesterRemoved: Boolean(report.checks?.tempTesterRemoved?.ok),
    files: report.files || {},
    error: report.success ? "" : report.error || "tester handoff drill failed",
  };
}

function normalizeOpsPack(report = {}) {
  return {
    ok: Boolean(report.success),
    success: Boolean(report.success),
    currentCommit: report.deployment?.currentCommit || "",
    rollbackCandidate: report.deployment?.rollbackCandidate || "",
    serviceCheckOk: Boolean(report.serviceCheck?.ok),
    runtimeDbEnabled: Boolean(report.serviceCheck?.runtimeDbEnabled),
    matterCount: report.serviceCheck?.matterCount || 0,
    logsOk: Boolean(report.logs?.ok),
    diskAvailableBytes: report.disk?.availableBytes || 0,
    failedChecks: report.failedChecks || [],
    files: report.files || {},
  };
}

function normalizeSecurityCheck(report = {}) {
  return {
    ok: Boolean(report.passed),
    passed: Boolean(report.passed),
    checks: (report.checks || []).map((check) => ({
      id: check.id || "",
      ok: Boolean(check.ok),
      skipped: Boolean(check.skipped),
      message: check.message || "",
    })),
  };
}

function normalizeRecoverabilityPack(report = {}) {
  return {
    ok: Boolean(report.success),
    success: Boolean(report.success),
    dbBackupOk: Boolean(report.steps?.dbBackup?.ok),
    dbRestoreOk: Boolean(report.steps?.dbRestore?.ok),
    storageBackupOk: Boolean(report.steps?.storageBackup?.ok),
    storageRestoreCheckOk: Boolean(report.steps?.storageRestoreCheck?.ok),
    serviceCheckOk: Boolean(report.steps?.serviceCheck?.ok),
    failedSteps: report.failedSteps || [],
    files: report.files || {},
  };
}

function skippedSection(label, reason) {
  return {
    label,
    ok: false,
    skipped: true,
    reason,
  };
}

function normalizeCheck(id, ok, evidence = {}) {
  return {
    id,
    ok: Boolean(ok),
    skipped: Boolean(evidence.skipped),
    summary: evidence.error || evidence.reason || "",
  };
}

async function writeEvidence(result) {
  const jsonPath = path.join(result.packDir, "private-beta-rc-closure-pack.json");
  const markdownPath = path.join(result.packDir, "private-beta-rc-closure-pack.md");
  const evidence = sanitizeEvidence({ ...result, files: undefined });
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderEvidenceMarkdown(evidence).join("\n")}\n`, "utf8");
  return {
    json: jsonPath,
    markdown: markdownPath,
  };
}

function renderEvidenceMarkdown(evidence = {}) {
  const lines = [
    "# Matter Workbench Private Beta RC Closure Pack",
    "",
    `Release: ${evidence.release || ""}`,
    `Generated at: ${evidence.generatedAt || ""}`,
    `Success: ${evidence.success ? "yes" : "no"}`,
    `Branch: ${evidence.git?.branch || ""}`,
    `Commit: ${evidence.git?.commit || ""}`,
    `Worktree clean: ${evidence.git?.clean ? "yes" : "no"}`,
    "",
    "This pack is the release-candidate closeout bundle. It joins local verification, runtime DB browser acceptance, live private-VM service health, operator evidence, access/security posture, and recoverability checks into one repeatable acceptance record.",
    "",
    "## Checks",
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
  ];
  for (const check of evidence.checks || []) {
    lines.push(`| ${escapeTable(check.id)} | ${check.ok ? "ok" : "failed"} | ${escapeTable(check.summary || (check.skipped ? "skipped" : ""))} |`);
  }
  lines.push("", "## Evidence Inputs", "");
  lines.push(`- Runtime DB browser pack: ${evidence.runtimeDbBrowser?.files?.markdown || "(not recorded)"}`);
  lines.push(`- Operator auth preflight: ${evidence.operatorAuth?.ok ? "passed" : evidence.operatorAuth?.error || "(not recorded)"}`);
  lines.push(`- Tester handoff drill: ${evidence.testerHandoff?.files?.markdown || "(not recorded)"}`);
  lines.push(`- Private VM ops pack: ${evidence.privateVmOps?.files?.markdown || "(not recorded)"}`);
  lines.push(`- Private VM recoverability pack: ${evidence.privateVmRecoverability?.files?.markdown || "(not recorded)"}`);
  if (evidence.failedChecks?.length) {
    lines.push("", "## Failed Checks", "");
    for (const check of evidence.failedChecks) lines.push(`- ${check}`);
  }
  return lines.map(redactLine);
}

function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, sanitizeEvidence(item)]));
  }
  if (typeof value === "string") return redactLine(value);
  return value;
}

function redactLine(value) {
  return redactSensitiveText(String(value || ""))
    .replace(/\b(GEMINI_API_KEY|ANTHROPIC_API_KEY|MWB_PRIVATE_BETA_PASSWORD|MWB_RUNTIME_DATABASE_URL|MWB_DATABASE_URL)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi, `$1=${REDACTED_SECRET}`)
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\bpassword\b/gi, "password");
}

function tailText(value, max = 1200) {
  const text = String(value || "");
  return text.length <= max ? text : text.slice(-max);
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

async function defaultGitInfo() {
  const [branch, commit, status] = await Promise.all([
    runCommand({ command: "git", args: ["branch", "--show-current"] }),
    runCommand({ command: "git", args: ["rev-parse", "--short", "HEAD"] }),
    runCommand({ command: "git", args: ["status", "--short"] }),
  ]);
  return {
    branch: String(branch.stdout || "").trim(),
    commit: String(commit.stdout || "").trim(),
    statusShort: String(status.stdout || "").trim(),
    branchCommandOk: Boolean(branch.ok),
    commitCommandOk: Boolean(commit.ok),
    statusCommandOk: Boolean(status.ok),
  };
}

function runCommand({ command, args = [], env = process.env }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr: error.message, exitCode: 1 });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr, exitCode: code });
    });
  });
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseRcClosurePackArgs(process.argv.slice(2));
  const result = await runPrivateBetaRcClosurePack(args);
  for (const line of renderPrivateBetaRcClosurePackResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.stack || error.message));
    process.exitCode = 1;
  });
}
