import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AI_RUN_CONTEXT_FIELDS, normalizeAiRunMetadata } from "../shared/ai-run-metadata.mjs";
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
    const summary = await summarizeLibraryArtifact(root, relativePath, limits, warnings);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

async function summarizeLibraryArtifact(root, relativePath, limits, warnings) {
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
      return summarizeJsonArtifact(relativePath, json, info, limits);
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

function summarizeJsonArtifact(relativePath, json, info, limits = {}) {
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
    const maxEntries = Number.isInteger(limits.maxChronologyEntries) ? limits.maxChronologyEntries : 120;
    const includedEntries = entries.slice(0, maxEntries);
    return {
      path: relativePath,
      kind: "list_of_dates",
      schema_version: json.schema_version || "",
      summary: `${entries.length} accepted chronology entr${entries.length === 1 ? "y" : "ies"} with preserved raw citations`,
      entry_count: entries.length,
      entries_included: includedEntries.length,
      entries_omitted: Math.max(0, entries.length - includedEntries.length),
      entries: includedEntries.map(summarizeChronologyEntry),
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

function summarizeChronologyEntry(entry = {}) {
  return {
    date_iso: normalizeText(entry.date_iso),
    date_text: normalizeText(entry.date_text),
    event: boundedText(entry.event, 900),
    legal_relevance: boundedText(entry.legal_relevance, 700),
    issue_tags: Array.isArray(entry.issue_tags) ? entry.issue_tags.map(normalizeText).filter(Boolean).slice(0, 8) : [],
    perspective: normalizeText(entry.perspective),
    citation: normalizeText(entry.citation),
    source_label: normalizeText(entry.source_label),
    source_short_label: normalizeText(entry.source_short_label),
    source_excerpt: boundedText(entry.source_excerpt, 700),
    needs_review: Boolean(entry.needs_review),
    supporting_sources: Array.isArray(entry.supporting_sources)
      ? entry.supporting_sources.slice(0, 4).map((source) => ({
          citation: normalizeText(source.citation),
          source_label: normalizeText(source.source_label),
          source_short_label: normalizeText(source.source_short_label),
          event: boundedText(source.event, 400),
        }))
      : [],
  };
}

function sanitizeAiRun(aiRun = {}) {
  return normalizeAiRunMetadata(aiRun, {
    fields: AI_RUN_CONTEXT_FIELDS,
    includeUsage: true,
  });
}

function firstMarkdownHeading(markdown) {
  const line = String(markdown || "").split(/\r?\n/).find((candidate) => /^#\s+/.test(candidate));
  return line ? line.replace(/^#\s+/, "").trim() : "";
}

function boundedText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length > maxLength) return text.slice(0, maxLength).trimEnd();
  return text;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
