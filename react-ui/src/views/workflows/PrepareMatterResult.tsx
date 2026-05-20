import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { lookupString } from '../../lib/lookup';
import { cleanCommandLabel } from '../../lib/nativeCommands';
import { humanizeArtifactPath, technicalPathTitle } from '../../lib/presentationLabels';
import { PREPARATION_STAGE_ACTIONS } from '../../lib/preparationStageActions';
import {
  createInitialPreparationRun,
  findNextPreparationStage,
  hasRunnablePreparationStage,
  isRunnablePreparationStage,
  runAutomaticPreparation,
  runPreparationStage,
  stageLabel,
} from '../../lib/autoPreparationRunner';
import { useLatestValue } from '../../hooks/useLatestValue';
import type { PreparationPlan } from '../../types';

const STAGE_STATE_CLASSES = {
  present: 'present',
  current: 'present',
  ready: 'warning',
  ready_to_run: 'warning',
  blocked: 'failed',
  stale: 'warning',
  failed: 'failed',
  missing: 'not-run',
  'not-run': 'not-run',
  not_selected: 'not-run',
} as const;

const STAGE_STATE_LABELS = {
  present: 'Done',
  current: 'Done',
  ready: 'Ready to run',
  ready_to_run: 'Ready to run',
  blocked: 'Blocked',
  stale: 'Needs update',
  failed: 'Failed',
  missing: 'Missing',
  'not-run': 'Not started',
  not_selected: 'Not selected',
} as const;

export default function PrepareMatterResult() {
  const { state, dispatch, appendTerminal, refreshActiveMatterWorkspace } = useApp();
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const [plan, setPlan] = useState<PreparationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const [error, setError] = useState('');
  const preparationRunSeqRef = useRef(0);

  const loadPlan = useCallback(async ({ matterName, isStale = () => false }: { matterName?: string; isStale?: () => boolean } = {}) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getPrepareMatter(matterName);
      if (isStale()) return;
      setPlan(result);
      appendTerminal(['[prepare] plan ready']);
    } catch (e) {
      if (isStale()) return;
      setError(getErrorMessage(e));
      appendTerminal([`[prepare] error: ${getErrorMessage(e)}`]);
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [appendTerminal]);

  useEffect(() => {
    let cancelled = false;
    if (state.activeMatter) {
      const matterName = state.activeMatter.name;
      void loadPlan({ matterName, isStale: () => cancelled });
    } else {
      setPlan(null);
    }
    return () => {
      cancelled = true;
    };
  }, [loadPlan, state.activeMatter]);

  function handleRunNextClick() {
    if (!plan?.nextStep?.slash) return;
    const matchedStage = findNextPreparationStage(plan);
    if (!matchedStage || !isRunnablePreparationStage(matchedStage)) return;
    if (matchedStage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN) {
      setConfirmingPaid(true);
    } else {
      executeRunNext();
    }
  }

  async function executeRunNext() {
    if (!plan?.nextStep?.slash || !state.activeMatter) return;
    const matterName = state.activeMatter.name;
    const matchedStage = findNextPreparationStage(plan);
    if (!matchedStage || !isRunnablePreparationStage(matchedStage)) return;
    setConfirmingPaid(false);
    setRunning(true);
    appendTerminal([`[prepare] running: ${cleanCommandLabel(plan.nextStep.slash)}`]);
    try {
      const slash = plan.nextStep.slash;
      await runPreparationStage(matchedStage, matterName);
      if (activeMatterNameRef.current !== matterName) return;
      appendTerminal([`[prepare] ${cleanCommandLabel(slash)} complete`]);
      await refreshActiveMatterWorkspace({
        expectedMatterName: matterName,
        failurePrefix: '[workspace] refresh failed after preparation update',
      });
      await loadPlan({
        matterName,
        isStale: () => activeMatterNameRef.current !== matterName,
      });
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      appendTerminal([`[prepare] error: ${getErrorMessage(e)}`]);
      setError(getErrorMessage(e));
    } finally {
      if (activeMatterNameRef.current === matterName) setRunning(false);
    }
  }

  async function handleRunAll() {
    if (!state.activeMatter) return;
    const matterName = state.activeMatter.name;
    const runSeq = preparationRunSeqRef.current + 1;
    preparationRunSeqRef.current = runSeq;
    let latestRun = createInitialPreparationRun(matterName, 'Preparing matter…');
    const isStale = () => preparationRunSeqRef.current !== runSeq || activeMatterNameRef.current !== matterName;
    dispatch({ type: 'SET_PREPARATION_RUN', payload: latestRun });
    setRunning(true);
    setError('');
    appendTerminal([`[prepare] running full preparation for "${matterName}"`]);
    try {
      const result = await runAutomaticPreparation({
        matterName,
        appendTerminal,
        isStale,
        onProgress: (status) => {
          latestRun = status;
          if (!isStale()) dispatch({ type: 'SET_PREPARATION_RUN', payload: status });
        },
      });
      if (isStale()) return;
      const refreshed = await refreshActiveMatterWorkspace({
        expectedMatterName: matterName,
        failurePrefix: '[workspace] refresh failed after preparation update',
      });
      await loadPlan({
        matterName,
        isStale: () => activeMatterNameRef.current !== matterName,
      });
      if (isStale()) return;
      const finalState = refreshed ? result.state : 'needs_review';
      const finalMessage = refreshed
        ? result.message
        : `${result.message} Refresh the matter view to see the latest files.`;
      dispatch({
        type: 'SET_PREPARATION_RUN',
        payload: {
          ...latestRun,
          state: finalState,
          message: finalMessage,
          finishedAt: new Date().toISOString(),
        },
      });
      dispatch({ type: 'SET_STATUS_BAR', payload: finalState === 'prepared' ? 'Matter prepared' : 'Matter needs review' });
    } catch (e) {
      if (isStale()) return;
      const message = getErrorMessage(e);
      setError(message);
      appendTerminal([`[prepare] error: ${message}`]);
      dispatch({
        type: 'SET_PREPARATION_RUN',
        payload: {
          ...latestRun,
          state: 'blocked',
          message: 'Preparation stopped.',
          error: message,
          finishedAt: new Date().toISOString(),
        },
      });
    } finally {
      if (!isStale()) setRunning(false);
    }
  }

  return (
    <div>
      <div className="document-preview-header">
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Preparation plan
          </div>
          <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 28, fontWeight: 600, margin: '0 0 5px', lineHeight: 1.15 }}>
            Prepare matter
          </h1>
          <p className="document-path">
            {state.activeMatter ? `Preparation plan for ${state.activeMatter.name}` : 'No matter selected'}
          </p>
        </div>
        <div className="document-actions">
          <button
            className="run-skill-button"
            type="button"
            onClick={handleRunAll}
            disabled={running || loading || !hasRunnablePreparationStage(plan)}
          >
            {running ? 'Running…' : 'Run preparation'}
          </button>
          {plan?.nextStep && isRunnablePreparationStage(findNextPreparationStage(plan)) && (
            <button
              className="run-skill-button secondary"
              type="button"
              onClick={handleRunNextClick}
              disabled={running || loading || confirmingPaid}
            >
              Run next stage
            </button>
          )}
          <button
            className="run-skill-button secondary"
            type="button"
            onClick={() => {
              const matterName = state.activeMatter?.name;
              void loadPlan({
                matterName,
                isStale: () => Boolean(matterName && activeMatterNameRef.current !== matterName),
              });
            }}
            disabled={loading || running}
          >
            Refresh plan
          </button>
        </div>
      </div>

      {error && <div className="run-failure-card"><strong>Error</strong>{error}</div>}

      {confirmingPaid && plan?.nextStep?.slash && (
        <div style={{ marginTop: 20 }}>
          <div className="form-warning" role="alertdialog">
            <h2>Confirm paid step: {cleanCommandLabel(plan.nextStep.slash)}</h2>
            <p>
              This step uses a paid AI provider. Running it may incur costs.
            </p>
            <ul className="overlap-list">
              <li><strong>Step:</strong> {cleanCommandLabel(plan.nextStep.slash)}</li>
            </ul>
            <div className="warning-actions">
              <button type="button" onClick={() => setConfirmingPaid(false)}>
                Skip this step
              </button>
              <button type="button" className="secondary" onClick={executeRunNext}>
                Run {cleanCommandLabel(plan.nextStep.slash)}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && !plan && (
        <p className="muted" style={{ marginTop: 16 }}>Loading preparation plan…</p>
      )}

      {plan?.nextStep && (
        <section className="matter-pipeline-card" style={{ marginTop: 24 }}>
          <h2>Next safe step</h2>
          <div className={`pipeline-stage ${stageStateClass(plan.nextStep.state)}`}>
            <div className="pipeline-stage-main">
              <div>
                <strong>{plan.nextStep.slash ? cleanCommandLabel(plan.nextStep.slash) : plan.nextStep.label}</strong>
                {plan.nextStep.slash && <span className="pipeline-stage-label">{cleanCommandLabel(plan.nextStep.slash)}</span>}
              </div>
              <span className={`pipeline-state ${stageStateClass(plan.nextStep.state)}`}>
                {stageStateLabel(plan.nextStep.state)}
              </span>
            </div>
            {plan.nextStep.message && (
              <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>{plan.nextStep.message}</p>
            )}
          </div>
          {plan.metadataCheck && !plan.metadataCheck.valid && plan.metadataCheck.missing && (
            <p className="form-error" style={{ marginTop: 8 }}>
              Missing metadata: {plan.metadataCheck.missing.join(', ')}
            </p>
          )}
        </section>
      )}

      {plan?.stages && plan.stages.length > 0 && (
        <section className="matter-pipeline-card" style={{ marginTop: 24 }}>
          <h2>Preparation steps</h2>
          <div className="pipeline-stage-list">
            {plan.stages.map((stage) => (
              <div key={stage.slash ?? stage.label} className={`pipeline-stage ${stageStateClass(stage.state)}`}>
                <div className="pipeline-stage-main">
                  <div>
                    <strong>{stageLabel(stage)}</strong>
                    {stage.slash && <span className="pipeline-stage-label">
                      {stage.paidProviderCall ? 'Uses AI' : 'Local'}
                    </span>}
                  </div>
                  <span className={`pipeline-state ${stageStateClass(stage.state)}`}>
                    {stageStateLabel(stage.state)}
                  </span>
                </div>
                {stage.description && (
                  <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>{stage.description}</p>
                )}
                {stage.reason && (
                  <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>{stage.reason}</p>
                )}
                {stage.artifacts && stage.artifacts.length > 0 && (
                  <div className="pipeline-artifacts">
                    {stage.artifacts.slice(0, 4).map((a) => (
                      <span key={a} title={technicalPathTitle(a)}>{humanizeArtifactPath(a)}</span>
                    ))}
                    {stage.artifacts.length > 4 && <span className="muted">+{stage.artifacts.length - 4} more</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!plan && !loading && !error && (
        <p style={{ color: 'var(--muted-strong)', fontSize: 14, marginTop: 16 }}>
          Prepare matter analyses what has already been done for this matter and runs the remaining
          steps in order: metadata check, extraction, and source labeling.
        </p>
      )}
    </div>
  );
}

function stageStateClass(state: string): string {
  return lookupString(STAGE_STATE_CLASSES, state, 'not-run');
}

function stageStateLabel(state: string): string {
  return lookupString(STAGE_STATE_LABELS, state, state);
}
