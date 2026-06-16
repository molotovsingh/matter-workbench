#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { createAiSettingsService } from "../services/ai-settings-service.mjs";
import { createCommandInteractionLogService } from "../services/command-interaction-log-service.mjs";
import { createConfigService } from "../services/config-service.mjs";
import { createJobStatusService } from "../services/job-status-service.mjs";
import { createMatterStore } from "../services/matter-store.mjs";
import { createRuntimeDbMatterIndex } from "../services/runtime-db-matter-index.mjs";
import { createRuntimeDbStorageService } from "../services/runtime-db-storage-service.mjs";
import { runtimeDatabaseUrl } from "../services/runtime-db-config.mjs";
import {
  createSystemHealthService,
  SYSTEM_HEALTH_SCHEMA_VERSION,
} from "../services/system-health-service.mjs";
import { loadLocalEnv } from "../shared/local-env.mjs";

const __filename = fileURLToPath(import.meta.url);

export function parseSystemHealthReportArgs(argv = []) {
  const parsed = {
    json: false,
    appDir: process.cwd(),
    recentLimit: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--app-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--app-dir requires a value");
      parsed.appDir = path.resolve(value);
      index += 1;
    } else if (arg === "--limit") {
      const value = argv[index + 1];
      if (!value) throw new Error("--limit requires a value");
      const number = Number(value);
      if (!Number.isInteger(number) || number <= 0) throw new Error("--limit must be a positive integer");
      parsed.recentLimit = number;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return parsed;
}

export async function readSystemHealthReport({
  appDir = process.cwd(),
  recentLimit,
  env: providedEnv,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const env = providedEnv || (await loadLocalEnv({ appDir: root, override: true })).env;
  const configService = createConfigService({ appDir: root, env });
  await configService.load();
  const runtimeMatterIndex = createRuntimeDbMatterIndex({ env });
  const matterStore = createMatterStore({
    configService,
    initialMatterRoot: env.MATTER_ROOT || null,
    runtimeMatterIndex,
  });
  const runtimeDbStorageService = createRuntimeDbStorageService({
    databaseUrl: runtimeDatabaseUrl(env),
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const systemHealthService = createSystemHealthService({
    appDir: root,
    aiSettingsService: createAiSettingsService({ appDir: root, env }),
    commandInteractionLogService: createCommandInteractionLogService({ appDir: root }),
    configService,
    env,
    jobStatusService: createJobStatusService({ appDir: root }),
    matterStore,
    runtimeDbStorageService,
  });
  return systemHealthService.readSystemHealth({ recentLimit });
}

export function renderSystemHealthReport(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "Matter Workbench system health",
    `schema: ${report.schema_version || SYSTEM_HEALTH_SCHEMA_VERSION}`,
    `generated: ${report.generatedAt || ""}`,
    `status: ${report.status || "unknown"}`,
    `storage_mode: ${report.runtime?.storageMode || "unknown"}`,
    `node: ${report.runtime?.nodeVersion || ""}`,
    "summary:",
    `  ok: ${summary.ok || 0}`,
    `  warnings: ${summary.warning || 0}`,
    `  errors: ${summary.error || 0}`,
    "checks:",
  ];
  for (const item of report.checks || []) {
    lines.push(`  [${item.status}] ${item.id}: ${item.message || item.label || ""}`);
    if (item.recommendation) lines.push(`    recommendation: ${item.recommendation}`);
  }
  if (report.recommendations?.length) {
    lines.push("recommendations:");
    for (const recommendation of report.recommendations) lines.push(`  - ${recommendation}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  try {
    const options = parseSystemHealthReportArgs(process.argv.slice(2));
    const report = await readSystemHealthReport(options);
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(renderSystemHealthReport(report));
    if (report.status === "error") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`[system-health-report] ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  await main();
}
