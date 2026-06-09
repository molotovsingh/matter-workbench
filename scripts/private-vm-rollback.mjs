#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-vm-rollback/v1";

export function parsePrivateVmRollbackArgs(argv = [], env = process.env) {
  const parsed = {
    host: env.MWB_PRIVATE_VM_HOST || env.MWB_PRIVATE_DEPLOYMENT_HOST || "",
    user: env.MWB_PRIVATE_VM_USER || env.MWB_PRIVATE_DEPLOYMENT_USER || env.USER || "",
    deploymentRoot: env.MWB_PRIVATE_VM_DEPLOYMENT_ROOT || "$HOME/matter-workbench-deployments",
    targetRelease: env.MWB_PRIVATE_VM_ROLLBACK_TO || "",
    baseUrl: normalizeUrl(env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191"),
    serviceName: env.MWB_PRIVATE_VM_SERVICE_NAME || "matter-workbench-runtime.service",
    json: false,
    dryRun: false,
    skipServiceCheck: false,
    skipUiHardening: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") {
      parsed.host = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--user") {
      parsed.user = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--deployment-root") {
      parsed.deploymentRoot = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--to") {
      parsed.targetRelease = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--base-url") {
      parsed.baseUrl = normalizeUrl(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--service-name") {
      parsed.serviceName = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--skip-service-check") {
      parsed.skipServiceCheck = true;
    } else if (arg === "--skip-ui-hardening") {
      parsed.skipUiHardening = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (/password/i.test(arg)) {
      throw new Error("private-vm:rollback does not accept passwords. Use SSH keys or an interactive SSH agent/session.");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export function buildPrivateVmRollbackPlan({
  host,
  user = "",
  deploymentRoot = "$HOME/matter-workbench-deployments",
  targetRelease,
  baseUrl = "http://127.0.0.1:4191",
  serviceName = "matter-workbench-runtime.service",
  skipServiceCheck = false,
  skipUiHardening = false,
} = {}) {
  if (!host) throw new Error("--host is required");
  if (!targetRelease) throw new Error("--to is required");

  const remote = user ? `${user}@${host}` : host;
  const root = deploymentRoot.replace(/\/+$/, "");
  const targetDir = `${root}/${targetRelease}`;
  const appDir = `${targetDir}/app`;
  const currentLink = `${root}/current`;
  const steps = [
    {
      id: "preflight",
      title: "Verify rollback target and VM runtime before switching current",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          "command -v systemctl >/dev/null",
          "systemctl --user show-environment >/dev/null",
          "test -r \"$HOME/.config/matter-workbench/runtime.env\"",
          `test -d ${shellQuote(appDir)}`,
          `test -r ${shellQuote(`${appDir}/package.json`)}`,
        ].join(" && "),
      ],
    },
    {
      id: "activate_rollback",
      title: "Point current at the target release and restart the user service",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          `ln -sfn ${shellQuote(targetDir)} ${shellQuote(currentLink)}`,
          `systemctl --user restart ${shellQuote(serviceName)}`,
          `systemctl --user is-active ${shellQuote(serviceName)}`,
          `readlink -f ${shellQuote(currentLink)}`,
        ].join(" && "),
      ],
    },
  ];

  if (!skipServiceCheck) {
    steps.push({
      id: "service_check",
      title: "Run VM-local service check against the rolled-back release",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          `cd ${shellQuote(appDir)}`,
          "set -a",
          ". \"$HOME/.config/matter-workbench/runtime.env\"",
          "set +a",
          `npm run private-vm:service-check --silent -- --base-url ${shellQuote(baseUrl)}`,
        ].join(" && "),
      ],
    });
  }

  if (!skipUiHardening) {
    steps.push({
      id: "ui_hardening",
      title: "Run VM-local rendered UI hardening pass after rollback",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          `cd ${shellQuote(appDir)}`,
          "set -a",
          ". \"$HOME/.config/matter-workbench/runtime.env\"",
          "set +a",
          `npm run private-beta:ui-hardening-pass --silent -- --base-url ${shellQuote(baseUrl)} --out-dir "$HOME/matter-workbench-backups/ui-hardening"`,
        ].join(" && "),
      ],
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    remote,
    deploymentRoot,
    targetRelease,
    targetDir,
    appDir,
    currentLink,
    baseUrl,
    serviceName,
    steps,
  };
}

export async function runPrivateVmRollback({
  host,
  user = "",
  deploymentRoot = "$HOME/matter-workbench-deployments",
  targetRelease = "",
  baseUrl = "http://127.0.0.1:4191",
  serviceName = "matter-workbench-runtime.service",
  dryRun = false,
  skipServiceCheck = false,
  skipUiHardening = false,
  commandRunner = runCommand,
} = {}) {
  const plan = buildPrivateVmRollbackPlan({
    host,
    user,
    deploymentRoot,
    targetRelease,
    baseUrl,
    serviceName,
    skipServiceCheck,
    skipUiHardening,
  });

  const result = {
    schemaVersion: SCHEMA_VERSION,
    success: true,
    executed: !dryRun,
    dryRun,
    plan,
    stepResults: [],
  };

  if (dryRun) return result;

  for (const step of plan.steps) {
    const stepResult = await commandRunner(step);
    result.stepResults.push({ id: step.id, ...stepResult });
    if (!stepResult.ok) {
      result.success = false;
      break;
    }
  }

  return result;
}

export function renderPrivateVmRollbackResult(result = {}) {
  const lines = [
    "Matter Workbench private VM rollback",
    `success: ${result.success ? "yes" : "no"}`,
    `executed: ${result.executed ? "yes" : "no"}`,
    `remote: ${result.plan?.remote || ""}`,
    `target_release: ${result.plan?.targetRelease || ""}`,
    `target_dir: ${result.plan?.targetDir || ""}`,
    "",
    "Steps:",
  ];
  for (const step of result.plan?.steps || []) {
    const status = result.stepResults?.find((entry) => entry.id === step.id);
    lines.push(`- ${step.id}: ${status ? (status.ok ? "ok" : "failed") : (result.dryRun ? "planned" : "pending")}`);
    lines.push(`  $ ${step.command.join(" ")}`);
  }
  return lines;
}

async function runCommand(step) {
  return await new Promise((resolve) => {
    const child = spawn(step.command[0], step.command.slice(1), { stdio: "inherit" });
    child.on("close", (code) => resolve({ ok: code === 0, code }));
    child.on("error", (error) => resolve({ ok: false, code: null, error: error.message }));
  });
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${arg} requires a value`);
  return value;
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

if (process.argv[1] === __filename) {
  try {
    const args = parsePrivateVmRollbackArgs(process.argv.slice(2));
    const result = await runPrivateVmRollback(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderPrivateVmRollbackResult(result).join("\n"));
    }
    process.exitCode = result.success ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
