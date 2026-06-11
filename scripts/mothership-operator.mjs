#!/usr/bin/env node
import process from "node:process";

import { buildMothershipReport, renderMothershipReportMarkdown } from "../mothership/report.mjs";
import { createMothershipStore, createPostgresMothershipDatabase } from "../mothership/store.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";

export function parseMothershipOperatorArgs(argv = []) {
  const parts = [...argv];
  let command = parts.shift() || "help";
  if (command === "installations") command = `installations:${parts.shift() || ""}`;
  const options = {};
  for (let index = 0; index < parts.length; index += 1) {
    const arg = parts[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (/password|token|secret/i.test(key)) throw new Error("Mothership operator does not accept secrets through command arguments.");
    const value = parts[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

export async function runMothershipOperator({
  argv = process.argv.slice(2),
  store,
  stdout = (line) => console.log(line),
  stderr = (line) => console.error(line),
  env = process.env,
} = {}) {
  let database;
  try {
    const parsed = parseMothershipOperatorArgs(argv);
    if (!store) {
      await loadDatabaseScriptEnv({ targetEnv: env, override: false });
      database = await createPostgresMothershipDatabase({ connectionString: env.MOTHERSHIP_DATABASE_URL });
      store = createMothershipStore({ database });
    }
    if (parsed.command === "installations:create") {
      const result = await store.registerInstallation({
        installationId: requireOption(parsed.options, "id"),
        label: requireOption(parsed.options, "label"),
      });
      stdout(`Created installation ${result.installationId}.`);
      stdout("Ingestion token (shown once):");
      stdout(result.rawToken);
    } else if (parsed.command === "installations:revoke") {
      const installationId = requireOption(parsed.options, "id");
      const revoked = await store.revokeInstallation({ installationId });
      if (!revoked) throw new Error(`No active installation found for ${installationId}.`);
      stdout(`Revoked installation ${installationId}.`);
    } else if (parsed.command === "health") {
      const health = await store.health();
      stdout(`database: ${health.database}`);
    } else if (parsed.command === "prune") {
      const retentionDays = positiveInteger(parsed.options["retention-days"], 180);
      const result = await store.pruneExpired({ retentionDays });
      stdout(`retention_days: ${result.retentionDays}`);
      stdout(`feedback_deleted: ${result.feedbackDeleted}`);
      stdout(`signals_deleted: ${result.signalsDeleted}`);
      stdout(`metrics_deleted: ${result.metricsDeleted || 0}`);
    } else if (parsed.command === "report") {
      const sinceDays = positiveInteger(parsed.options["since-days"], 30);
      const dataset = await store.queryReport({ sinceDays });
      const report = buildMothershipReport(dataset);
      stdout(parsed.options.format === "json" ? JSON.stringify(report, null, 2) : renderMothershipReportMarkdown(report).trimEnd());
    } else {
      stdout(usage());
    }
    return 0;
  } catch (error) {
    stderr(redactOperatorError(error?.message || error));
    return 1;
  } finally {
    await database?.close?.();
  }
}

function requireOption(options, key) {
  const value = String(options[key] || "").trim();
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function redactOperatorError(value) {
  return String(value || "Mothership operator failed")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/gi, "postgres://$1:***@")
    .replace(/\bmwb_ing_[A-Za-z0-9_-]+/gi, "mwb_ing_[redacted-secret]")
    .slice(0, 500);
}

function usage() {
  return [
    "Mothership operator",
    "  installations create --id <id> --label <label>",
    "  installations revoke --id <id>",
    "  health",
    "  report [--since-days 30] [--format markdown|json]",
    "  prune [--retention-days 180]",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runMothershipOperator();
}
