import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeStoredSkill } from "./configurable-skill-definition.mjs";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const CONFIGURABLE_SKILLS_SCHEMA_VERSION = "configurable-skills/v1";

export function createConfigurableSkillStore({ appDir, skillsPath } = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = skillsPath || path.join(root, "configurable-skills.json");
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: serializeStore,
  });

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
    await persistence.writeStoreFile(store);
  }

  async function updateStore(mutator) {
    return persistence.withStoreMutation(async () => {
      const store = await readStore();
      const result = await mutator(store);
      await writeStore(store);
      return result;
    });
  }

  return {
    readStore,
    storePath,
    updateStore,
    writeStore,
  };
}

function serializeStore(store) {
  return formatJsonStore({
    schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
    skills: store.skills.map(normalizeStoredSkill),
  });
}
