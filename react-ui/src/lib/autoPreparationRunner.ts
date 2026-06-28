import { api } from '../api/client';
import { LIST_OF_DATES_DEPENDENCY_STATES } from './listOfDatesDependencyState';
import { cleanCommandLabel } from './nativeCommands';
import { formatVisiblePreparationError } from './preparationErrors';
import { PREPARATION_STAGE_ACTIONS } from './preparationStageActions';
import type {
  PreparationPlan,
  PreparationProgressStep,
  PreparationRunStatus,
  PreparationStage,
  PreparationRunTelemetryRequest,
} from '../types';

export const AUTO_PREPARATION_STEPS: PreparationProgressStep[] = [
  { id: 'matter-init', label: 'Registering files', state: 'pending' },
  { id: 'extract', label: 'Reading documents', state: 'pending' },
  { id: 'describe-sources', label: 'Preparing source record', state: 'pending' },
  { id: 'create-listofdates', label: 'Building List of Dates', state: 'pending' },
  { id: 'dispute-story', label: 'Writing dispute story', state: 'pending' },
  { id: 'advisory', label: 'Checking advisory', state: 'pending' },
];

type ProgressUpdate = (status: PreparationRunStatus) => void;
type PreparationRunMode = 'needed' | 'full';

const LONG_RUNNING_STAGE_HEARTBEAT_MS = 15_000;

export interface RunAutomaticPreparationOptions {
  matterName: string;
  appendTerminal: (lines: string[]) => void;
  onProgress: ProgressUpdate;
  isStale?: () => boolean;
  maxPasses?: number;
  mode?: PreparationRunMode;
  initialMessage?: string;
}

export interface AutomaticPreparationResult {
  state: 'prepared' | 'needs_review' | 'blocked';
  message: string;
}

type AutomaticPreparationTelemetryResult = AutomaticPreparationResult & { status?: PreparationRunStatus };

export function createInitialPreparationRun(matterName: string, message = 'Preparing matter…'): PreparationRunStatus {
  return {
    matterName,
    state: 'running',
    message,
    startedAt: new Date().toISOString(),
    steps: cloneSteps(),
  };
}

const FULL_PREPARATION_STAGES: PreparationStage[] = [
  { id: 'matter-init', slash: '/matter-init', label: 'Set Up Matter', state: '', action: PREPARATION_STAGE_ACTIONS.RUN },
  { id: 'extract', slash: '/extract', label: 'Extract Documents', state: '', action: PREPARATION_STAGE_ACTIONS.RUN },
  { id: 'describe-sources', slash: '/describe_sources', label: 'Label Sources', state: '', action: PREPARATION_STAGE_ACTIONS.RUN },
  { id: 'create-listofdates', slash: '/create_listofdates', label: 'Create List of Dates', state: '', action: PREPARATION_STAGE_ACTIONS.RUN },
  { id: 'dispute-story', slash: '/the_story', label: 'The Story', state: '', action: PREPARATION_STAGE_ACTIONS.RUN },
];

export async function runAutomaticPreparation({
  matterName,
  appendTerminal,
  onProgress,
  isStale = () => false,
  maxPasses = 8,
  mode = 'needed',
  initialMessage = 'Preparing matter…',
}: RunAutomaticPreparationOptions): Promise<AutomaticPreparationResult> {
  let status = createInitialPreparationRun(matterName, initialMessage);
  const telemetryRunId = createPreparationTelemetryRunId();
  const stageStarts = new Map<string, number>();
  await safeRecordPreparationRunTelemetry({
    action: 'start',
    runId: telemetryRunId,
    matterName,
    mode,
    status: 'running',
    stages: status.steps.map(telemetryStageForProgressStep),
  });
  const finishWithTelemetry = async (result: AutomaticPreparationTelemetryResult, runStatus: PreparationRunStatus = status): Promise<AutomaticPreparationResult> => {
    await safeRecordPreparationRunTelemetry({
      action: 'finish',
      runId: telemetryRunId,
      matterName,
      mode,
      status: telemetryStatusForResult(result),
      message: result.message,
      stages: runStatus.steps.map(telemetryStageForProgressStep),
    });
    return { state: result.state, message: result.message };
  };
  onProgress(status);

  if (mode === 'full') {
    const result = await runFullPreparation({
      matterName,
      appendTerminal,
      onProgress,
      isStale,
      status,
      telemetryRunId,
      stageStarts,
    });
    return finishWithTelemetry(result, result.status || status);
  }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (isStale()) return finishWithTelemetry(staleResult());

    const plan = await api.getPrepareMatter(matterName);
    const nextStage = firstRunnablePreparationStage(plan);
    status = mergePlanIntoStatus(status, plan, { markBlocked: !nextStage });
    onProgress(status);

    if (!nextStage) {
      const advisoryStatus = markStep(status, 'advisory', 'running', 'Checking preparation advisory…');
      await recordProgressStepTelemetry(telemetryRunId, matterName, advisoryStatus.steps.find((step) => step.id === 'advisory'), 'running', stageStarts);
      onProgress(advisoryStatus);
      if (isStale()) return finishWithTelemetry(staleResult(), advisoryStatus);
      const finalPlan = await api.getPrepareMatter(matterName);
      const finalNextStage = firstRunnablePreparationStage(finalPlan);
      const finalStatus = markStep(mergePlanIntoStatus(advisoryStatus, finalPlan, { markBlocked: !finalNextStage }), 'advisory', 'done');
      await recordProgressStepTelemetry(telemetryRunId, matterName, finalStatus.steps.find((step) => step.id === 'advisory'), 'succeeded', stageStarts);
      onProgress(finalStatus);
      if (firstBlockedStage(finalPlan)) {
        return finishWithTelemetry({
          state: 'blocked',
          message: 'Preparation stopped because one required step is blocked.',
        }, finalStatus);
      }
      return finishWithTelemetry({
        state: allStagesCurrent(finalPlan) ? 'prepared' : 'needs_review',
        message: allStagesCurrent(finalPlan)
          ? 'Automatic preparation completed.'
          : 'Automatic preparation finished with items to review.',
      }, finalStatus);
    }

    status = markStageRunning(status, nextStage);
    await recordStageTelemetry(telemetryRunId, matterName, nextStage, 'running', stageStarts, stageRunningDetail(nextStage));
    onProgress(status);
    appendTerminal([`[prepare] auto running: ${stageLabel(nextStage)}`]);
    const stopHeartbeat = startStageHeartbeat(status, nextStage, onProgress, isStale);
    try {
      await runPreparationStage(nextStage, matterName);
      if (isStale()) return finishWithTelemetry(staleResult(), status);
      appendTerminal([`[prepare] auto complete: ${stageLabel(nextStage)}`]);
      status = markStageDone(status, nextStage);
      await recordStageTelemetry(telemetryRunId, matterName, nextStage, 'succeeded', stageStarts);
      onProgress(status);
    } catch (error) {
      const message = formatVisiblePreparationError(error, nextStage);
      status = markStageFailed(status, nextStage, message);
      await recordStageTelemetry(telemetryRunId, matterName, nextStage, 'failed', stageStarts, message, preparationErrorDiagnostic(error));
      if (isStale()) return finishWithTelemetry(staleResult(), status);
      onProgress(status);
      appendTerminal([`[prepare] auto failed: ${stageLabel(nextStage)} — ${message}`]);
      return finishWithTelemetry({
        state: 'blocked',
        message,
      }, status);
    } finally {
      stopHeartbeat();
    }
  }

  return finishWithTelemetry({
    state: 'needs_review',
    message: 'Preparation stopped after repeated passes. Review the preparation plan before rerunning.',
  });
}

async function runFullPreparation({
  matterName,
  appendTerminal,
  onProgress,
  isStale,
  status,
  telemetryRunId,
  stageStarts,
}: {
  matterName: string;
  appendTerminal: (lines: string[]) => void;
  onProgress: ProgressUpdate;
  isStale: () => boolean;
  status: PreparationRunStatus;
  telemetryRunId: string;
  stageStarts: Map<string, number>;
}): Promise<AutomaticPreparationTelemetryResult> {
  let next = status;
  const publishProgress = (run: PreparationRunStatus) => {
    if (!isStale()) onProgress(run);
  };
  const publishTerminal = (lines: string[]) => {
    if (!isStale()) appendTerminal(lines);
  };

  for (const stage of FULL_PREPARATION_STAGES) {
    next = markStageRunning(next, stage);
    await recordStageTelemetry(telemetryRunId, matterName, stage, 'running', stageStarts, stageRunningDetail(stage));
    publishProgress(next);
    publishTerminal([`[prepare] rerun running: ${stageLabel(stage)}`]);
    const stopHeartbeat = startStageHeartbeat(next, stage, publishProgress, isStale);
    try {
      await runPreparationStage(stage, matterName, {
        forceExtractRefresh: true,
        forceListOfDatesRegeneration: true,
        forceStoryRegeneration: true,
      });
      publishTerminal([`[prepare] rerun complete: ${stageLabel(stage)}`]);
      next = markStageDone(next, stage);
      await recordStageTelemetry(telemetryRunId, matterName, stage, 'succeeded', stageStarts);
      publishProgress(next);
    } catch (error) {
      const message = formatVisiblePreparationError(error, stage);
      next = markStageFailed(next, stage, message);
      await recordStageTelemetry(telemetryRunId, matterName, stage, 'failed', stageStarts, message, preparationErrorDiagnostic(error));
      publishProgress(next);
      publishTerminal([`[prepare] rerun failed: ${stageLabel(stage)} — ${message}`]);
      return {
        state: 'blocked',
        message,
        status: next,
      };
    } finally {
      stopHeartbeat();
    }
  }

  const advisoryStatus = markStep(next, 'advisory', 'running', 'Checking preparation advisory…');
  await recordProgressStepTelemetry(telemetryRunId, matterName, advisoryStatus.steps.find((step) => step.id === 'advisory'), 'running', stageStarts);
  publishProgress(advisoryStatus);
  const finalPlan = await api.getPrepareMatter(matterName);
  const finalStatus = markStep(mergePlanIntoStatus(advisoryStatus, finalPlan, { markBlocked: false }), 'advisory', 'done');
  await recordProgressStepTelemetry(telemetryRunId, matterName, finalStatus.steps.find((step) => step.id === 'advisory'), 'succeeded', stageStarts);
  publishProgress(finalStatus);
  if (firstBlockedStage(finalPlan)) {
    return {
      state: 'blocked',
      message: 'Preparation stopped because one required step is blocked.',
      status: finalStatus,
    };
  }
  return {
    state: allStagesCurrent(finalPlan) ? 'prepared' : 'needs_review',
    message: allStagesCurrent(finalPlan)
      ? 'Preparation rerun completed.'
      : 'Preparation rerun finished with items to review.',
    status: finalStatus,
  };
}

export async function runPreparationStage(
  stageOrSlash: PreparationStage | string,
  matterName?: string,
  options: { forceExtractRefresh?: boolean; forceListOfDatesRegeneration?: boolean; forceStoryRegeneration?: boolean } = {},
) {
  const stage = typeof stageOrSlash === 'string' ? { slash: stageOrSlash, label: cleanCommandLabel(stageOrSlash), state: '', action: '' } : stageOrSlash;
  const body = { matterName };
  if (stage.slash === '/matter-init') return api.runMatterInit(body);
  if (stage.slash === '/extract') return api.runExtract({ ...body, forceRefresh: options.forceExtractRefresh === true });
  if (stage.slash === '/describe_sources') return api.runDescribeSources(body);
  if (stage.slash === '/create_listofdates') {
    if (!options.forceListOfDatesRegeneration && stage.rerunAdvice?.dependencyState === LIST_OF_DATES_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED) {
      return api.refreshListOfDatesLabels({ matterName, dryRun: false });
    }
    return api.runCreateListOfDates(body);
  }
  if (stage.slash === '/the_story') {
    return api.runMatterStory({ ...body, overwrite: options.forceStoryRegeneration === true || stage.state === 'stale' });
  }
  throw new Error(`No React runner is wired for preparation stage ${stage.slash || stage.label}`);
}

export function isRunnablePreparationStage(stage?: PreparationStage | null): stage is PreparationStage {
  if (!stage) return false;
  return stage.action === PREPARATION_STAGE_ACTIONS.RUN
    || stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN;
}

export function hasRunnablePreparationStage(plan?: PreparationPlan | null): boolean {
  return Boolean(plan?.stages?.some(isRunnablePreparationStage));
}

export function findNextPreparationStage(plan: PreparationPlan): PreparationStage | null {
  if (!plan.nextStep) return null;
  return plan.stages.find((stage) => (
    (plan.nextStep?.slash && stage.slash === plan.nextStep.slash)
    || (plan.nextStep?.stage && stage.id === plan.nextStep.stage)
  )) ?? null;
}

export function stageLabel(stage: PreparationStage): string {
  if (stage.label) return stage.label;
  if (stage.slash) return cleanCommandLabel(stage.slash);
  return 'Preparation step';
}

function firstRunnablePreparationStage(plan: PreparationPlan): PreparationStage | null {
  return plan.stages.find(isRunnablePreparationStage) || null;
}

function firstBlockedStage(plan: PreparationPlan): PreparationStage | null {
  return plan.stages.find((stage) => stage.action === PREPARATION_STAGE_ACTIONS.BLOCKED) || null;
}

function allStagesCurrent(plan: PreparationPlan): boolean {
  return plan.stages.length > 0
    && plan.stages.every((stage) => stage.action === PREPARATION_STAGE_ACTIONS.SKIP_CURRENT || stage.state === 'current');
}

function isCurrentPreparationStage(stage: PreparationStage): boolean {
  return stage.action === PREPARATION_STAGE_ACTIONS.SKIP_CURRENT || stage.state === 'current';
}

function mergePlanIntoStatus(
  status: PreparationRunStatus,
  plan: PreparationPlan,
  { markBlocked = false }: { markBlocked?: boolean } = {},
): PreparationRunStatus {
  let next = status;
  for (const stage of plan.stages || []) {
    const stepId = stepIdForStage(stage);
    if (!stepId) continue;
    if (isCurrentPreparationStage(stage)) {
      next = markStep(next, stepId, 'done');
    } else if (markBlocked && stage.action === PREPARATION_STAGE_ACTIONS.BLOCKED) {
      next = markStep(next, stepId, 'failed', stage.reason);
    }
  }
  return next;
}

function markStageRunning(status: PreparationRunStatus, stage: PreparationStage): PreparationRunStatus {
  return markStep(status, stepIdForStage(stage), 'running', stageRunningDetail(stage));
}

function markStageDone(status: PreparationRunStatus, stage: PreparationStage): PreparationRunStatus {
  return markStep(status, stepIdForStage(stage), 'done');
}

function markStageFailed(status: PreparationRunStatus, stage: PreparationStage, detail: string): PreparationRunStatus {
  return markStep(status, stepIdForStage(stage), 'failed', detail);
}

function startStageHeartbeat(
  status: PreparationRunStatus,
  stage: PreparationStage,
  onProgress: ProgressUpdate,
  isStale: () => boolean,
): () => void {
  const stepId = stepIdForStage(stage);
  if (!stepId || typeof window === 'undefined' || typeof window.setInterval !== 'function') return () => {};
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    if (isStale()) {
      window.clearInterval(timer);
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    onProgress(markStep(status, stepId, 'running', stageRunningDetail(stage, elapsedMs)));
  }, LONG_RUNNING_STAGE_HEARTBEAT_MS);
  return () => window.clearInterval(timer);
}

function stageRunningDetail(stage: PreparationStage, elapsedMs = 0): string {
  const stepId = stepIdForStage(stage);
  if (stepId === 'extract') {
    const elapsed = elapsedMs >= LONG_RUNNING_STAGE_HEARTBEAT_MS ? ` Still reading documents (${formatElapsed(elapsedMs)} elapsed).` : '';
    return `Reading documents. Large or scanned PDFs can take several minutes.${elapsed} Keep this page open; the matter will update when this step finishes.`;
  }
  if (stepId === 'matter-init') return 'Registering file IDs and source records…';
  return `Running ${stageLabel(stage)}…`;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function markStep(status: PreparationRunStatus, stepId: string | null, state: PreparationProgressStep['state'], detail = ''): PreparationRunStatus {
  if (!stepId) return status;
  return {
    ...status,
    steps: status.steps.map((step) => (
      step.id === stepId ? { ...step, state, detail: detail || undefined } : step
    )),
  };
}

function stepIdForStage(stage: PreparationStage): string | null {
  if (stage.id === 'create-listofdates') return 'create-listofdates';
  if (stage.id) return stage.id;
  if (stage.slash === '/matter-init') return 'matter-init';
  if (stage.slash === '/extract') return 'extract';
  if (stage.slash === '/describe_sources') return 'describe-sources';
  if (stage.slash === '/create_listofdates') return 'create-listofdates';
  if (stage.slash === '/the_story') return 'dispute-story';
  return null;
}

function cloneSteps(): PreparationProgressStep[] {
  return AUTO_PREPARATION_STEPS.map((step) => ({ ...step }));
}

function createPreparationTelemetryRunId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `prep_${randomId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

async function safeRecordPreparationRunTelemetry(body: PreparationRunTelemetryRequest): Promise<void> {
  try {
    await api.recordPreparationRunTelemetry(body);
  } catch {
    // Telemetry must never block matter preparation.
  }
}

async function recordStageTelemetry(
  runId: string,
  matterName: string,
  stage: PreparationStage,
  status: NonNullable<PreparationRunTelemetryRequest['stage']>['status'],
  stageStarts: Map<string, number>,
  message = '',
  diagnostic?: NonNullable<PreparationRunTelemetryRequest['stage']>['diagnostic'],
) {
  const stepId = stepIdForStage(stage) || stage.id || stage.slash || stage.label;
  const stageKey = stepId || stageLabel(stage);
  const now = Date.now();
  if (status === 'running') stageStarts.set(stageKey, now);
  const startedAt = stageStarts.get(stageKey) || now;
  await safeRecordPreparationRunTelemetry({
    action: 'stage',
    runId,
    matterName,
    stage: {
      id: stepId || undefined,
      label: stageLabel(stage),
      status,
      durationMs: status === 'running' ? 0 : now - startedAt,
      message,
      diagnostic,
    },
  });
}

async function recordProgressStepTelemetry(
  runId: string,
  matterName: string,
  step: PreparationProgressStep | undefined,
  status: NonNullable<PreparationRunTelemetryRequest['stage']>['status'],
  stageStarts: Map<string, number>,
) {
  if (!step) return;
  const now = Date.now();
  if (status === 'running') stageStarts.set(step.id, now);
  const startedAt = stageStarts.get(step.id) || now;
  await safeRecordPreparationRunTelemetry({
    action: 'stage',
    runId,
    matterName,
    stage: {
      id: step.id,
      label: step.label,
      status,
      durationMs: status === 'running' ? 0 : now - startedAt,
      message: step.detail,
    },
  });
}

function telemetryStageForProgressStep(step: PreparationProgressStep): NonNullable<PreparationRunTelemetryRequest['stages']>[number] {
  return {
    id: step.id,
    label: step.label,
    status: step.state,
    message: step.detail,
  };
}

function telemetryStatusForResult(result: AutomaticPreparationResult): PreparationRunTelemetryRequest['status'] {
  if (result.state === 'blocked') return 'blocked';
  return result.state;
}

function preparationErrorDiagnostic(error: unknown): NonNullable<PreparationRunTelemetryRequest['stage']>['diagnostic'] | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const diagnostic = (error as { diagnostic?: unknown }).diagnostic;
  if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return undefined;
  return diagnostic as NonNullable<PreparationRunTelemetryRequest['stage']>['diagnostic'];
}

function staleResult(): AutomaticPreparationResult {
  return {
    state: 'needs_review',
    message: 'Preparation stopped because the active matter changed.',
  };
}
