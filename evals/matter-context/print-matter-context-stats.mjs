#!/usr/bin/env node
import { buildMatterContextPacket } from "../../services/matter-context-service.mjs";

const matterRoot = process.argv[2] || process.env.MATTER_ROOT;

if (!matterRoot) {
  console.error("Usage: node evals/matter-context/print-matter-context-stats.mjs <matter-root>");
  console.error("   or: MATTER_ROOT=/path/to/matter node evals/matter-context/print-matter-context-stats.mjs");
  process.exit(2);
}

try {
  const packet = await buildMatterContextPacket(matterRoot);
  console.log(JSON.stringify({
    schema_version: packet.schema_version,
    generated_at: packet.generated_at,
    matter: {
      folder_name: packet.matter.folder_name,
      matter_name: packet.matter.matter_name,
      client_name: packet.matter.client_name,
      opposite_party: packet.matter.opposite_party,
    },
    file_registers: packet.file_registers.length,
    registered_files: packet.file_registers.reduce((sum, register) => sum + register.rows.length, 0),
    sources: packet.sources.length,
    evidence_blocks: packet.evidence_blocks.length,
    library_artifacts: packet.library_artifacts.map((artifact) => ({
      path: artifact.path,
      kind: artifact.kind,
      summary: artifact.summary || artifact.heading || "",
    })),
    limits: packet.limits,
    warnings: packet.warnings,
  }, null, 2));
} catch (error) {
  console.error(`[matter-context-stats] failed: ${error.message}`);
  process.exit(1);
}
