import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  LIST_OF_DATES_JSON_RELATIVE,
  LIST_OF_DATES_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";

export async function readLibraryArtifactSummaries(root, limits, warnings) {
  const candidates = [
    SOURCE_INDEX_RELATIVE,
    LIST_OF_DATES_JSON_RELATIVE,
    LIST_OF_DATES_MARKDOWN_RELATIVE,
  ];
  const summaries = [];
  for (const relativePath of candidates) {
    if (summaries.length >= limits.maxLibraryArtifacts) break;
    const summary = await summarizeLibraryArtifact(root, relativePath, warnings);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

async function summarizeLibraryArtifact(root, relativePath, warnings) {
  const artifactPath = path.join(root, relativePath);
  let body = "";
  let info = null;
  try {
    body = await readFile(artifactPath, "utf8");
    info = await stat(artifactPath);
  } catch (error) {
    if (error.code !== "ENOENT") warnings.push(`Skipped library artifact ${relativePath}: ${error.message}`);
    return null;
  }

  if (relativePath.endsWith(".json")) {
    try {
      const json = JSON.parse(body);
      return summarizeJsonArtifact(relativePath, json, info);
    } catch (error) {
      warnings.push(`Skipped invalid JSON library artifact ${relativePath}: ${error.message}`);
      return null;
    }
  }

  if (relativePath.endsWith(".md")) {
    return {
      path: relativePath,
      kind: "markdown",
      heading: firstMarkdownHeading(body),
      char_count: body.length,
      line_count: body.split(/\r?\n/).length,
      mtime: info.mtime.toISOString(),
    };
  }

  return null;
}

function summarizeJsonArtifact(relativePath, json, info) {
  if (relativePath === SOURCE_INDEX_RELATIVE) {
    return {
      path: relativePath,
      kind: "source_index",
      schema_version: json.schema_version || "",
      summary: `${Array.isArray(json.sources) ? json.sources.length : 0} source descriptor(s)`,
      source_count: Array.isArray(json.sources) ? json.sources.length : 0,
      generated_at: json.generated_at || "",
      ai_run: sanitizeAiRun(json.ai_run),
      mtime: info.mtime.toISOString(),
    };
  }

  if (relativePath === LIST_OF_DATES_JSON_RELATIVE) {
    const entries = Array.isArray(json.entries) ? json.entries : [];
    return {
      path: relativePath,
      kind: "list_of_dates",
      schema_version: json.schema_version || "",
      summary: `${entries.length} accepted chronology entr${entries.length === 1 ? "y" : "ies"} with preserved raw citations`,
      entry_count: entries.length,
      generated_at: json.generated_at || "",
      ai_run: sanitizeAiRun(json.ai_run),
      mtime: info.mtime.toISOString(),
    };
  }

  return {
    path: relativePath,
    kind: "json",
    schema_version: json.schema_version || "",
    summary: "Selected JSON library artifact",
    mtime: info.mtime.toISOString(),
  };
}

function sanitizeAiRun(aiRun = {}) {
  if (!aiRun || typeof aiRun !== "object") return null;
  const sanitized = {};
  for (const key of [
    "policyVersion",
    "task",
    "tier",
    "provider",
    "model",
    "maxOutputTokens",
    "fallback",
    "returnedModel",
    "returnedProvider",
  ]) {
    if (aiRun[key] !== undefined && aiRun[key] !== null && aiRun[key] !== "") {
      sanitized[key] = aiRun[key];
    }
  }
  if (aiRun.usage && typeof aiRun.usage === "object") {
    sanitized.usage = {};
    for (const key of ["promptTokens", "completionTokens", "totalTokens", "cost"]) {
      if (aiRun.usage[key] !== undefined && aiRun.usage[key] !== null) sanitized.usage[key] = aiRun.usage[key];
    }
  }
  return Object.keys(sanitized).length ? sanitized : null;
}

function firstMarkdownHeading(markdown) {
  const line = String(markdown || "").split(/\r?\n/).find((candidate) => /^#\s+/.test(candidate));
  return line ? line.replace(/^#\s+/, "").trim() : "";
}
