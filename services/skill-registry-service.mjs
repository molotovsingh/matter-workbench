import { readFile } from "node:fs/promises";
import path from "node:path";

const CATEGORY_SET = new Set([
  "Ingest",
  "Extract",
  "Organize",
  "Analyze",
  "Draft",
  "Review",
  "Export",
  "Maintain",
]);

export function createSkillRegistryService({ appDir, registryPath } = {}) {
  const resolvedPath = registryPath || path.join(path.resolve(appDir || process.cwd()), "skills", "registry.json");
  let cache = null;

  async function readRegistry({ refresh = false } = {}) {
    if (cache && !refresh) return cache;
    const parsed = JSON.parse(await readFile(resolvedPath, "utf8"));
    cache = normalizeRegistry(parsed, resolvedPath);
    return cache;
  }

  async function listSkills(options = {}) {
    return (await readRegistry(options)).skills;
  }

  return {
    listSkills,
    readRegistry,
    registryPath: resolvedPath,
  };
}

function normalizeRegistry(registry, registryPath) {
  if (registry?.schema_version !== "skill-registry/v1") {
    throw new Error(`Invalid skill registry schema at ${registryPath}`);
  }
  if (!Array.isArray(registry.skills)) {
    throw new Error(`Skill registry must contain a skills array at ${registryPath}`);
  }

  const seen = new Set();
  const skills = registry.skills.map((skill) => {
    if (!skill?.slash || !String(skill.slash).startsWith("/")) {
      throw new Error(`Skill registry card is missing slash id at ${registryPath}`);
    }
    if (seen.has(skill.slash)) {
      throw new Error(`Duplicate skill registry card: ${skill.slash}`);
    }
    seen.add(skill.slash);
    if (!CATEGORY_SET.has(skill.category)) {
      throw new Error(`Invalid category for ${skill.slash}: ${skill.category}`);
    }
    return {
      ...skill,
      inputs: Array.isArray(skill.inputs) ? skill.inputs : [],
      outputs: Array.isArray(skill.outputs) ? skill.outputs : [],
      upstream: Array.isArray(skill.upstream) ? skill.upstream : [],
      downstream: Array.isArray(skill.downstream) ? skill.downstream : [],
      version: Number.isInteger(skill.version) ? skill.version : 1,
    };
  });

  return {
    ...registry,
    skills,
    registry_path: registryPath,
  };
}
