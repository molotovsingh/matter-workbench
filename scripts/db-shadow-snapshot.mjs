#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  buildShadowDbReport,
  renderShadowDbReport,
} from "./db-shadow-report.mjs";
import { defaultMattersHome } from "./db-hydrate-local-matters.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "shadow-db-snapshot/v1";

export function parseArgs(argv = []) {
  const parsed = {
    json: false,
    outDir: path.resolve("docs/shadow-db-snapshots"),
    timestamp: "",
    appDir: process.cwd(),
    mattersHome: defaultMattersHome(),
    matterQuery: "",
    slashQuery: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a value");
      parsed.outDir = path.resolve(value);
      i += 1;
    } else if (arg === "--timestamp") {
      const value = argv[i + 1];
      if (!value) throw new Error("--timestamp requires a value");
      parsed.timestamp = value;
      i += 1;
    } else if (arg === "--app-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--app-dir requires a value");
      parsed.appDir = path.resolve(value);
      i += 1;
    } else if (arg === "--matters-home") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matters-home requires a value");
      parsed.mattersHome = path.resolve(value);
      i += 1;
    } else if (arg === "--matter") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matter requires a value");
      parsed.matterQuery = value;
      i += 1;
    } else if (arg === "--slash") {
      const value = argv[i + 1];
      if (!value) throw new Error("--slash requires a value");
      parsed.slashQuery = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function createShadowDbSnapshot({
  databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "",
  outDir = path.resolve("docs/shadow-db-snapshots"),
  timestamp = "",
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
  matterQuery = "",
  slashQuery = "",
  buildReport = buildShadowDbReport,
  renderReport = renderShadowDbReport,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before creating a shadow DB snapshot.");

  const generatedAt = normalizeTimestamp(timestamp);
  const report = await buildReport({
    databaseUrl,
    appDir,
    mattersHome,
    matterQuery,
    slashQuery,
  });
  const reportLines = renderReport(report).map((line) => redactSecret(line));
  const matched = Boolean(report.matched);
  const safeOutDir = path.resolve(outDir);
  const basename = `shadow-db-snapshot-${timestampSlug(generatedAt)}`;
  const markdownPath = path.join(safeOutDir, `${basename}.md`);
  const jsonPath = path.join(safeOutDir, `${basename}.json`);
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    matched,
    filters: {
      matter: matterQuery || "",
      slash: slashQuery || "",
    },
    reportLines,
    files: {
      markdown: markdownPath,
      json: jsonPath,
    },
  };

  await mkdir(safeOutDir, { recursive: true });
  await writeFile(markdownPath, renderShadowDbSnapshotMarkdown(snapshot), "utf8");
  await writeFile(jsonPath, `${JSON.stringify(toPortableSnapshot(snapshot), null, 2)}\n`, "utf8");

  return snapshot;
}

export function renderShadowDbSnapshotMarkdown(snapshot = {}) {
  const lines = [
    "# Matter Workbench Shadow DB Snapshot",
    "",
    `Generated at: ${snapshot.generatedAt || ""}`,
    `Matched: ${snapshot.matched ? "yes" : "no"}`,
  ];
  const matterFilter = snapshot.filters?.matter || "";
  const slashFilter = snapshot.filters?.slash || "";
  if (matterFilter || slashFilter) {
    lines.push(`Filters: matter=${matterFilter || "(none)"}; slash=${slashFilter || "(none)"}`);
  }
  lines.push(
    "",
    "This is a shadow-database handoff artifact. It records what the PostgreSQL control-plane mirror currently reports, without changing Matter Workbench runtime storage.",
    "",
    "```text",
    ...(snapshot.reportLines || []),
    "```",
    "",
  );
  return redactSecret(lines.join("\n"));
}

function normalizeTimestamp(timestamp) {
  const value = timestamp || new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${timestamp}`);
  return date.toISOString();
}

function timestampSlug(timestamp) {
  return timestamp.replace(/[:.]/g, "-");
}

function toPortableSnapshot(snapshot) {
  return {
    ...snapshot,
    files: {
      markdown: path.basename(snapshot.files?.markdown || ""),
      json: path.basename(snapshot.files?.json || ""),
    },
  };
}

function redactSecret(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/secret/gi, "***");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
  const snapshot = await createShadowDbSnapshot({
    databaseUrl,
    outDir: args.outDir,
    timestamp: args.timestamp,
    appDir: args.appDir,
    mattersHome: args.mattersHome,
    matterQuery: args.matterQuery,
    slashQuery: args.slashQuery,
  });

  if (args.json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log("Matter Workbench shadow DB snapshot");
    console.log(`matched: ${snapshot.matched ? "yes" : "no"}`);
    console.log(`markdown: ${snapshot.files.markdown}`);
    console.log(`json: ${snapshot.files.json}`);
  }
  if (!snapshot.matched) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactSecret(error.message));
    process.exitCode = 1;
  });
}
