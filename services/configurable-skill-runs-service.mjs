import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { AI_RUN_LEDGER_FIELDS, normalizeAiRunMetadata } from "../shared/ai-run-metadata.mjs";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import { deriveConfigurableSkillRunReceipt } from "../shared/configurable-skill-run-receipts.mjs";
import { makeHttpError, resolveRelativeInside } from "../shared/safe-paths.mjs";

export const CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION = "configurable-skill-runs/v1";
export const CONFIGURABLE_SKILL_RUN_SCHEMA_VERSION = "configurable-skill-run-ledger/v1";

const VALID_STATUSES = new Set(["running", "succeeded", "failed", "cancelled"]);
const VALID_OVERWRITE_STATES = new Set(["not_needed", "prompted", "approved", "cancelled"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function createConfigurableSkillRunsService({
  appDir,
  runsPath,
  now = () => new Date(),
  idFactory = () => `run_${randomUUID()}`,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = runsPath || path.join(root, "configurable-skill-runs.json");
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: serializeStore,
  });

  async function createRun(entry = {}) {
    return persistence.withStoreMutation(async () => {
      const store = await readStore();
      const timestamp = now().toISOString();
      const record = normalizeRunRecord({
        ...entry,
        id: entry.id || idFactory(),
        status: entry.status || "running",
        startedAt: entry.startedAt || timestamp,
        finishedAt: entry.finishedAt || "",
      });
      store.runs.push(record);
      await writeStore(store);
      return record;
    });
  }

  async function updateRun(id, patch = {}) {
    const runId = normalizeText(id);
    if (!runId) throw makeHttpError("Run id is required", 400);
    return persistence.withStoreMutation(async () => {
      const store = await readStore();
      const index = store.runs.findIndex((run) => run.id === runId);
      if (index === -1) throw makeHttpError(`Configurable skill run ${runId} was not found`, 404);
      const next = normalizeRunRecord({
        ...store.runs[index],
        ...patch,
        finishedAt: patch.finishedAt || (
          TERMINAL_STATUSES.has(patch.status) && !store.runs[index].finishedAt
            ? now().toISOString()
            : store.runs[index].finishedAt
        ),
      });
      store.runs[index] = next;
      await writeStore(store);
      return next;
    });
  }

  async function recordCancelledRun(entry = {}) {
    return createRun({
      ...entry,
      status: "cancelled",
      overwrite: "cancelled",
      finishedAt: now().toISOString(),
    });
  }

  async function listRuns({
    slash = "",
    skillId = "",
    matterFolder = "",
    limit = DEFAULT_LIMIT,
  } = {}) {
    const store = await readStore();
    const normalizedSlash = normalizeText(slash);
    const normalizedSkillId = normalizeText(skillId);
    const normalizedMatterFolder = normalizeText(matterFolder);
    const normalizedLimit = normalizeLimit(limit);
    let runs = store.runs;
    if (normalizedSlash) runs = runs.filter((run) => run.slash === normalizedSlash);
    if (normalizedSkillId) runs = runs.filter((run) => run.skillId === normalizedSkillId);
    if (normalizedMatterFolder) runs = runs.filter((run) => run.matterFolder === normalizedMatterFolder);
    runs = [...runs].sort(compareRunsNewestFirst).slice(0, normalizedLimit);
    const annotatedRuns = await Promise.all(runs.map(annotateRun));
    return {
      schema_version: CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION,
      runs: annotatedRuns,
    };
  }

  async function readStore() {
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8"));
      if (parsed?.schema_version !== CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION || !Array.isArray(parsed.runs)) {
        throw makeHttpError(`Invalid configurable skill runs store at ${storePath}`, 500);
      }
      return {
        schema_version: CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION,
        runs: parsed.runs.map(normalizeRunRecord),
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { schema_version: CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION, runs: [] };
      }
      throw error;
    }
  }

  async function writeStore(store) {
    await persistence.writeStoreFile(store);
  }

  return {
    annotateRun,
    createRun,
    listRuns,
    recordCancelledRun,
    storePath,
    updateRun,
  };
}

async function annotateRun(run = {}) {
  const normalized = normalizeRunRecord(run);
  const outputAvailability = {
    markdown: await outputPathAvailability(normalized, normalized.outputPaths.markdown),
    json: await outputPathAvailability(normalized, normalized.outputPaths.json),
  };
  const annotated = {
    ...normalized,
    outputAvailability,
  };
  return {
    ...annotated,
    receipt: deriveConfigurableSkillRunReceipt(annotated),
  };
}

async function outputPathAvailability(run = {}, relativePath = "") {
  const outputPath = normalizeText(relativePath);
  if (!outputPath) return "not_recorded";
  if (!run.matterRoot) return "unknown";
  try {
    await access(resolveRelativeInside(run.matterRoot, outputPath));
    return "present";
  } catch (error) {
    if (error?.code === "ENOENT" || error?.statusCode === 400 || error?.statusCode === 403) return "missing";
    return "unknown";
  }
}

function serializeStore(store) {
  return formatJsonStore({
    schema_version: CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION,
    runs: store.runs.map(normalizeRunRecord),
  });
}

export function normalizeRunRecord(record = {}) {
  return {
    schema_version: CONFIGURABLE_SKILL_RUN_SCHEMA_VERSION,
    id: normalizeText(record.id),
    skillId: normalizeText(record.skillId),
    slash: normalizeText(record.slash),
    title: normalizeText(record.title),
    matterName: normalizeText(record.matterName),
    matterFolder: normalizeText(record.matterFolder),
    matterRoot: normalizeText(record.matterRoot),
    status: VALID_STATUSES.has(record.status) ? record.status : "running",
    startedAt: normalizeText(record.startedAt),
    finishedAt: normalizeText(record.finishedAt),
    outputPaths: normalizeOutputPaths(record.outputPaths),
    aiRun: normalizeAiRun(record.aiRun),
    warnings: normalizeWarnings(record.warnings),
    overwrite: VALID_OVERWRITE_STATES.has(record.overwrite) ? record.overwrite : "not_needed",
    errorMessage: normalizeText(record.errorMessage, 800),
  };
}

function normalizeOutputPaths(outputPaths = {}) {
  return {
    markdown: normalizeText(outputPaths.markdown),
    json: normalizeText(outputPaths.json),
  };
}

function normalizeAiRun(aiRun = {}) {
  return normalizeAiRunMetadata(aiRun, {
    fields: AI_RUN_LEDGER_FIELDS,
    includeEmptyFields: true,
  });
}

function normalizeWarnings(warnings = []) {
  return (Array.isArray(warnings) ? warnings : warnings ? [warnings] : [])
    .map((warning) => normalizeText(warning, 800))
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeText(value, maxLength = 1200) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(number), MAX_LIMIT);
}

function compareRunsNewestFirst(a, b) {
  const left = Date.parse(a.finishedAt || a.startedAt || "") || 0;
  const right = Date.parse(b.finishedAt || b.startedAt || "") || 0;
  if (right !== left) return right - left;
  return String(b.id || "").localeCompare(String(a.id || ""));
}
