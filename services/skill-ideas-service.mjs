import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import {
  SKILL_IDEA_STATUS,
  SKILL_IDEA_STATUS_VALUES,
  normalizeSkillIdeaStatus,
} from "../shared/skill-idea-statuses.mjs";
import {
  SKILL_IDEA_PAID_POSTURES,
  SKILL_IDEA_RISK_LEVELS,
  SKILL_IDEA_TARGET_LANES,
  calculateSkillIdeaReadiness,
  normalizeSkillIdeaDesignBrief,
} from "../shared/skill-idea-design-brief.mjs";

export const SKILL_IDEAS_SCHEMA_VERSION = "skill-ideas/v1";
export const SKILL_IDEA_STATUSES = new Set(SKILL_IDEA_STATUS_VALUES);
export { SKILL_IDEA_TARGET_LANES, SKILL_IDEA_PAID_POSTURES, SKILL_IDEA_RISK_LEVELS, calculateSkillIdeaReadiness };

const MAX_IDEA_TEXT_LENGTH = 2000;

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
        status: SKILL_IDEA_STATUS.INCOMPLETE,
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
      if (idea.status === SKILL_IDEA_STATUS.READY_FOR_REVIEW && !calculateSkillIdeaReadiness(idea.designBrief).ready) {
        idea.status = SKILL_IDEA_STATUS.INCOMPLETE;
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
      if (normalizedStatus === SKILL_IDEA_STATUS.READY_FOR_REVIEW && !calculateSkillIdeaReadiness(idea.designBrief).ready) {
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
  let status = normalizeSkillIdeaStatus(idea?.status);
  if (status === SKILL_IDEA_STATUS.READY_FOR_REVIEW && !readiness.ready) {
    status = SKILL_IDEA_STATUS.INCOMPLETE;
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

function normalizeDesignBrief(designBrief) {
  return normalizeSkillIdeaDesignBrief(designBrief, {
    makeError: (message, statusCode) => makeHttpError(message, statusCode),
  });
}
