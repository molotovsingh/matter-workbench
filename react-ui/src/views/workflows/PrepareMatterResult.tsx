import { useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { lookupString } from '../../lib/lookup';
import { PREPARATION_STAGE_ACTIONS } from '../../lib/preparationStageActions';
import RerunConfirmDialog from '../../components/RerunConfirmDialog';
import type { PreparationPlan, PreparationStage } from '../../types';

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
  const { state, dispatch, appendTerminal } = useApp();
  const [plan, setPlan] = useState<PreparationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const [pendingPaidConfirm, setPendingPaidConfirm] = useState<{
    stage: PreparationStage;
    resolve: (skip: boolean) => void;
  } | null>(null);
  const [error, setError] = useState('');

  async function loadPlan() {
    setLoading(true);
    setError('');
    try {
      const result = await api.getPrepareMatter();
      setPlan(result);
      appendTerminal(['[prepare] plan ready']);
    } catch (e) {
      setError(getErrorMessage(e));
      appendTerminal([`[prepare] error: ${getErrorMessage(e)}`]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (state.activeMatter) loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeMatter?.name]);

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
    if (!plan?.nextStep?.slash) return;
    const matchedStage = findNextPreparationStage(plan);
    if (!matchedStage || !isRunnablePreparationStage(matchedStage)) return;
    setConfirmingPaid(false);
    setRunning(true);
    appendTerminal([`[prepare] running: ${plan.nextStep.slash}`]);
    try {
      const slash = plan.nextStep.slash;
      await runPreparationStage(slash, state.activeMatter?.name);
      appendTerminal([`[prepare] ${slash} complete`]);
      await loadPlan();
    } catch (e) {
      appendTerminal([`[prepare] error: ${getErrorMessage(e)}`]);
      setError(getErrorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  async function handleRunAll() {
    if (!plan?.stages) return;
    setRunning(true);
    const runnableStages = plan.stages.filter(isRunnablePreparationStage);
    for (const stage of runnableStages) {
      if (stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN) {
        const skipPaid = await new Promise<boolean>((resolve) => {
          setPendingPaidConfirm({ stage, resolve });
        });
        if (skipPaid) {
          appendTerminal([`[prepare] skipped paid stage: ${stage.slash}`]);
          continue;
        }
      }
      appendTerminal([`[prepare] running child stage: ${stage.slash}`]);
      try {
        if (!stage.slash) throw new Error(`Preparation stage has no runnable slash: ${stage.label}`);
        const slash = stage.slash;
        await runPreparationStage(slash, state.activeMatter?.name);
        appendTerminal([`[prepare] ${slash} done`]);
      } catch (e) {
        appendTerminal([`[prepare] ${stage.slash} failed: ${getErrorMessage(e)}`]);
        break;
      }
    }
    setPendingPaidConfirm(null);
    await loadPlan();
    setRunning(false);
    dispatch({ type: 'SET_STATUS_BAR', payload: 'Prepare Matter Complete' });
  }

  return (
    <div>
      <div className="document-preview-header">
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Skill · /prepare_matter
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
            onClick={loadPlan}
            disabled={loading || running}
          >
            Refresh plan
          </button>
        </div>
      </div>

      {error && <div className="run-failure-card"><strong>Error</strong>{error}</div>}

      {confirmingPaid && plan?.nextStep?.slash && (
        <div style={{ marginTop: 20 }}>
          <RerunConfirmDialog
            skill={plan.nextStep.slash}
            title={`Confirm paid AI action — ${plan.nextStep.label}`}
            confirmLabel={`Run ${plan.nextStep.label}`}
            cancelLabel="Skip this step"
            onConfirm={executeRunNext}
            onCancel={() => setConfirmingPaid(false)}
          />
        </div>
      )}

      {pendingPaidConfirm && (
        <div style={{ marginTop: 20 }}>
          <div className="form-warning" role="alertdialog">
            <h2>Confirm paid step: {pendingPaidConfirm.stage.label}</h2>
            <p>
              This step uses a paid AI provider. Running it may incur costs.
            </p>
            <div className="warning-actions">
              <button type="button" onClick={() => { pendingPaidConfirm.resolve(true); setPendingPaidConfirm(null); }}>
                Skip
              </button>
              <button type="button" className="secondary" onClick={() => { pendingPaidConfirm.resolve(false); setPendingPaidConfirm(null); }}>
                Run {pendingPaidConfirm.stage.label}
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
                <strong>{plan.nextStep.label}</strong>
                {plan.nextStep.slash && <span className="pipeline-stage-label">{plan.nextStep.slash}</span>}
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
                    <strong>{stage.label}</strong>
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
                    {stage.artifacts.slice(0, 4).map((a) => <code key={a}>{a}</code>)}
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

async function runPreparationStage(slash: string, matterName?: string) {
  const body = { matterName };
  if (slash === '/matter-init') return api.runMatterInit(body);
  if (slash === '/extract') return api.runExtract(body);
  if (slash === '/describe_sources') return api.runDescribeSources(body);
  throw new Error(`No React runner is wired for preparation stage ${slash}`);
}

function stageStateClass(state: string): string {
  return lookupString(STAGE_STATE_CLASSES, state, 'not-run');
}

function stageStateLabel(state: string): string {
  return lookupString(STAGE_STATE_LABELS, state, state);
}

function isRunnablePreparationStage(stage?: PreparationStage | null): stage is PreparationStage {
  return stage?.action === PREPARATION_STAGE_ACTIONS.RUN || stage?.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN;
}

function hasRunnablePreparationStage(plan?: PreparationPlan | null): boolean {
  return Boolean(plan?.stages?.some(isRunnablePreparationStage));
}

function findNextPreparationStage(plan: PreparationPlan): PreparationStage | null {
  if (!plan.nextStep) return null;
  return plan.stages.find((stage) => (
    (plan.nextStep?.slash && stage.slash === plan.nextStep.slash)
    || (plan.nextStep?.stage && stage.id === plan.nextStep.stage)
  )) ?? null;
}
