import os from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEnvText } from "../shared/local-env.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";

export async function loadMothershipScriptEnv({
  appDir = process.cwd(),
  targetEnv = process.env,
  override = false,
  homeDir = targetEnv.HOME || os.homedir(),
} = {}) {
  const loaded = await loadDatabaseScriptEnv({ appDir, targetEnv, override });
  const mothershipLoaded = await loadMothershipEnv({ targetEnv, override, homeDir });
  return {
    env: targetEnv,
    loadedKeys: [...new Set([...loaded.loadedKeys, ...mothershipLoaded.loadedKeys])],
    loadedPaths: [...loaded.loadedPaths, ...mothershipLoaded.loadedPaths],
  };
}

async function loadMothershipEnv({ targetEnv, override, homeDir }) {
  const envPath = String(targetEnv.MOTHERSHIP_ENV_PATH || "").trim()
    || path.join(path.resolve(homeDir || os.homedir()), ".config", "matter-workbench", "mothership.env");
  const loaded = {};
  const loadedPaths = [];

  try {
    Object.assign(loaded, parseEnvText(await readFile(envPath, "utf8")));
    loadedPaths.push(envPath);
  } catch {
    // Missing mothership env files are fine; explicit env vars and .env still work.
  }

  for (const [key, value] of Object.entries(loaded)) {
    if (override || targetEnv[key] === undefined) targetEnv[key] = value;
  }

  return {
    loadedKeys: Object.keys(loaded),
    loadedPaths,
  };
}
