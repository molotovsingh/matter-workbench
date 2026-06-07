#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readdir, readlink, stat, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText, REDACTED_SECRET } from "../shared/secret-redaction.mjs";
import { runPrivateVmServiceCheck } from "./private-vm-service-check.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-vm-ops-pack/v1";

export function parseOpsPackArgs(argv = [], env = process.env) {
  const parsed = {
    outDir: path.resolve(".local", "private-vm-ops-packs"),
    timestamp: "",
    baseUrl: env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191",
    deploymentRoot: env.MWB_PRIVATE_VM_DEPLOYMENT_ROOT || path.join(os.homedir(), "matter-workbench-deployments"),
    serviceName: env.MWB_PRIVATE_VM_SERVICE_NAME || "matter-workbench-runtime.service",
    authUsername: env.MWB_PRIVATE_BETA_USERNAME || "",
    authPassword: env.MWB_PRIVATE_BETA_PASSWORD || "",
    skipServiceCheck: false,
    skipLogs: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a value");
      parsed.outDir = path.resolve(value);
      i += 1;
    } else if (arg === "--timestamp") {
      const value = argv[i + 1];
      if (!value) throw new Error("--timestamp requires a value");
      parsed.timestamp = value;
      i += 1;
    } else if (arg === "--base-url") {
      const value = argv[i + 1];
      if (!value) throw new Error("--base-url requires a value");
      parsed.baseUrl = value.replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--deployment-root") {
      const value = argv[i + 1];
      if (!value) throw new Error("--deployment-root requires a value");
      parsed.deploymentRoot = path.resolve(value);
      i += 1;
    } else if (arg === "--service-name") {
      const value = argv[i + 1];
      if (!value) throw new Error("--service-name requires a value");
      parsed.serviceName = value;
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
    } else if (arg === "--skip-service-check") {
      parsed.skipServiceCheck = true;
    } else if (arg === "--skip-logs") {
      parsed.skipLogs = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runPrivateVmOpsPack({
  outDir = path.resolve(".local", "private-vm-ops-packs"),
  timestamp = new Date().toISOString(),
  baseUrl = "http://127.0.0.1:4191",
  deploymentRoot = path.join(os.homedir(), "matter-workbench-deployments"),
  serviceName = "matter-workbench-runtime.service",
  authUsername = process.env.MWB_PRIVATE_BETA_USERNAME || "",
  authPassword = process.env.MWB_PRIVATE_BETA_PASSWORD || "",
  skipServiceCheck = false,
  skipLogs = false,
  serviceCheckFn = runPrivateVmServiceCheck,
  commandRunner = runCommand,
  statfsFn = statfs,
  memorySnapshotFn = defaultMemorySnapshot,
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const packDir = path.join(outDir, `private-vm-ops-pack-${slug}`);
  await mkdir(packDir, { recursive: true });

  const deployment = await inspectDeployment({ deploymentRoot });
  const disk = await inspectDisk({ deploymentRoot, statfsFn });
  const memory = memorySnapshotFn();
  const serviceCheck = skipServiceCheck
    ? skippedSection("service_check", "skipped by --skip-service-check")
    : await inspectService({ baseUrl, authUsername, authPassword, serviceCheckFn });
  const logs = skipLogs
    ? skippedSection("service_logs", "skipped by --skip-logs")
    : await inspectLogs({ serviceName, commandRunner });
  const rollback = buildRollbackPlan({
    deploymentRoot,
    deployment,
    serviceName,
    baseUrl,
    requiresServiceCheckAuth: Boolean(authUsername || authPassword),
  });

  const failedChecks = [];
  if (!deployment.ok) failedChecks.push("deployment");
  if (!disk.ok) failedChecks.push("disk");
  if (!serviceCheck.ok) failedChecks.push("service_check");
  if (!logs.ok) failedChecks.push("service_logs");

  const result = {
    schemaVersion: SCHEMA_VERSION,
    success: failedChecks.length === 0,
    generatedAt,
    packDir,
    baseUrl,
    serviceName,
    failedChecks,
    deployment,
    disk,
    memory,
    serviceCheck,
    logs,
    rollback,
  };
  result.files = await writeOpsPackEvidence(result);
  return result;
}

export function renderPrivateVmOpsPackResult(result = {}) {
  const lines = [
    "Matter Workbench private VM ops pack",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `base_url: ${result.baseUrl || ""}`,
    `current_commit: ${result.deployment?.currentCommit || ""}`,
    `rollback_candidate: ${result.deployment?.rollbackCandidate || ""}`,
    `service_check: ${result.serviceCheck?.ok ? "ok" : "failed"}`,
    `logs: ${result.logs?.ok ? "ok" : "failed"}`,
    `disk_available_bytes: ${result.disk?.availableBytes || 0}`,
  ];
  if (result.failedChecks?.length) lines.push(`failed_checks: ${result.failedChecks.join(", ")}`);
  if (result.files?.markdown) lines.push(`evidence_md: ${result.files.markdown}`);
  if (result.files?.json) lines.push(`evidence_json: ${result.files.json}`);
  if (result.files?.rollbackScript) lines.push(`rollback_script: ${result.files.rollbackScript}`);
  return lines.map(redactLine);
}

async function inspectDeployment({ deploymentRoot }) {
  const currentLink = path.join(deploymentRoot, "current");
  try {
    const currentTarget = await readlink(currentLink);
    const currentPath = path.resolve(deploymentRoot, currentTarget);
    const currentCommit = path.basename(currentPath);
    const deployments = await listDeploymentDirs(deploymentRoot);
    const rollbackCandidate = deployments.find((name) => name !== currentCommit) || "";
    return {
      ok: true,
      deploymentRoot,
      currentLink,
      currentTarget: currentPath,
      currentCommit,
      deployments,
      rollbackCandidate,
      rollbackTarget: rollbackCandidate ? path.join(deploymentRoot, rollbackCandidate) : "",
    };
  } catch (error) {
    return {
      ok: false,
      deploymentRoot,
      currentLink,
      currentTarget: "",
      currentCommit: "",
      deployments: [],
      rollbackCandidate: "",
      rollbackTarget: "",
      error: redactLine(error.message),
    };
  }
}

async function listDeploymentDirs(deploymentRoot) {
  const entries = await readdir(deploymentRoot, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (entry.name === "current" || !entry.isDirectory()) continue;
    const deploymentInfo = await stat(path.join(deploymentRoot, entry.name)).catch(() => null);
    const appInfo = await stat(path.join(deploymentRoot, entry.name, "app")).catch(() => null);
    if (deploymentInfo?.isDirectory() && appInfo?.isDirectory()) {
      dirs.push({ name: entry.name, mtimeMs: deploymentInfo.mtimeMs || 0 });
    }
  }
  return dirs
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name))
    .map((entry) => entry.name);
}

async function inspectDisk({ deploymentRoot, statfsFn }) {
  try {
    const info = await statfsFn(deploymentRoot);
    const blockSize = Number(info.bsize || info.frsize || 0);
    return {
      ok: true,
      path: deploymentRoot,
      totalBytes: Number(info.blocks || 0) * blockSize,
      freeBytes: Number(info.bfree || 0) * blockSize,
      availableBytes: Number(info.bavail || 0) * blockSize,
    };
  } catch (error) {
    return {
      ok: false,
      path: deploymentRoot,
      totalBytes: 0,
      freeBytes: 0,
      availableBytes: 0,
      error: redactLine(error.message),
    };
  }
}

function defaultMemorySnapshot() {
  return {
    totalBytes: os.totalmem(),
    freeBytes: os.freemem(),
  };
}

async function inspectService({ baseUrl, authUsername, authPassword, serviceCheckFn }) {
  try {
    const report = await serviceCheckFn({ baseUrl, authUsername, authPassword });
    return {
      label: "service_check",
      ok: Boolean(report.passed),
      authenticated: Boolean(report.authenticated),
      runtimeDbEnabled: Boolean(report.runtimeDbEnabled),
      matterCount: report.matterCount || 0,
      targetMatter: report.targetMatter || "",
      filePreviewReadable: Boolean(report.filePreviewReadable),
      error: report.passed ? "" : redactLine(report.error || "private VM service check failed"),
    };
  } catch (error) {
    return {
      label: "service_check",
      ok: false,
      error: redactLine(error.message || "private VM service check failed"),
    };
  }
}

async function inspectLogs({ serviceName, commandRunner }) {
  try {
    const result = await commandRunner("journalctl", ["--user", "-u", serviceName, "-n", "80", "--no-pager"]);
    const lines = String(result.stdout || "")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-80)
      .map(redactLine);
    return {
      label: "service_logs",
      ok: Boolean(result.ok),
      lineCount: lines.length,
      lines,
      error: result.ok ? "" : redactLine(result.stderr || "journalctl failed"),
    };
  } catch (error) {
    return {
      label: "service_logs",
      ok: false,
      lineCount: 0,
      lines: [],
      error: redactLine(error.message || "journalctl failed"),
    };
  }
}

function buildRollbackPlan({ deploymentRoot, deployment, serviceName, baseUrl, requiresServiceCheckAuth = false }) {
  if (!deployment?.rollbackCandidate || !deployment?.rollbackTarget) {
    return {
      available: false,
      reason: "No previous deployment candidate found.",
      commands: [],
    };
  }
  const currentLink = path.join(deploymentRoot, "current");
  const serviceCheckCommand = requiresServiceCheckAuth
    ? [
        `: "\${MWB_PRIVATE_BETA_USERNAME:?Set MWB_PRIVATE_BETA_USERNAME before running rollback-plan.sh}"`,
        `: "\${MWB_PRIVATE_BETA_PASSWORD:?Set MWB_PRIVATE_BETA_PASSWORD before running rollback-plan.sh}"`,
        `npm run private-vm:service-check -- --base-url ${shellQuote(baseUrl)} --auth-username "$MWB_PRIVATE_BETA_USERNAME" --auth-password "$MWB_PRIVATE_BETA_PASSWORD"`,
      ]
    : [`npm run private-vm:service-check -- --base-url ${shellQuote(baseUrl)}`];
  const commands = [
    ...serviceCheckCommand.slice(0, -1),
    `systemctl --user stop ${shellQuote(serviceName)}`,
    `ln -sfn ${shellQuote(deployment.rollbackTarget)} ${shellQuote(currentLink)}`,
    `systemctl --user start ${shellQuote(serviceName)}`,
    serviceCheckCommand.at(-1),
  ];
  return {
    available: true,
    from: deployment.currentCommit || "",
    to: deployment.rollbackCandidate,
    target: deployment.rollbackTarget,
    commands,
  };
}

async function writeOpsPackEvidence(result) {
  const jsonPath = path.join(result.packDir, "ops-pack.json");
  const markdownPath = path.join(result.packDir, "ops-pack.md");
  const rollbackScriptPath = path.join(result.packDir, "rollback-plan.sh");
  const evidence = toPortableEvidence(result);
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderOpsPackMarkdown(evidence).join("\n")}\n`, "utf8");
  await writeFile(rollbackScriptPath, `${renderRollbackScript(evidence).join("\n")}\n`, "utf8");
  return {
    json: jsonPath,
    markdown: markdownPath,
    rollbackScript: rollbackScriptPath,
  };
}

function toPortableEvidence(result) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: result.generatedAt || "",
    success: Boolean(result.success),
    baseUrl: result.baseUrl || "",
    serviceName: result.serviceName || "",
    failedChecks: result.failedChecks || [],
    deployment: redactObject(result.deployment || {}),
    disk: redactObject(result.disk || {}),
    memory: redactObject(result.memory || {}),
    serviceCheck: redactObject(result.serviceCheck || {}),
    logs: redactObject(result.logs || {}),
    rollback: redactObject(result.rollback || {}),
  };
}

function renderOpsPackMarkdown(evidence = {}) {
  const lines = [
    "# Matter Workbench Private VM Ops Pack",
    "",
    `Generated at: ${evidence.generatedAt || ""}`,
    `Success: ${evidence.success ? "yes" : "no"}`,
    `Service URL: ${evidence.baseUrl || ""}`,
    "",
    "This is the lightweight operator and incident bundle for the private VM. It records live service health, deployment state, disk and memory posture, recent service logs, and a rollback plan. It does not perform a rollback by itself.",
    "",
    "## Health",
    "",
    `- Current deployment: ${evidence.deployment?.currentCommit || "(unknown)"}`,
    `- Rollback candidate: ${evidence.deployment?.rollbackCandidate || "(none)"}`,
    `- Service check: ${evidence.serviceCheck?.ok ? "ok" : "failed"}`,
    `- Runtime DB enabled: ${evidence.serviceCheck?.runtimeDbEnabled ? "yes" : "no"}`,
    `- Matters visible: ${evidence.serviceCheck?.matterCount || 0}`,
    `- Disk available bytes: ${evidence.disk?.availableBytes || 0}`,
    `- Memory free bytes: ${evidence.memory?.freeBytes || 0}`,
    "",
    "## Rollback",
    "",
  ];
  if (evidence.rollback?.available) {
    lines.push(`Rollback from ${evidence.rollback.from || "(current)"} to ${evidence.rollback.to || "(target)"}:`);
    lines.push("");
    lines.push("```bash");
    for (const command of evidence.rollback.commands || []) lines.push(command);
    lines.push("```");
  } else {
    lines.push(evidence.rollback?.reason || "No rollback candidate was found.");
  }
  lines.push("", "## Recent Service Logs", "");
  for (const line of evidence.logs?.lines || []) lines.push(`- ${line}`);
  if (!evidence.logs?.lines?.length) lines.push("- No log lines captured.");
  if (evidence.failedChecks?.length) {
    lines.push("", "## Failed Checks", "");
    for (const check of evidence.failedChecks) lines.push(`- ${check}`);
  }
  return lines.map(redactLine);
}

function renderRollbackScript(evidence = {}) {
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# Generated rollback plan for Matter Workbench private VM.",
    "# Review before running. This changes the current deployment symlink.",
    "",
  ];
  if (!evidence.rollback?.available) {
    lines.push(`echo ${shellQuote(evidence.rollback?.reason || "No rollback candidate was found.")}`);
    lines.push("exit 1");
    return lines;
  }
  for (const command of evidence.rollback.commands || []) lines.push(command);
  return lines.map(redactLine);
}

function skippedSection(label, reason) {
  return {
    label,
    ok: true,
    skipped: true,
    reason,
  };
}

function redactObject(value) {
  return redactPortableValue(value || {});
}

function redactPortableValue(value) {
  if (typeof value === "string") return redactLine(value);
  if (Array.isArray(value)) return value.map(redactPortableValue);
  if (value && typeof value === "object") {
    const redacted = {};
    for (const [key, item] of Object.entries(value)) redacted[key] = redactPortableValue(item);
    return redacted;
  }
  return value;
}

function redactLine(value) {
  return redactSensitiveText(String(value || ""))
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@")
    .replace(
      /\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi,
      `$1=${REDACTED_SECRET}`,
    );
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function runCommand(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr, code });
    });
  });
}

async function main() {
  const args = parseOpsPackArgs(process.argv.slice(2));
  const result = await runPrivateVmOpsPack(args);
  for (const line of renderPrivateVmOpsPackResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.message));
    process.exitCode = 1;
  });
}
