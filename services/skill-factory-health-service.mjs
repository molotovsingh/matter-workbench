import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashDesignBrief } from "./skill-samples-service.mjs";

export const SKILL_FACTORY_HEALTH_SCHEMA_VERSION = "skill-factory-health/v1";

const SKILL_IDEAS_SCHEMA_VERSION = "skill-ideas/v1";
const SKILL_SAMPLES_SCHEMA_VERSION = "skill-samples/v1";
const CONFIGURABLE_SKILLS_SCHEMA_VERSION = "configurable-skills/v1";
const VALID_SKILL_STATUSES = new Set(["draft", "active", "disabled"]);
const VALID_LANES = new Set(["10_Library", "20_Workshop", "30_Drafts", "40_Dispatch"]);
const BUILTIN_SLASHES = new Set([
  "/matter-init",
  "/prepare_matter",
  "/extract",
  "/describe_sources",
  "/context_preview",
  "/context_search",
  "/create_listofdates",
  "/doctor",
]);

export function createSkillFactoryHealthService({
  appDir,
  ideasPath,
  samplesPath,
  skillsPath,
  now = () => new Date(),
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePaths = {
    ideas: ideasPath || path.join(root, "skill-ideas.json"),
    samples: samplesPath || path.join(root, "skill-samples.json"),
    skills: skillsPath || path.join(root, "configurable-skills.json"),
  };

  async function checkHealth() {
    const issues = [];
    const [ideasStore, samplesStore, skillsStore] = await Promise.all([
      readJsonStore(storePaths.ideas, SKILL_IDEAS_SCHEMA_VERSION, "ideas", "ideas", issues),
      readJsonStore(storePaths.samples, SKILL_SAMPLES_SCHEMA_VERSION, "samples", "samples", issues),
      readJsonStore(storePaths.skills, CONFIGURABLE_SKILLS_SCHEMA_VERSION, "skills", "skills", issues),
    ]);
    const ideas = Array.isArray(ideasStore.ideas) ? ideasStore.ideas.map(normalizeIdea) : [];
    const samples = Array.isArray(samplesStore.samples) ? samplesStore.samples.map(normalizeSample) : [];
    const skills = Array.isArray(skillsStore.skills) ? skillsStore.skills.map(normalizeSkill) : [];

    const ideaById = new Map(ideas.filter((idea) => idea.id).map((idea) => [idea.id, idea]));
    const sampleById = new Map(samples.filter((sample) => sample.id).map((sample) => [sample.id, sample]));
    const activeSlashCounts = countValues(skills.filter((skill) => skill.status === "active").map((skill) => skill.slash));
    const approvedByIdea = new Map();

    for (const sample of samples) {
      if (!sample.id) addIssue(issues, "error", "sample_missing_id", "A sample is missing an id.");
      if (!sample.ideaId || !ideaById.has(sample.ideaId)) {
        addIssue(issues, "error", "sample_missing_idea", `Sample ${sample.id || "(missing id)"} points to a missing idea ${sample.ideaId || "(blank)"}.`);
        continue;
      }
      const idea = ideaById.get(sample.ideaId);
      const currentHash = hashDesignBrief(idea.designBrief || {});
      if (sample.approved) {
        const approved = approvedByIdea.get(sample.ideaId) || [];
        approved.push(sample.id);
        approvedByIdea.set(sample.ideaId, approved);
        if (sample.designBriefHash !== currentHash) {
          addIssue(issues, "error", "approved_sample_stale", `Approved sample ${sample.id} is stale against idea ${sample.ideaId}.`);
        }
      }
    }

    for (const [ideaId, approved] of approvedByIdea.entries()) {
      if (approved.length > 1) {
        addIssue(issues, "error", "multiple_approved_samples", `Idea ${ideaId} has multiple approved samples: ${approved.join(", ")}.`);
      }
    }

    for (const [slash, count] of activeSlashCounts.entries()) {
      if (!slash) continue;
      if (count > 1) addIssue(issues, "error", "duplicate_active_slash", `Active slash ${slash} appears ${count} times.`);
      if (BUILTIN_SLASHES.has(slash)) addIssue(issues, "error", "builtin_slash_collision", `Custom skill ${slash} collides with a built-in skill.`);
    }

    for (const skill of skills) {
      validateSkill(skill, { ideaById, sampleById, issues });
    }

    const errors = issues.filter((issue) => issue.severity === "error");
    const warnings = issues.filter((issue) => issue.severity === "warning");
    const state = errors.length ? "error" : warnings.length ? "warning" : "ok";
    return {
      schema_version: SKILL_FACTORY_HEALTH_SCHEMA_VERSION,
      checkedAt: now().toISOString(),
      state,
      summary: {
        ideas: ideas.length,
        samples: samples.length,
        configurableSkills: skills.length,
        activeSkills: skills.filter((skill) => skill.status === "active").length,
        errors: errors.length,
        warnings: warnings.length,
      },
      checks: buildChecks({ ideas, samples, skills, issues }),
      issues,
      storePaths,
    };
  }

  return {
    checkHealth,
    storePaths,
  };
}

async function readJsonStore(filePath, expectedSchema, arrayKey, label, issues) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed?.schema_version !== expectedSchema) {
      addIssue(issues, "error", `${label}_schema`, `${label} store has invalid schema_version ${parsed?.schema_version || "(blank)"}.`);
      return { schema_version: expectedSchema, [arrayKey]: [] };
    }
    if (!Array.isArray(parsed[arrayKey])) {
      addIssue(issues, "error", `${label}_shape`, `${label} store is missing ${arrayKey} array.`);
      return { schema_version: expectedSchema, [arrayKey]: [] };
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return { schema_version: expectedSchema, [arrayKey]: [] };
    addIssue(issues, "error", `${label}_read`, `${label} store could not be read: ${error.message}`);
    return { schema_version: expectedSchema, [arrayKey]: [] };
  }
}

function validateSkill(skill, { ideaById, sampleById, issues }) {
  if (!skill.id) addIssue(issues, "error", "skill_missing_id", "A configurable skill is missing an id.");
  if (!VALID_SKILL_STATUSES.has(skill.status)) {
    addIssue(issues, "error", "skill_invalid_status", `Skill ${skill.id || skill.slash || "(missing id)"} has invalid status ${skill.status || "(blank)"}.`);
  }
  if (!skill.slash || !skill.slash.startsWith("/")) {
    addIssue(issues, "error", "skill_invalid_slash", `Skill ${skill.id || "(missing id)"} has invalid slash ${skill.slash || "(blank)"}.`);
  }
  if (!skill.sourceIdeaId || !ideaById.has(skill.sourceIdeaId)) {
    addIssue(issues, "error", "skill_missing_idea", `Skill ${skill.slash || skill.id || "(missing skill)"} points to a missing source idea ${skill.sourceIdeaId || "(blank)"}.`);
  }
  if (!skill.sourceSampleId || !sampleById.has(skill.sourceSampleId)) {
    addIssue(issues, "error", "skill_missing_sample", `Skill ${skill.slash || skill.id || "(missing skill)"} points to a missing source sample ${skill.sourceSampleId || "(blank)"}.`);
  } else {
    const sample = sampleById.get(skill.sourceSampleId);
    const idea = ideaById.get(skill.sourceIdeaId);
    if (sample.ideaId !== skill.sourceIdeaId) {
      addIssue(issues, "error", "skill_sample_idea_mismatch", `Skill ${skill.slash || skill.id} links idea ${skill.sourceIdeaId || "(blank)"} but sample ${sample.id} belongs to ${sample.ideaId || "(blank)"}.`);
    }
    if (!sample.approved) {
      addIssue(issues, "error", "skill_unapproved_sample", `Skill ${skill.slash || skill.id} was built from unapproved sample ${sample.id}.`);
    }
    if (idea && sample.designBriefHash !== hashDesignBrief(idea.designBrief || {})) {
      addIssue(issues, "error", "skill_stale_sample", `Skill ${skill.slash || skill.id} points to a sample that is stale against its idea.`);
    }
  }
  if (!VALID_LANES.has(skill.targetLane)) {
    addIssue(issues, "error", "skill_invalid_lane", `Skill ${skill.slash || skill.id} has invalid target lane ${skill.targetLane || "(blank)"}.`);
  }
  if (!isArtifactInsideLane(skill.outputArtifact, skill.targetLane)) {
    addIssue(issues, "error", "skill_invalid_output", `Skill ${skill.slash || skill.id} writes outside its target lane: ${skill.outputArtifact || "(blank)"}.`);
  }
  if (skill.status === "active" && skill.validation?.status !== "passed") {
    addIssue(issues, "warning", "active_skill_validation_status", `Active skill ${skill.slash || skill.id} does not have passed validation metadata.`);
  }
}

function buildChecks({ ideas, samples, skills, issues }) {
  const hasIssue = (codePrefix, severity = "error") => issues.some((issue) => issue.severity === severity && issue.code.startsWith(codePrefix));
  return [
    checkItem("stores_readable", "Skill factory stores are readable JSON", !hasIssue("ideas_read") && !hasIssue("samples_read") && !hasIssue("skills_read")),
    checkItem("sample_links", "Samples point to existing ideas", !hasIssue("sample_missing_idea")),
    checkItem("sample_approval", "Approved samples are current and unique per idea", !hasIssue("approved_sample_stale") && !hasIssue("multiple_approved_samples")),
    checkItem("skill_links", "Configurable skills point to existing ideas and samples", !hasIssue("skill_missing_idea") && !hasIssue("skill_missing_sample") && !hasIssue("skill_sample_idea_mismatch")),
    checkItem("slash_uniqueness", "Active custom skill slashes are unique and do not collide with built-ins", !hasIssue("duplicate_active_slash") && !hasIssue("builtin_slash_collision")),
    checkItem("skill_status", "Configurable skill statuses are valid", !hasIssue("skill_invalid_status")),
    checkItem("output_lanes", "Configurable skill outputs stay inside allowed lanes", !hasIssue("skill_invalid_lane") && !hasIssue("skill_invalid_output")),
    {
      id: "counts",
      label: `Checked ${ideas.length} ideas, ${samples.length} samples, and ${skills.length} configurable skills`,
      state: "ok",
    },
  ];
}

function checkItem(id, label, passed) {
  return {
    id,
    label,
    state: passed ? "ok" : "error",
  };
}

function addIssue(issues, severity, code, message) {
  issues.push({ severity, code, message });
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) {
    const key = String(value || "").trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function normalizeIdea(idea = {}) {
  return {
    id: String(idea.id || "").trim(),
    designBrief: idea.designBrief && typeof idea.designBrief === "object" ? idea.designBrief : {},
  };
}

function normalizeSample(sample = {}) {
  return {
    id: String(sample.id || sample.sample_id || "").trim(),
    ideaId: String(sample.ideaId || sample.idea_id || "").trim(),
    approved: Boolean(sample.approved),
    designBriefHash: String(sample.designBriefHash || "").trim(),
  };
}

function normalizeSkill(skill = {}) {
  return {
    id: String(skill.id || "").trim(),
    slash: String(skill.slash || "").trim(),
    status: String(skill.status || "").trim(),
    sourceIdeaId: String(skill.sourceIdeaId || "").trim(),
    sourceSampleId: String(skill.sourceSampleId || "").trim(),
    targetLane: String(skill.targetLane || "").trim(),
    outputArtifact: String(skill.outputArtifact || "").trim(),
    validation: skill.validation && typeof skill.validation === "object" ? skill.validation : {},
  };
}

function isArtifactInsideLane(outputArtifact, targetLane) {
  const artifact = String(outputArtifact || "").trim();
  const lane = String(targetLane || "").trim();
  if (!artifact || !lane || !VALID_LANES.has(lane)) return false;
  if (path.isAbsolute(artifact)) return false;
  const normalized = path.posix.normalize(artifact.replaceAll("\\", "/"));
  if (normalized.startsWith("../") || normalized === "..") return false;
  return normalized === lane || normalized.startsWith(`${lane}/`);
}
