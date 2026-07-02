import { readFile } from "node:fs/promises";
import path from "node:path";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";

const LEDGER_SCHEMA_VERSION = "native-skill-run-state-ledger/v1";
const RUN_ID_PATTERN = /^job_[a-z0-9][a-z0-9_.:-]{0,120}$/i;
const STAGE_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;

export function createNativeSkillRunStateService({
  appDir = process.cwd(),
  statePath,
  now = () => new Date(),
} = {}) {
  const storePath = statePath || path.join(path.resolve(appDir || process.cwd()), ".local", "native-skill-run-state.json");
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: (store) => formatJsonStore(normalizeStore(store)),
  });

  async function loadStore() {
    try {
      return normalizeStore(JSON.parse(await readFile(storePath, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async function writeStageState({ runId, stageId, value, summary = "" } = {}) {
    const normalizedRunId = normalizeRunId(runId);
    const normalizedStageId = normalizeStageId(stageId);
    if (!normalizedRunId) throw new Error("run id is required");
    if (!normalizedStageId) throw new Error("stage id is required");
    return persistence.withStoreMutation(async () => {
      const store = await loadStore();
      const writtenAt = isoNow(now);
      const entry = normalizeStageState({
        runId: normalizedRunId,
        stageId: normalizedStageId,
        value,
        summary,
        writtenAt,
      });
      const index = store.stageStates.findIndex((item) => item.runId === normalizedRunId && item.stageId === normalizedStageId);
      if (index >= 0) store.stageStates[index] = entry;
      else store.stageStates.push(entry);
      await persistence.writeStoreFile(store);
      return entry;
    });
  }

  async function readStageState({ runId, stageId } = {}) {
    const normalizedRunId = normalizeRunId(runId);
    const normalizedStageId = normalizeStageId(stageId);
    if (!normalizedRunId || !normalizedStageId) return null;
    const store = await loadStore();
    const entry = store.stageStates.find((item) => item.runId === normalizedRunId && item.stageId === normalizedStageId);
    return entry || null;
  }

  async function readStageValue({ runId, stageId } = {}) {
    const entry = await readStageState({ runId, stageId });
    return entry ? entry.value : null;
  }

  async function listRunStageStates(runId) {
    const normalizedRunId = normalizeRunId(runId);
    if (!normalizedRunId) return [];
    const store = await loadStore();
    return store.stageStates.filter((item) => item.runId === normalizedRunId);
  }

  return {
    writeStageState,
    readStageState,
    readStageValue,
    listRunStageStates,
  };
}

function emptyStore() {
  return { schema_version: LEDGER_SCHEMA_VERSION, stageStates: [] };
}

function normalizeStore(store = {}) {
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    stageStates: (Array.isArray(store.stageStates) ? store.stageStates : [])
      .map(normalizeStageState)
      .filter(Boolean)
      .slice(-1000),
  };
}

function normalizeStageState(entry = {}) {
  const runId = normalizeRunId(entry.runId);
  const stageId = normalizeStageId(entry.stageId);
  if (!runId || !stageId) return null;
  return {
    runId,
    stageId,
    writtenAt: normalizeIso(entry.writtenAt) || isoNow(() => new Date()),
    ...(entry.summary ? { summary: normalizeText(entry.summary, 500) } : {}),
    value: normalizeJsonValue(entry.value),
  };
}

function normalizeJsonValue(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeRunId(value) {
  const text = String(value || "").trim();
  return RUN_ID_PATTERN.test(text) ? text : "";
}

function normalizeStageId(value) {
  const text = String(value || "").trim().toLowerCase();
  return STAGE_ID_PATTERN.test(text) ? text : "";
}

function normalizeIso(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function normalizeText(value, maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isoNow(now) {
  const value = now();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
