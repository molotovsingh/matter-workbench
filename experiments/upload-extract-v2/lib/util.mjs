import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function atomicWriteJson(filePath, value) {
  return atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, value, { mode: 0o600 });
  await rename(tempPath, filePath);
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function removeIfExists(filePath) {
  await rm(filePath, { force: true, recursive: true });
}

export async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) throw new Error("relative path is required");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`unsafe relative path: ${normalized}`);
  }
  return parts.join("/");
}

export function isFilteredUploadPath(value) {
  const parts = normalizeRelativePath(value).split("/");
  return parts.some((part) => (
    part === ".DS_Store"
    || part === "Thumbs.db"
    || part === "desktop.ini"
    || part.startsWith("~$")
    || part.startsWith(".")
  ));
}

export function safeExperimentId(value, label = "id") {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id)) {
    throw new Error(`${label} must use only letters, digits, underscore, and hyphen`);
  }
  return id;
}

export function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(max, Math.trunc(parsed));
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const count = Math.min(Math.max(1, positiveInteger(concurrency, 1)), Math.max(1, items.length));
  const workers = Array.from({ length: count }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function nowIso() {
  return new Date().toISOString();
}

export function elapsedMs(startedAt, finishedAt = nowIso()) {
  const start = Date.parse(String(startedAt || ""));
  const finish = Date.parse(String(finishedAt || ""));
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return 0;
  return Math.max(0, finish - start);
}

export function summarizeNumbers(values = []) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return { count: 0, sum: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0 };
  const sum = numbers.reduce((total, value) => total + value, 0);
  return {
    count: numbers.length,
    sum,
    min: numbers[0],
    max: numbers.at(-1),
    mean: sum / numbers.length,
    p50: percentile(numbers, 0.5),
    p95: percentile(numbers, 0.95),
  };
}

function percentile(sorted, quantile) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

export function sessionDir(root, sessionId) {
  return path.join(path.resolve(root), "sessions", safeExperimentId(sessionId, "session id"));
}

export function sessionManifestPath(root, sessionId) {
  return path.join(sessionDir(root, sessionId), "session.json");
}

export function objectPath(root, sessionId, fileIndex) {
  return path.join(sessionDir(root, sessionId), "objects", `${String(fileIndex).padStart(6, "0")}.blob`);
}

export function extractionRecordPath(root, sessionId, fileIndex) {
  return path.join(sessionDir(root, sessionId), "extracted", `${String(fileIndex).padStart(6, "0")}.json`);
}

export function extractionTextPath(root, sessionId, fileIndex) {
  return path.join(sessionDir(root, sessionId), "extracted", `${String(fileIndex).padStart(6, "0")}.txt`);
}
