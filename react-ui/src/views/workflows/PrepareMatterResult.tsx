import { useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import RerunConfirmDialog from '../../components/RerunConfirmDialog';
import type { PreparationPlan, PreparationStage } from '../../types';

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
    const matchedStage = plan.stages?.find(s => s.slash === plan.nextStep?.slash);
    if (matchedStage?.paidProviderCall) {
      setConfirmingPaid(true);
    } else {
      executeRunNext();
    }
  }

  async function executeRunNext() {
    if (!plan?.nextStep?.slash) return;
    setConfirmingPaid(false);
    setRunning(true);
    appendTerminal([`[prepare] running: ${plan.nextStep.slash}`]);
    try {
      const slash = plan.nextStep.slash;
      if (slash === '/matter-init') await api.runMatterInit({ matterName: state.activeMatter?.name });
      else if (slash === '/extract') await api.runExtract({ matterName: state.activeMatter?.name });
      else if (slash === '/describe_sources') await api.runDescribeSources({ matterName: state.activeMatter?.name });
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
    const actionable = plan.stages.filter((s) => s.actionable);
    for (const stage of actionable) {
      if (stage.paidProviderCall) {
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
        const slash = stage.slash;
        if (slash === '/matter-init') await api.runMatterInit({ matterName: state.activeMatter?.name });
        else if (slash === '/extract') await api.runExtract({ matterName: state.activeMatter?.name });
        else if (slash === '/describe_sources') await api.runDescribeSources({ matterName: state.activeMatter?.name });
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
            disabled={running || loading || !plan}
          >
            {running ? 'Running…' : 'Run preparation'}
          </button>
          {plan?.nextStep && (
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
          <div className="pipeline-stage present">
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
              <div key={stage.slash ?? stage.label} className={`pipeline-stage ${stage.state === 'present' ? 'present' : 'not-run'}`}>
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

function stageStateClass(state: string): string {
  return ({
    present: 'present',
    ready: 'warning',
    blocked: 'failed',
    stale: 'warning',
    'not-run': 'not-run',
  } as Record<string, string>)[state] || 'not-run';
}

function stageStateLabel(state: string): string {
  return ({
    present: 'Done',
    ready: 'Ready to run',
    blocked: 'Blocked',
    stale: 'Needs update',
    'not-run': 'Not started',
  } as Record<string, string>)[state] || state;
}
