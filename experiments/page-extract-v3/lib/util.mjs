import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function safeId(value, label = "id") {
  const result = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(result)) {
    throw new Error(`${label} must use only letters, digits, underscore, and hyphen`);
  }
  return result;
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

export async function atomicWriteJson(filePath, value) {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteFile(filePath, value) {
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, target);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeReferenceText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

export function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFor(item) || "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const values = Array.from(items || []);
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(values.length || 1, Math.max(1, Math.trunc(Number(concurrency) || 1))) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function elapsedMs(startedAt, finishedAt) {
  const start = Date.parse(String(startedAt || ""));
  const finish = Date.parse(String(finishedAt || ""));
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return 0;
  return Math.max(0, finish - start);
}

function percentile(sorted, quantile) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}
