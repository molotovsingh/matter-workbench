#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkbenchServer } from "../server.mjs";

export const MATTER_ATTENTION_REPORT_SCHEMA_VERSION = "matter-attention-report/v1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

export async function buildMatterAttentionReport(options = {}) {
  const appDir = path.resolve(options.appDir || process.env.MATTER_WORKBENCH_APP_DIR || repoRoot);
  const env = { ...process.env, ...(options.env || {}) };
  if (options.mattersHome) env.MATTERS_HOME = options.mattersHome;

  const app = await createWorkbenchServer({
    appDir,
    env,
    host: "127.0.0.1",
    port: 0,
  });
  const { matterStore, matterAttentionService } = app.services;
  const mattersHome = matterStore.getMattersHome();
  if (!mattersHome) {
    const error = new Error("Matters home is not configured. Pass --matters-home or set MATTERS_HOME.");
    error.exitCode = 1;
    throw error;
  }

  const selectedMatter = normalizeText(options.matter);
  const matters = selectedMatter
    ? [{ name: selectedMatter }]
    : await matterStore.listMattersHomeChildren();
  const reports = [];
  for (const matter of matters) {
    const rawName = matter.name;
    try {
      const { name, matterPath } = matterStore.matterPathForName(rawName);
      reports.push(await matterAttentionService.readMatterAttention(matterPath, { matterName: name }));
    } catch (error) {
      reports.push(failedMatterReport(rawName, error));
    }
  }

  const filteredReports = options.onlyProblems
    ? reports.filter((report) => report.summary.total > 0)
    : reports;
  return {
    schema_version: MATTER_ATTENTION_REPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mattersHome,
    summary: summarizeReports(reports),
    matters: filteredReports,
  };
}

export function formatMatterAttentionReport(report) {
  const lines = [
    "Matter Attention Report",
    `Matters home: ${report.mattersHome}`,
    `Summary: ${report.summary.matters} matter(s), ${report.summary.blocked} blocked, ${report.summary.attention_needed} need attention, ${report.summary.clear} clear, ${report.summary.blocker} blocker(s), ${report.summary.warning} warning(s)`,
    "",
  ];

  if (!report.matters.length) {
    lines.push("No matters to report.");
    return lines.join("\n");
  }

  for (const matter of report.matters) {
    lines.push(`${matterHeading(matter)} ${matter.matterName}`);
    lines.push(`  ${matter.summary.total} item(s): ${matter.summary.blocker} blocker(s), ${matter.summary.warning} warning(s), ${matter.summary.info} info`);
    if (!matter.items.length) {
      lines.push("  No developer attention items.");
      lines.push("");
      continue;
    }
    for (const item of matter.items) {
      lines.push(`  - [${item.severity}] ${item.code}: ${item.title}`);
      if (item.detail) lines.push(`    ${item.detail}`);
      if (item.action) lines.push(`    Action: ${item.action}`);
      const evidence = formatEvidence(item.evidence);
      if (evidence) lines.push(`    Evidence: ${evidence}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function parseArgs(argv) {
  const options = {
    appDir: "",
    json: false,
    matter: "",
    mattersHome: "",
    onlyProblems: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--only-problems") {
      options.onlyProblems = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--app-dir") {
      options.appDir = requireValue(argv, ++index, arg);
    } else if (arg === "--matters-home") {
      options.mattersHome = requireValue(argv, ++index, arg);
    } else if (arg === "--matter") {
      options.matter = requireValue(argv, ++index, arg);
    } else {
      const error = new Error(`Unknown option: ${arg}`);
      error.exitCode = 1;
      throw error;
    }
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    const error = new Error(`${flag} requires a value`);
    error.exitCode = 1;
    throw error;
  }
  return value;
}

function summarizeReports(reports) {
  const summary = {
    matters: reports.length,
    blocked: 0,
    attention_needed: 0,
    clear: 0,
    blocker: 0,
    warning: 0,
    info: 0,
  };
  for (const report of reports) {
    if (Object.hasOwn(summary, report.summary.state)) summary[report.summary.state] += 1;
    summary.blocker += report.summary.blocker || 0;
    summary.warning += report.summary.warning || 0;
    summary.info += report.summary.info || 0;
  }
  return summary;
}

function matterHeading(matter) {
  if (matter.summary.state === "blocked") return "BLOCKED";
  if (matter.summary.state === "attention_needed") return "ATTENTION";
  return "CLEAR";
}

function formatEvidence(evidence = []) {
  return evidence
    .slice(0, 3)
    .map((entry) => {
      const parts = [entry.path, entry.row, entry.status, entry.runId, entry.source_id]
        .map(normalizeText)
        .filter(Boolean);
      return parts.join(" ");
    })
    .filter(Boolean)
    .join("; ");
}

function failedMatterReport(name, error) {
  return {
    schema_version: "matter-attention/v1",
    generated_at: new Date().toISOString(),
    matterName: normalizeText(name) || "Unknown matter",
    matterRoot: "",
    summary: {
      total: 1,
      blocker: 1,
      warning: 0,
      info: 0,
      state: "blocked",
    },
    items: [
      {
        id: "matter-attention-read-failed",
        severity: "blocker",
        category: "developer",
        code: "matter_attention_read_failed",
        title: "Matter attention could not be read",
        detail: error?.message || "Unknown error",
        action: "Inspect the matter folder and attention service.",
        evidence: [],
        occurredAt: "",
      },
    ],
  };
}

function printHelp() {
  console.log([
    "Usage: npm run matter-attention:report -- [options]",
    "",
    "Options:",
    "  --matter <name>        Inspect one matter by folder name.",
    "  --matters-home <path>  Override configured matters home.",
    "  --app-dir <path>       Override app directory for config and local ledgers.",
    "  --only-problems        Hide clear matters in the report body.",
    "  --json                 Print machine-readable JSON.",
    "  --help                 Show this help.",
  ].join("\n"));
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await buildMatterAttentionReport(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatMatterAttentionReport(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = error?.exitCode || 1;
  });
}
