import type { JobStageStatus, JobStatus } from '../types';
import { redactSensitiveText } from './secretRedaction';

export function formatJobStatusReport(job: JobStatus): string {
  const lines = [
    '# Job Status Report',
    '',
    `- Job id: ${packetValue(job.id)}`,
    `- Label: ${packetValue(job.label)}`,
    `- Kind: ${packetValue(job.kind)}`,
    `- Status: ${packetValue(job.status)}`,
    `- Matter: ${packetValue(job.matterName)}`,
    `- Started: ${packetValue(job.startedAt)}`,
    `- Finished: ${packetValue(job.finishedAt)}`,
    `- Result state: ${packetValue(job.resultState)}`,
    `- Failure class: ${packetValue(job.failureClass)}`,
    `- Failure code: ${packetValue(job.errorCode)}`,
    '',
    '## Stages',
    '',
    ...formatStageLines(job.stages || []),
    '',
    '## Recovery',
    '',
    ...formatRecoveryLines(job),
    '',
    '## Summary',
    '',
    job.summary ? `- ${redactSensitiveText(job.summary)}` : '- None.',
    '',
    '## Error',
    '',
    job.errorMessage ? `- ${redactSensitiveText(job.errorMessage)}` : '- None.',
    '',
    '## Boundary',
    '',
    'This report contains job and stage metadata only. It does not include raw source text, prompts, provider secrets, or generated work product.',
    '',
  ];
  return lines.join('\n');
}

export function formatJobStageSummary(stage: JobStageStatus): string {
  const label = stage.label || stage.id;
  const bits = [stage.status];
  if (stage.durationMs !== undefined) bits.push(formatDuration(stage.durationMs));
  if (stage.failureCode) bits.push(stage.failureCode);
  if (stage.model) bits.push(stage.model);
  return `${label}: ${bits.filter(Boolean).join(' · ')}`;
}

function formatRecoveryLines(job: JobStatus): string[] {
  const stages = Array.isArray(job.stages) ? job.stages : [];
  const failedStage = stages.find((stage) => stage.status === 'failed');
  const failureCode = failedStage?.failureCode || job.errorCode || '';
  const failureClass = failedStage?.failureClass || job.failureClass || '';
  const retryable = isRetryableFailure(failureCode, failureClass);
  if (!failedStage && job.status !== 'failed') return ['- None.'];
  const lines: string[] = [];
  if (failedStage?.id) lines.push(`- Failed stage: ${packetValue(failedStage.id)}`);
  if (retryable && failedStage?.id) {
    lines.push('- Suggested action: retry failed stage.');
    lines.push(`- Retry stage: ${packetValue(failedStage.id)}`);
  } else if (retryable) {
    lines.push('- Suggested action: retry run.');
  } else {
    lines.push('- Suggested action: operator review.');
  }
  const salvageable = salvageableStageIdsBeforeFailure(stages, failedStage);
  if (salvageable.length) lines.push(`- Salvageable stages: ${salvageable.map(packetValue).join(', ')}`);
  if (!lines.length) return ['- None.'];
  return lines;
}

function salvageableStageIdsBeforeFailure(stages: JobStageStatus[], failedStage?: JobStageStatus): string[] {
  if (!failedStage?.id) return [];
  const ids: string[] = [];
  for (const stage of stages) {
    if (stage.id === failedStage.id) break;
    if (stage.salvageable && stage.status === 'succeeded' && stage.id) ids.push(stage.id);
  }
  return ids;
}

function isRetryableFailure(code = '', failureClass = ''): boolean {
  if (/^provider\.(timeout|invalid_json|truncated_output|empty_output|error)$/.test(code)) return true;
  return failureClass === 'provider';
}

function formatStageLines(stages: JobStageStatus[]): string[] {
  if (!Array.isArray(stages) || stages.length === 0) return ['- None recorded.'];
  return stages.map((stage) => {
    const details = [
      stage.status,
      stage.durationMs !== undefined ? formatDuration(stage.durationMs) : '',
      stage.provider || '',
      stage.model || '',
      stage.failureCode ? `failure: ${stage.failureCode}` : '',
      stage.salvageable ? 'salvageable' : '',
    ].filter(Boolean).join(' · ');
    const label = stage.label || stage.id;
    return `- ${packetValue(label)} (${packetValue(stage.id)}): ${packetValue(details || 'recorded')}`;
  });
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function packetValue(value: unknown): string {
  const normalized = String(value || '').trim();
  return redactSensitiveText(normalized || 'Not specified');
}
