import type { ActiveMatter, SkillRun, SkillRunReceipt, WorkspaceFile } from '../types';
import { humanizeArtifactPath } from './presentationLabels';
import { redactSensitiveText } from './secretRedaction';

export function formatConfigurableRunOutputDocumentState(overwrite?: string): string {
  if (overwrite === 'approved') return 'Replaced existing output document';
  if (overwrite === 'cancelled') return 'Kept existing output document';
  if (overwrite === 'prompted') return 'Replacement confirmation shown';
  return 'Created new output document';
}

export function canOpenSkillRunOutputForMatter(run: SkillRun, activeMatter: ActiveMatter | null): boolean {
  const outputPath = run.outputPaths?.markdown;
  const receipt = receiptForRun(run);
  if (!outputPath || !receipt.canOpenOutput || !activeMatter?.folderName) return false;
  return activeMatter.folderName === run.matterFolder;
}

export function skillRunOutputExistsInWorkspace(run: SkillRun, activeMatter: ActiveMatter | null): boolean {
  const receipt = receiptForRun(run);
  if (receipt.receiptState === 'output_missing') return false;
  const sameMatter = Boolean(activeMatter?.folderName && activeMatter.folderName === run.matterFolder);
  if (!sameMatter) return false;
  const availability = receipt.outputFileStatus;
  if (availability === 'missing' || availability === 'not_recorded') return false;
  if (!receipt.canOpenOutput) return false;
  if (receipt.canOpenOutput && availability === 'present') return true;
  const outputPath = normalizeWorkspacePath(run.outputPaths?.markdown);
  if (!outputPath || !activeMatter?.workspace?.children) return false;
  return workspaceContainsPath(activeMatter.workspace.children, outputPath);
}

export function receiptForRun(run: SkillRun): SkillRunReceipt {
  if (run.receipt) return run.receipt;
  return receipt({
    receiptState: 'unknown',
    statusLabel: 'Receipt unavailable',
    statusClass: 'warning',
    resultText: 'Run receipt is unavailable',
    needsAttention: true,
  });
}

export function formatConfigurableSkillRunReport(run: SkillRun): string {
  const outputPaths = run.outputPaths || {};
  const aiRun = run.aiRun || {};
  const receipt = receiptForRun(run);
  const lines = [
    '# Custom Skill Run Report',
    '',
    `- Run id: ${packetValue(run.id)}`,
    `- Skill: ${packetValue(run.title || run.slash)}`,
    `- Slash command: ${packetValue(run.slash)}`,
    `- Status: ${packetValue(receipt.statusLabel)}`,
    `- Receipt state: ${packetValue(receipt.receiptState)}`,
    `- Matter: ${packetValue(run.matterName)}`,
    `- Matter folder: ${packetValue(run.matterFolder)}`,
    `- Started: ${packetValue(run.startedAt)}`,
    `- Finished: ${packetValue(run.finishedAt)}`,
    `- Provider/model: ${packetValue([aiRun.provider, aiRun.model].filter(Boolean).join(' / '))}`,
    `- Output document: ${packetValue(formatConfigurableRunOutputDocumentState(run.overwrite))}`,
    `- Output availability: ${packetValue(receipt.outputFileStatusLabel)}`,
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
  return humanizeArtifactPath(path);
}

function packetValue(value: unknown): string {
  const normalized = String(value || '').trim();
  return redactSensitiveText(normalized || 'Not specified');
}

function receipt({
  receiptState,
  statusLabel,
  statusClass,
  resultText,
  needsAttention = false,
  isCompletedWork = false,
  canOpenOutput = false,
  outputFileStatus = 'unknown',
  outputFileStatusLabel = 'Not checked',
}: Partial<SkillRunReceipt> & Pick<SkillRunReceipt, 'receiptState' | 'statusLabel' | 'statusClass' | 'resultText'>): SkillRunReceipt {
  return {
    receiptState,
    statusLabel,
    statusClass,
    resultText,
    needsAttention,
    isCompletedWork,
    canOpenOutput,
    outputFileStatus,
    outputFileStatusLabel,
  };
}

function workspaceContainsPath(nodes: WorkspaceFile[], targetPath: string): boolean {
  for (const node of nodes) {
    if (node.type === 'file' && normalizeWorkspacePath(node.path) === targetPath) return true;
    if (node.children?.length && workspaceContainsPath(node.children, targetPath)) return true;
  }
  return false;
}

function normalizeWorkspacePath(value?: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}
