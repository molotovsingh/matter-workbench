#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-vm-legal-source-sidecar-deploy/v1";
const DEFAULT_NODE_VERSION = "v22.16.0";
const DEFAULT_STATUTES_PORT = 8788;
const DEFAULT_LEGAL_SOURCE_PORT = 8790;

const LEGAL_SOURCE_EXCLUDES = [
  ".git/",
  "node_modules/",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
];

const STATUTES_INCLUDES = [
  "bin/***",
  "src/***",
  "corpus/***",
  "docs/***",
  "package.json",
  "package-lock.json",
  "README.md",
];

export function parsePrivateVmLegalSourceSidecarDeployArgs(argv = [], env = process.env) {
  const parsed = {
    host: env.MWB_PRIVATE_VM_HOST || env.MWB_PRIVATE_DEPLOYMENT_HOST || "",
    user: env.MWB_PRIVATE_VM_USER || env.MWB_PRIVATE_DEPLOYMENT_USER || env.USER || "",
    sidecarRoot: env.MWB_PRIVATE_VM_SIDECAR_ROOT || "",
    legalSourceDir: path.resolve(env.MWB_LEGAL_SOURCE_SERVICE_DIR || path.join(process.cwd(), "..", "legal-source-service")),
    statutesDir: path.resolve(env.MWB_STATUTES_DIR || path.join(process.cwd(), "..", "statutes")),
    statutesPort: normalizePort(env.MWB_STATUTES_PORT, DEFAULT_STATUTES_PORT),
    legalSourcePort: normalizePort(env.MWB_LEGAL_SOURCE_PORT, DEFAULT_LEGAL_SOURCE_PORT),
    nodeVersion: normalizeNodeVersion(env.MWB_SIDECAR_NODE_VERSION || DEFAULT_NODE_VERSION),
    nodeDistBaseUrl: normalizeUrl(env.MWB_NODE_DIST_BASE_URL || "https://nodejs.org/dist"),
    statutesServiceName: env.MWB_STATUTES_SERVICE_NAME || "mwb-statutes.service",
    legalSourceServiceName: env.MWB_LEGAL_SOURCE_SERVICE_NAME || "mwb-legal-source.service",
    workbenchServiceName: env.MWB_PRIVATE_VM_SERVICE_NAME || "matter-workbench-runtime.service",
    configureWorkbenchEnv: false,
    skipHealthCheck: false,
    dryRun: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") {
      parsed.host = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--user") {
      parsed.user = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--sidecar-root") {
      parsed.sidecarRoot = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--legal-source-dir") {
      parsed.legalSourceDir = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--statutes-dir") {
      parsed.statutesDir = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--statutes-port") {
      parsed.statutesPort = normalizePort(requiredValue(argv, i, arg), DEFAULT_STATUTES_PORT);
      i += 1;
    } else if (arg === "--legal-source-port") {
      parsed.legalSourcePort = normalizePort(requiredValue(argv, i, arg), DEFAULT_LEGAL_SOURCE_PORT);
      i += 1;
    } else if (arg === "--node-version") {
      parsed.nodeVersion = normalizeNodeVersion(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--node-dist-base-url") {
      parsed.nodeDistBaseUrl = normalizeUrl(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--statutes-service-name") {
      parsed.statutesServiceName = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--legal-source-service-name") {
      parsed.legalSourceServiceName = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--workbench-service-name") {
      parsed.workbenchServiceName = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--configure-workbench-env") {
      parsed.configureWorkbenchEnv = true;
    } else if (arg === "--skip-health-check") {
      parsed.skipHealthCheck = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (/password|token|secret/i.test(arg)) {
      throw new Error("private-vm:legal-source-sidecar-deploy does not accept secrets on the command line. Put secrets in protected VM env files.");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!parsed.sidecarRoot) parsed.sidecarRoot = defaultRemoteSidecarRoot(parsed.user);
  return parsed;
}

export function buildPrivateVmLegalSourceSidecarDeployPlan({
  host,
  user = "",
  sidecarRoot = "",
  legalSourceDir = path.join(process.cwd(), "..", "legal-source-service"),
  statutesDir = path.join(process.cwd(), "..", "statutes"),
  statutesPort = DEFAULT_STATUTES_PORT,
  legalSourcePort = DEFAULT_LEGAL_SOURCE_PORT,
  nodeVersion = DEFAULT_NODE_VERSION,
  nodeDistBaseUrl = "https://nodejs.org/dist",
  statutesServiceName = "mwb-statutes.service",
  legalSourceServiceName = "mwb-legal-source.service",
  workbenchServiceName = "matter-workbench-runtime.service",
  configureWorkbenchEnv = false,
  skipHealthCheck = false,
} = {}) {
  if (!host) throw new Error("--host is required");
  if (!sidecarRoot) sidecarRoot = defaultRemoteSidecarRoot(user);

  const normalizedStatutesPort = normalizePort(statutesPort, DEFAULT_STATUTES_PORT);
  const normalizedLegalSourcePort = normalizePort(legalSourcePort, DEFAULT_LEGAL_SOURCE_PORT);
  const normalizedNodeVersion = normalizeNodeVersion(nodeVersion);
  const normalizedNodeDistBaseUrl = normalizeUrl(nodeDistBaseUrl || "https://nodejs.org/dist");
  const remote = user ? `${user}@${host}` : host;
  const sidecarRootBase = sidecarRoot.replace(/\/+$/, "");
  const legalSourceRemoteDir = `${sidecarRootBase}/legal-source-service`;
  const statutesRemoteDir = `${sidecarRootBase}/statutes`;
  const nodeDir = `${sidecarRootBase}/node`;
  const nodeBin = `${nodeDir}/bin/node`;
  const statutesHealthUrl = `http://127.0.0.1:${normalizedStatutesPort}/health`;
  const legalSourceHealthUrl = `http://127.0.0.1:${normalizedLegalSourcePort}/health`;
  const legalSourceUrl = `http://127.0.0.1:${normalizedLegalSourcePort}`;

  const steps = [
    {
      id: "preflight",
      title: "Verify VM sidecar prerequisites before syncing sources",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          "command -v rsync >/dev/null",
          "command -v curl >/dev/null",
          "command -v tar >/dev/null",
          "command -v xz >/dev/null",
          "command -v systemctl >/dev/null",
          "systemctl --user show-environment >/dev/null",
          `mkdir -p ${shellQuote(sidecarRootBase)} ${shellQuote(legalSourceRemoteDir)} ${shellQuote(statutesRemoteDir)}`,
          `test -w ${shellQuote(sidecarRootBase)}`,
        ].join(" && "),
      ],
    },
    {
      id: "rsync_legal_source",
      title: "Sync the standalone Legal Source Sidecar source",
      command: [
        "sh",
        "-lc",
        [
          `cd ${shellQuote(path.resolve(legalSourceDir))}`,
          [
            "rsync -az --delete",
            ...LEGAL_SOURCE_EXCLUDES.map((entry) => `--exclude=${shellQuote(entry)}`),
            "--",
            "./",
            shellQuote(`${remote}:${legalSourceRemoteDir}/`),
          ].join(" "),
        ].join(" && "),
      ],
    },
    {
      id: "rsync_statutes",
      title: "Sync the statutes server source and corpus without local databases",
      command: [
        "sh",
        "-lc",
        [
          `cd ${shellQuote(path.resolve(statutesDir))}`,
          [
            "rsync -az --delete",
            ...STATUTES_INCLUDES.map((entry) => `--include=${shellQuote(entry)}`),
            "--exclude='.git/'",
            "--exclude='node_modules/'",
            "--exclude='data/'",
            "--exclude='*.db'",
            "--exclude='*.db-*'",
            "--exclude='*'",
            "--",
            "./",
            shellQuote(`${remote}:${statutesRemoteDir}/`),
          ].join(" "),
        ].join(" && "),
      ],
    },
    {
      id: "install_node_runtime",
      title: "Install or refresh the user-local Node runtime required by the statutes service",
      command: [
        "ssh",
        remote,
        buildInstallNodeRuntimeCommand({ sidecarRoot: sidecarRootBase, nodeDir, nodeVersion: normalizedNodeVersion, nodeDistBaseUrl: normalizedNodeDistBaseUrl }),
      ],
    },
    {
      id: "build_statutes_db",
      title: "Build the statutes database from the synced corpus",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          `export PATH=${shellQuote(`${nodeDir}/bin`)}:\$PATH`,
          `cd ${shellQuote(statutesRemoteDir)}`,
          "mkdir -p data",
          "STATUTE_ACTS_DIR=./corpus STATUTE_DB_PATH=./data/statutes.db npm run build:corpus --silent",
        ].join(" && "),
      ],
    },
    {
      id: "install_systemd_units",
      title: "Install user-level systemd units for statutes and legal-source services",
      command: [
        "ssh",
        remote,
        buildInstallSystemdUnitsCommand({
          nodeBin,
          statutesRemoteDir,
          legalSourceRemoteDir,
          statutesPort: normalizedStatutesPort,
          legalSourcePort: normalizedLegalSourcePort,
          statutesServiceName,
          legalSourceServiceName,
        }),
      ],
    },
    {
      id: "restart_sidecars",
      title: "Enable, restart, and verify sidecar user services",
      command: [
        "ssh",
        remote,
        [
          "set -e",
          `systemctl --user enable --now ${shellQuote(statutesServiceName)} ${shellQuote(legalSourceServiceName)}`,
          `systemctl --user restart ${shellQuote(statutesServiceName)}`,
          `systemctl --user is-active ${shellQuote(statutesServiceName)}`,
          `systemctl --user restart ${shellQuote(legalSourceServiceName)}`,
          `systemctl --user is-active ${shellQuote(legalSourceServiceName)}`,
        ].join(" && "),
      ],
    },
  ];

  if (configureWorkbenchEnv) {
    steps.push({
      id: "configure_workbench_env",
      title: "Point Workbench Research at the loopback Legal Source Sidecar",
      command: [
        "ssh",
        remote,
        buildConfigureWorkbenchEnvCommand({ nodeBin, legalSourceUrl, workbenchServiceName }),
      ],
    });
  }

  if (!skipHealthCheck) {
    steps.push({
      id: "health_check",
      title: "Verify statutes and legal-source health without sending matter context",
      command: [
        "ssh",
        remote,
        buildHealthCheckCommand({ nodeBin, statutesHealthUrl, legalSourceHealthUrl }),
      ],
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    remote,
    sidecarRoot: sidecarRootBase,
    legalSourceDir: path.resolve(legalSourceDir),
    statutesDir: path.resolve(statutesDir),
    legalSourceRemoteDir,
    statutesRemoteDir,
    nodeDir,
    nodeVersion: normalizedNodeVersion,
    statutesPort: normalizedStatutesPort,
    legalSourcePort: normalizedLegalSourcePort,
    statutesServiceName,
    legalSourceServiceName,
    workbenchServiceName,
    configureWorkbenchEnv: Boolean(configureWorkbenchEnv),
    health: {
      statutes: statutesHealthUrl,
      legalSource: legalSourceHealthUrl,
    },
    steps,
  };
}

export async function runPrivateVmLegalSourceSidecarDeploy({
  host,
  user = "",
  sidecarRoot = "",
  legalSourceDir = path.join(process.cwd(), "..", "legal-source-service"),
  statutesDir = path.join(process.cwd(), "..", "statutes"),
  statutesPort = DEFAULT_STATUTES_PORT,
  legalSourcePort = DEFAULT_LEGAL_SOURCE_PORT,
  nodeVersion = DEFAULT_NODE_VERSION,
  nodeDistBaseUrl = "https://nodejs.org/dist",
  statutesServiceName = "mwb-statutes.service",
  legalSourceServiceName = "mwb-legal-source.service",
  workbenchServiceName = "matter-workbench-runtime.service",
  configureWorkbenchEnv = false,
  skipHealthCheck = false,
  dryRun = false,
  commandRunner = runCommand,
} = {}) {
  const plan = buildPrivateVmLegalSourceSidecarDeployPlan({
    host,
    user,
    sidecarRoot,
    legalSourceDir,
    statutesDir,
    statutesPort,
    legalSourcePort,
    nodeVersion,
    nodeDistBaseUrl,
    statutesServiceName,
    legalSourceServiceName,
    workbenchServiceName,
    configureWorkbenchEnv,
    skipHealthCheck,
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

export function renderPrivateVmLegalSourceSidecarDeployResult(result = {}) {
  const lines = [
    "Matter Workbench private VM Legal Source Sidecar deploy",
    `success: ${result.success ? "yes" : "no"}`,
    `executed: ${result.executed ? "yes" : "no"}`,
    `remote: ${result.plan?.remote || ""}`,
    `sidecar_root: ${result.plan?.sidecarRoot || ""}`,
    `statutes_port: ${result.plan?.statutesPort || ""}`,
    `legal_source_port: ${result.plan?.legalSourcePort || ""}`,
    `configure_workbench_env: ${result.plan?.configureWorkbenchEnv ? "yes" : "no"}`,
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

function buildInstallNodeRuntimeCommand({ sidecarRoot, nodeDir, nodeVersion, nodeDistBaseUrl }) {
  return [
    "set -e",
    `mkdir -p ${shellQuote(sidecarRoot)}`,
    `NODE_VERSION=${shellQuote(nodeVersion)}`,
    `NODE_DIR=${shellQuote(nodeDir)}`,
    `NODE_DIST_BASE_URL=${shellQuote(nodeDistBaseUrl)}`,
    "export NODE_VERSION NODE_DIR NODE_DIST_BASE_URL",
    "ARCH=$(uname -m)",
    "case \"$ARCH\" in x86_64) NODE_ARCH=x64;; aarch64|arm64) NODE_ARCH=arm64;; *) printf '%s\\n' \"Unsupported architecture: $ARCH\" >&2; exit 64;; esac",
    "if ! test -x \"$NODE_DIR/bin/node\" || ! \"$NODE_DIR/bin/node\" -e \"process.exit(process.version === process.env.NODE_VERSION ? 0 : 1)\" >/dev/null 2>&1; then "
      + "TMP_DIR=$(mktemp -d); "
      + "trap 'rm -rf \"$TMP_DIR\"' EXIT; "
      + "cd \"$TMP_DIR\"; "
      + "TARBALL=\"node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz\"; "
      + "curl -fsSLO \"$NODE_DIST_BASE_URL/$NODE_VERSION/$TARBALL\"; "
      + "tar -xJf \"$TARBALL\"; "
      + "rm -rf \"$NODE_DIR\"; "
      + "mkdir -p \"$(dirname \"$NODE_DIR\")\"; "
      + "mv \"node-$NODE_VERSION-linux-$NODE_ARCH\" \"$NODE_DIR\"; "
      + "fi",
    "\"$NODE_DIR/bin/node\" -v",
  ].join(" && ");
}

function buildInstallSystemdUnitsCommand({
  nodeBin,
  statutesRemoteDir,
  legalSourceRemoteDir,
  statutesPort,
  legalSourcePort,
  statutesServiceName,
  legalSourceServiceName,
}) {
  const statutesUnit = `[Unit]
Description=Matter Workbench statutes sidecar
After=network.target

[Service]
Type=simple
WorkingDirectory=${statutesRemoteDir}
Environment=STATUTE_HOST=127.0.0.1
Environment=STATUTE_PORT=${statutesPort}
Environment=STATUTE_ACTS_DIR=./corpus
Environment=STATUTE_DB_PATH=./data/statutes.db
ExecStart=${nodeBin} bin/statutes.mjs serve --host 127.0.0.1 --port ${statutesPort}
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target`;

  const legalSourceUnit = `[Unit]
Description=Matter Workbench legal source sidecar
After=network.target ${statutesServiceName}
Wants=${statutesServiceName}

[Service]
Type=simple
WorkingDirectory=${legalSourceRemoteDir}
Environment=LEGAL_SOURCE_HOST=127.0.0.1
Environment=LEGAL_SOURCE_PORT=${legalSourcePort}
Environment=LEGAL_SOURCE_STATUTES_ENABLED=1
Environment=STATUTES_API_URL=http://127.0.0.1:${statutesPort}
Environment=LEGAL_SOURCE_WEB_ENABLED=0
ExecStart=${nodeBin} src/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target`;

  return [
    "set -e",
    "mkdir -p \"$HOME/.config/systemd/user\"",
    `cat > "$HOME/.config/systemd/user/${statutesServiceName}" <<'MWB_STATUTES_UNIT'\n${statutesUnit}\nMWB_STATUTES_UNIT`,
    `cat > "$HOME/.config/systemd/user/${legalSourceServiceName}" <<'MWB_LEGAL_SOURCE_UNIT'\n${legalSourceUnit}\nMWB_LEGAL_SOURCE_UNIT`,
    "systemctl --user daemon-reload",
  ].join("\n");
}

function buildConfigureWorkbenchEnvCommand({ nodeBin, legalSourceUrl, workbenchServiceName }) {
  return [
    "set -e",
    `MWB_LEGAL_SOURCE_URL=${shellQuote(legalSourceUrl)} ${shellQuote(nodeBin)} --input-type=module <<'MWB_CONFIGURE_ENV'`,
    "import { readFile, writeFile } from 'node:fs/promises';",
    "import { homedir } from 'node:os';",
    "import path from 'node:path';",
    "const envPath = path.join(homedir(), '.config', 'matter-workbench', 'runtime.env');",
    "const updates = new Map([",
    "  ['COPILOT_WEB_RESEARCH_ENABLED', '1'],",
    "  ['COPILOT_WEB_RESEARCH_PROVIDER', 'legal_source_sidecar'],",
    "  ['COPILOT_LEGAL_SOURCE_SERVICE_URL', process.env.MWB_LEGAL_SOURCE_URL],",
    "]);",
    "const text = await readFile(envPath, 'utf8');",
    "const lines = text.split(/\\r?\\n/);",
    "const seen = new Set();",
    "const next = lines.map((line) => {",
    "  if (/^\\s*#/.test(line) || !line.includes('=')) return line;",
    "  const key = line.split('=', 1)[0];",
    "  if (!updates.has(key)) return line;",
    "  seen.add(key);",
    "  return `${key}=${updates.get(key)}`;",
    "});",
    "for (const [key, value] of updates) if (!seen.has(key)) next.push(`${key}=${value}`);",
    "await writeFile(envPath, `${next.filter((line, index) => index < next.length - 1 || line).join('\\n')}\\n`);",
    "MWB_CONFIGURE_ENV",
    `systemctl --user restart ${shellQuote(workbenchServiceName)}`,
    `systemctl --user is-active ${shellQuote(workbenchServiceName)}`,
  ].join("\n");
}

function buildHealthCheckCommand({ nodeBin, statutesHealthUrl, legalSourceHealthUrl }) {
  return [
    "set -e",
    `${shellQuote(nodeBin)} --input-type=module <<'MWB_HEALTH_CHECK'`,
    `const statutesHealthUrl = ${JSON.stringify(statutesHealthUrl)};`,
    `const legalSourceHealthUrl = ${JSON.stringify(legalSourceHealthUrl)};`,
    "async function getJson(url) {",
    "  const response = await fetch(url);",
    "  const body = await response.text();",
    "  let payload = {};",
    "  try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }",
    "  if (!response.ok) throw new Error(`${url}: ${response.status}`);",
    "  return payload;",
    "}",
    "const statutes = await getJson(statutesHealthUrl);",
    "const legal = await getJson(legalSourceHealthUrl);",
    "const summary = {",
    "  statutes: { ok: Boolean(statutes.ok), acts: statutes.acts ?? null, sections: statutes.sections ?? null, corpus_fingerprint: statutes.corpus_fingerprint ?? null },",
    "  legalSource: { ok: Boolean(legal.ok), statutesOk: Boolean(legal.providers?.statutes?.ok), webEnabled: Boolean(legal.providers?.web?.enabled) },",
    "};",
    "console.log(JSON.stringify(summary, null, 2));",
    "if (!summary.statutes.ok || !summary.legalSource.ok || !summary.legalSource.statutesOk) process.exit(1);",
    "MWB_HEALTH_CHECK",
  ].join("\n");
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

function normalizeNodeVersion(value) {
  const trimmed = String(value || DEFAULT_NODE_VERSION).trim();
  const normalized = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  if (!/^v\d+\.\d+\.\d+$/.test(normalized)) throw new Error(`Invalid Node version: ${value}`);
  return normalized;
}

function normalizePort(value, fallback) {
  const raw = value === undefined || value === null || value === "" ? fallback : value;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${value}`);
  return port;
}

function defaultRemoteSidecarRoot(user) {
  const remoteUser = String(user || "").trim();
  if (remoteUser === "root") return "/root/matter-workbench-sidecars";
  if (remoteUser) return `/home/${remoteUser}/matter-workbench-sidecars`;
  throw new Error("sidecar root is required when the remote user is not specified.");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

if (process.argv[1] === __filename) {
  try {
    const args = parsePrivateVmLegalSourceSidecarDeployArgs(process.argv.slice(2));
    const result = await runPrivateVmLegalSourceSidecarDeploy(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderPrivateVmLegalSourceSidecarDeployResult(result).join("\n"));
    }
    process.exitCode = result.success ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
