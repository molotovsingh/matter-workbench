import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AI_RUN_LEDGER_FIELDS, normalizeAiRunMetadata } from "../shared/ai-run-metadata.mjs";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { SKILL_SAMPLE_STATE } from "../shared/skill-sample-states.mjs";

export const SKILL_SAMPLES_SCHEMA_VERSION = "skill-samples/v1";

const MAX_SAMPLE_MARKDOWN_LENGTH = 60_000;

export function createSkillSamplesService({
  appDir,
  samplesPath,
  now = () => new Date(),
  idFactory = () => `sample_${randomUUID()}`,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = samplesPath || path.join(root, "skill-samples.json");
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: serializeStore,
  });

  async function recordSample({ idea = {}, sample = {} } = {}) {
    const ideaId = String(idea.id || sample.idea?.id || "").trim();
    if (!ideaId) throw makeHttpError("Skill idea id is required for sample storage", 400, "skill_sample.idea_id_required");
    return persistence.withStoreMutation(async () => {
      const timestamp = now().toISOString();
      const store = await readStore();
      const sampleId = String(sample.sample_id || idFactory()).trim();
      const version = store.samples.filter((candidate) => candidate.ideaId === ideaId).length + 1;
      const stored = normalizeStoredSample({
        id: sampleId,
        ideaId,
        version,
        createdAt: String(sample.generated_at || timestamp),
        updatedAt: timestamp,
        approved: false,
        approvedAt: "",
        designBriefHash: hashDesignBrief(idea.designBrief || sample.idea?.designBrief || {}),
        matter: normalizeSampleMatter(sample.matter),
        sampleMarkdown: boundedSampleMarkdown(sample.sample_markdown),
        feedback: String(sample.feedback || ""),
        aiRun: sample.ai_run || {},
        warnings: Array.isArray(sample.warnings) ? sample.warnings : [],
        rawSample: sample,
      });
      store.samples.push(stored);
      await writeStore(store);
      return {
        schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
        sample: stored,
      };
    });
  }

  async function approveSample({ ideaId, sampleId, designBrief = {} } = {}) {
    const normalizedIdeaId = String(ideaId || "").trim();
    const normalizedSampleId = String(sampleId || "").trim();
    if (!normalizedIdeaId) throw makeHttpError("Skill idea id is required", 400, "skill_sample.idea_id_required");
    if (!normalizedSampleId) throw makeHttpError("Sample id is required", 400, "skill_sample.id_required");
    return persistence.withStoreMutation(async () => {
      const store = await readStore();
      const sample = store.samples.find((candidate) => candidate.ideaId === normalizedIdeaId && candidate.id === normalizedSampleId);
      if (!sample) throw makeHttpError("Skill sample not found", 404, "skill_sample.not_found");
      const currentHash = hashDesignBrief(designBrief);
      if (sample.designBriefHash !== currentHash) {
        throw makeHttpError("Approved sample is stale because the design brief changed", 409, "skill_sample.stale");
      }
      const timestamp = now().toISOString();
      for (const candidate of store.samples) {
        if (candidate.ideaId === normalizedIdeaId) {
          candidate.approved = false;
          candidate.approvedAt = "";
          candidate.updatedAt = timestamp;
        }
      }
      sample.approved = true;
      sample.approvedAt = timestamp;
      sample.updatedAt = timestamp;
      await writeStore(store);
      return {
        schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
        sample: normalizeStoredSample(sample),
      };
    });
  }

  async function getApprovedCurrentSample({ ideaId, designBrief = {} } = {}) {
    const normalizedIdeaId = String(ideaId || "").trim();
    if (!normalizedIdeaId) throw makeHttpError("Skill idea id is required", 400, "skill_sample.idea_id_required");
    const store = await readStore();
    const currentHash = hashDesignBrief(designBrief);
    const sample = [...store.samples]
      .reverse()
      .find((candidate) => candidate.ideaId === normalizedIdeaId && candidate.approved);
    if (!sample) throw makeHttpError("No approved sample found for this skill idea", 409, "skill_sample.no_approved_sample");
    if (sample.designBriefHash !== currentHash) {
      throw makeHttpError("Approved sample is stale because the design brief changed", 409, "skill_sample.stale");
    }
    return normalizeStoredSample(sample);
  }

  async function listSamples({ ideaId = "" } = {}) {
    const store = await readStore();
    const samples = String(ideaId || "").trim()
      ? store.samples.filter((sample) => sample.ideaId === String(ideaId).trim())
      : store.samples;
    return {
      schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
      samples: samples.map(normalizeStoredSample),
    };
  }

  async function listSamplesForIdea({ ideaId = "", designBrief = {} } = {}) {
    const normalizedIdeaId = String(ideaId || "").trim();
    if (!normalizedIdeaId) throw makeHttpError("Skill idea id is required", 400, "skill_sample.idea_id_required");
    const store = await readStore();
    const currentHash = hashDesignBrief(designBrief);
    const samples = store.samples
      .filter((sample) => sample.ideaId === normalizedIdeaId)
      .map(normalizeStoredSample)
      .map((sample) => decorateSampleWithState(sample, currentHash));
    return {
      schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
      ideaId: normalizedIdeaId,
      designBriefHash: currentHash,
      samples,
    };
  }

  async function readStore() {
    let raw;
    try {
      raw = await readFile(storePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { schema_version: SKILL_SAMPLES_SCHEMA_VERSION, samples: [] };
      }
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw makeHttpError(`Invalid skill samples JSON at ${storePath}`, 500, "skill_samples.invalid_json");
    }
    if (parsed?.schema_version !== SKILL_SAMPLES_SCHEMA_VERSION) {
      throw makeHttpError(`Invalid skill samples schema at ${storePath}`, 500, "skill_samples.invalid_schema");
    }
    if (!Array.isArray(parsed.samples)) {
      throw makeHttpError(`Invalid skill samples store at ${storePath}`, 500, "skill_samples.invalid_store");
    }
    return {
      schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
      samples: parsed.samples.map(normalizeStoredSample),
    };
  }

  async function writeStore(store) {
    await persistence.writeStoreFile(store);
  }

  return {
    approveSample,
    getApprovedCurrentSample,
    hashDesignBrief,
    listSamples,
    listSamplesForIdea,
    recordSample,
    storePath,
  };
}

function serializeStore(store) {
  return formatJsonStore({
    schema_version: SKILL_SAMPLES_SCHEMA_VERSION,
    samples: store.samples.map(normalizeStoredSample),
  });
}

export function hashDesignBrief(designBrief = {}) {
  return createHash("sha256")
    .update(stableStringify(normalizeDesignBriefForHash(designBrief)))
    .digest("hex");
}

function normalizeStoredSample(sample = {}) {
  return {
    id: String(sample.id || sample.sample_id || "").trim(),
    ideaId: String(sample.ideaId || sample.idea_id || "").trim(),
    version: Number.isInteger(sample.version) && sample.version > 0 ? sample.version : 1,
    createdAt: String(sample.createdAt || sample.generated_at || "").trim(),
    updatedAt: String(sample.updatedAt || sample.createdAt || sample.generated_at || "").trim(),
    approved: Boolean(sample.approved),
    approvedAt: String(sample.approvedAt || "").trim(),
    designBriefHash: String(sample.designBriefHash || "").trim(),
    matter: normalizeSampleMatter(sample.matter),
    sampleMarkdown: boundedSampleMarkdown(sample.sampleMarkdown || sample.sample_markdown),
    feedback: String(sample.feedback || ""),
    aiRun: normalizeAiRun(sample.aiRun || sample.ai_run),
    warnings: Array.isArray(sample.warnings) ? sample.warnings.map((warning) => String(warning || "")).filter(Boolean).slice(0, 10) : [],
    rawSample: sample.rawSample && typeof sample.rawSample === "object" ? sample.rawSample : {},
  };
}

function normalizeSampleMatter(matter = {}) {
  return {
    matter_name: String(matter.matter_name || matter.matterName || "").trim(),
    folder_name: String(matter.folder_name || matter.folderName || "").trim(),
  };
}

function normalizeAiRun(aiRun = {}) {
  return normalizeAiRunMetadata(aiRun, {
    fields: AI_RUN_LEDGER_FIELDS,
    includeEmptyFields: true,
  });
}

function decorateSampleWithState(sample, currentHash) {
  const current = sample.designBriefHash === currentHash;
  const state = sample.approved
    ? current ? SKILL_SAMPLE_STATE.APPROVED_CURRENT : SKILL_SAMPLE_STATE.APPROVED_STALE
    : current ? SKILL_SAMPLE_STATE.CURRENT : SKILL_SAMPLE_STATE.STALE;
  return {
    ...sample,
    current,
    state,
  };
}

function boundedSampleMarkdown(value) {
  const markdown = String(value || "").trim();
  if (markdown.length > MAX_SAMPLE_MARKDOWN_LENGTH) {
    throw makeHttpError(`Skill sample Markdown must be ${MAX_SAMPLE_MARKDOWN_LENGTH} characters or less`, 400, "skill_sample.markdown_too_long");
  }
  return markdown;
}

function normalizeDesignBriefForHash(designBrief = {}) {
  const source = designBrief && typeof designBrief === "object" ? designBrief : {};
  return {
    intendedUser: String(source.intendedUser || "").trim(),
    problem: String(source.problem || "").trim(),
    expectedInputs: String(source.expectedInputs || "").trim(),
    expectedOutputArtifact: String(source.expectedOutputArtifact || "").trim(),
    targetLane: String(source.targetLane || "").trim(),
    paidPosture: String(source.paidPosture || "").trim(),
    riskLevel: String(source.riskLevel || "").trim(),
    notes: String(source.notes || "").trim(),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
