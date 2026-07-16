import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_SKILL_REGISTRY_COMMANDS } from "../shared/builtin-skill-commands.mjs";
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
const BUILTIN_DISPLAY_FIELDS = ["action", "artifact", "running", "complete", "pill"];

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
  if (usesBuiltins) assertBuiltinManifestMatchesCommandList(registry.builtins, { registryPath });
  const rawSkills = await loadSkillCards(registry, { registryPath, builtinsDir });
  const configurableCards = configurableSkillsService
    ? await configurableSkillsService.activeSkillCards()
    : [];
  if (!Array.isArray(rawSkills)) {
    throw new Error(`Skill registry must contain a skills array at ${registryPath}`);
  }

  const normalizeCard = (skill) => usesBuiltins
    ? normalizeBuiltinSkillCard(skill, { registryPath, categorySet })
    : normalizeLegacySkillCard(skill, { registryPath, categorySet });
  const builtinCards = rawSkills.map(normalizeCard);
  const builtinSlashes = new Set(builtinCards.map((skill) => skill.slash));
  const seenIds = new Set();
  const seenSlashes = new Set();
  const skills = [];

  for (const normalized of [...builtinCards, ...configurableCards.map(normalizeCard)]) {
    // A workflow promoted from custom to native can leave an older active card
    // in durable storage. Keep the native registry readable while the health
    // surface reports that stale configurable record for operator cleanup.
    if (normalized.configurable && builtinSlashes.has(normalized.slash)) {
      continue;
    }
    if (seenIds.has(normalized.id)) {
      throw new Error(`Duplicate skill id: ${normalized.id}`);
    }
    if (seenSlashes.has(normalized.slash)) {
      throw new Error(`Duplicate skill slash: ${normalized.slash}`);
    }
    seenIds.add(normalized.id);
    seenSlashes.add(normalized.slash);
    skills.push(normalized);
  }

  return {
    schema_version: registry.schema_version,
    categories: Array.isArray(registry.categories) ? registry.categories : [...FALLBACK_CATEGORIES],
    principles: registry.principles || {},
    skills,
    registry_path: registryPath,
  };
}

function assertBuiltinManifestMatchesCommandList(builtins, { registryPath }) {
  const manifestSlashes = builtins.map((builtin) => {
    const id = typeof builtin === "string" ? builtin : builtin?.id;
    return id ? `/${id}` : "";
  });
  if (
    manifestSlashes.length === BUILTIN_SKILL_REGISTRY_COMMANDS.length
    && manifestSlashes.every((slash, index) => slash === BUILTIN_SKILL_REGISTRY_COMMANDS[index])
  ) {
    return;
  }
  throw new Error(
    `Built-in skill manifest in ${registryPath} must match shared/builtin-skill-commands.mjs`,
  );
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
    display: skill.schema_version === BUILTIN_SKILL_SCHEMA_VERSION
      ? normalizeBuiltinDisplay(skill)
      : normalizeConfigurableDisplay(skill),
    inputs: skill.inputs,
    outputs: skill.outputs,
    upstream: skill.upstream,
    downstream: skill.downstream,
    version: Number.isInteger(skill.version) ? skill.version : 1,
  };
  delete normalized._stub_path;
  return normalized;
}

function normalizeBuiltinDisplay(skill) {
  if (!skill.display || typeof skill.display !== "object" || Array.isArray(skill.display)) {
    throw new Error(`display must be an object for ${skill.slash}`);
  }
  const display = {};
  for (const field of BUILTIN_DISPLAY_FIELDS) {
    const value = typeof skill.display[field] === "string" ? skill.display[field].trim() : "";
    if (!value) throw new Error(`display.${field} must be a non-empty string for ${skill.slash}`);
    display[field] = value;
  }
  return display;
}

function normalizeConfigurableDisplay(skill) {
  const action = normalizeDisplayText(skill.display?.action || skill.title || skill.slash || "Custom Skill");
  const artifact = normalizeDisplayText(skill.display?.artifact || action);
  return {
    action,
    artifact,
    running: normalizeDisplayText(skill.display?.running || `Running ${action}`),
    complete: normalizeDisplayText(skill.display?.complete || `${action} complete`),
    pill: normalizeDisplayText(skill.display?.pill || (skill.paid_provider_call ? "Uses AI" : "Local")),
  };
}

function normalizeDisplayText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
