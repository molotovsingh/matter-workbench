import { readFile } from "node:fs/promises";
import path from "node:path";
import { MATTER_WORKSPACE_LANES } from "../shared/matter-contract.mjs";

const FALLBACK_CATEGORIES = [
  "Ingest",
  "Extract",
  "Organize",
  "Analyze",
  "Draft",
  "Review",
  "Export",
  "Maintain",
];

const BUILTIN_SKILL_SCHEMA_VERSION = "built-in-skill/v1";
const CONFIGURABLE_SKILL_SCHEMA_VERSION = "configurable-skill/v1";
const LANE_SET = new Set(MATTER_WORKSPACE_LANES.map((lane) => lane.path));

export function createSkillRegistryService({ appDir, registryPath, builtinsDir, configurableSkillsService = null } = {}) {
  const resolvedPath = registryPath || path.join(path.resolve(appDir || process.cwd()), "skills", "registry.json");
  const resolvedBuiltinsDir = builtinsDir || path.join(path.dirname(resolvedPath), "builtins");
  let cache = null;

  async function readRegistry({ refresh = false } = {}) {
    if (cache && !refresh && !configurableSkillsService) return cache;
    const parsed = JSON.parse(await readFile(resolvedPath, "utf8"));
    cache = await normalizeRegistry(parsed, {
      registryPath: resolvedPath,
      builtinsDir: resolvedBuiltinsDir,
      configurableSkillsService,
    });
    return cache;
  }

  async function listSkills(options = {}) {
    return (await readRegistry(options)).skills;
  }

  return {
    listSkills,
    readRegistry,
    registryPath: resolvedPath,
    builtinsDir: resolvedBuiltinsDir,
  };
}

async function normalizeRegistry(registry, { registryPath, builtinsDir, configurableSkillsService }) {
  if (registry?.schema_version !== "skill-registry/v1") {
    throw new Error(`Invalid skill registry schema at ${registryPath}`);
  }
  const categorySet = new Set(
    Array.isArray(registry.categories) && registry.categories.length
      ? registry.categories
      : FALLBACK_CATEGORIES,
  );
  const usesBuiltins = Array.isArray(registry.builtins) && registry.builtins.length > 0;
  const rawSkills = await loadSkillCards(registry, { registryPath, builtinsDir });
  const configurableCards = configurableSkillsService
    ? await configurableSkillsService.activeSkillCards()
    : [];
  if (!Array.isArray(rawSkills)) {
    throw new Error(`Skill registry must contain a skills array at ${registryPath}`);
  }

  const seenIds = new Set();
  const seenSlashes = new Set();
  const skills = [...rawSkills, ...configurableCards].map((skill) => {
    const normalized = usesBuiltins
      ? normalizeBuiltinSkillCard(skill, { registryPath, categorySet })
      : normalizeLegacySkillCard(skill, { registryPath, categorySet });
    if (seenIds.has(normalized.id)) {
      throw new Error(`Duplicate skill id: ${normalized.id}`);
    }
    if (seenSlashes.has(normalized.slash)) {
      throw new Error(`Duplicate skill slash: ${normalized.slash}`);
    }
    seenIds.add(normalized.id);
    seenSlashes.add(normalized.slash);
    return normalized;
  });

  return {
    schema_version: registry.schema_version,
    categories: Array.isArray(registry.categories) ? registry.categories : [...FALLBACK_CATEGORIES],
    principles: registry.principles || {},
    skills,
    registry_path: registryPath,
  };
}

async function loadSkillCards(registry, { registryPath, builtinsDir }) {
  if (Array.isArray(registry.builtins) && registry.builtins.length) {
    const cards = [];
    for (const builtin of registry.builtins) {
      const id = typeof builtin === "string" ? builtin : builtin?.id;
      if (!id || String(id).includes("/") || String(id).includes("\\")) {
        throw new Error(`Invalid built-in skill reference in ${registryPath}: ${String(id || "")}`);
      }
      const stubPath = path.join(builtinsDir, String(id), "skill.json");
      let parsed;
      try {
        parsed = JSON.parse(await readFile(stubPath, "utf8"));
      } catch (error) {
        throw new Error(`Failed to read built-in skill stub ${stubPath}: ${error.message}`);
      }
      cards.push({ ...parsed, _stub_path: stubPath });
    }
    return cards;
  }

  return registry.skills;
}

function normalizeBuiltinSkillCard(skill, { registryPath, categorySet }) {
  if (!skill?.slash || !String(skill.slash).startsWith("/")) {
    throw new Error(`Skill registry card is missing slash id at ${registryPath}`);
  }
  if (!skill.id) {
    throw new Error(`Skill registry card is missing id for ${skill.slash}`);
  }
  if (!categorySet.has(skill.category)) {
    throw new Error(`Invalid category for ${skill.slash}: ${skill.category}`);
  }
  if (![BUILTIN_SKILL_SCHEMA_VERSION, CONFIGURABLE_SKILL_SCHEMA_VERSION].includes(skill.schema_version)) {
    throw new Error(`Invalid skill schema for ${skill.slash}: ${skill.schema_version}`);
  }
  if (skill.runner_key !== skill.slash) {
    throw new Error(`runner_key must match slash for ${skill.slash}`);
  }
  for (const field of ["matter_required", "paid_provider_call", "rerun_guarded"]) {
    if (typeof skill[field] !== "boolean") {
      throw new Error(`${field} must be boolean for ${skill.slash}`);
    }
  }
  for (const field of ["inputs", "outputs", "upstream", "downstream"]) {
    if (!Array.isArray(skill[field])) {
      throw new Error(`${field} must be an array for ${skill.slash}`);
    }
  }
  const defaultLane = skill.default_lane ?? "";
  if (defaultLane && !LANE_SET.has(defaultLane)) {
    throw new Error(`Invalid default_lane for ${skill.slash}: ${defaultLane}`);
  }

  const normalized = {
    ...skill,
    inputs: skill.inputs,
    outputs: skill.outputs,
    upstream: skill.upstream,
    downstream: skill.downstream,
    version: Number.isInteger(skill.version) ? skill.version : 1,
  };
  delete normalized._stub_path;
  return normalized;
}

function normalizeLegacySkillCard(skill, { registryPath, categorySet }) {
  if (!skill?.slash || !String(skill.slash).startsWith("/")) {
    throw new Error(`Skill registry card is missing slash id at ${registryPath}`);
  }
  if (!skill.id) {
    throw new Error(`Skill registry card is missing id for ${skill.slash}`);
  }
  if (!categorySet.has(skill.category)) {
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
}
