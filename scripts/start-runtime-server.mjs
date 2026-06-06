#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";

import { createWorkbenchServer } from "../server.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";

const __filename = fileURLToPath(import.meta.url);

export function parseRuntimeServerArgs(argv = [], env = process.env) {
  const parsed = {
    host: env.MWB_HOST || "0.0.0.0",
    port: Number(env.PORT || 4191),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") {
      const value = argv[i + 1];
      if (!value) throw new Error("--host requires a value");
      parsed.host = value;
      i += 1;
    } else if (arg === "--port") {
      const value = argv[i + 1];
      if (!value) throw new Error("--port requires a value");
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer from 1 to 65535");
      parsed.port = port;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export function applyPrivateVmRuntimeDefaults(env = process.env) {
  if (!env.MWB_RUNTIME_DB) env.MWB_RUNTIME_DB = "postgres";
  if (!env.MWB_RUNTIME_DB_STORAGE) env.MWB_RUNTIME_DB_STORAGE = "postgres";
  if (!env.MWB_DB_RUNTIME_CUTOVER_APPROVED) env.MWB_DB_RUNTIME_CUTOVER_APPROVED = "yes";
  return env;
}

export async function startRuntimeServer({
  argv = process.argv.slice(2),
  env = process.env,
  createServer = createWorkbenchServer,
  loadEnv = loadDatabaseScriptEnv,
  log = console.log,
} = {}) {
  await loadEnv({ targetEnv: env, override: false });
  applyPrivateVmRuntimeDefaults(env);
  const args = parseRuntimeServerArgs(argv, env);
  const app = await createServer({ env, host: args.host, port: args.port });

  await new Promise((resolve) => app.server.listen(args.port, args.host, resolve));
  const address = app.server.address();
  log(`Matter Workbench runtime server listening on http://${args.host}:${address.port}/`);

  const close = () => {
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);

  return app;
}

if (process.argv[1] === __filename) {
  startRuntimeServer().catch((error) => {
    console.error(redactRuntimeServerLine(error.message));
    process.exitCode = 1;
  });
}

function redactRuntimeServerLine(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***");
}

