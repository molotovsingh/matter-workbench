import process from "node:process";

import { loadLocalEnv } from "../shared/local-env.mjs";

export async function loadDatabaseScriptEnv({
  appDir = process.cwd(),
  targetEnv = process.env,
  override = false,
} = {}) {
  return loadLocalEnv({ appDir, targetEnv, override });
}
