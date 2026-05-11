import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const SKILL_IDEAS_SCHEMA_VERSION = "skill-ideas/v1";
export const SKILL_IDEA_STATUSES = new Set(["proposed", "dismissed", "marked_for_future"]);
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

export function createSkillIdeasService({
  appDir,
  ideasPath,
  now = () => new Date(),
  idFactory = () => `idea_${randomUUID()}`,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = ideasPath || path.join(root, "skill-ideas.json");

  async function listIdeas() {
    const store = await readStore();
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      ideas: [...store.ideas].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    };
  }

  async function createIdea({ text, matter = null } = {}) {
    const normalizedText = normalizeIdeaText(text);
    const timestamp = now().toISOString();
    const store = await readStore();
    const idea = {
      id: idFactory(),
      text: normalizedText,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "proposed",
      matter: normalizeMatterSummary(matter),
      designBrief: normalizeDesignBrief({}),
    };
    store.ideas.push(idea);
    await writeStore(store);
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      idea,
    };
  }

  async function updateIdeaDesignBrief(id, designBrief = {}) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw makeHttpError("Skill idea id is required", 400);
    const store = await readStore();
    const idea = store.ideas.find((candidate) => candidate.id === normalizedId);
    if (!idea) throw makeHttpError("Skill idea not found", 404);
    idea.designBrief = normalizeDesignBrief(designBrief);
    idea.updatedAt = now().toISOString();
    await writeStore(store);
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      idea,
    };
  }

  async function updateIdeaStatus(id, status) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw makeHttpError("Skill idea id is required", 400);
    const normalizedStatus = String(status || "").trim();
    if (!SKILL_IDEA_STATUSES.has(normalizedStatus)) {
      throw makeHttpError(`Invalid skill idea status: ${normalizedStatus || "blank"}`, 400);
    }
    const store = await readStore();
    const idea = store.ideas.find((candidate) => candidate.id === normalizedId);
    if (!idea) throw makeHttpError("Skill idea not found", 404);
    idea.status = normalizedStatus;
    idea.updatedAt = now().toISOString();
    await writeStore(store);
    return {
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      idea,
    };
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
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, `${JSON.stringify({
      schema_version: SKILL_IDEAS_SCHEMA_VERSION,
      ideas: store.ideas.map(normalizeStoredIdea),
    }, null, 2)}\n`);
  }

  return {
    createIdea,
    listIdeas,
    updateIdeaDesignBrief,
    updateIdeaStatus,
    storePath,
  };
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
  const status = SKILL_IDEA_STATUSES.has(idea?.status) ? idea.status : "proposed";
  return {
    id: String(idea?.id || "").trim(),
    text: String(idea?.text || "").trim(),
    createdAt: String(idea?.createdAt || "").trim(),
    updatedAt: String(idea?.updatedAt || idea?.createdAt || "").trim(),
    status,
    matter: normalizeMatterSummary(idea?.matter),
    designBrief: normalizeDesignBrief(idea?.designBrief),
  };
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
