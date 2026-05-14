import { buildMatterContextPacket } from "./matter-context-service.mjs";
import { normalizeText } from "./configurable-skill-definition.mjs";

export const CONFIGURABLE_SKILL_CONTEXT_LIMITS = Object.freeze({
  maxSources: 40,
  maxBlocks: 70,
  maxCharsPerBlock: 900,
  maxLibraryArtifacts: 4,
});

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
    library_artifacts: (Array.isArray(packet?.library_artifacts) ? packet.library_artifacts : []).slice(0, 4),
    warnings: Array.isArray(packet?.warnings) ? packet.warnings.slice(0, 5) : [],
  };
}
