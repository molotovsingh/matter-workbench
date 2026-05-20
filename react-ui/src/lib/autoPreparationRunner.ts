import { api } from '../api/client';
import { LIST_OF_DATES_DEPENDENCY_STATES } from './listOfDatesDependencyState';
import { cleanCommandLabel } from './nativeCommands';
import { PREPARATION_STAGE_ACTIONS } from './preparationStageActions';
import type {
  PreparationPlan,
  PreparationProgressStep,
  PreparationRunStatus,
  PreparationStage,
} from '../types';

export const AUTO_PREPARATION_STEPS: PreparationProgressStep[] = [
  { id: 'matter-init', label: 'Registering files', state: 'pending' },
  { id: 'extract', label: 'Reading documents', state: 'pending' },
  { id: 'describe-sources', label: 'Preparing source record', state: 'pending' },
  { id: 'create-listofdates', label: 'Building List of Dates', state: 'pending' },
  { id: 'advisory', label: 'Checking advisory', state: 'pending' },
];

type ProgressUpdate = (status: PreparationRunStatus) => void;
type PreparationRunMode = 'needed' | 'full';

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
  onProgress(status);

  if (mode === 'full') {
    return runFullPreparation({
      matterName,
      appendTerminal,
      onProgress,
      isStale,
      status,
    });
  }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (isStale()) return staleResult();

    const plan = await api.getPrepareMatter(matterName);
    const nextStage = firstRunnablePreparationStage(plan);
    status = mergePlanIntoStatus(status, plan, { markBlocked: !nextStage });
    onProgress(status);

    if (!nextStage) {
      const advisoryStatus = markStep(status, 'advisory', 'running', 'Checking preparation advisory…');
      onProgress(advisoryStatus);
      if (isStale()) return staleResult();
      const finalPlan = await api.getPrepareMatter(matterName);
      const finalNextStage = firstRunnablePreparationStage(finalPlan);
      const finalStatus = markStep(mergePlanIntoStatus(advisoryStatus, finalPlan, { markBlocked: !finalNextStage }), 'advisory', 'done');
      onProgress(finalStatus);
      if (firstBlockedStage(finalPlan)) {
        return {
          state: 'blocked',
          message: 'Preparation stopped because one required step is blocked.',
        };
      }
      return {
        state: allStagesCurrent(finalPlan) ? 'prepared' : 'needs_review',
        message: allStagesCurrent(finalPlan)
          ? 'Automatic preparation completed.'
          : 'Automatic preparation finished with items to review.',
      };
    }

    status = markStageRunning(status, nextStage);
    onProgress(status);
    appendTerminal([`[prepare] auto running: ${stageLabel(nextStage)}`]);
    try {
      await runPreparationStage(nextStage, matterName);
      if (isStale()) return staleResult();
      appendTerminal([`[prepare] auto complete: ${stageLabel(nextStage)}`]);
      status = markStageDone(status, nextStage);
      onProgress(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = markStageFailed(status, nextStage, message);
      onProgress(status);
      appendTerminal([`[prepare] auto failed: ${stageLabel(nextStage)} — ${message}`]);
      return {
        state: 'blocked',
        message,
      };
    }
  }

  return {
    state: 'needs_review',
    message: 'Preparation stopped after repeated passes. Review the preparation plan before rerunning.',
  };
}

async function runFullPreparation({
  matterName,
  appendTerminal,
  onProgress,
  isStale,
  status,
}: {
  matterName: string;
  appendTerminal: (lines: string[]) => void;
  onProgress: ProgressUpdate;
  isStale: () => boolean;
  status: PreparationRunStatus;
}): Promise<AutomaticPreparationResult> {
  let next = status;
  const publishProgress = (run: PreparationRunStatus) => {
    if (!isStale()) onProgress(run);
  };
  const publishTerminal = (lines: string[]) => {
    if (!isStale()) appendTerminal(lines);
  };

  for (const stage of FULL_PREPARATION_STAGES) {
    next = markStageRunning(next, stage);
    publishProgress(next);
    publishTerminal([`[prepare] rerun running: ${stageLabel(stage)}`]);
    try {
      await runPreparationStage(stage, matterName, {
        forceExtractRefresh: true,
        forceListOfDatesRegeneration: true,
      });
      publishTerminal([`[prepare] rerun complete: ${stageLabel(stage)}`]);
      next = markStageDone(next, stage);
      publishProgress(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next = markStageFailed(next, stage, message);
      publishProgress(next);
      publishTerminal([`[prepare] rerun failed: ${stageLabel(stage)} — ${message}`]);
      return {
        state: 'blocked',
        message,
      };
    }
  }

  const advisoryStatus = markStep(next, 'advisory', 'running', 'Checking preparation advisory…');
  publishProgress(advisoryStatus);
  const finalPlan = await api.getPrepareMatter(matterName);
  const finalStatus = markStep(mergePlanIntoStatus(advisoryStatus, finalPlan, { markBlocked: false }), 'advisory', 'done');
  publishProgress(finalStatus);
  if (firstBlockedStage(finalPlan)) {
    return {
      state: 'blocked',
      message: 'Preparation stopped because one required step is blocked.',
    };
  }
  return {
    state: allStagesCurrent(finalPlan) ? 'prepared' : 'needs_review',
    message: allStagesCurrent(finalPlan)
      ? 'Preparation rerun completed.'
      : 'Preparation rerun finished with items to review.',
  };
}

export async function runPreparationStage(
  stageOrSlash: PreparationStage | string,
  matterName?: string,
  options: { forceExtractRefresh?: boolean; forceListOfDatesRegeneration?: boolean } = {},
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
  return markStep(status, stepIdForStage(stage), 'running', `Running ${stageLabel(stage)}…`);
}

function markStageDone(status: PreparationRunStatus, stage: PreparationStage): PreparationRunStatus {
  return markStep(status, stepIdForStage(stage), 'done');
}

function markStageFailed(status: PreparationRunStatus, stage: PreparationStage, detail: string): PreparationRunStatus {
  return markStep(status, stepIdForStage(stage), 'failed', detail);
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
  return null;
}

function cloneSteps(): PreparationProgressStep[] {
  return AUTO_PREPARATION_STEPS.map((step) => ({ ...step }));
}

function staleResult(): AutomaticPreparationResult {
  return {
    state: 'needs_review',
    message: 'Preparation stopped because the active matter changed.',
  };
}
