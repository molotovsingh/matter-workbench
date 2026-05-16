import { formatConfigurableRunOutputDocumentState } from "../configurable-skill-run-labels.js";
import { redactSensitiveText } from "../secret-redaction.js";

export function formatConfigurableSkillRunReport(run = {}) {
  const outputPaths = run.outputPaths || {};
  const aiRun = run.aiRun || {};
  const lines = [
    "# Custom Skill Run Report",
    "",
    `- Run id: ${packetValue(run.id)}`,
    `- Skill: ${packetValue(run.title || run.slash)}`,
    `- Slash command: ${packetValue(run.slash)}`,
    `- Status: ${packetValue(run.status)}`,
    `- Matter: ${packetValue(run.matterName)}`,
    `- Matter folder: ${packetValue(run.matterFolder)}`,
    `- Started: ${packetValue(run.startedAt)}`,
    `- Finished: ${packetValue(run.finishedAt)}`,
    `- Provider/model: ${packetValue([aiRun.provider, aiRun.model].filter(Boolean).join(" / "))}`,
    `- Output document: ${packetValue(formatConfigurableRunOutputDocumentState(run.overwrite))}`,
    "",
    "## Output Paths",
    "",
    `- Markdown: ${packetValue(outputPaths.markdown)}`,
    `- Metadata: ${packetValue(outputPaths.json)}`,
    "",
    "## Warnings",
    "",
    ...(Array.isArray(run.warnings) && run.warnings.length
      ? run.warnings.map((warning) => `- ${redactSensitiveText(warning)}`)
      : ["- None."]),
    "",
    "## Error",
    "",
    run.errorMessage ? `- ${redactSensitiveText(run.errorMessage)}` : "- None.",
    "",
    "## Boundary",
    "",
    "This report contains run metadata only. It does not include raw source text, full extraction records, prompts, API keys, or generated Markdown body.",
  ];
  return `${lines.join("\n")}\n`;
}

function packetValue(value) {
  const normalized = String(value || "").trim();
  return redactSensitiveText(normalized || "Not specified");
}
