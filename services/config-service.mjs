import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function createConfigService({ appDir, env = process.env } = {}) {
  if (!appDir) throw new Error("appDir is required");

  const configPath = path.join(appDir, "config.json");
  const defaultMattersHome = path.join(os.homedir(), "Documents", "Matter Workbench");
  let mattersHome = env.MATTERS_HOME ? path.resolve(env.MATTERS_HOME) : null;

  async function load() {
    if (mattersHome) return;
    try {
      const loaded = JSON.parse(await readFile(configPath, "utf8"));
      if (loaded && typeof loaded.mattersHome === "string") {
        mattersHome = path.resolve(loaded.mattersHome);
      }
    } catch {
      // First-run flow handles missing config.
    }
  }

  async function save() {
    await writeFile(configPath, `${JSON.stringify({ mattersHome }, null, 2)}\n`);
  }

  async function setMattersHome(rawValue) {
    if (!rawValue || typeof rawValue !== "string") {
      const error = new Error("mattersHome is required");
      error.statusCode = 400;
      throw error;
    }
    const resolved = path.resolve(rawValue.replace(/^~(?=$|\/|\\)/, os.homedir()));
    await mkdir(resolved, { recursive: true });
    const homeChanged = resolved !== mattersHome;
    mattersHome = resolved;
    await save();
    return { mattersHome, homeChanged };
  }

  return {
    configPath,
    defaultMattersHome,
    load,
    save,
    setMattersHome,
    getMattersHome: () => mattersHome,
  };
}
