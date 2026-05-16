import { SOURCE_INDEX_RELATIVE } from "../shared/matter-artifacts.mjs";

export const MATTER_CONTEXT_PREVIEW_SCHEMA_VERSION = "matter-context-preview/v1";

export function summarizeMatterContextPacket(packet) {
  const warnings = Array.isArray(packet?.warnings) ? [...packet.warnings] : [];
  const libraryArtifacts = Array.isArray(packet?.library_artifacts) ? packet.library_artifacts : [];
  const hasSourceIndex = libraryArtifacts.some((artifact) => artifact.path === SOURCE_INDEX_RELATIVE);
  if (!hasSourceIndex) {
    warnings.push("10_Library/Source Index.json not found; source labels may be blank.");
  }

  const fileRegisters = Array.isArray(packet?.file_registers) ? packet.file_registers : [];
  const sources = Array.isArray(packet?.sources) ? packet.sources : [];
  const evidenceBlocks = Array.isArray(packet?.evidence_blocks) ? packet.evidence_blocks : [];

  return {
    schema_version: MATTER_CONTEXT_PREVIEW_SCHEMA_VERSION,
    packet_schema_version: packet?.schema_version || "",
    generated_at: packet?.generated_at || "",
    matter: packet?.matter || {},
    counts: {
      file_registers: fileRegisters.length,
      registered_files: fileRegisters.reduce((sum, register) => sum + (Array.isArray(register.rows) ? register.rows.length : 0), 0),
      sources: sources.length,
      evidence_blocks_included: evidenceBlocks.length,
      evidence_blocks_omitted: Number(packet?.limits?.omitted_blocks || 0),
      library_artifacts: libraryArtifacts.length,
      warnings: warnings.length,
    },
    limits: packet?.limits || {},
    source_index_present: hasSourceIndex,
    warnings,
    library_artifacts: libraryArtifacts.map((artifact) => ({
      path: artifact.path || "",
      kind: artifact.kind || "",
      summary: artifact.summary || artifact.heading || "",
      schema_version: artifact.schema_version || "",
      source_count: artifact.source_count ?? null,
      entry_count: artifact.entry_count ?? null,
    })),
    top_sources: sources.slice(0, 12).map((source) => ({
      source_id: source.source_id || source.file_id || "",
      content_hash: source.content_hash || source.sha256 || "",
      file_id: source.file_id || "",
      source_label: source.source_label || "",
      source_short_label: source.source_short_label || "",
      document_type: source.document_type || "",
      source_path: source.source_path || "",
      needs_review: Boolean(source.needs_review),
      sample_citations: Array.isArray(source.sample_citations) && source.sample_citations.length
        ? source.sample_citations
        : evidenceBlocks
          .filter((block) => block.file_id === source.file_id)
          .slice(0, 3)
          .map((block) => block.citation),
    })),
  };
}
