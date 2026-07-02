import { PREPARATION_STAGE_ACTIONS } from './preparationStageActions';
import { RERUN_ADVICE_STATES } from './rerunAdviceState';
import type { PreparationStage } from '../types';

export interface PreparationRowAction {
  label: string;
  hint?: string;
  disabled?: boolean;
  primary?: boolean;
  startStage?: string;
}

interface StandardPreparationRowActionCopy {
  runLabel: string;
  refreshLabel?: string;
  hint: string;
  hideWhenCurrent?: boolean;
}

const STANDARD_ROW_ACTION_COPY: Record<string, StandardPreparationRowActionCopy> = {
  '/matter-init': {
    runLabel: 'Set up matter',
    hint: 'Creates matter setup files before preparation can continue.',
    hideWhenCurrent: true,
  },
  '/extract': {
    runLabel: 'Read documents',
    hint: 'Runs local document reading before source labels.',
    hideWhenCurrent: true,
  },
  '/describe_sources': {
    runLabel: 'Run Source Labels',
    refreshLabel: 'Refresh from Source Labels',
    hint: 'Checks source labels and downstream stages; skips current work.',
  },
  '/create_listofdates': {
    runLabel: 'Build Case Timeline',
    refreshLabel: 'Refresh from Case Timeline',
    hint: 'Starts at Case Timeline; does not re-read documents when upstream is current.',
  },
  '/the_story': {
    runLabel: 'Write Matter Story',
    refreshLabel: 'Refresh from Matter Story',
    hint: 'Starts at Story and continues to downstream diagnosis if needed.',
  },
};

const BLOCKED_ROW_ACTION_LABELS: Record<string, string> = {
  '/matter-init': 'Needs matter details',
  '/extract': 'Needs matter setup first',
  '/describe_sources': 'Needs documents first',
  '/create_listofdates': 'Needs Source Labels first',
  '/the_story': 'Needs Case Timeline first',
  '/procedural_posture_diagnosis': 'Needs Matter Story first',
};

export function getPreparationRowAction(stage: PreparationStage): PreparationRowAction | null {
  const slash = stage.slash || '';
  const state = normalizedStageState(stage);

  if (stage.action === PREPARATION_STAGE_ACTIONS.BLOCKED) {
    return {
      label: blockedPreparationRowActionLabel(stage),
      hint: stage.reason || 'Resolve the upstream dependency first.',
      disabled: true,
      startStage: slash,
    };
  }

  if (slash === '/procedural_posture_diagnosis') {
    return proceduralPostureRowAction(stage, state);
  }

  const copy = STANDARD_ROW_ACTION_COPY[slash];
  if (!copy) return null;
  return standardPreparationRowAction(stage, copy, state);
}

export function isPreparationStageCurrent(stage: PreparationStage): boolean {
  if (stage.rerunAdvice?.state && stage.rerunAdvice.state !== RERUN_ADVICE_STATES.CURRENT) return false;
  if (stage.state === 'current_unconfirmed') return false;
  return stage.action === PREPARATION_STAGE_ACTIONS.SKIP_CURRENT
    && ['current', 'current_confirmed', 'current_corrected'].includes(stage.state || '');
}

function standardPreparationRowAction(
  stage: PreparationStage,
  copy: StandardPreparationRowActionCopy,
  state: string,
): PreparationRowAction | null {
  const current = isPreparationStageCurrent(stage);
  if (current && copy.hideWhenCurrent) return null;
  const label = copy.refreshLabel && (current || state === 'stale')
    ? copy.refreshLabel
    : copy.runLabel;
  return {
    label,
    hint: copy.hint,
    primary: !current,
    startStage: stage.slash || '',
  };
}

function proceduralPostureRowAction(stage: PreparationStage, state: string): PreparationRowAction | null {
  if (state === 'current_unconfirmed') {
    return {
      label: 'Confirm in Case Analysis card',
      hint: 'The diagnosis is saved; use the confirmation controls above before relying on it.',
      disabled: true,
      startStage: stage.slash || '',
    };
  }
  if (isPreparationStageCurrent(stage)) return null;
  return {
    label: state === 'stale' ? 'Refresh saved Procedural Diagnosis' : 'Run saved Procedural Diagnosis',
    hint: 'Creates the Case Analysis Markdown/JSON artifact, job, and receipt. Not chat.',
    primary: true,
    startStage: stage.slash || '',
  };
}

function blockedPreparationRowActionLabel(stage: PreparationStage): string {
  return BLOCKED_ROW_ACTION_LABELS[stage.slash || ''] || 'Blocked';
}

function normalizedStageState(stage: PreparationStage): string {
  return String(stage.state || '').trim();
}
