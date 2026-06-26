import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeStoredSkill } from "./configurable-skill-definition.mjs";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import { isStoreReplacement } from "../shared/store-mutation.mjs";
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
    let raw;
    try {
      raw = await readFile(storePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION, skills: [] };
      }
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw makeHttpError(`Invalid configurable skills JSON at ${storePath}`, 500, "configurable_skill_store.invalid_json");
    }
    if (parsed?.schema_version !== CONFIGURABLE_SKILLS_SCHEMA_VERSION) {
      throw makeHttpError(`Invalid configurable skills schema at ${storePath}`, 500, "configurable_skill_store.invalid_schema");
    }
    if (!Array.isArray(parsed.skills)) {
      throw makeHttpError(`Invalid configurable skills store at ${storePath}`, 500, "configurable_skill_store.invalid_store");
    }
    return {
      schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION,
      skills: parsed.skills.map(normalizeStoredSkill),
    };
  }

  async function writeStore(store) {
    await persistence.writeStoreFile(store);
  }

  async function updateStore(mutator, options = {}) {
    return persistence.withStoreMutation(async () => {
      const store = await readStore();
      const result = await mutator(store);
      const nextStore = isStoreReplacement(result) ? result : store;
      await writeStore(nextStore);
      if (typeof options.afterWrite === "function") {
        await options.afterWrite({ result, store: nextStore });
      }
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
