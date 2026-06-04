import { buildMatterContextPacket } from "./matter-context-service.mjs";
import { normalizeText } from "./configurable-skill-definition.mjs";

export const CONFIGURABLE_SKILL_CONTEXT_LIMITS = Object.freeze({
  maxSources: 40,
  maxBlocks: 70,
  maxCharsPerBlock: 900,
  maxLibraryArtifacts: 4,
  maxChronologyEntries: 80,
  maxChronologyMarkdownChars: 12_000,
});

const MAX_LIBRARY_ARTIFACTS = 4;
const MAX_CHRONOLOGY_ENTRIES_FOR_SKILL_RUN = 40;
const MAX_CHRONOLOGY_EVENT_CHARS = 350;
const MAX_CHRONOLOGY_RELEVANCE_CHARS = 350;

export async function buildConfigurableSkillMatterContextPacket(matterRoot) {
  return buildMatterContextPacket(matterRoot, CONFIGURABLE_SKILL_CONTEXT_LIMITS);
}

export function summarizeMatterContext(packet) {
  const blocks = Array.isArray(packet?.evidence_blocks) ? packet.evidence_blocks : [];
  const sources = Array.isArray(packet?.sources) ? packet.sources : [];
  return {
    schema_version: packet?.schema_version || "",
    matter: packet?.matter || {},
    counts: {
      sources: sources.length,
      evidence_blocks_included: blocks.length,
      evidence_blocks_omitted: Number(packet?.limits?.omitted_blocks || 0),
      library_artifacts: Array.isArray(packet?.library_artifacts) ? packet.library_artifacts.length : 0,
    },
    sources: sources.slice(0, 30).map((source) => ({
      file_id: source.file_id || "",
      source_label: source.source_label || "",
      source_short_label: source.source_short_label || "",
      document_type: source.document_type || "",
      sample_citations: Array.isArray(source.sample_citations) ? source.sample_citations.slice(0, 3) : [],
    })),
    evidence_blocks: blocks.slice(0, CONFIGURABLE_SKILL_CONTEXT_LIMITS.maxBlocks).map((block) => ({
      citation: block.citation || "",
      source_label: block.source_label || "",
      source_short_label: block.source_short_label || "",
      text: normalizeText(block.text).slice(0, CONFIGURABLE_SKILL_CONTEXT_LIMITS.maxCharsPerBlock),
    })),
    library_artifacts: summarizeLibraryArtifactsForSkillRun(packet?.library_artifacts),
    warnings: Array.isArray(packet?.warnings) ? packet.warnings.slice(0, 5) : [],
  };
}

function summarizeLibraryArtifactsForSkillRun(artifacts) {
  return (Array.isArray(artifacts) ? artifacts : [])
    .slice(0, MAX_LIBRARY_ARTIFACTS)
    .map((artifact) => {
      const kind = normalizeText(artifact?.kind);
      const base = {
        path: normalizeText(artifact?.path),
        kind,
        summary: normalizeText(artifact?.summary || artifact?.heading),
        entry_count: numberOrNull(artifact?.entry_count),
        source_count: numberOrNull(artifact?.source_count),
        generated_at: normalizeText(artifact?.generated_at),
        ai_run: summarizeAiRunForSkillRun(artifact?.ai_run),
      };

      if (kind === "list_of_dates") {
        const entries = Array.isArray(artifact?.entries) ? artifact.entries : [];
        const totalEntries = Number.isInteger(artifact?.entry_count) ? artifact.entry_count : entries.length;
        const includedEntries = entries
          .slice(0, MAX_CHRONOLOGY_ENTRIES_FOR_SKILL_RUN)
          .map(summarizeChronologyEntryForSkillRun);
        return {
          ...base,
          entry_count: totalEntries,
          entries_included: includedEntries.length,
          entries_omitted: Math.max(0, totalEntries - includedEntries.length),
          entries: includedEntries,
        };
      }

      if (kind === "list_of_dates_markdown") {
        return {
          ...base,
          markdown_available: Boolean(normalizeText(artifact?.markdown) || artifact?.char_count),
          markdown_truncated: Boolean(artifact?.markdown_truncated),
          char_count: numberOrNull(artifact?.char_count),
          line_count: numberOrNull(artifact?.line_count),
        };
      }

      return base;
    });
}

function summarizeChronologyEntryForSkillRun(entry = {}) {
  return {
    date_iso: normalizeText(entry.date_iso),
    date_text: normalizeText(entry.date_text),
    event: boundedText(entry.event, MAX_CHRONOLOGY_EVENT_CHARS),
    legal_relevance: boundedText(entry.legal_relevance, MAX_CHRONOLOGY_RELEVANCE_CHARS),
    issue_tags: Array.isArray(entry.issue_tags) ? entry.issue_tags.map(normalizeText).filter(Boolean).slice(0, 8) : [],
    perspective: normalizeText(entry.perspective),
    citation: normalizeText(entry.citation),
    source_label: normalizeText(entry.source_label),
    source_short_label: normalizeText(entry.source_short_label),
    needs_review: Boolean(entry.needs_review),
  };
}

function summarizeAiRunForSkillRun(aiRun = {}) {
  return {
    provider: normalizeText(aiRun.provider),
    model: normalizeText(aiRun.model),
    task: normalizeText(aiRun.task),
    policyPromptVersion: normalizeText(aiRun.policyPromptVersion),
  };
}

function boundedText(value, maxChars) {
  return normalizeText(value).slice(0, maxChars);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}
