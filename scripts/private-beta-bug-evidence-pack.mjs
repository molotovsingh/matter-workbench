#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { createCommandInteractionLogService } from "../services/command-interaction-log-service.mjs";
import { redactSensitiveText, REDACTED_SECRET } from "../shared/secret-redaction.mjs";
import { runPrivateVmOpsPack } from "./private-vm-ops-pack.mjs";
import { runPrivateVmServiceCheck } from "./private-vm-service-check.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "private-beta-bug-evidence-pack/v1";
const DEFAULT_RECENT_INTERACTION_LIMIT = 20;

export function parseBugEvidencePackArgs(argv = [], env = process.env) {
  const parsed = {
    outDir: path.resolve(".local", "private-beta-bug-evidence-packs"),
    timestamp: "",
    baseUrl: env.MWB_PRIVATE_VM_BASE_URL || "http://127.0.0.1:4191",
    deploymentRoot: env.MWB_PRIVATE_VM_DEPLOYMENT_ROOT || "",
    appDir: env.MWB_APP_DIR || process.cwd(),
    commandLogPath: env.MWB_COMMAND_INTERACTION_LOG || "",
    matterName: env.MWB_PRIVATE_BETA_BUG_MATTER || "",
    issueNote: env.MWB_PRIVATE_BETA_BUG_NOTE || "",
    authUsername: env.MWB_PRIVATE_BETA_USERNAME || "",
    authPassword: env.MWB_PRIVATE_BETA_PASSWORD || "",
    skipInteractions: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      parsed.outDir = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--timestamp") {
      parsed.timestamp = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--base-url") {
      parsed.baseUrl = requiredValue(argv, i, arg).replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--deployment-root") {
      parsed.deploymentRoot = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--app-dir") {
      parsed.appDir = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--command-log") {
      parsed.commandLogPath = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--matter") {
      parsed.matterName = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--note") {
      parsed.issueNote = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--auth-username") {
      parsed.authUsername = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--auth-password") {
      parsed.authPassword = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--skip-interactions") {
      parsed.skipInteractions = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  parsed.baseUrl = parsed.baseUrl.replace(/\/+$/, "");
  return parsed;
}

export async function runPrivateBetaBugEvidencePack({
  outDir = path.resolve(".local", "private-beta-bug-evidence-packs"),
  timestamp = new Date().toISOString(),
  baseUrl = "http://127.0.0.1:4191",
  deploymentRoot = "",
  appDir = process.cwd(),
  commandLogPath = "",
  matterName = "",
  issueNote = "",
  authUsername = "",
  authPassword = "",
  skipInteractions = false,
  serviceCheckFn = runPrivateVmServiceCheck,
  opsPackFn = runPrivateVmOpsPack,
  recentInteractionsFn,
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const packDir = path.join(outDir, `private-beta-bug-evidence-pack-${slug}`);
  await mkdir(packDir, { recursive: true });

  const serviceCheck = await inspectService({ baseUrl, matterName, authUsername, authPassword, serviceCheckFn });
  const opsPack = await inspectOpsPack({
    outDir: path.join(packDir, "private-vm-ops"),
    timestamp: generatedAt,
    baseUrl,
    deploymentRoot,
    authUsername,
    authPassword,
    opsPackFn,
  });
  const recentInteractions = skipInteractions
    ? skippedSection("recent_interactions", "skipped by --skip-interactions")
    : await inspectRecentInteractions({ appDir, commandLogPath, matterName, recentInteractionsFn });

  const failedChecks = [];
  if (!serviceCheck.ok) failedChecks.push("service_check");
  if (!opsPack.ok) failedChecks.push("ops_pack");

  const result = sanitizeEvidence({
    schemaVersion: SCHEMA_VERSION,
    success: failedChecks.length === 0,
    generatedAt,
    packDir,
    baseUrl,
    failedChecks,
    issue: {
      matterName,
      note: issueNote || "(no operator note supplied)",
    },
    serviceCheck,
    opsPack,
    recentInteractions,
    operatorHandoff: buildOperatorHandoff({ serviceCheck, opsPack, recentInteractions }),
  });
  result.files = await writeBugEvidence(result);
  return result;
}

export function renderPrivateBetaBugEvidencePackResult(result = {}) {
  const lines = [
    "Matter Workbench private beta bug evidence pack",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `base_url: ${result.baseUrl || ""}`,
    `matter: ${result.issue?.matterName || ""}`,
    `service_check: ${result.serviceCheck?.ok ? "ok" : "failed"}`,
    `ops_pack: ${result.opsPack?.ok ? "ok" : "failed"}`,
    `recent_interactions: ${result.recentInteractions?.itemCount || 0}`,
  ];
  if (result.failedChecks?.length) lines.push(`failed_checks: ${result.failedChecks.join(", ")}`);
  if (result.files?.markdown) lines.push(`evidence_md: ${result.files.markdown}`);
  if (result.files?.json) lines.push(`evidence_json: ${result.files.json}`);
  if (result.opsPack?.files?.markdown) lines.push(`ops_pack_md: ${result.opsPack.files.markdown}`);
  return lines.map(redactLine);
}

async function inspectService({ baseUrl, matterName, authUsername, authPassword, serviceCheckFn }) {
  try {
    const report = await serviceCheckFn({ baseUrl, matterName, authUsername, authPassword });
    return {
      label: "service_check",
      ok: Boolean(report.passed),
      authenticated: Boolean(report.authenticated),
      runtimeDbEnabled: Boolean(report.runtimeDbEnabled),
      matterCount: report.matterCount || 0,
      targetMatter: report.targetMatter || "",
      workspaceReadable: Boolean(report.workspaceReadable),
      previewPath: report.previewPath || "",
      filePreviewReadable: Boolean(report.filePreviewReadable),
      error: report.passed ? "" : report.error || "private VM service check failed",
    };
  } catch (error) {
    return {
      label: "service_check",
      ok: false,
      error: error?.message || "private VM service check failed",
    };
  }
}

async function inspectOpsPack({ outDir, timestamp, baseUrl, deploymentRoot, authUsername, authPassword, opsPackFn }) {
  try {
    const options = {
      outDir,
      timestamp,
      baseUrl,
      authUsername,
      authPassword,
    };
    if (deploymentRoot) options.deploymentRoot = deploymentRoot;
    const report = await opsPackFn(options);
    return {
      label: "ops_pack",
      ok: Boolean(report.success),
      failedChecks: report.failedChecks || [],
      deployment: {
        currentCommit: report.deployment?.currentCommit || "",
        rollbackCandidate: report.deployment?.rollbackCandidate || "",
      },
      serviceCheck: {
        ok: Boolean(report.serviceCheck?.ok),
        runtimeDbEnabled: Boolean(report.serviceCheck?.runtimeDbEnabled),
        matterCount: report.serviceCheck?.matterCount || 0,
      },
      logs: {
        ok: Boolean(report.logs?.ok),
        lineCount: report.logs?.lineCount || 0,
      },
      disk: {
        availableBytes: report.disk?.availableBytes || 0,
      },
      files: report.files || {},
      error: report.success ? "" : report.error || "private VM ops pack failed",
    };
  } catch (error) {
    return {
      label: "ops_pack",
      ok: false,
      failedChecks: ["ops_pack_exception"],
      files: {},
      error: error?.message || "private VM ops pack failed",
    };
  }
}

async function inspectRecentInteractions({ appDir, commandLogPath, matterName, recentInteractionsFn }) {
  try {
    const items = recentInteractionsFn
      ? await recentInteractionsFn()
      : await readRecentCommandInteractions({ appDir, commandLogPath });
    const normalized = normalizeInteractions(items, { matterName });
    return {
      label: "recent_interactions",
      ok: true,
      itemCount: normalized.length,
      items: normalized,
    };
  } catch (error) {
    return {
      label: "recent_interactions",
      ok: false,
      itemCount: 0,
      items: [],
      error: error?.message || "could not read recent command interactions",
    };
  }
}

async function readRecentCommandInteractions({ appDir, commandLogPath }) {
  const service = createCommandInteractionLogService({
    appDir,
    logPath: commandLogPath || undefined,
  });
  return service.readRecentInteractions({ limit: DEFAULT_RECENT_INTERACTION_LIMIT });
}

function normalizeInteractions(items = [], { matterName = "" } = {}) {
  const values = Array.isArray(items) ? items : [];
  const filtered = matterName
    ? values.filter((item) => {
      const itemMatter = item?.matter?.matter_name || item?.matter?.matterName || "";
      return !itemMatter || itemMatter === matterName;
    })
    : values;
  return filtered.slice(-DEFAULT_RECENT_INTERACTION_LIMIT).map((item) => ({
    timestamp: item?.timestamp || "",
    matterName: item?.matter?.matter_name || item?.matter?.matterName || "",
    typedInput: item?.typed_input || item?.typedInput || "",
    matchedCommand: item?.matched_command || item?.matchedCommand || "",
    renderedState: item?.rendered_state || item?.renderedState || "",
    status: item?.status || "",
    errors: Array.isArray(item?.errors) ? item.errors.slice(0, 4) : [],
  }));
}

function buildOperatorHandoff({ serviceCheck, opsPack, recentInteractions }) {
  return {
    attach: [
      "bug-evidence-pack.md",
      "bug-evidence-pack.json",
      ...(opsPack?.files?.markdown ? [opsPack.files.markdown] : []),
      ...(opsPack?.files?.json ? [opsPack.files.json] : []),
      ...(opsPack?.files?.rollbackScript ? [opsPack.files.rollbackScript] : []),
    ],
    nextActions: [
      serviceCheck?.ok ? "Service smoke passed; inspect product-specific evidence next." : "Service smoke failed; inspect service/root/API availability first.",
      opsPack?.ok ? "Ops pack captured deployment and rollback posture." : "Ops pack failed; inspect failedChecks before treating the bundle as complete.",
      recentInteractions?.itemCount ? "Recent command interactions are included for route/UI context." : "No recent command interactions were found or included.",
      "Do not attach raw matter documents or .env files unless explicitly requested inside the trusted operator circle.",
    ],
  };
}

async function writeBugEvidence(result) {
  const jsonPath = path.join(result.packDir, "bug-evidence-pack.json");
  const markdownPath = path.join(result.packDir, "bug-evidence-pack.md");
  const evidence = toPortableEvidence(result);
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderBugEvidenceMarkdown(evidence).join("\n")}\n`, "utf8");
  return {
    json: jsonPath,
    markdown: markdownPath,
  };
}

function toPortableEvidence(result) {
  return sanitizeEvidence({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: result.generatedAt || "",
    success: Boolean(result.success),
    baseUrl: result.baseUrl || "",
    failedChecks: result.failedChecks || [],
    issue: result.issue || {},
    serviceCheck: result.serviceCheck || {},
    opsPack: result.opsPack || {},
    recentInteractions: result.recentInteractions || {},
    operatorHandoff: result.operatorHandoff || {},
  });
}

function renderBugEvidenceMarkdown(evidence = {}) {
  const lines = [
    "# Matter Workbench Private Beta Bug Evidence Pack",
    "",
    `Generated at: ${evidence.generatedAt || ""}`,
    `Success: ${evidence.success ? "yes" : "no"}`,
    `Service URL: ${evidence.baseUrl || ""}`,
    `Matter: ${evidence.issue?.matterName || "(not supplied)"}`,
    "",
    "This pack is for private beta bug handoff. It records the operator note, service smoke result, ops-pack summary, and recent command interactions. It avoids raw source-document bodies and redacts common secret shapes.",
    "",
    "## Issue",
    "",
    evidence.issue?.note || "(no operator note supplied)",
    "",
    "## Health Snapshot",
    "",
    `- Service check: ${evidence.serviceCheck?.ok ? "ok" : "failed"}`,
    `- Authenticated: ${evidence.serviceCheck?.authenticated ? "yes" : "no"}`,
    `- Runtime DB enabled: ${evidence.serviceCheck?.runtimeDbEnabled ? "yes" : "no"}`,
    `- Matters visible: ${evidence.serviceCheck?.matterCount || 0}`,
    `- Target matter: ${evidence.serviceCheck?.targetMatter || "(none)"}`,
    `- Preview path: ${evidence.serviceCheck?.previewPath || "(none)"}`,
    `- Ops pack: ${evidence.opsPack?.ok ? "ok" : "failed"}`,
    `- Current deployment: ${evidence.opsPack?.deployment?.currentCommit || "(unknown)"}`,
    `- Rollback candidate: ${evidence.opsPack?.deployment?.rollbackCandidate || "(none)"}`,
    "",
    "## Recent Command Interactions",
    "",
  ];
  const interactions = evidence.recentInteractions?.items || [];
  if (!interactions.length) {
    lines.push("- No recent command interactions captured.");
  } else {
    for (const item of interactions) {
      const parts = [
        item.timestamp || "(no timestamp)",
        item.matterName ? `matter=${item.matterName}` : "",
        item.matchedCommand ? `command=${item.matchedCommand}` : "",
        item.status ? `status=${item.status}` : "",
        item.typedInput ? `input=${item.typedInput}` : "",
      ].filter(Boolean);
      lines.push(`- ${parts.join(" | ")}`);
    }
  }
  lines.push("", "## What To Attach", "");
  for (const item of evidence.operatorHandoff?.attach || []) lines.push(`- ${item}`);
  lines.push("", "## Operator Next Actions", "");
  for (const item of evidence.operatorHandoff?.nextActions || []) lines.push(`- ${item}`);
  if (evidence.failedChecks?.length) {
    lines.push("", "## Failed Checks", "");
    for (const check of evidence.failedChecks) lines.push(`- ${check}`);
  }
  return lines.map(redactLine);
}

function skippedSection(label, reason) {
  return {
    label,
    ok: true,
    skipped: true,
    reason,
    itemCount: 0,
    items: [],
  };
}

function sanitizeEvidence(value) {
  return redactPortableValue(value);
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

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${arg} requires a value`);
  return value;
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

async function main() {
  const args = parseBugEvidencePackArgs(process.argv.slice(2));
  const result = await runPrivateBetaBugEvidencePack(args);
  for (const line of renderPrivateBetaBugEvidencePackResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.message));
    process.exitCode = 1;
  });
}
