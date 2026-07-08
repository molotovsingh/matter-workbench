import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AI_RUN_CONTEXT_FIELDS, normalizeAiRunMetadata } from "../shared/ai-run-metadata.mjs";
import {
  CASE_TIMELINE_JSON_RELATIVE_CANDIDATES,
  CASE_TIMELINE_MARKDOWN_RELATIVE_CANDIDATES,
  SOURCE_INDEX_RELATIVE,
  isCaseTimelineReadModelPath,
} from "../shared/matter-artifacts.mjs";
import {
  hasSuppressedCitation,
  isSourceSuppressed,
} from "./active-source-set-service.mjs";

export async function readLibraryArtifactSummaries(root, limits, warnings, { sourceSuppressionIndex = null } = {}) {
  const candidateGroups = [
    [SOURCE_INDEX_RELATIVE],
    CASE_TIMELINE_JSON_RELATIVE_CANDIDATES,
    CASE_TIMELINE_MARKDOWN_RELATIVE_CANDIDATES,
  ];
  const summaries = [];
  for (const relativePaths of candidateGroups) {
    if (summaries.length >= limits.maxLibraryArtifacts) break;
    const summary = await summarizeFirstExistingLibraryArtifact(root, relativePaths, limits, warnings, { sourceSuppressionIndex });
    if (summary) summaries.push(summary);
  }
  return summaries;
}

async function summarizeFirstExistingLibraryArtifact(root, relativePaths, limits, warnings, options = {}) {
  for (const relativePath of relativePaths) {
    const summary = await summarizeLibraryArtifact(root, relativePath, limits, warnings, options);
    if (summary) return summary;
  }
  return null;
}

async function summarizeLibraryArtifact(root, relativePath, limits, warnings, { sourceSuppressionIndex = null } = {}) {
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
      return summarizeJsonArtifact(relativePath, json, info, limits, warnings, { sourceSuppressionIndex });
    } catch (error) {
      warnings.push(`Skipped invalid JSON library artifact ${relativePath}: ${error.message}`);
      return null;
    }
  }

  if (relativePath.endsWith(".md")) {
    if (isCaseTimelineReadModelPath(relativePath) && hasSuppressedCitation(body, sourceSuppressionIndex)) {
      warnings.push(`Skipped ${relativePath}: cites suppressed source(s)`);
      return null;
    }
    const maxChars = Number.isInteger(limits.maxChronologyMarkdownChars) ? limits.maxChronologyMarkdownChars : 32000;
    const markdown = boundedText(body, maxChars);
    return {
      path: relativePath,
      kind: isCaseTimelineReadModelPath(relativePath) ? "list_of_dates_markdown" : "markdown",
      heading: firstMarkdownHeading(body),
      markdown,
      markdown_truncated: markdown.length < normalizeText(body).length,
      char_count: body.length,
      line_count: body.split(/\r?\n/).length,
      mtime: info.mtime.toISOString(),
    };
  }

  return null;
}

function summarizeJsonArtifact(relativePath, json, info, limits = {}, warnings = [], { sourceSuppressionIndex = null } = {}) {
  if (relativePath === SOURCE_INDEX_RELATIVE) {
    const sources = Array.isArray(json.sources) ? json.sources : [];
    const activeSources = sources.filter((source) => !isSourceSuppressed(source, sourceSuppressionIndex));
    const suppressedCount = sources.length - activeSources.length;
    if (suppressedCount > 0) warnings.push(`Suppressed ${suppressedCount} Source Index descriptor(s) from active context`);
    return {
      path: relativePath,
      kind: "source_index",
      schema_version: json.schema_version || "",
      summary: `${activeSources.length} active source descriptor(s)`,
      source_count: activeSources.length,
      source_count_total: sources.length,
      sources_suppressed: suppressedCount,
      generated_at: json.generated_at || "",
      ai_run: sanitizeAiRun(json.ai_run),
      mtime: info.mtime.toISOString(),
    };
  }

  if (isCaseTimelineReadModelPath(relativePath)) {
    const entries = Array.isArray(json.entries) ? json.entries : [];
    const activeEntries = entries.filter((entry) => !chronologyEntryHasSuppressedCitation(entry, sourceSuppressionIndex));
    const suppressedCount = entries.length - activeEntries.length;
    if (suppressedCount > 0) warnings.push(`Suppressed ${suppressedCount} Case Timeline entr${suppressedCount === 1 ? "y" : "ies"} from active context`);
    const maxEntries = Number.isInteger(limits.maxChronologyEntries) ? limits.maxChronologyEntries : 120;
    const includedEntries = activeEntries.slice(0, maxEntries);
    return {
      path: relativePath,
      kind: "list_of_dates",
      schema_version: json.schema_version || "",
      summary: `${activeEntries.length} active chronology entr${activeEntries.length === 1 ? "y" : "ies"} with preserved raw citations`,
      entry_count: activeEntries.length,
      entry_count_total: entries.length,
      entries_suppressed: suppressedCount,
      entries_included: includedEntries.length,
      entries_omitted: Math.max(0, activeEntries.length - includedEntries.length),
      entries: includedEntries.map(summarizeChronologyEntry),
      citation_index: activeEntries.map(summarizeChronologyCitation).filter((entry) => entry.citation),
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

function summarizeChronologyCitation(entry = {}) {
  return {
    citation: normalizeText(entry.citation),
    source_label: normalizeText(entry.source_label),
    source_short_label: normalizeText(entry.source_short_label),
    source_excerpt: boundedText(entry.source_excerpt, 300),
    event: boundedText(entry.event, 300),
  };
}

function chronologyEntryHasSuppressedCitation(entry = {}, sourceSuppressionIndex = null) {
  if (hasSuppressedCitation(entry.citation, sourceSuppressionIndex)) return true;
  if (hasSuppressedCitation(entry.source_label, sourceSuppressionIndex)) return true;
  if (hasSuppressedCitation(entry.source_short_label, sourceSuppressionIndex)) return true;
  if (!Array.isArray(entry.supporting_sources)) return false;
  return entry.supporting_sources.some((source) => (
    hasSuppressedCitation(source?.citation, sourceSuppressionIndex)
    || hasSuppressedCitation(source?.source_label, sourceSuppressionIndex)
    || hasSuppressedCitation(source?.source_short_label, sourceSuppressionIndex)
  ));
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
