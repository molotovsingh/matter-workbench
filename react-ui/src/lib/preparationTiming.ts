import type { PreparationProgressStep, PreparationRunStatus } from '../types';

export const PREPARATION_CLOCK_TICK_MS = 1_000;

export function preparationRunElapsedMs(run: Pick<PreparationRunStatus, 'startedAt' | 'finishedAt'>, nowMs = Date.now()): number | null {
  return elapsedMsBetween(run.startedAt, run.finishedAt, nowMs);
}

export function preparationStepElapsedMs(step: PreparationProgressStep, nowMs = Date.now()): number | null {
  if (step.state !== 'running' && Number.isFinite(step.durationMs) && Number(step.durationMs) >= 0) {
    return Number(step.durationMs);
  }
  return elapsedMsBetween(step.startedAt, step.finishedAt, nowMs);
}

export function elapsedMsBetween(startedAt?: string, finishedAt?: string, nowMs = Date.now()): number | null {
  const startMs = Date.parse(String(startedAt || ''));
  if (!Number.isFinite(startMs)) return null;
  const parsedFinishMs = Date.parse(String(finishedAt || ''));
  const endMs = Number.isFinite(parsedFinishMs) ? parsedFinishMs : nowMs;
  if (!Number.isFinite(endMs)) return null;
  return Math.max(0, endMs - startMs);
}

export function formatPreparationDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((Number(elapsedMs) || 0) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
