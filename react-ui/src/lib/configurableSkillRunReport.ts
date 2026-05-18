import type { ActiveMatter, SkillRun } from '../types';
import { redactSensitiveText } from './secretRedaction';

export function formatConfigurableRunOutputDocumentState(overwrite?: string): string {
  if (overwrite === 'approved') return 'Replaced existing output document';
  if (overwrite === 'cancelled') return 'Kept existing output document';
  if (overwrite === 'prompted') return 'Replacement confirmation shown';
  return 'Created new output document';
}

export function canOpenSkillRunOutputForMatter(run: SkillRun, activeMatter: ActiveMatter | null): boolean {
  const outputPath = run.outputPaths?.markdown;
  if (!outputPath || run.status !== 'succeeded' || !activeMatter?.folderName) return false;
  return activeMatter.folderName === run.matterFolder;
}

export function formatConfigurableSkillRunReport(run: SkillRun): string {
  const outputPaths = run.outputPaths || {};
  const aiRun = run.aiRun || {};
  const lines = [
    '# Custom Skill Run Report',
    '',
    `- Run id: ${packetValue(run.id)}`,
    `- Skill: ${packetValue(run.title || run.slash)}`,
    `- Slash command: ${packetValue(run.slash)}`,
    `- Status: ${packetValue(run.status)}`,
    `- Matter: ${packetValue(run.matterName)}`,
    `- Matter folder: ${packetValue(run.matterFolder)}`,
    `- Started: ${packetValue(run.startedAt)}`,
    `- Finished: ${packetValue(run.finishedAt)}`,
    `- Provider/model: ${packetValue([aiRun.provider, aiRun.model].filter(Boolean).join(' / '))}`,
    `- Output document: ${packetValue(formatConfigurableRunOutputDocumentState(run.overwrite))}`,
    '',
    '## Output Paths',
    '',
    `- Markdown: ${packetValue(outputPaths.markdown)}`,
    `- Metadata: ${packetValue(outputPaths.json)}`,
    '',
    '## Warnings',
    '',
    ...(Array.isArray(run.warnings) && run.warnings.length
      ? run.warnings.map((warning) => `- ${redactSensitiveText(warning)}`)
      : ['- None.']),
    '',
    '## Error',
    '',
    run.errorMessage ? `- ${redactSensitiveText(run.errorMessage)}` : '- None.',
    '',
    '## Boundary',
    '',
    'This report contains run metadata only. It does not include raw source text, full extraction records, prompts, API keys, or generated Markdown body.',
    '',
  ];
  return lines.join('\n');
}

export function humanizeRunOutputPath(path = ''): string {
  return String(path || '')
    .replace(/^10_Library\//, 'Source Record / ')
    .replace(/^20_Workshop\//, 'Case Analysis / ')
    .replace(/^30_Drafts\//, 'Drafts / ')
    .replace(/^40_Dispatch\//, 'Ready to Send / ');
}

function packetValue(value: unknown): string {
  const normalized = String(value || '').trim();
  return redactSensitiveText(normalized || 'Not specified');
}
