import { api } from '../api/client';

interface ResearchTelemetryInput {
  matterName?: string | null;
  stage?: 'research_submit' | 'research_answer' | 'research_failed';
  error?: unknown;
  publicSourceCount?: number;
  answerStatus?: string;
}

export function reportResearchFailure(input: ResearchTelemetryInput): void {
  void api.capturePrivateBetaClientSignal({
    code: researchErrorCode(input.error),
    category: 'copilot_research',
    severity: 'error',
    view: 'command_panel',
    action: 'research',
    stage: input.stage || 'research_failed',
    matterName: input.matterName || undefined,
    errorClass: errorClass(input.error),
    errorMessage: 'Copilot Research failed before returning a usable answer.',
  }).catch(() => {
    // Client telemetry must never interrupt Research recovery UX.
  });
}

export function reportResearchAnswer(input: ResearchTelemetryInput): void {
  void api.capturePrivateBetaClientSignal({
    code: 'copilot_research.answer_returned',
    category: 'copilot_research',
    severity: input.answerStatus === 'answered' ? 'info' : 'warning',
    view: 'command_panel',
    action: 'research',
    stage: 'research_answer',
    matterName: input.matterName || undefined,
    fileCount: input.publicSourceCount,
    errorMessage: input.answerStatus ? `Research answer status: ${input.answerStatus}` : 'Research answer returned.',
  }).catch(() => {
    // Client telemetry must never interrupt Research UX.
  });
}

function researchErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'copilot_research.failed';
  const value = (error as { code?: unknown }).code;
  if (typeof value !== 'string') return 'copilot_research.failed';
  const code = value.trim();
  return /^copilot_research\.[a-z0-9_]+$/.test(code) ? code : 'copilot_research.failed';
}

function errorClass(error: unknown): string {
  if (error instanceof Error) return 'Error';
  if (Array.isArray(error)) return 'Array';
  if (error && typeof error === 'object') return 'Object';
  return typeof error || 'unknown';
}
