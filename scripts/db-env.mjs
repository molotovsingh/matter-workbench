import process from "node:process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadLocalEnv, parseEnvText } from "../shared/local-env.mjs";

export async function loadDatabaseScriptEnv({
  appDir = process.cwd(),
  targetEnv = process.env,
  override = false,
} = {}) {
  const loaded = await loadLocalEnv({ appDir, targetEnv, override });
  const shadowLoaded = await loadShadowEnv({ appDir, targetEnv, override });
  return {
    env: targetEnv,
    loadedKeys: [...new Set([...loaded.loadedKeys, ...shadowLoaded.loadedKeys])],
    loadedPaths: [...loaded.loadedPaths, ...shadowLoaded.loadedPaths],
  };
}

async function loadShadowEnv({ appDir, targetEnv, override }) {
  const root = path.resolve(appDir || process.cwd());
  const candidatePaths = [...new Set([
    path.join(path.dirname(root), ".env.shadow"),
    path.join(root, ".env.shadow"),
  ])];
  const loaded = {};
  const loadedPaths = [];

  for (const envPath of candidatePaths) {
    try {
      Object.assign(loaded, parseEnvText(await readFile(envPath, "utf8")));
      loadedPaths.push(envPath);
    } catch {
      // Missing shadow env files are fine; shell variables and .env still work.
    }
  }

  for (const [key, value] of Object.entries(loaded)) {
    if (override || targetEnv[key] === undefined) targetEnv[key] = value;
  }

  return {
    loadedKeys: Object.keys(loaded),
    loadedPaths,
  };
}
