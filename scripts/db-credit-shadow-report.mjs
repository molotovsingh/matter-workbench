#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { collectLocalProviderRunHydrationPlan } from "./db-hydrate-local-provider-runs.mjs";
import { buildShadowCostEventPlan } from "./db-hydrate-local-cost-events.mjs";
import { defaultMattersHome } from "./db-hydrate-local-matters.mjs";
import {
  buildShadowCreditPlan,
  renderShadowCreditReport,
  shadowCreditReportFromPlan,
} from "../services/credit-shadow-planner.mjs";

const __filename = fileURLToPath(import.meta.url);

export function parseArgs(argv = []) {
  const parsed = {
    json: false,
    appDir: process.cwd(),
    mattersHome: defaultMattersHome(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      parsed.json = true;
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
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function collectShadowCreditReportPlan({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
} = {}) {
  const providerRunPlan = await collectLocalProviderRunHydrationPlan({ appDir, mattersHome });
  const costEventPlan = buildShadowCostEventPlan({ providerRunPlan, appDir, mattersHome });
  return buildShadowCreditPlan({ providerRunPlan, costEventPlan, appDir, mattersHome });
}

export async function runCreditShadowReport(options = {}) {
  const plan = await collectShadowCreditReportPlan(options);
  return {
    plan,
    report: shadowCreditReportFromPlan(plan),
    text: renderShadowCreditReport(plan),
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runCreditShadowReport(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    } else {
      process.stdout.write(`${result.text}\n`);
    }
  } catch (error) {
    process.stderr.write(`[db-credit-shadow-report] ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  await main();
}
