#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-vm-rsync-deploy/v1";

const RSYNC_EXCLUDES = [
  ".git/",
  "node_modules/",
  "react-dist/",
  ".local/",
  "codex_review/",
  "claude_review/",
  ".env",
  ".env.*",
  "*.tgz",
  "*.pem",
  "*.key",
  "private-beta-users.json",
];

const RSYNC_INCLUDES = [
  ".env.example",
];

export function parsePrivateVmRsyncDeployArgs(argv = [], env = process.env) {
  const parsed = {
    host: env.MWB_PRIVATE_VM_HOST || env.MWB_PRIVATE_DEPLOYMENT_HOST || "",
    user: env.MWB_PRIVATE_VM_USER || env.MWB_PRIVATE_DEPLOYMENT_USER || env.USER || "",
    deploymentRoot: env.MWB_PRIVATE_VM_DEPLOYMENT_ROOT || "",
    commit: env.MWB_PRIVATE_VM_DEPLOY_COMMIT || "",
    sourceDir: process.cwd(),
    baseUrl: normalizeUrl(env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191"),
    serviceName: env.MWB_PRIVATE_VM_SERVICE_NAME || "matter-workbench-runtime.service",
    json: false,
    dryRun: false,
    allowDirty: false,
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
    } else if (arg === "--commit") {
      parsed.commit = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--source-dir") {
      parsed.sourceDir = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--base-url") {
      parsed.baseUrl = normalizeUrl(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--service-name") {
      parsed.serviceName = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--allow-dirty") {
      parsed.allowDirty = true;
    } else if (arg === "--skip-service-check") {
      parsed.skipServiceCheck = true;
    } else if (arg === "--skip-ui-hardening") {
      parsed.skipUiHardening = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (/password/i.test(arg)) {
      throw new Error("private-vm:rsync-deploy does not accept passwords. Use SSH keys or an interactive SSH agent/session.");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!parsed.deploymentRoot) {
    parsed.deploymentRoot = defaultRemoteDeploymentRoot(parsed.user);
  }

  return parsed;
}

export function buildPrivateVmRsyncDeployPlan({
  host,
  user = "",
  deploymentRoot = "",
  commit,
  sourceDir = process.cwd(),
  baseUrl = "http://127.0.0.1:4191",
  serviceName = "matter-workbench-runtime.service",
  skipServiceCheck = false,
  skipUiHardening = false,
} = {}) {
  if (!host) throw new Error("--host is required");
  if (!commit) throw new Error("--commit is required");
  if (!deploymentRoot) deploymentRoot = defaultRemoteDeploymentRoot(user);

  const remote = user ? `${user}@${host}` : host;
  const releaseDir = `${deploymentRoot.replace(/\/+$/, "")}/${commit}`;
  const appDir = `${releaseDir}/app`;
  const remoteAppTarget = `${remote}:${appDir}/`;
  const steps = [
    {
      id: "preflight",
      title: "Verify VM deploy prerequisites before mutating the release directory",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          "command -v rsync >/dev/null",
          "command -v node >/dev/null",
          "command -v npm >/dev/null",
          "command -v systemctl >/dev/null",
          "systemctl --user show-environment >/dev/null",
          "test -r \"$HOME/.config/matter-workbench/runtime.env\"",
          `test -d ${shellQuote(deploymentRoot.replace(/\/+$/, ""))}`,
          `test -w ${shellQuote(deploymentRoot.replace(/\/+$/, ""))}`,
        ].join(" && "),
      ],
    },
    {
      id: "prepare_release_dir",
      title: "Create a clean release app directory on the VM",
      command: ["ssh", remote, `rm -rf ${shellQuote(appDir)} && mkdir -p ${shellQuote(appDir)}`],
    },
    {
      id: "rsync_source",
      title: "Sync tracked source into the fresh release directory",
      command: [
        "sh",
        "-lc",
        [
          `cd ${shellQuote(path.resolve(sourceDir))}`,
          [
            "git ls-files -z",
            "|",
            "rsync -az --delete --from0 --files-from=-",
            ...RSYNC_INCLUDES.map((entry) => `--include=${shellQuote(entry)}`),
            ...RSYNC_EXCLUDES.map((entry) => `--exclude=${shellQuote(entry)}`),
            "--",
            "./",
            shellQuote(remoteAppTarget),
          ].join(" "),
        ].join(" && "),
      ],
    },
    {
      id: "install_and_build",
      title: "Install dependencies and build React before activation",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          `cd ${shellQuote(appDir)}`,
          "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --silent",
          "npm run ui:build --silent",
          "mkdir -p \"$HOME/.config/systemd/user\"",
          "cp deployment/private-vm/matter-workbench-runtime.service \"$HOME/.config/systemd/user/\"",
          "systemctl --user daemon-reload",
        ].join(" && "),
      ],
    },
    {
      id: "activate_release",
      title: "Atomically point current at the release and restart the user service",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          `ln -sfn ${shellQuote(releaseDir)} ${shellQuote(`${deploymentRoot.replace(/\/+$/, "")}/current`)}`,
          `systemctl --user restart ${shellQuote(serviceName)}`,
          `systemctl --user is-active ${shellQuote(serviceName)}`,
          `readlink -f ${shellQuote(`${deploymentRoot.replace(/\/+$/, "")}/current`)}`,
        ].join(" && "),
      ],
    },
  ];

  if (!skipServiceCheck) {
    steps.push({
      id: "service_check",
      title: "Run VM-local service check",
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
      title: "Run VM-local rendered UI hardening pass",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          `cd ${shellQuote(appDir)}`,
          "set -a",
          ". \"$HOME/.config/matter-workbench/runtime.env\"",
          "set +a",
          `npm run private-beta:ui-hardening-pass --silent -- --base-url ${shellQuote(baseUrl)} --out-dir \"$HOME/matter-workbench-backups/ui-hardening\"`,
        ].join(" && "),
      ],
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    remote,
    deploymentRoot,
    releaseDir,
    appDir,
    commit,
    sourceDir: path.resolve(sourceDir),
    baseUrl,
    serviceName,
    excludes: [...RSYNC_EXCLUDES],
    includes: [...RSYNC_INCLUDES],
    steps,
  };
}

export async function runPrivateVmRsyncDeploy({
  host,
  user = "",
  deploymentRoot = "",
  commit = "",
  sourceDir = process.cwd(),
  baseUrl = "http://127.0.0.1:4191",
  serviceName = "matter-workbench-runtime.service",
  dryRun = false,
  allowDirty = false,
  skipServiceCheck = false,
  skipUiHardening = false,
  commandRunner = runCommand,
  gitDirtyChecker = hasTrackedGitChanges,
  commitResolver = resolveGitCommit,
} = {}) {
  const resolvedCommit = commit || await commitResolver({ cwd: sourceDir });
  if (!dryRun && !allowDirty && await gitDirtyChecker({ cwd: sourceDir })) {
    throw new Error("Tracked worktree has uncommitted changes. Commit first or rerun with --allow-dirty.");
  }

  const plan = buildPrivateVmRsyncDeployPlan({
    host,
    user,
    deploymentRoot,
    commit: resolvedCommit,
    sourceDir,
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

export function renderPrivateVmRsyncDeployResult(result = {}) {
  const lines = [
    "Matter Workbench private VM rsync deploy",
    `success: ${result.success ? "yes" : "no"}`,
    `executed: ${result.executed ? "yes" : "no"}`,
    `remote: ${result.plan?.remote || ""}`,
    `commit: ${result.plan?.commit || ""}`,
    `release_dir: ${result.plan?.releaseDir || ""}`,
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

async function hasTrackedGitChanges({ cwd }) {
  const unstaged = await runQuiet("git", ["diff", "--quiet", "--exit-code", "--"], { cwd });
  if (!unstaged.ok) return true;
  const staged = await runQuiet("git", ["diff", "--cached", "--quiet", "--exit-code", "--"], { cwd });
  return !staged.ok;
}

async function resolveGitCommit({ cwd }) {
  const result = await runQuiet("git", ["rev-parse", "--short", "HEAD"], { cwd });
  if (!result.ok || !result.stdout.trim()) throw new Error("Could not resolve git commit for deployment.");
  return result.stdout.trim();
}

async function runQuiet(command, args, { cwd }) {
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
    child.on("error", (error) => resolve({ ok: false, code: null, stdout, stderr: error.message }));
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

function defaultRemoteDeploymentRoot(user) {
  const remoteUser = String(user || "").trim();
  if (remoteUser === "root") return "/root/matter-workbench-deployments";
  if (remoteUser) return `/home/${remoteUser}/matter-workbench-deployments`;
  throw new Error("deployment root is required when the remote user is not specified.");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

if (process.argv[1] === __filename) {
  try {
    const args = parsePrivateVmRsyncDeployArgs(process.argv.slice(2));
    const result = await runPrivateVmRsyncDeploy(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderPrivateVmRsyncDeployResult(result).join("\n"));
    }
    process.exitCode = result.success ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
