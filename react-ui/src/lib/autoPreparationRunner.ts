import { api } from '../api/client';
import { CASE_TIMELINE_DEPENDENCY_STATES } from './caseTimelineDependencyState';
import { cleanCommandLabel } from './nativeCommands';
import { formatVisiblePreparationError } from './preparationErrors';
import { PREPARATION_STAGE_ACTIONS } from './preparationStageActions';
import type {
  JobStatus,
  PreparationPlan,
  PreparationProgressStep,
  PreparationQueueRunResponse,
  PreparationRunStatus,
  PreparationStage,
  PreparationRunTelemetryRequest,
} from '../types';

export const AUTO_PREPARATION_STEPS: PreparationProgressStep[] = [
  { id: 'matter-init', label: 'Registering files', state: 'pending' },
  { id: 'extract', label: 'Reading documents', state: 'pending' },
  { id: 'describe-sources', label: 'Preparing source record', state: 'pending' },
  { id: 'create-listofdates', label: 'Building Case Timeline', state: 'pending' },
  { id: 'dispute-story', label: 'Writing dispute story', state: 'pending' },
  { id: 'procedural-posture-diagnosis', label: 'Diagnosing procedural posture', state: 'pending' },
  { id: 'advisory', label: 'Checking advisory', state: 'pending' },
];

type ProgressUpdate = (status: PreparationRunStatus) => void;
type PreparationRunMode = 'needed' | 'full';

const LONG_RUNNING_STAGE_HEARTBEAT_MS = 15_000;
const SERVER_PREPARATION_JOB_POLL_MS = 2_000;
const SERVER_PREPARATION_MAX_POLLS_PER_STAGE = 900;

export interface RunAutomaticPreparationOptions {
  matterName: string;
  appendTerminal: (lines: string[]) => void;
  onProgress: ProgressUpdate;
  isStale?: () => boolean;
  maxPasses?: number;
  mode?: PreparationRunMode;
  startStage?: string;
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
  { id: 'create-listofdates', slash: '/create_listofdates', label: 'Build Case Timeline', state: '', action: PREPARATION_STAGE_ACTIONS.RUN },
  { id: 'dispute-story', slash: '/the_story', label: 'The Story', state: '', action: PREPARATION_STAGE_ACTIONS.RUN },
  { id: 'procedural-posture-diagnosis', slash: '/procedural_posture_diagnosis', label: 'Diagnose procedural posture', state: '', action: PREPARATION_STAGE_ACTIONS.RUN },
];

export async function runAutomaticPreparation({
  matterName,
  appendTerminal,
  onProgress,
  isStale = () => false,
  maxPasses = 8,
  mode = 'needed',
  startStage = '',
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
    startStage: normalizePreparationStartStage(startStage) || undefined,
    status: 'running',
    stages: status.steps.map(telemetryStageForProgressStep),
  });
  const finishWithTelemetry = async (result: AutomaticPreparationTelemetryResult, runStatus: PreparationRunStatus = status): Promise<AutomaticPreparationResult> => {
    await safeRecordPreparationRunTelemetry({
      action: 'finish',
      runId: telemetryRunId,
      matterName,
      mode,
      startStage: normalizePreparationStartStage(startStage) || undefined,
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

  const serverQueuedResult = await runServerOwnedNeededPreparation({
    matterName,
    appendTerminal,
    onProgress,
    isStale,
    status,
    telemetryRunId,
    stageStarts,
    maxPasses,
    startStage,
  });
  if (serverQueuedResult) return finishWithTelemetry(serverQueuedResult, serverQueuedResult.status || status);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (isStale()) return finishWithTelemetry(staleResult());

    const plan = await api.getPrepareMatter(matterName);
    const upstreamBlocker = firstNonCurrentStageBefore(plan, startStage);
    const nextStage = upstreamBlocker ? null : firstRunnablePreparationStage(plan, startStage);
    status = mergePlanIntoStatus(status, plan, { markBlocked: !nextStage });
    onProgress(status);

    if (upstreamBlocker) {
      const message = `Cannot start preparation from ${stageLabelForStart(startStage)} until ${stageLabel(upstreamBlocker)} is current. ${upstreamBlocker.reason || 'Run needed preparation first.'}`;
      status = markStageFailed(status, upstreamBlocker, message);
      onProgress(status);
      return finishWithTelemetry({ state: 'blocked', message }, status);
    }

    if (!nextStage) {
      const result = await completePreparationAdvisory({
        matterName,
        status,
        onProgress,
        isStale,
        telemetryRunId,
        stageStarts,
        markBlockedWhenNoRunnable: true,
        preparedMessage: 'Automatic preparation completed.',
        needsReviewMessage: 'Automatic preparation finished with items to review.',
      });
      return finishWithTelemetry(result, result.status || status);
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

async function completePreparationAdvisory({
  matterName,
  status,
  onProgress,
  isStale,
  telemetryRunId,
  stageStarts,
  markBlockedWhenNoRunnable,
  preparedMessage,
  needsReviewMessage,
}: {
  matterName: string;
  status: PreparationRunStatus;
  onProgress: ProgressUpdate;
  isStale: () => boolean;
  telemetryRunId: string;
  stageStarts: Map<string, number>;
  markBlockedWhenNoRunnable: boolean;
  preparedMessage: string;
  needsReviewMessage: string;
}): Promise<AutomaticPreparationTelemetryResult> {
  const advisoryStatus = markStep(status, 'advisory', 'running', 'Checking preparation advisory…');
  await recordProgressStepTelemetry(telemetryRunId, matterName, advisoryStatus.steps.find((step) => step.id === 'advisory'), 'running', stageStarts);
  onProgress(advisoryStatus);
  if (isStale()) return { ...staleResult(), status: advisoryStatus };

  const finalPlan = await api.getPrepareMatter(matterName);
  const finalNextStage = firstRunnablePreparationStage(finalPlan);
  const finalStatus = markStep(
    mergePlanIntoStatus(advisoryStatus, finalPlan, { markBlocked: markBlockedWhenNoRunnable && !finalNextStage }),
    'advisory',
    'done',
  );
  await recordProgressStepTelemetry(telemetryRunId, matterName, finalStatus.steps.find((step) => step.id === 'advisory'), 'succeeded', stageStarts);
  onProgress(finalStatus);

  if (firstBlockedStage(finalPlan)) {
    return {
      state: 'blocked',
      message: 'Preparation stopped because one required step is blocked.',
      status: finalStatus,
    };
  }
  return {
    state: allStagesCurrent(finalPlan) ? 'prepared' : 'needs_review',
    message: allStagesCurrent(finalPlan) ? preparedMessage : needsReviewMessage,
    status: finalStatus,
  };
}

async function runServerOwnedNeededPreparation({
  matterName,
  appendTerminal,
  onProgress,
  isStale,
  status,
  telemetryRunId,
  stageStarts,
  maxPasses,
  startStage = '',
}: {
  matterName: string;
  appendTerminal: (lines: string[]) => void;
  onProgress: ProgressUpdate;
  isStale: () => boolean;
  status: PreparationRunStatus;
  telemetryRunId: string;
  stageStarts: Map<string, number>;
  maxPasses: number;
  startStage?: string;
}): Promise<AutomaticPreparationTelemetryResult | null> {
  let next = status;
  let usedServerQueue = false;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (isStale()) return { ...staleResult(), status: next };

    const plan = await api.getPrepareMatter(matterName);
    const upstreamBlocker = firstNonCurrentStageBefore(plan, startStage);
    const nextStage = upstreamBlocker ? null : firstRunnablePreparationStage(plan, startStage);
    next = mergePlanIntoStatus(next, plan, { markBlocked: !nextStage });
    onProgress(next);

    if (upstreamBlocker) {
      const message = `Cannot start preparation from ${stageLabelForStart(startStage)} until ${stageLabel(upstreamBlocker)} is current. ${upstreamBlocker.reason || 'Run needed preparation first.'}`;
      next = markStageFailed(next, upstreamBlocker, message);
      await recordStageTelemetry(telemetryRunId, matterName, upstreamBlocker, 'failed', stageStarts, message);
      onProgress(next);
      return { state: 'blocked', message, status: next };
    }

    if (!nextStage) {
      return completePreparationAdvisory({
        matterName,
        status: next,
        onProgress,
        isStale,
        telemetryRunId,
        stageStarts,
        markBlockedWhenNoRunnable: true,
        preparedMessage: 'Automatic preparation completed.',
        needsReviewMessage: 'Automatic preparation finished with items to review.',
      });
    }

    const runningStage = nextStage;
    next = markStageRunning(next, runningStage, serverQueuedStageDetail(runningStage));
    await recordStageTelemetry(telemetryRunId, matterName, runningStage, 'running', stageStarts, serverQueuedStageDetail(runningStage));
    onProgress(next);
    appendTerminal([`[prepare] server queue requested: ${stageLabel(runningStage)}`]);

    let queued: PreparationQueueRunResponse;
    try {
      queued = await api.queueNeededPreparation({
        matterName,
        mode: 'needed',
        runId: telemetryRunId,
        startStage: normalizePreparationStartStage(startStage) || undefined,
        reason: startStage ? `Run needed preparation from ${stageLabel(runningStage)}` : 'Run needed preparation',
      });
    } catch (error) {
      if (!usedServerQueue && isBackendPreparationQueueUnavailable(error)) {
        appendTerminal(['[prepare] server queue unavailable; running needed preparation in the browser session']);
        return null;
      }
      const message = formatVisiblePreparationError(error, runningStage);
      next = markStageFailed(next, runningStage, message);
      await recordStageTelemetry(telemetryRunId, matterName, runningStage, 'failed', stageStarts, message, preparationErrorDiagnostic(error));
      if (isStale()) return { ...staleResult(), status: next };
      onProgress(next);
      appendTerminal([`[prepare] server queue failed: ${stageLabel(runningStage)} — ${message}`]);
      return { state: 'blocked', message, status: next };
    }

    usedServerQueue = true;
    if (queued.state === 'complete') {
      continue;
    }
    if (queued.state === 'blocked') {
      const message = queued.message || 'Preparation stopped because one required step is blocked.';
      next = markStageFailed(next, queued.stage || runningStage, message);
      await recordStageTelemetry(telemetryRunId, matterName, queued.stage || runningStage, 'failed', stageStarts, message);
      onProgress(next);
      return { state: 'blocked', message, status: next };
    }

    const queuedStage = queued.stage || runningStage;
    const queuedKind = queued.kind || jobKindForQueuedStage(queuedStage);
    appendTerminal([queued.alreadyQueued
      ? `[prepare] server job already running: ${stageLabel(queuedStage)}`
      : `[prepare] server job queued: ${stageLabel(queuedStage)}`]);

    try {
      const completedJob = await waitForServerPreparationJob({
        matterName,
        kind: queuedKind,
        jobId: queued.job?.id,
        stage: queuedStage,
        status: next,
        onProgress,
        isStale,
      });
      if (isStale()) return { ...staleResult(), status: next };
      appendTerminal([`[prepare] server job complete: ${stageLabel(queuedStage)}`]);
      next = markStageDone(next, queuedStage);
      await recordStageTelemetry(telemetryRunId, matterName, queuedStage, 'succeeded', stageStarts, completedJob?.summary || 'Server preparation job completed.');
      onProgress(next);
    } catch (error) {
      const message = formatVisiblePreparationError(error, queuedStage);
      next = markStageFailed(next, queuedStage, message);
      await recordStageTelemetry(telemetryRunId, matterName, queuedStage, 'failed', stageStarts, message, preparationErrorDiagnostic(error));
      if (isStale()) return { ...staleResult(), status: next };
      onProgress(next);
      appendTerminal([`[prepare] server job failed: ${stageLabel(queuedStage)} — ${message}`]);
      return { state: 'blocked', message, status: next };
    }
  }

  return {
    state: 'needs_review',
    message: 'Preparation stopped after repeated server-queued passes. Review the preparation plan before rerunning.',
    status: next,
  };
}

async function waitForServerPreparationJob({
  matterName,
  kind,
  jobId,
  stage,
  status,
  onProgress,
  isStale,
}: {
  matterName: string;
  kind?: string;
  jobId?: string;
  stage: PreparationStage;
  status: PreparationRunStatus;
  onProgress: ProgressUpdate;
  isStale: () => boolean;
}): Promise<JobStatus | null> {
  for (let poll = 0; poll < SERVER_PREPARATION_MAX_POLLS_PER_STAGE; poll += 1) {
    if (isStale()) return null;
    const jobs = await api.getJobs({ matterName, kind, limit: 20 });
    const job = findServerPreparationJob(jobs.jobs || [], { jobId, kind });
    if (job?.status === 'succeeded') return job;
    if (job && ['failed', 'cancelled'].includes(job.status)) {
      throw new Error(job.errorMessage || job.summary || `${stageLabel(stage)} did not complete.`);
    }
    onProgress(markStageRunning(status, stage, serverQueuedStageDetail(stage, job)));
    await delay(SERVER_PREPARATION_JOB_POLL_MS);
  }
  throw new Error(`${stageLabel(stage)} is still running on the server. Refresh the matter in a minute to see the latest status.`);
}

function findServerPreparationJob(jobs: JobStatus[], { jobId, kind }: { jobId?: string; kind?: string }): JobStatus | null {
  if (jobId) {
    const exact = jobs.find((job) => job.id === jobId);
    if (exact) return exact;
  }
  if (kind) return jobs.find((job) => job.kind === kind) || null;
  return jobs[0] || null;
}

function serverQueuedStageDetail(stage: PreparationStage, job?: JobStatus | null): string {
  if (job?.status === 'running') return `Server is running ${stageLabel(stage)}. You can refresh; progress is kept in Activity.`;
  if (job?.status === 'queued' || job?.status === 'retrying') return `${stageLabel(stage)} is queued on the server. You can refresh; progress is kept in Activity.`;
  return `Queueing ${stageLabel(stage)} on the server…`;
}

function isBackendPreparationQueueUnavailable(error: unknown): boolean {
  const candidate = error as { statusCode?: number; code?: string } | null;
  return candidate?.statusCode === 404
    || candidate?.code === 'matter_workflow.preparation_queue_required'
    || candidate?.code === 'matter_workflow.preparation_queue_stage_required';
}

function jobKindForQueuedStage(stage: PreparationStage): string {
  if (stage.slash === '/matter-init') return 'matter_init';
  if (stage.slash === '/extract') return 'extract';
  if (stage.slash === '/describe_sources') return 'source_labels';
  if (stage.slash === '/create_listofdates') return 'case_timeline';
  if (stage.slash === '/the_story') return 'matter_story';
  if (stage.slash === '/procedural_posture_diagnosis') return 'posture_diagnosis';
  return '';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') window.setTimeout(resolve, ms);
    else setTimeout(resolve, ms);
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
        forceCaseTimelineRegeneration: true,
        forceStoryRegeneration: true,
        forcePostureDiagnosisRegeneration: true,
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

  return completePreparationAdvisory({
    matterName,
    status: next,
    onProgress: publishProgress,
    isStale,
    telemetryRunId,
    stageStarts,
    markBlockedWhenNoRunnable: false,
    preparedMessage: 'Preparation rerun completed.',
    needsReviewMessage: 'Preparation rerun finished with items to review.',
  });
}

export async function runPreparationStage(
  stageOrSlash: PreparationStage | string,
  matterName?: string,
  options: { forceExtractRefresh?: boolean; forceCaseTimelineRegeneration?: boolean; forceStoryRegeneration?: boolean; forcePostureDiagnosisRegeneration?: boolean } = {},
) {
  const stage = typeof stageOrSlash === 'string' ? { slash: stageOrSlash, label: cleanCommandLabel(stageOrSlash), state: '', action: '' } : stageOrSlash;
  const body = { matterName };
  if (stage.slash === '/matter-init') return api.runMatterInit(body);
  if (stage.slash === '/extract') return api.runExtract({ ...body, forceRefresh: options.forceExtractRefresh === true });
  if (stage.slash === '/describe_sources') return api.runDescribeSources(body);
  if (stage.slash === '/create_listofdates') {
    if (!options.forceCaseTimelineRegeneration && stage.rerunAdvice?.dependencyState === CASE_TIMELINE_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED) {
      return api.refreshListOfDatesLabels({ matterName, dryRun: false });
    }
    return api.runCreateListOfDates(body);
  }
  if (stage.slash === '/the_story') {
    return api.runMatterStory({ ...body, overwrite: options.forceStoryRegeneration === true || stage.state === 'stale' });
  }
  if (stage.slash === '/procedural_posture_diagnosis') {
    return api.runProceduralPostureDiagnosis({ ...body, overwrite: options.forcePostureDiagnosisRegeneration === true || stage.state === 'stale' });
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

const PREPARATION_STAGE_SLASHES = [
  '/matter-init',
  '/extract',
  '/describe_sources',
  '/create_listofdates',
  '/the_story',
  '/procedural_posture_diagnosis',
];

const PREPARATION_STAGE_ALIASES: Record<string, string> = {
  'matter-init': '/matter-init',
  matter_init: '/matter-init',
  extract: '/extract',
  'describe-sources': '/describe_sources',
  describe_sources: '/describe_sources',
  source_labels: '/describe_sources',
  'create-listofdates': '/create_listofdates',
  create_listofdates: '/create_listofdates',
  case_timeline: '/create_listofdates',
  'dispute-story': '/the_story',
  the_story: '/the_story',
  matter_story: '/the_story',
  'procedural-posture-diagnosis': '/procedural_posture_diagnosis',
  procedural_posture_diagnosis: '/procedural_posture_diagnosis',
  posture_diagnosis: '/procedural_posture_diagnosis',
};

function normalizePreparationStartStage(value?: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (PREPARATION_STAGE_SLASHES.includes(text)) return text;
  return PREPARATION_STAGE_ALIASES[text.replace(/^\/+/, '')] || '';
}

function preparationStageIndex(stageOrSelector?: PreparationStage | string | null): number {
  const slash = typeof stageOrSelector === 'string'
    ? normalizePreparationStartStage(stageOrSelector)
    : normalizePreparationStartStage(stageOrSelector?.slash || stageOrSelector?.id || '');
  return slash ? PREPARATION_STAGE_SLASHES.indexOf(slash) : -1;
}

function firstRunnablePreparationStage(plan: PreparationPlan, startStage = ''): PreparationStage | null {
  const startIndex = preparationStageIndex(startStage);
  return plan.stages.find((stage) => {
    const index = preparationStageIndex(stage);
    return (startIndex < 0 || index < 0 || index >= startIndex) && isRunnablePreparationStage(stage);
  }) || null;
}

function firstNonCurrentStageBefore(plan: PreparationPlan, startStage = ''): PreparationStage | null {
  const startIndex = preparationStageIndex(startStage);
  if (startIndex <= 0) return null;
  return plan.stages.find((stage) => {
    const index = preparationStageIndex(stage);
    return index >= 0 && index < startIndex && !isCurrentPreparationStage(stage);
  }) || null;
}

function firstBlockedStage(plan: PreparationPlan): PreparationStage | null {
  return plan.stages.find((stage) => stage.action === PREPARATION_STAGE_ACTIONS.BLOCKED) || null;
}

function stageLabelForStart(startStage = ''): string {
  const normalized = normalizePreparationStartStage(startStage);
  if (normalized === '/describe_sources') return 'Source Labels';
  if (normalized === '/create_listofdates') return 'Case Timeline';
  if (normalized === '/the_story') return 'Matter Story';
  if (normalized === '/procedural_posture_diagnosis') return 'Procedural Diagnosis';
  if (normalized === '/extract') return 'document reading';
  if (normalized === '/matter-init') return 'matter setup';
  return 'the selected stage';
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

function markStageRunning(status: PreparationRunStatus, stage: PreparationStage, detail = ''): PreparationRunStatus {
  return markStep(status, stepIdForStage(stage), 'running', detail || stageRunningDetail(stage));
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
  if (stage.slash === '/procedural_posture_diagnosis') return 'procedural-posture-diagnosis';
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
