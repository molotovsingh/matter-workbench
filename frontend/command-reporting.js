import { formatConfigurableRunOutputDocumentState } from "./configurable-skill-run-labels.js";

export function normalizeTerminalLines(terminal) {
  if (terminal === undefined || terminal === null) return [];
  const values = Array.isArray(terminal) ? terminal : [terminal];
  return values.map((line) => String(line)).filter(Boolean);
}

export function formatCommandReport(report) {
  const lines = [
    "# Command Report",
    "",
    `- Matter: ${report.matterName || "Unknown"}`,
    `- Matter folder: ${report.matterFolder || "Unknown"}`,
    `- Timestamp: ${report.timestamp || ""}`,
    `- Typed input: \`${report.typedInput || ""}\``,
    `- Matched command: \`${report.matchedCommand || "none"}\``,
    `- Status: ${report.status || "unknown"}`,
  ];

  if (report.routerDecision) lines.push(`- Router/check result: ${report.routerDecision}${report.routerMatchedSkill ? ` -> ${report.routerMatchedSkill}` : ""}`);
  if (report.skillIdeaId) lines.push(`- Saved skill idea: ${report.skillIdeaId}`);
  if (report.sampleId) lines.push(`- Sample output: ${report.sampleId}`);
  if (report.plannerSource) lines.push(`- Planner: ${report.plannerModel || report.plannerSource}`);
  if (report.plannerFallbackReason) lines.push(`- Planner fallback reason: ${report.plannerFallbackReason}`);
  if (report.providerModel) lines.push(`- Provider/model: ${report.providerModel}`);
  if (report.runId) lines.push(`- Run id: ${report.runId}`);
  if (report.overwrite) lines.push(`- Output document: ${formatConfigurableRunOutputDocumentState(report.overwrite)}`);
  if (report.error) lines.push(`- Error: ${report.error}`);
  if (Array.isArray(report.artifacts) && report.artifacts.length) {
    lines.push("- Artifact paths touched/preserved:");
    for (const artifact of report.artifacts.slice(0, 8)) {
      lines.push(`  - \`${artifact}\``);
    }
  }
  if (report.statusBar) lines.push(`- Visible status: ${report.statusBar}`);
  if (Array.isArray(report.terminalLines) && report.terminalLines.length) {
    lines.push("", "## Latest Terminal Lines", "", "```text", ...report.terminalLines, "```");
  }
  return lines.join("\n");
}
