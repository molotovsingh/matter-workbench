#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  evaluatePrivateWebBetaReadiness,
  renderPrivateWebBetaReadiness,
} from "./private-web-beta-readiness-check.mjs";
import { redactSensitiveText, REDACTED_SECRET } from "../shared/secret-redaction.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-beta-deployment-pack/v1";

export function parsePrivateBetaDeploymentPackArgs(argv = [], env = process.env) {
  const parsed = {
    outDir: env.MWB_PRIVATE_BETA_DEPLOYMENT_PACK_DIR || path.resolve(".local", "private-beta-deployment-packs"),
    timestamp: "",
    targetUrl: normalizeUrl(env.MWB_PRIVATE_BETA_PUBLIC_URL || env.MWB_PUBLIC_URL || ""),
    deploymentHost: env.MWB_PRIVATE_DEPLOYMENT_HOST || env.MWB_PRIVATE_VM_HOST || "",
    deploymentUser: env.MWB_PRIVATE_DEPLOYMENT_USER || env.USER || "",
    deploymentRoot: env.MWB_PRIVATE_VM_DEPLOYMENT_ROOT || "$HOME/matter-workbench-deployments",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      parsed.outDir = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--timestamp") {
      parsed.timestamp = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--target-url") {
      parsed.targetUrl = normalizeUrl(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--deployment-host") {
      parsed.deploymentHost = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--deployment-user") {
      parsed.deploymentUser = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--deployment-root") {
      parsed.deploymentRoot = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runPrivateBetaDeploymentPack({
  outDir = path.resolve(".local", "private-beta-deployment-packs"),
  timestamp = new Date().toISOString(),
  env = process.env,
  targetUrl = "",
  deploymentHost = "",
  deploymentUser = "",
  deploymentRoot = "$HOME/matter-workbench-deployments",
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const packDir = path.join(outDir, `private-beta-deployment-pack-${slug}`);
  await mkdir(packDir, { recursive: true });

  const effectiveTargetUrl = normalizeUrl(targetUrl || env.MWB_PRIVATE_BETA_PUBLIC_URL || env.MWB_PUBLIC_URL || "");
  const readiness = evaluatePrivateWebBetaReadiness({ env, publicUrl: effectiveTargetUrl, now: generatedAt });
  const commandPhases = buildCommandPhases({
    targetUrl: effectiveTargetUrl,
    deploymentHost,
    deploymentUser,
    deploymentRoot,
  });
  const stopRules = buildStopRules(readiness);
  const result = sanitizeEvidence({
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    readyForHandoff: readiness.ready,
    target: {
      url: effectiveTargetUrl,
      deploymentHost,
      deploymentUser,
      deploymentRoot,
    },
    readiness,
    commandPhases,
    stopRules,
    sitesBoundary: {
      status: "parked",
      message: "Sites is parked for companion surfaces; the main app remains a private VM/cloud Node + Postgres deployment.",
    },
    packDir,
  });

  result.files = await writeDeploymentPackEvidence(result);
  return result;
}

export function renderPrivateBetaDeploymentPack(result = {}) {
  const lines = [
    "Matter Workbench private beta deployment pack",
    `ready_for_handoff: ${result.readyForHandoff ? "yes" : "no"}`,
    `target_url: ${result.target?.url || "(not set)"}`,
    `deployment_host: ${result.target?.deploymentHost || "(not set)"}`,
    `deployment_root: ${result.target?.deploymentRoot || ""}`,
    `readiness_blockers: ${result.readiness?.summary?.blockers ?? 0}`,
    `readiness_warnings: ${result.readiness?.summary?.warnings ?? 0}`,
    "",
    "Deployment phases:",
  ];

  for (const phase of result.commandPhases || []) {
    lines.push(`- ${phase.id}: ${phase.title}`);
    for (const command of phase.commands || []) {
      lines.push(`  $ ${command}`);
    }
  }

  lines.push("", "Readiness:");
  lines.push(...renderPrivateWebBetaReadiness(result.readiness || {}).map((line) => `  ${line}`));

  if (result.stopRules?.length) {
    lines.push("", "Stop rules:");
    for (const rule of result.stopRules) lines.push(`- ${rule}`);
  }

  lines.push("", result.sitesBoundary?.message || "Sites is parked for companion surfaces.");
  if (result.files?.markdown) lines.push(`evidence_md: ${result.files.markdown}`);
  if (result.files?.json) lines.push(`evidence_json: ${result.files.json}`);
  return lines.map(redactLine);
}

function buildCommandPhases({ targetUrl, deploymentHost, deploymentUser, deploymentRoot }) {
  const root = deploymentRoot || "$HOME/matter-workbench-deployments";
  return [
    {
      id: "source_release",
      title: "Prepare source release artifact on the trusted development machine",
      commands: [
        "git status --short --branch",
        "npm run ui:typecheck --silent",
        "npm run ui:build --silent",
        "npm test --silent",
      ],
    },
    {
      id: "runtime_env",
      title: "Prepare private runtime environment values on the target host",
      commands: [
        "mkdir -p \"$HOME/.config/matter-workbench\"",
        "install -m 600 /dev/null \"$HOME/.config/matter-workbench/runtime.env\"",
        "edit \"$HOME/.config/matter-workbench/runtime.env\" with runtime DB, provider, auth users file, and mothership values",
        "include MWB_PRIVATE_BETA_USERS_FILE=$HOME/.config/matter-workbench/private-beta-users.json",
        "chmod 600 \"$HOME/.config/matter-workbench/runtime.env\"",
      ],
    },
    {
      id: "tester_accounts",
      title: "Create or update named private beta tester accounts",
      commands: [
        "printf '%s\\n' '<temporary password>' | npm run private-beta:users -- add --file \"$HOME/.config/matter-workbench/private-beta-users.json\" --username <tester> --password-stdin",
        "npm run private-beta:users -- list --file \"$HOME/.config/matter-workbench/private-beta-users.json\"",
        "chmod 600 \"$HOME/.config/matter-workbench/private-beta-users.json\"",
      ],
    },
    {
      id: "deploy_artifact",
      title: "Rsync, install, build, and atomically point current deployment at the release",
      commands: [
        `npm run private-vm:rsync-deploy -- --host ${deploymentHost || "<deployment-host>"}${deploymentUser ? ` --user ${deploymentUser}` : ""} --deployment-root ${root}`,
      ],
    },
    {
      id: "service_start",
      title: "Install or restart the user-level systemd service",
      commands: [
        "cp deployment/private-vm/matter-workbench-runtime.service \"$HOME/.config/systemd/user/\"",
        "systemctl --user daemon-reload",
        "systemctl --user enable --now matter-workbench-runtime.service",
        "systemctl --user status matter-workbench-runtime.service --no-pager",
      ],
    },
    {
      id: "https_access",
      title: "Put HTTPS in front of the private service before tester access",
      commands: [
        "configure Caddy/Nginx/reverse proxy for HTTPS",
        "reverse proxy 127.0.0.1:4191 to the private beta hostname",
        `curl -sS -o /tmp/mwb-root.html -w '%{http_code} %{size_download}\\n' ${targetUrl || "https://<private-beta-url>"}/`,
      ],
    },
    {
      id: "verification",
      title: "Run readiness, runtime DB, security, recoverability, and release-candidate checks",
      commands: [
        "npm run private-web:readiness-check",
        "MWB_RUNTIME_DB=postgres MWB_RUNTIME_DB_STORAGE=postgres MWB_DB_RUNTIME_CUTOVER_APPROVED=yes npm run db:runtime:write-smoke",
        "npm run private-vm:security-check",
        "npm run private-vm:recoverability-pack",
        "npm run private-beta:rc-closure-pack",
      ],
    },
    {
      id: "observability",
      title: "Collect routine service evidence and enable tester signal flow",
      commands: [
        "npm run private-vm:ops-pack",
        "journalctl --user -u matter-workbench-runtime.service -n 80 --no-pager",
        "curl -sS -X POST http://127.0.0.1:4191/api/private-beta/feedback/sync",
        "curl -sS -X POST http://127.0.0.1:4191/api/private-beta/signals/sync",
      ],
    },
    {
      id: "rollback",
      title: "Keep rollback executable but reviewed",
      commands: [
        "review the latest ops-pack rollback-plan.sh",
        "run rollback-plan.sh only after confirming the previous deployment candidate",
        "rerun private-vm:service-check after rollback",
      ],
    },
    {
      id: "sites_boundary",
      title: "Keep OpenAI Sites for future lightweight companion surfaces",
      commands: [
        "do not deploy the main Matter Workbench app through Sites in this slice",
        "use Sites later for a landing page, tester guide, or lightweight mothership dashboard candidate",
      ],
    },
  ];
}

function buildStopRules(readiness) {
  const rules = [];
  if (!readiness.ready) {
    rules.push("Do not hand the URL to beta testers until private-web readiness blockers pass.");
  }
  rules.push("Do not widen access if runtime DB write smoke fails.");
  rules.push("Do not widen access if recoverability evidence cannot prove database/file custody recovery.");
  rules.push("Do not widen access if mothership feedback, diagnostic signal, or backend metrics sync is unavailable.");
  rules.push("Do not treat OpenAI Sites as the main app deployment path until the app is redesigned for that hosting shape.");
  return rules;
}

async function writeDeploymentPackEvidence(result) {
  const jsonPath = path.join(result.packDir, "private-beta-deployment-pack.json");
  const markdownPath = path.join(result.packDir, "private-beta-deployment-pack.md");
  await writeFile(jsonPath, JSON.stringify(result, null, 2), "utf8");
  await writeFile(markdownPath, renderDeploymentPackMarkdown(result), "utf8");
  return { json: jsonPath, markdown: markdownPath };
}

function renderDeploymentPackMarkdown(result) {
  const lines = [
    "# Matter Workbench Private Beta Deployment Pack",
    "",
    `Generated: ${result.generatedAt}`,
    `Ready for handoff: ${result.readyForHandoff ? "yes" : "no"}`,
    `Target URL: ${result.target?.url || "(not set)"}`,
    "",
    "## Readiness",
    "",
    ...renderPrivateWebBetaReadiness(result.readiness || {}),
    "",
    "## Command Phases",
    "",
  ];
  for (const phase of result.commandPhases || []) {
    lines.push(`### ${phase.title}`, "", `id: \`${phase.id}\``, "", "```bash", ...phase.commands, "```", "");
  }
  lines.push("## Stop Rules", "");
  for (const rule of result.stopRules || []) lines.push(`- ${rule}`);
  lines.push("", "## Sites Boundary", "", result.sitesBoundary?.message || "Sites is parked for companion surfaces.", "");
  return lines.map(redactLine).join("\n");
}

function sanitizeEvidence(value) {
  return JSON.parse(redactLine(JSON.stringify(value)));
}

function redactLine(value) {
  return redactSensitiveText(String(value))
    .replace(/\b(GEMINI_API_KEY|ANTHROPIC_API_KEY|MWB_PRIVATE_BETA_PASSWORD|MWB_RUNTIME_DATABASE_URL|MWB_DATABASE_URL|MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN|MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi, `$1=${REDACTED_SECRET}`)
    .replace(/\bpostgres:\/\/([^:\s/@]+):([^@\s]+)@/gi, "postgres://$1:***@")
    .replace(/\b(private-password|feedback-token|signal-token)\b/gi, REDACTED_SECRET);
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${arg} requires a value`);
  return value;
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

if (process.argv[1] === __filename) {
  try {
    const args = parsePrivateBetaDeploymentPackArgs(process.argv.slice(2));
    const result = await runPrivateBetaDeploymentPack(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderPrivateBetaDeploymentPack(result).join("\n"));
    }
    process.exitCode = result.readyForHandoff ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
