import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const SKILL_IDEAS_SCHEMA_VERSION = "skill-ideas/v1";
export const SKILL_IDEA_STATUSES = new Set(["incomplete", "ready_for_review", "parked", "dismissed"]);
export const SKILL_IDEA_TARGET_LANES = new Set(["", "10_Library", "20_Workshop", "30_Drafts", "40_Dispatch"]);
export const SKILL_IDEA_PAID_POSTURES = new Set(["", "free", "paid", "unknown"]);
export const SKILL_IDEA_RISK_LEVELS = new Set(["", "low", "medium", "high"]);

const MAX_IDEA_TEXT_LENGTH = 2000;
const MAX_BRIEF_TEXT_LENGTH = 4000;
const EMPTY_DESIGN_BRIEF = Object.freeze({
  intendedUser: "",
  problem: "",
  expectedInputs: "",
  expectedOutputArtifact: "",
  targetLane: "",
  paidPosture: "",
  riskLevel: "",
  notes: "",
});
const LEGACY_STATUS_MAP = new Map([
  ["proposed", "incomplete"],
  ["marked_for_future", "parked"],
]);
const READINESS_CHECKS = Object.freeze([
  ["intendedUser", "Intended user present"],
  ["problem", "Problem/job present"],
  ["expectedInputs", "Expected inputs present"],
  ["expectedOutputArtifact", "Expected output artifact present"],
  ["targetLane", "Target lane selected"],
  ["paidPosture", "Paid/free posture selected"],
  ["riskLevel", "Risk level selected"],
  ["notes", "Notes or acceptance criteria present"],
]);

export function createSkillIdeasService({
  appDir,
  ideasPath,
  now = () => new Date(),
  idFactory = () => `idea_${randomUUID()}`,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = ideasPath || path.join(root, "skill-ideas.json");
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: serializeStore,
  });

  async function listIdeas() {
    const store = await readStore();
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      ideas: [...store.ideas].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    };
  }

  async function getIdea(id) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw makeHttpError("Skill idea id is required", 400);
    const store = await readStore();
    const idea = store.ideas.find((candidate) => candidate.id === normalizedId);
    if (!idea) throw makeHttpError("Skill idea not found", 404);
    return normalizeStoredIdea(idea);
  }

  async function createIdea({ text, matter = null, designBrief = {} } = {}) {
    const normalizedText = normalizeIdeaText(text);
    return persistence.withStoreMutation(async () => {
      const timestamp = now().toISOString();
      const store = await readStore();
      const idea = {
        id: idFactory(),
        text: normalizedText,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "incomplete",
        matter: normalizeMatterSummary(matter),
        designBrief: normalizeDesignBrief(designBrief),
      };
      const normalizedIdea = normalizeStoredIdea(idea);
      store.ideas.push(normalizedIdea);
      await writeStore(store);
      return {
        schema_version: SKILL_IDEAS_SCHEMA_VERSION,
        idea: normalizedIdea,
      };
    });
  }

  async function updateIdeaDesignBrief(id, designBrief = {}) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw makeHttpError("Skill idea id is required", 400);
    return persistence.withStoreMutation(async () => {
      const store = await readStore();
      const idea = store.ideas.find((candidate) => candidate.id === normalizedId);
      if (!idea) throw makeHttpError("Skill idea not found", 404);
      idea.designBrief = normalizeDesignBrief(designBrief);
      if (idea.status === "ready_for_review" && !calculateSkillIdeaReadiness(idea.designBrief).ready) {
        idea.status = "incomplete";
      }
      idea.updatedAt = now().toISOString();
      const normalizedIdea = normalizeStoredIdea(idea);
      Object.assign(idea, normalizedIdea);
      await writeStore(store);
      return {
        schema_version: SKILL_IDEAS_SCHEMA_VERSION,
        idea: normalizedIdea,
      };
    });
  }

  async function updateIdeaStatus(id, status) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw makeHttpError("Skill idea id is required", 400);
    const normalizedStatus = String(status || "").trim();
    if (!SKILL_IDEA_STATUSES.has(normalizedStatus)) {
      throw makeHttpError(`Invalid skill idea status: ${normalizedStatus || "blank"}`, 400);
    }
    return persistence.withStoreMutation(async () => {
      const store = await readStore();
      const idea = store.ideas.find((candidate) => candidate.id === normalizedId);
      if (!idea) throw makeHttpError("Skill idea not found", 404);
      if (normalizedStatus === "ready_for_review" && !calculateSkillIdeaReadiness(idea.designBrief).ready) {
        throw makeHttpError("Skill idea is not ready for review", 400);
      }
      idea.status = normalizedStatus;
      idea.updatedAt = now().toISOString();
      const normalizedIdea = normalizeStoredIdea(idea);
      Object.assign(idea, normalizedIdea);
      await writeStore(store);
      return {
        schema_version: SKILL_IDEAS_SCHEMA_VERSION,
        idea: normalizedIdea,
      };
    });
  }

  async function readStore() {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(storePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { schema_version: SKILL_IDEAS_SCHEMA_VERSION, ideas: [] };
      }
      throw error;
    }
    if (parsed?.schema_version !== SKILL_IDEAS_SCHEMA_VERSION) {
      throw makeHttpError(`Invalid skill ideas schema at ${storePath}`, 500);
    }
    if (!Array.isArray(parsed.ideas)) {
      throw makeHttpError(`Invalid skill ideas store at ${storePath}`, 500);
    }
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      ideas: parsed.ideas.map(normalizeStoredIdea),
    };
  }

  async function writeStore(store) {
    await persistence.writeStoreFile(store);
  }

  return {
    createIdea,
    getIdea,
    listIdeas,
    updateIdeaDesignBrief,
    updateIdeaStatus,
    storePath,
  };
}

function serializeStore(store) {
  return formatJsonStore({
    schema_version: SKILL_IDEAS_SCHEMA_VERSION,
    ideas: store.ideas.map(normalizeStoredIdea),
  });
}

function normalizeIdeaText(text) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) throw makeHttpError("Skill idea text is required", 400);
  if (normalized.length > MAX_IDEA_TEXT_LENGTH) {
    throw makeHttpError(`Skill idea text must be ${MAX_IDEA_TEXT_LENGTH} characters or less`, 400);
  }
  return normalized;
}

function normalizeMatterSummary(matter) {
  if (!matter || typeof matter !== "object") {
    return {
      matterName: "",
      folderName: "",
    };
  }
  return {
    matterName: String(matter.matterName || "").trim(),
    folderName: String(matter.folderName || "").trim(),
  };
}

function normalizeStoredIdea(idea) {
  const designBrief = normalizeDesignBrief(idea?.designBrief);
  const readiness = calculateSkillIdeaReadiness(designBrief);
  let status = normalizeIdeaStatus(idea?.status);
  if (status === "ready_for_review" && !readiness.ready) {
    status = "incomplete";
  }
  return {
    id: String(idea?.id || "").trim(),
    text: String(idea?.text || "").trim(),
    createdAt: String(idea?.createdAt || "").trim(),
    updatedAt: String(idea?.updatedAt || idea?.createdAt || "").trim(),
    status,
    matter: normalizeMatterSummary(idea?.matter),
    designBrief,
    readiness,
  };
}

export function calculateSkillIdeaReadiness(designBrief = {}) {
  const normalized = normalizeDesignBrief(designBrief);
  const items = READINESS_CHECKS.map(([key, label]) => ({
    key,
    label,
    passed: Boolean(normalized[key]),
  }));
  const ready = items.every((item) => item.passed);
  return {
    state: ready ? "ready_for_review" : "incomplete",
    ready,
    passedCount: items.filter((item) => item.passed).length,
    totalCount: items.length,
    items,
  };
}

function normalizeIdeaStatus(status) {
  const normalized = String(status || "").trim();
  const mapped = LEGACY_STATUS_MAP.get(normalized) || normalized;
  return SKILL_IDEA_STATUSES.has(mapped) ? mapped : "incomplete";
}

function normalizeDesignBrief(designBrief) {
  const source = designBrief && typeof designBrief === "object" ? designBrief : {};
  const targetLane = normalizeBriefEnum(source.targetLane, SKILL_IDEA_TARGET_LANES, "target lane");
  const paidPosture = normalizeBriefEnum(source.paidPosture, SKILL_IDEA_PAID_POSTURES, "paid/free posture");
  const riskLevel = normalizeBriefEnum(source.riskLevel, SKILL_IDEA_RISK_LEVELS, "risk level");
  return {
    ...EMPTY_DESIGN_BRIEF,
    intendedUser: normalizeBriefText(source.intendedUser, "intended user"),
    problem: normalizeBriefText(source.problem, "problem"),
    expectedInputs: normalizeBriefText(source.expectedInputs, "expected inputs"),
    expectedOutputArtifact: normalizeBriefText(source.expectedOutputArtifact, "expected output artifact"),
    targetLane,
    paidPosture,
    riskLevel,
    notes: normalizeBriefText(source.notes, "notes"),
  };
}

function normalizeBriefText(value, label) {
  const normalized = String(value || "").trim();
  if (normalized.length > MAX_BRIEF_TEXT_LENGTH) {
    throw makeHttpError(`Skill idea design brief ${label} must be ${MAX_BRIEF_TEXT_LENGTH} characters or less`, 400);
  }
  return normalized;
}

function normalizeBriefEnum(value, allowed, label) {
  const normalized = String(value || "").trim();
  if (!allowed.has(normalized)) {
    throw makeHttpError(`Invalid skill idea design brief ${label}: ${normalized || "blank"}`, 400);
  }
  return normalized;
}
