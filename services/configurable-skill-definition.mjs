import path from "node:path";
import { AI_TASKS } from "../shared/model-policy.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const CONFIGURABLE_SKILL_SCHEMA_VERSION = "configurable-skill/v1";

const MAX_PROMPT_LENGTH = 8000;
const MAX_OUTPUT_LENGTH = 80_000;
const MAX_SLASH_ALLOCATION_ATTEMPTS = 1000;
export const CONFIGURABLE_SKILL_STATUSES = new Set(["draft", "active", "disabled", "suspended", "archived", "deleted"]);
const RAW_SOURCE_HANDLE_INSTRUCTION = [
  "For source-backed outputs, keep readable source labels in normal lawyer-facing prose.",
  "Also include an internal audit/source-handles section with raw FILE-NNNN pX.bY citations for material factual assertions and recommendations.",
  "Mark that audit section internal and not court-facing.",
].join(" ");

export function skillToRegistryCard(skill = {}) {
  const normalized = normalizeStoredSkill(skill);
  return {
    schema_version: CONFIGURABLE_SKILL_SCHEMA_VERSION,
    id: normalized.id,
    slash: normalized.slash,
    title: normalized.title,
    category: "Analyze",
    mode: "AI",
    purpose: normalized.description,
    matter_required: normalized.matterRequired,
    paid_provider_call: normalized.paidProviderCall,
    rerun_guarded: true,
    source_backed: normalized.sourceBacked,
    inputs: ["matter-context-packet/v1"],
    outputs: [normalized.outputArtifact],
    upstream: [normalized.sourceIdeaId, normalized.sourceSampleId].filter(Boolean),
    downstream: [],
    default_lane: normalized.targetLane,
    runner_key: normalized.slash,
    version: normalized.version,
    family_id: normalized.familyId,
    previous_skill_id: normalized.previousSkillId,
    configurable: true,
    status: normalized.status,
  };
}

export function primaryActiveSkills(skills = []) {
  const grouped = new Map();
  for (const skill of skills.map(normalizeStoredSkill).filter((candidate) => candidate.status === "active")) {
    const key = customSkillGroupingKey(skill);
    const current = grouped.get(key);
    if (!current || comparePrimarySkill(skill, current) < 0) {
      grouped.set(key, skill);
    }
  }
  return [...grouped.values()].sort(comparePrimarySkill);
}

export function normalizeAuthoredDefinition(definition = {}, idea = {}) {
  const brief = idea.designBrief || {};
  const sourceBacked = ["required", "optional", "none"].includes(definition.source_backed) ? definition.source_backed : "required";
  return {
    title: normalizeText(definition.title || titleFromArtifact(brief.expectedOutputArtifact) || "Custom Skill"),
    slash: normalizeSlash(definition.slash || slashFromTitle(definition.title || titleFromArtifact(brief.expectedOutputArtifact))),
    description: normalizeText(definition.description || brief.problem || idea.text),
    target_lane: normalizeLane(definition.target_lane || brief.targetLane),
    output_artifact: normalizeArtifactPath(definition.output_artifact || brief.expectedOutputArtifact, definition.target_lane || brief.targetLane),
    matter_required: definition.matter_required !== false,
    paid_provider_call: definition.paid_provider_call !== false,
    source_backed: sourceBacked,
    prompt: sourceBacked === "required"
      ? withRawSourceHandleInstruction(boundedPrompt(definition.prompt || ""))
      : boundedPrompt(definition.prompt || ""),
    citation_policy: sourceBacked === "required"
      ? withRawSourceHandleInstruction(normalizeText(definition.citation_policy || "Cite source-backed factual statements with readable labels and raw citations."))
      : normalizeText(definition.citation_policy || "Cite source-backed factual statements with readable labels and raw citations."),
  };
}

export function normalizeStoredSkill(skill = {}) {
  const id = normalizeText(skill.id);
  return {
    schema_version: CONFIGURABLE_SKILL_SCHEMA_VERSION,
    id,
    slash: normalizeSlash(skill.slash),
    title: normalizeText(skill.title),
    description: normalizeText(skill.description),
    status: CONFIGURABLE_SKILL_STATUSES.has(skill.status) ? skill.status : "draft",
    version: Number.isInteger(skill.version) && skill.version > 0 ? skill.version : 1,
    familyId: normalizeText(skill.familyId || id),
    previousSkillId: normalizeText(skill.previousSkillId),
    replacedBySkillId: normalizeText(skill.replacedBySkillId),
    supersededAt: normalizeText(skill.supersededAt),
    sourceIdeaId: normalizeText(skill.sourceIdeaId),
    sourceSampleId: normalizeText(skill.sourceSampleId),
    approvedSampleHash: normalizeText(skill.approvedSampleHash),
    targetLane: normalizeLane(skill.targetLane),
    outputArtifact: normalizeArtifactPath(skill.outputArtifact, skill.targetLane),
    matterRequired: skill.matterRequired !== false,
    paidProviderCall: skill.paidProviderCall !== false,
    sourceBacked: ["required", "optional", "none"].includes(skill.sourceBacked) ? skill.sourceBacked : "required",
    promptConfig: {
      prompt: boundedPrompt(skill.promptConfig?.prompt || ""),
      citationPolicy: normalizeText(skill.promptConfig?.citationPolicy),
    },
    modelPolicy: {
      task: normalizeText(skill.modelPolicy?.task || AI_TASKS.CONFIGURABLE_SKILL_RUN),
      provider: normalizeText(skill.modelPolicy?.provider),
      model: normalizeText(skill.modelPolicy?.model),
      policyPromptVersion: normalizeText(skill.modelPolicy?.policyPromptVersion),
    },
    validation: {
      status: ["pending", "passed", "failed"].includes(skill.validation?.status) ? skill.validation.status : "pending",
      messages: Array.isArray(skill.validation?.messages) ? skill.validation.messages.map(normalizeText).filter(Boolean).slice(0, 10) : [],
      validatedAt: normalizeText(skill.validation?.validatedAt),
    },
    createdAt: normalizeText(skill.createdAt),
    updatedAt: normalizeText(skill.updatedAt || skill.createdAt),
    activatedAt: normalizeText(skill.activatedAt),
    lifecycle: normalizeLifecycle(skill.lifecycle),
  };
}

export function publicSkill(skill) {
  const normalized = normalizeStoredSkill(skill);
  return {
    id: normalized.id,
    slash: normalized.slash,
    title: normalized.title,
    status: normalized.status,
    version: normalized.version,
    familyId: normalized.familyId,
    previousSkillId: normalized.previousSkillId,
    outputArtifact: normalized.outputArtifact,
    targetLane: normalized.targetLane,
    lifecycle: normalized.lifecycle,
  };
}

function normalizeLifecycle(lifecycle = {}) {
  return {
    statusChangedAt: normalizeText(lifecycle.statusChangedAt),
    statusChangedBy: normalizeText(lifecycle.statusChangedBy),
    reason: normalizeText(lifecycle.reason),
    previousStatus: normalizeText(lifecycle.previousStatus),
  };
}

export function normalizeArtifactPath(value, lane = "20_Workshop") {
  const normalizedLane = normalizeLane(lane);
  const raw = normalizeText(value) || `${normalizedLane}/Custom Skill Output.md`;
  const posix = raw.split(/[\\/]+/).filter(Boolean).join("/");
  const withLane = posix.startsWith(`${normalizedLane}/`) ? posix : `${normalizedLane}/${path.posix.basename(posix)}`;
  return withLane.endsWith(".md") ? withLane : `${withLane}.md`;
}

export function normalizeSlash(value) {
  const raw = normalizeText(value).toLowerCase().replace(/[^a-z0-9_/]+/g, "_").replace(/_+/g, "_");
  const slash = raw.startsWith("/") ? raw : `/${raw}`;
  return slash.replace(/\/+/g, "/").replace(/_$/g, "") || "/custom_skill";
}

export function uniqueSlash(base, existing) {
  const normalized = normalizeSlash(base || "/custom_skill");
  const taken = new Set(existing.map(normalizeSlash));
  if (!taken.has(normalized)) return normalized;
  for (let index = 2; index < MAX_SLASH_ALLOCATION_ATTEMPTS; index += 1) {
    const candidate = `${normalized}_${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw makeHttpError(`Could not allocate unique slash for ${normalized}`, 409);
}

export function slashFromTitle(title) {
  const text = normalizeText(title)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `/${text || "custom_skill"}`;
}

export function boundedOutputMarkdown(value) {
  const markdown = String(value || "").trim();
  if (!markdown) throw makeHttpError("Configurable skill output was empty", 502);
  if (markdown.length > MAX_OUTPUT_LENGTH) {
    throw makeHttpError(`Configurable skill output must be ${MAX_OUTPUT_LENGTH} characters or less`, 502);
  }
  return markdown;
}

export function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function withRawSourceHandleInstruction(value) {
  const normalized = normalizeText(value);
  if (!normalized) return normalized;
  if (/FILE-NNNN|FILE-\d{4}|raw FILE/i.test(normalized)) return normalized;
  return boundedPrompt(`${normalized} ${RAW_SOURCE_HANDLE_INSTRUCTION}`);
}

function customSkillGroupingKey(skill = {}) {
  const normalized = normalizeStoredSkill(skill);
  const hasExplicitLineage = Boolean(
    normalized.previousSkillId
    || normalized.replacedBySkillId
    || (normalized.familyId && normalized.familyId !== normalized.id),
  );
  if (hasExplicitLineage) return `family:${normalized.familyId || normalized.id}`;
  return [
    "signature",
    normalizeComparableText(normalized.title),
    normalizeComparableText(normalized.outputArtifact),
    normalizeComparableText(normalized.targetLane),
  ].join(":");
}

function comparePrimarySkill(left = {}, right = {}) {
  const leftVersion = Number(left.version || 0);
  const rightVersion = Number(right.version || 0);
  if (leftVersion !== rightVersion) return rightVersion - leftVersion;
  const leftTime = left.activatedAt || left.updatedAt || left.createdAt || "";
  const rightTime = right.activatedAt || right.updatedAt || right.createdAt || "";
  if (leftTime !== rightTime) return String(rightTime).localeCompare(String(leftTime));
  const leftId = left.id || "";
  const rightId = right.id || "";
  if (leftId !== rightId) return String(rightId).localeCompare(String(leftId));
  return String(left.slash || "").localeCompare(String(right.slash || ""));
}

function normalizeLane(value) {
  const lane = normalizeText(value);
  return ["10_Library", "20_Workshop", "30_Drafts", "40_Dispatch"].includes(lane) ? lane : "20_Workshop";
}

function titleFromArtifact(value) {
  const base = path.posix.basename(normalizeText(value), ".md");
  return base || "";
}

function boundedPrompt(value) {
  const prompt = normalizeText(value);
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw makeHttpError(`Configurable skill prompt must be ${MAX_PROMPT_LENGTH} characters or less`, 400);
  }
  return prompt;
}

function normalizeComparableText(value) {
  return normalizeText(value).toLowerCase();
}
