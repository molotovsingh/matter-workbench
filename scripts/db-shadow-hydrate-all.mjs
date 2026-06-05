#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";

const __filename = fileURLToPath(import.meta.url);

const STEPS = {
  "dry-run": [
    "db:hydrate:dry-run",
    "db:skills:hydrate:dry-run",
    "db:advisory:hydrate:dry-run",
    "db:storage:hydrate:dry-run",
    "db:provider-runs:hydrate:dry-run",
    "db:jobs:hydrate:dry-run",
    "db:costs:hydrate:dry-run",
    "db:audit:hydrate:dry-run",
  ],
  apply: [
    "db:hydrate",
    "db:skills:hydrate",
    "db:advisory:hydrate",
    "db:storage:hydrate",
    "db:provider-runs:hydrate",
    "db:jobs:hydrate",
    "db:costs:hydrate",
    "db:audit:hydrate",
    "db:shadow:report",
  ],
  verify: [
    "db:hydrate:verify",
    "db:skills:hydrate:verify",
    "db:advisory:hydrate:verify",
    "db:storage:hydrate:verify",
    "db:provider-runs:hydrate:verify",
    "db:jobs:hydrate:verify",
    "db:costs:hydrate:verify",
    "db:audit:hydrate:verify",
    "db:shadow:report",
  ],
};

export function parseArgs(argv = []) {
  const parsed = { mode: "dry-run", json: false };

  for (const arg of argv) {
    if (arg === "--dry-run") parsed.mode = "dry-run";
    else if (arg === "--apply") parsed.mode = "apply";
    else if (arg === "--verify") parsed.mode = "verify";
    else if (arg === "--json") parsed.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

export function runShadowHydrationPipeline({
  args = { mode: "dry-run" },
  databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "",
  spawn = spawnSync,
} = {}) {
  const mode = args.mode || "dry-run";
  const scripts = STEPS[mode];
  if (!scripts) throw new Error(`Unknown shadow hydration mode: ${mode}`);
  if (mode !== "dry-run" && !databaseUrl) {
    throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before running shadow hydration apply/verify.");
  }

  const steps = [];
  const env = mode === "dry-run"
    ? { ...process.env }
    : { ...process.env, MWB_DATABASE_URL: databaseUrl };

  if (mode !== "dry-run") {
    const doctor = runNpmScript("db:doctor", { spawn, env });
    const readyToHydrate = /\bready_to_hydrate:\s*yes\b/i.test(doctor.stdout);
    const doctorStep = buildStep({
      script: "db:doctor",
      result: doctor.result,
      okOverride: readyToHydrate,
      fallbackError: "shadow database is not ready to hydrate; run db:migrate first",
    });
    steps.push(doctorStep);
    if (!doctorStep.ok) {
      return {
        mode,
        success: false,
        steps,
        failedStep: doctorStep,
      };
    }
  }

  for (const script of scripts) {
    const { result } = runNpmScript(script, { spawn, env });
    const step = buildStep({ script, result });
    steps.push(step);

    if (!step.ok) {
      return {
        mode,
        success: false,
        steps,
        failedStep: step,
      };
    }
  }

  return {
    mode,
    success: true,
    steps,
    failedStep: null,
  };
}

function runNpmScript(script, { spawn, env }) {
  const result = spawn("npm", ["run", script, "--silent"], {
    encoding: "utf8",
    env,
  });
  return {
    result,
    stdout: String(result.stdout || ""),
  };
}

function buildStep({ script, result, okOverride, fallbackError = "" }) {
  const ok = !result.error && Number(result.status) === 0 && (okOverride === undefined || okOverride);
  const step = {
    script,
    status: Number(result.status) || 0,
    ok,
  };
  if (result.error) step.error = redactSecret(result.error.message);
  else if (!ok && fallbackError) step.error = redactSecret(fallbackError);
  if (!ok) {
    const stdout = compactOutput(result.stdout);
    const stderr = compactOutput(result.stderr);
    if (stdout) step.stdout = stdout;
    if (stderr) step.stderr = stderr;
  }
  return step;
}

export function renderShadowHydrationPipelineResult(result = {}) {
  const lines = [
    "Matter Workbench shadow DB hydration pipeline",
    `mode: ${result.mode || "dry-run"}`,
    `success: ${result.success ? "yes" : "no"}`,
    "steps:",
  ];
  for (const step of result.steps || []) {
    lines.push(`  ${step.script}: ${step.ok ? "ok" : "failed"}`);
    if (!step.ok && step.stdout) lines.push(`    stdout: ${step.stdout}`);
    if (!step.ok && step.stderr) lines.push(`    stderr: ${step.stderr}`);
    if (!step.ok && step.error) lines.push(`    error: ${step.error}`);
  }
  if (result.failedStep) lines.push(`failed_step: ${result.failedStep.script}`);
  return lines;
}

function compactOutput(value) {
  return redactSecret(String(value || "").trim().replace(/\s+/g, " ")).slice(0, 500);
}

function redactSecret(value) {
  const locallyRedacted = String(value || "")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@([^/\s]+)\/[^\s]+/g, "postgres://$1:***@$3")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@")
    .replace(/secret/gi, "***");
  return redactSensitiveText(locallyRedacted);
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseArgs(process.argv.slice(2));
  const result = runShadowHydrationPipeline({ args });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else for (const line of renderShadowHydrationPipelineResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactSecret(error.message));
    process.exitCode = 1;
  });
}
