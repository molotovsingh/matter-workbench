import { formatConfigurableRunOutputDocumentState } from "./configurable-skill-run-labels.js";

export const REDACTED_SECRET = "[redacted-secret]";

export function redactSensitiveText(value = "") {
  return String(value)
    .replace(/\b(OPENAI_API_KEY|OPENROUTER_API_KEY|MISTRAL_API_KEY)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi, `$1=${REDACTED_SECRET}`)
    .replace(/\bBearer\s+sk-[A-Za-z0-9_-]+/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(/\bsk-[A-Za-z0-9_-]+/g, REDACTED_SECRET);
}

export function normalizeTerminalLines(terminal) {
  if (terminal === undefined || terminal === null) return [];
  const values = Array.isArray(terminal) ? terminal : [terminal];
  return values.map((line) => String(line)).filter(Boolean);
}

export function formatCommandReport(report) {
  const lines = [
    "# Command Report",
    "",
    `- Matter: ${redactSensitiveText(report.matterName || "Unknown")}`,
    `- Matter folder: ${redactSensitiveText(report.matterFolder || "Unknown")}`,
    `- Timestamp: ${redactSensitiveText(report.timestamp || "")}`,
    `- Typed input: \`${redactSensitiveText(report.typedInput || "")}\``,
    `- Matched command: \`${redactSensitiveText(report.matchedCommand || "none")}\``,
    `- Status: ${redactSensitiveText(report.status || "unknown")}`,
  ];

  if (report.routerDecision) lines.push(`- Router/check result: ${redactSensitiveText(report.routerDecision)}${report.routerMatchedSkill ? ` -> ${redactSensitiveText(report.routerMatchedSkill)}` : ""}`);
  if (report.skillIdeaId) lines.push(`- Saved skill idea: ${redactSensitiveText(report.skillIdeaId)}`);
  if (report.sampleId) lines.push(`- Sample output: ${redactSensitiveText(report.sampleId)}`);
  if (report.skillName) lines.push(`- Skill: ${redactSensitiveText(report.skillName)}`);
  if (report.plannerSource) lines.push(`- Planner: ${redactSensitiveText(report.plannerModel || report.plannerSource)}`);
  if (report.plannerFallbackReason) lines.push(`- Planner fallback reason: ${redactSensitiveText(report.plannerFallbackReason)}`);
  if (report.providerModel) lines.push(`- Provider/model: ${redactSensitiveText(report.providerModel)}`);
  if (report.runId) lines.push(`- Run id: ${redactSensitiveText(report.runId)}`);
  if (report.overwrite) lines.push(`- Output document: ${formatConfigurableRunOutputDocumentState(report.overwrite)}`);
  if (report.error) lines.push(`- Error: ${redactSensitiveText(report.error)}`);
  if (Array.isArray(report.artifacts) && report.artifacts.length) {
    lines.push("- Artifact paths touched/preserved:");
    for (const artifact of report.artifacts.slice(0, 8)) {
      lines.push(`  - \`${redactSensitiveText(artifact)}\``);
    }
  }
  if (report.statusBar) lines.push(`- Visible status: ${redactSensitiveText(report.statusBar)}`);
  if (Array.isArray(report.terminalLines) && report.terminalLines.length) {
    lines.push("", "## Latest Terminal Lines", "", "```text", ...report.terminalLines.map(redactSensitiveText), "```");
  }
  return lines.join("\n");
}

export function buildCommandInteractionLogBody(report = {}, patch = {}, {
  statusBar = "",
  terminalLines = [],
} = {}) {
  const merged = { ...report, ...patch };
  return {
    timestamp: merged.timestamp || "",
    typed_input: merged.typedInput || "",
    matched_command: merged.matchedCommand || "",
    rendered_state: merged.renderedState || patch.renderedState || "",
    status: merged.status || "",
    skill_idea_id: merged.skillIdeaId || "",
    sample_id: merged.sampleId || "",
    router_decision: patch.routerDecision || (
      merged.routerDecision
        ? {
            decision: merged.routerDecision,
            matched_skill: merged.routerMatchedSkill || "",
          }
        : null
    ),
    provider_run_invoked: Boolean(patch.providerRunInvoked),
    planner_source: merged.plannerSource || patch.plannerSource || "",
    planner_model: merged.plannerModel || patch.plannerModel || "",
    planner_fallback_reason: merged.plannerFallbackReason || patch.plannerFallbackReason || "",
    errors: merged.error ? [merged.error] : [],
    status_bar: merged.statusBar || statusBar,
    terminal_lines: Array.isArray(merged.terminalLines) ? merged.terminalLines : terminalLines,
  };
}

export function deriveReportPatchFromStatus(status = {}, {
  statusBar = "",
  terminalLines = [],
} = {}) {
  const bar = String(status.bar || "");
  const statusTerminalLines = normalizeTerminalLines(status.terminal);
  const patch = {
    statusBar: bar || statusBar,
    terminalLines,
  };
  if (/rerun confirmation/i.test(bar)) patch.status = "warned";
  if (/cancelled/i.test(bar) || statusTerminalLines.some((line) => /cancelled by user/i.test(line))) patch.status = "cancelled";
  if (/failed|unavailable/i.test(bar) || statusTerminalLines.some((line) => /\bfailed\b/i.test(line))) patch.status = "failed";
  if (/complete|matter status/i.test(bar)) patch.status = "ran";
  return patch;
}
