#!/usr/bin/env node
import process from "node:process";

import { createMothershipServer } from "../mothership/server.mjs";
import { createMothershipStore, createPostgresMothershipDatabase } from "../mothership/store.mjs";
import { loadMothershipScriptEnv } from "./mothership-env.mjs";

export async function startMothershipServer({ env = process.env, log = console } = {}) {
  await loadMothershipScriptEnv({ targetEnv: env, override: false });
  const host = String(env.MOTHERSHIP_HOST || "127.0.0.1");
  const port = parsePort(env.MOTHERSHIP_PORT || 4192);
  const database = await createPostgresMothershipDatabase({ connectionString: env.MOTHERSHIP_DATABASE_URL });
  const store = createMothershipStore({ database });
  const app = createMothershipServer({ store, log });

  await new Promise((resolve) => app.server.listen(port, host, resolve));
  log.log(`Matter Workbench mothership listening on http://${host}:${port}/`);

  const close = () => {
    app.server.close(async () => {
      await database.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  return { ...app, database, host, port };
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MOTHERSHIP_PORT must be an integer from 1 to 65535");
  return port;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMothershipServer().catch((error) => {
    console.error(String(error?.message || error).replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@"));
    process.exitCode = 1;
  });
}
