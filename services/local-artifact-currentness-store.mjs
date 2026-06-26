import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { formatJsonStore, writeJsonFileAtomic } from "./json-store-persistence.mjs";
import {
  ARTIFACT_CURRENTNESS_PROJECTION_SCHEMA_VERSION,
  normalizeArtifactCurrentnessRecord,
  normalizeArtifactCurrentnessRecords,
} from "./artifact-currentness-service.mjs";

export const ARTIFACT_CURRENTNESS_STORE_SCHEMA_VERSION = "matter-artifact-currentness/v1";
export const ARTIFACT_CURRENTNESS_RELATIVE = ".matter-workbench/artifact-currentness.json";

export function createLocalArtifactCurrentnessStore({
  matterRoot = "",
  storePath = "",
  now = () => new Date(),
} = {}) {
  const resolvedStorePath = storePath || path.join(matterRoot, ARTIFACT_CURRENTNESS_RELATIVE);
  if (!resolvedStorePath) throw new Error("storePath or matterRoot is required");
  let mutationQueue = Promise.resolve();

  async function readProjection() {
    const { records, warnings, updatedAt } = await readStoreFile(resolvedStorePath, { now });
    return {
      schema_version: ARTIFACT_CURRENTNESS_PROJECTION_SCHEMA_VERSION,
      store_schema_version: ARTIFACT_CURRENTNESS_STORE_SCHEMA_VERSION,
      storePath: resolvedStorePath,
      updatedAt,
      records,
      staleCount: records.filter((record) => record.state === "stale").length,
      needsReviewCount: records.filter((record) => record.state === "needs_review").length,
      warnings,
    };
  }

  async function upsertRecords(records = []) {
    return withStoreMutation(async () => {
      const existing = await readStoreFile(resolvedStorePath, { now });
      const normalizedRecords = normalizeArtifactCurrentnessRecords(records, { now });
      const mergedRecords = mergeRecords(existing.records, normalizedRecords);
      const updatedAt = isoNow(now);
      await mkdir(path.dirname(resolvedStorePath), { recursive: true });
      await writeJsonFileAtomic(resolvedStorePath, formatJsonStore({
        schema_version: ARTIFACT_CURRENTNESS_STORE_SCHEMA_VERSION,
        updated_at: updatedAt,
        records: mergedRecords,
      }));
      return {
        schema_version: ARTIFACT_CURRENTNESS_PROJECTION_SCHEMA_VERSION,
        store_schema_version: ARTIFACT_CURRENTNESS_STORE_SCHEMA_VERSION,
        storePath: resolvedStorePath,
        updatedAt,
        records: mergedRecords,
        staleCount: mergedRecords.filter((record) => record.state === "stale").length,
        needsReviewCount: mergedRecords.filter((record) => record.state === "needs_review").length,
        warnings: existing.warnings,
      };
    });
  }

  function withStoreMutation(operation) {
    const run = mutationQueue.then(operation);
    mutationQueue = run.catch(() => {});
    return run;
  }

  return {
    readProjection,
    storePath: resolvedStorePath,
    upsertRecords,
  };
}

export async function readLocalArtifactCurrentnessStore(storePath, { now = () => new Date() } = {}) {
  return readStoreFile(storePath, { now });
}

async function readStoreFile(storePath, { now = () => new Date() } = {}) {
  let raw = "";
  try {
    raw = await readFile(storePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], warnings: [], updatedAt: "" };
    return { records: [], warnings: [`Skipped unreadable ${path.basename(storePath)}: ${error.message}`], updatedAt: "" };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schema_version !== ARTIFACT_CURRENTNESS_STORE_SCHEMA_VERSION) {
      return {
        records: [],
        warnings: [`Skipped ${path.basename(storePath)} with unsupported schema_version.`],
        updatedAt: "",
      };
    }
    const records = (Array.isArray(parsed.records) ? parsed.records : [])
      .map((record) => {
        try {
          return normalizeArtifactCurrentnessRecord(record, { now });
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return {
      records,
      warnings: [],
      updatedAt: normalizeIso(parsed.updated_at || parsed.updatedAt) || "",
    };
  } catch (error) {
    return { records: [], warnings: [`Skipped invalid ${path.basename(storePath)}: ${error.message}`], updatedAt: "" };
  }
}

function mergeRecords(existing = [], updates = []) {
  const byKey = new Map();
  for (const record of existing) byKey.set(recordKey(record), record);
  for (const record of updates) byKey.set(recordKey(record), record);
  return [...byKey.values()].sort(compareRecords);
}

function recordKey(record = {}) {
  return `${record.artifactFamily || ""}\u0000${record.artifactPath || ""}`;
}

function compareRecords(a = {}, b = {}) {
  const family = String(a.artifactFamily || "").localeCompare(String(b.artifactFamily || ""));
  if (family) return family;
  return String(a.artifactPath || "").localeCompare(String(b.artifactPath || ""));
}

function normalizeIso(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isoNow(now = () => new Date()) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
