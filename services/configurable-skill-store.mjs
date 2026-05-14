import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeStoredSkill } from "./configurable-skill-definition.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const CONFIGURABLE_SKILLS_SCHEMA_VERSION = "configurable-skills/v1";

export function createConfigurableSkillStore({ appDir, skillsPath } = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = skillsPath || path.join(root, "configurable-skills.json");

  async function readStore() {
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8"));
      if (parsed?.schema_version !== CONFIGURABLE_SKILLS_SCHEMA_VERSION || !Array.isArray(parsed.skills)) {
        throw makeHttpError(`Invalid configurable skills store at ${storePath}`, 500);
      }
      return {
        schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
        skills: parsed.skills.map(normalizeStoredSkill),
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION, skills: [] };
      }
      throw error;
    }
  }

  async function writeStore(store) {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, `${JSON.stringify({
      schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
      skills: store.skills.map(normalizeStoredSkill),
    }, null, 2)}\n`);
  }

  return {
    readStore,
    storePath,
    writeStore,
  };
}
