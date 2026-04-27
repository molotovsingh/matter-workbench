import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPENAI_KEY_PATTERN = /^sk-[A-Za-z0-9_-]+$/;

export function parseEnvText(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const assignment = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex > 0) {
      const key = assignment.slice(0, equalsIndex).trim();
      if (!ENV_KEY_PATTERN.test(key)) continue;
      values[key] = cleanEnvValue(assignment.slice(equalsIndex + 1));
      continue;
    }

    if (!values.OPENAI_API_KEY && OPENAI_KEY_PATTERN.test(assignment)) {
      values.OPENAI_API_KEY = assignment;
    }
  }
  return values;
}

export async function loadLocalEnv({ appDir, targetEnv = process.env, override = false } = {}) {
  const root = path.resolve(appDir || process.cwd());
  const candidatePaths = [...new Set([
    path.join(path.dirname(root), ".env"),
    path.join(root, ".env"),
  ])];
  const loaded = {};
  const loadedPaths = [];

  for (const envPath of candidatePaths) {
    try {
      Object.assign(loaded, parseEnvText(await readFile(envPath, "utf8")));
      loadedPaths.push(envPath);
    } catch {
      // Missing .env files are fine; explicit env vars still work.
    }
  }

  for (const [key, value] of Object.entries(loaded)) {
    if (override || targetEnv[key] === undefined) targetEnv[key] = value;
  }

  return {
    env: targetEnv,
    loadedKeys: Object.keys(loaded),
    loadedPaths,
  };
}

export async function upsertLocalEnv({ appDir, values }) {
  const envPath = path.join(path.resolve(appDir || process.cwd()), ".env");
  let text = "";
  try {
    text = await readFile(envPath, "utf8");
  } catch {
    // A missing .env will be created below.
  }

  const pending = new Map(Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]));
  const lines = text ? text.split(/\r?\n/) : [];
  const nextLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex > 0) {
      const key = normalized.slice(0, equalsIndex).trim();
      if (pending.has(key)) {
        nextLines.push(`${key}=${envEscape(pending.get(key))}`);
        pending.delete(key);
        continue;
      }
    } else if (pending.has("OPENAI_API_KEY") && OPENAI_KEY_PATTERN.test(normalized)) {
      nextLines.push(`OPENAI_API_KEY=${envEscape(pending.get("OPENAI_API_KEY"))}`);
      pending.delete("OPENAI_API_KEY");
      continue;
    }
    nextLines.push(rawLine);
  }

  for (const [key, value] of pending.entries()) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") nextLines.push("");
    nextLines.push(`${key}=${envEscape(value)}`);
  }

  await writeFile(envPath, `${trimTrailingBlankLines(nextLines).join("\n")}\n`);
  return envPath;
}

function cleanEnvValue(rawValue) {
  let value = String(rawValue || "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r");
}

function envEscape(value) {
  const text = String(value ?? "");
  return /[\s#"'\\]/.test(text)
    ? `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`
    : text;
}

function trimTrailingBlankLines(lines) {
  const next = [...lines];
  while (next.length && next[next.length - 1] === "") next.pop();
  return next;
}
