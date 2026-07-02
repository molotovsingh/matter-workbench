import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { lookupString } from '../lib/lookup';
import { CASE_TIMELINE_DEPENDENCY_STATES } from '../lib/caseTimelineDependencyState';
import { formatMissingMatterDetails } from '../lib/matterDetails';
import { cleanCommandLabel } from '../lib/nativeCommands';
import { humanizeArtifactPath, technicalPathTitle } from '../lib/presentationLabels';
import { RERUN_ADVICE_STATES } from '../lib/rerunAdviceState';
import { PREPARATION_STAGE_ACTIONS } from '../lib/preparationStageActions';
import { useBackendPreparationJobs } from '../hooks/useBackendPreparationJobs';
import { PostureSummary } from '../components/matters/PostureSummary';
import type {
  PreparationStage,
  RerunAdvice,
  MatterAttention,
  AttentionItem,
  AttentionSummary,
  PreparationRunStatus,
  MatterMetadata,
  ProceduralPostureDiagnosisResult,
} from '../types';

interface Props {
  onRunNeededPreparation: (matterName: string, startStage?: string) => void;
  onForceFullPreparation: (matterName: string, reason: string) => void;
}

export default function MatterOverview({ onRunNeededPreparation, onForceFullPreparation }: Props) {
  const { state, refreshActiveMatterWorkspace, appendTerminal } = useApp();
  const matter = state.activeMatter!;
  const meta = matter.metadata ?? {};
  const localPreparationRun = state.preparationRun?.matterName === matter.name ? state.preparationRun : null;
  const backendPreparation = useBackendPreparationJobs({
    matterName: matter.name,
    localPreparationRun,
    refreshActiveMatterWorkspace,
    appendTerminal,
  });
  const preparationRun = localPreparationRun?.state === 'running'
    ? localPreparationRun
    : backendPreparation.preparationRun || localPreparationRun;
  const preparationRefreshKey = [
    preparationRun ? `${preparationRun.state}:${preparationRun.finishedAt || preparationRun.startedAt}` : '',
    backendPreparation.refreshKey,
  ].filter(Boolean).join(':');

  const missingFields = validateMetadata(meta as Record<string, string | undefined>);

  return (
    <div>
      <section className="matter-overview-hero">
        <h1>{meta.matterName?.trim() || matter.name}</h1>
        <p>
          {matter.fileCount ?? '—'} files and {matter.directoryCount ?? '—'} folders loaded from
          the matter folder.
        </p>
      </section>

      <MatterStoryCard meta={meta} />
      <ProceduralPostureCard matterName={matter.name} refreshKey={preparationRefreshKey} />

      <dl className="matter-info-card">
        <dt>Client</dt>
        <dd>{meta.clientName?.trim() || '—'}</dd>
        <dt>Matter name</dt>
        <dd>{meta.matterName?.trim() || '—'}</dd>
        <dt>Opposite party</dt>
        <dd>{meta.oppositeParty?.trim() || '—'}</dd>
        <dt>Matter type</dt>
        <dd>{meta.matterType?.trim() || '—'}</dd>
        <dt>Jurisdiction</dt>
        <dd>{meta.jurisdiction?.trim() || '—'}</dd>
      </dl>

      {missingFields.length > 0 && (
        <p className="form-error">
          Matter details are incomplete: {formatMissingMatterDetails(missingFields)}. Recreate the matter
          with these details, or ask the Matter Workbench operator to update them.
        </p>
      )}

      <PipelineCard
        matterName={matter.name}
        preparationRun={preparationRun}
        refreshKey={preparationRefreshKey}
        backendJobsError={backendPreparation.error}
        hasBackendPreparationFailure={backendPreparation.hasFailedJob}
        onRunNeededPreparation={onRunNeededPreparation}
        onForceFullPreparation={onForceFullPreparation}
      />

      <AttentionCard matterName={matter.name} refreshKey={preparationRefreshKey} preparationRun={preparationRun} />
    </div>
  );
}

function MatterStoryCard({ meta }: { meta: MatterMetadata }) {
  const story = (meta.briefDescription || '').trim();
  const originalNote = (meta.originalIntakeNote || '').trim();
  const source = meta.briefDescriptionSource || null;
  const isMatterWorkbenchStory = isMwStorySource(source);

  if (!story && !originalNote) return null;

  if (!isMatterWorkbenchStory) {
    return (
      <section className="matter-story-card original-note">
        <div className="matter-story-heading">
          <div>
            <p className="matter-story-kicker">Original intake note</p>
            <h2>Description</h2>
          </div>
        </div>
        <StoryText text={story || originalNote} />
      </section>
    );
  }

  return (
    <section className="matter-story-card">
      <div className="matter-story-heading">
        <div>
          <p className="matter-story-kicker">Matter Story</p>
          <h2>Matter Workbench story</h2>
        </div>
        <div className="matter-story-provenance" aria-label="Matter story provenance">
          <span>Author: MW</span>
          <span>Based on: {caseTimelineSourceLabel(source?.basedOn)}</span>
        </div>
      </div>
      <StoryText text={story} />
      {originalNote && (
        <details className="matter-original-note">
          <summary>Original intake note</summary>
          <StoryText text={originalNote} />
        </details>
      )}
    </section>
  );
}

function ProceduralPostureCard({
  matterName,
  refreshKey,
}: {
  matterName: string;
  refreshKey: string;
}) {
  const [status, setStatus] = useState<ProceduralPostureDiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [correction, setCorrection] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const loadStatus = () => {
    setError(null);
    api.getProceduralPostureDiagnosis(matterName)
      .then(setStatus)
      .catch((e) => setError(getErrorMessage(e)));
  };

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setError(null);
    api.getProceduralPostureDiagnosis(matterName)
      .then((payload) => { if (!cancelled) setStatus(payload); })
      .catch((e) => { if (!cancelled) setError(getErrorMessage(e)); });
    return () => { cancelled = true; };
  }, [matterName, refreshKey]);

  async function recordDecision(decision: 'confirmed' | 'corrected' | 'not_sure') {
    setFormError(null);
    const reasonOrCorrection = correction.trim();
    if (decision === 'corrected' && !reasonOrCorrection) {
      setFormError('Add the correction or reason before recording disagreement.');
      return;
    }
    setBusy(decision);
    try {
      await api.confirmProceduralPostureDiagnosis({
        matterName,
        decision,
        reasonOrCorrection,
        actor: 'lawyer',
      });
      setCorrection('');
      loadStatus();
    } catch (e) {
      setFormError(getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <section className="matter-story-card matter-posture-card">
        <div className="matter-story-heading">
          <div>
            <p className="matter-story-kicker">Case Analysis</p>
            <h2>Filing and Procedural Posture Diagnosis</h2>
          </div>
        </div>
        <p className="muted">Procedural posture diagnosis is unavailable: {error}</p>
      </section>
    );
  }

  if (!status) {
    return (
      <section className="matter-story-card matter-posture-card">
        <div className="matter-story-heading">
          <div>
            <p className="matter-story-kicker">Case Analysis</p>
            <h2>Filing and Procedural Posture Diagnosis</h2>
          </div>
        </div>
        <p className="muted">Checking procedural posture diagnosis…</p>
      </section>
    );
  }

  const state = status.state || 'missing';
  const confirmationState = status.confirmation?.state || 'unconfirmed';
  const readyForConfirmation = state === 'current_unconfirmed' || state === 'current_confirmed' || state === 'current_corrected';

  return (
    <section className="matter-story-card matter-posture-card">
      <div className="matter-story-heading">
        <div>
          <p className="matter-story-kicker">Case Analysis</p>
          <h2>Filing and Procedural Posture Diagnosis</h2>
        </div>
        <div className="matter-story-provenance" aria-label="Procedural posture status">
          <span>{postureStateLabel(state)}</span>
          <span>Confirmation: {confirmationStateLabel(confirmationState)}</span>
        </div>
      </div>
      <PostureSummary status={status} />
      {state === 'blocked' && <p className="muted">{postureBlockedMessage(status)}</p>}
      {state === 'missing' && <p className="muted">Diagnosis has not been generated yet. Use the Procedural Diagnosis row below to run and save it.</p>}
      {state === 'stale' || state === 'needs_reconfirmation' ? <p className="form-error">Case Timeline or Matter Story changed. Use the Procedural Diagnosis row below to refresh the saved diagnosis before relying on it.</p> : null}
      {readyForConfirmation && (
        <div className="posture-confirmation-panel">
          <p className="muted">
            Confirm this as a working posture for analysis, correct it with a reason, or mark it not sure. This is not final legal approval.
          </p>
          <textarea
            value={correction}
            onChange={(event) => setCorrection(event.target.value)}
            placeholder="If disagreeing, explain the correct court/forum, stage, remedy, or missing context."
            rows={3}
          />
          {formError && <p className="form-error">{formError}</p>}
          <div className="form-actions">
            <button type="button" className="run-skill-button" onClick={() => recordDecision('confirmed')} disabled={Boolean(busy)}>
              {busy === 'confirmed' ? 'Recording…' : 'Confirm working posture'}
            </button>
            <button type="button" className="secondary-button" onClick={() => recordDecision('corrected')} disabled={Boolean(busy)}>
              {busy === 'corrected' ? 'Recording…' : 'Disagree / correct'}
            </button>
            <button type="button" className="secondary-button" onClick={() => recordDecision('not_sure')} disabled={Boolean(busy)}>
              {busy === 'not_sure' ? 'Recording…' : 'Not sure yet'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function postureStateLabel(state: string): string {
  if (state === 'current_confirmed') return 'Confirmed working posture';
  if (state === 'current_corrected') return 'Correction recorded';
  if (state === 'current_unconfirmed') return 'Ready for lawyer confirmation';
  if (state === 'stale' || state === 'needs_reconfirmation') return 'Needs refresh';
  if (state === 'blocked') return 'Waiting on Case Timeline / Story';
  return 'Not started';
}

function confirmationStateLabel(state: string): string {
  if (state === 'confirmed') return 'confirmed';
  if (state === 'corrected') return 'corrected';
  if (state === 'not_sure') return 'not sure';
  return 'unconfirmed';
}

function caseTimelineSourceLabel(value?: string): string {
  return (value || 'Current Case Timeline').replace(/List of Dates/gi, 'Case Timeline');
}

function StoryText({ text }: { text: string }) {
  const blocks = storyTextBlocks(text);
  return (
    <div className="matter-story-body">
      {blocks.map((block, index) => (
        <section key={`${block.heading || 'paragraph'}-${index}`} className={block.heading ? 'matter-story-section' : 'matter-story-paragraph'}>
          {block.heading && <h3>{block.heading}</h3>}
          {block.body.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
        </section>
      ))}
    </div>
  );
}

function storyTextBlocks(text: string): Array<{ heading: string; body: string[] }> {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      if (lines.length > 1 && isStorySectionHeading(lines[0])) {
        return { heading: lines[0], body: [lines.slice(1).join(' ')] };
      }
      return { heading: '', body: [lines.join(' ')] };
    });
}

function isStorySectionHeading(line: string): boolean {
  return /^(At a glance|What this matter is about|Key dispute|Procedural posture|Main risks and missing facts)$/i.test(line.trim());
}

function isMwStorySource(source: MatterMetadata['briefDescriptionSource']): boolean {
  if (!source) return false;
  return (source.author || '').trim().toUpperCase() === 'MW'
    || source.type === 'matter_workbench_story'
    || source.slash === '/the_story';
}

// ─── Pipeline card ────────────────────────────────────────

function PipelineCard({
  matterName,
  preparationRun,
  refreshKey,
  backendJobsError,
  hasBackendPreparationFailure,
  onRunNeededPreparation,
  onForceFullPreparation,
}: {
  matterName: string;
  preparationRun: PreparationRunStatus | null;
  refreshKey: string;
  backendJobsError: string | null;
  hasBackendPreparationFailure: boolean;
  onRunNeededPreparation: (matterName: string, startStage?: string) => void;
  onForceFullPreparation: (matterName: string, reason: string) => void;
}) {
  const [stages, setStages] = useState<PreparationStage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forceReason, setForceReason] = useState('');
  const [forceConfirmation, setForceConfirmation] = useState('');
  const forceReasonReady = forceReason.trim().length >= 10;
  const forceConfirmationReady = forceConfirmation.trim().toUpperCase() === 'REBUILD';
  const isPreparationRunning = preparationRun?.state === 'running';
  const forceDisabled = isPreparationRunning || !forceReasonReady || !forceConfirmationReady;

  useEffect(() => {
    let cancelled = false;
    setStages(null);
    setError(null);
    api
      .getPrepareMatter(matterName)
      .then((plan) => {
        if (cancelled) return;
        setStages(Array.isArray(plan.stages) ? plan.stages : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(getErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [matterName, refreshKey]);

  return (
    <section className="matter-pipeline-card">
      <div className="matter-preparation-heading">
        <div className="matter-preparation-title">
          <h2>Matter Preparation</h2>
          <span className={`pipeline-state ${preparationHeadlineClass({ preparationRun, stages, error })}`}>
            {preparationHeadlineLabel({ preparationRun, stages, error })}
          </span>
        </div>
        <div className="matter-preparation-actions">
          <button
            type="button"
            className="run-skill-button"
            onClick={() => onRunNeededPreparation(matterName)}
            disabled={isPreparationRunning}
          >
            Run needed preparation
          </button>
        </div>
      </div>
      <p className="muted">
        {preparationSummaryText(preparationRun, stages)}
      </p>
      <details className="force-preparation-rebuild">
        <summary>Advanced: force full rebuild</summary>
        <div className="form-warning">
          <h2>Force full rebuild</h2>
          <p>This reruns extraction, source labels, Case Timeline, Matter Story, and procedural posture diagnosis even when current outputs exist. Use only when the saved preparation is known to be wrong or stale.</p>
          <label className="force-preparation-field">
            <span>Reason for the rebuild</span>
            <textarea
              value={forceReason}
              onChange={(event) => setForceReason(event.target.value)}
              placeholder="Explain why current preparation cannot be trusted."
              disabled={isPreparationRunning}
            />
            {!forceReasonReady && <small>Enter at least 10 characters.</small>}
          </label>
          <label className="force-preparation-field">
            <span>Type REBUILD to confirm</span>
            <input
              type="text"
              value={forceConfirmation}
              onChange={(event) => setForceConfirmation(event.target.value)}
              disabled={isPreparationRunning}
            />
          </label>
          <div className="warning-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onForceFullPreparation(matterName, forceReason);
                setForceReason('');
                setForceConfirmation('');
              }}
              disabled={forceDisabled}
            >
              Force full rebuild
            </button>
          </div>
        </div>
      </details>
      {preparationRun && <PreparationProgress run={preparationRun} />}
      {backendJobsError && <p className="muted">Server preparation status is unavailable: {backendJobsError}</p>}
      {hasBackendPreparationFailure && !isPreparationRunning && (
        <p className="form-error">A server preparation job stopped before finishing. Open Activity for details, then run needed preparation again.</p>
      )}
      {error && <p className="muted">Matter preparation is unavailable: {error}</p>}
      {!error && stages === null && (
        <p className="muted">Checking what has already been prepared for this matter…</p>
      )}
      {stages && stages.length === 0 && <p className="muted">No pipeline status available.</p>}
      {stages && stages.length > 0 && (
        <>
          <p className="muted">
            Based on files already saved for this matter. Missing work products are shown as
            needs review.
          </p>
          <div className="pipeline-stage-list">
            {stages.map((stage) => (
              <StageRow
                key={stage.slash || stage.label}
                stage={stage}
                isPreparationRunning={isPreparationRunning}
                onRunFromStage={(startStage) => onRunNeededPreparation(matterName, startStage)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PreparationProgress({ run }: { run: PreparationRunStatus }) {
  return (
    <div className="preparation-progress" aria-label="Matter preparation progress">
      {run.steps.map((step) => (
        <div key={step.id} className={`preparation-progress-step ${step.state}`}>
          <span className="preparation-progress-dot" />
          <div>
            <strong>{step.label}</strong>
            {step.detail && <span>{step.detail}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function StageRow({
  stage,
  isPreparationRunning,
  onRunFromStage,
}: {
  stage: PreparationStage;
  isPreparationRunning: boolean;
  onRunFromStage: (startStage: string) => void;
}) {
  const stateClass = pipelineStageStateClass(stage);
  const label = stageDisplayLabel(stage);
  const pill = stagePill(stage);

  return (
    <div className={`pipeline-stage ${stateClass}`}>
      <div className="pipeline-stage-main">
        <div>
          <strong>{label}</strong>
          {pill && <span className="pipeline-stage-label">{pill}</span>}
        </div>
        <span className={`pipeline-state ${stateClass}`}>
          {pipelineStageStateLabel(stage)}
        </span>
      </div>
      <StageReason stage={stage} />
      <StageArtifacts stage={stage} />
      <StageAiRun aiRun={stage.aiRun} />
      {stage.rerunAdvice && <StageRerunHint stage={stage} />}
      <StagePrimaryAction stage={stage} disabled={isPreparationRunning} onRunFromStage={onRunFromStage} />
    </div>
  );
}

function StagePrimaryAction({
  stage,
  disabled,
  onRunFromStage,
}: {
  stage: PreparationStage;
  disabled: boolean;
  onRunFromStage: (startStage: string) => void;
}) {
  const action = stagePrimaryAction(stage);
  if (!action) return null;
  const startStage = action.startStage || stage.slash || stage.id || '';
  if (!startStage && !action.disabled) return null;
  return (
    <div className="pipeline-stage-actions">
      <button
        type="button"
        className={`run-skill-button${action.primary ? '' : ' secondary'}`}
        onClick={() => { if (!action.disabled) onRunFromStage(startStage); }}
        disabled={disabled || action.disabled}
      >
        {action.label}
      </button>
      {action.hint && <span className="pipeline-stage-action-hint">{action.hint}</span>}
    </div>
  );
}

function stagePrimaryAction(stage: PreparationStage): { label: string; hint: string; disabled?: boolean; primary?: boolean; startStage?: string } | null {
  const slash = stage.slash || '';
  const state = String(stage.state || '').trim();

  if (stage.action === PREPARATION_STAGE_ACTIONS.BLOCKED) {
    return {
      label: blockedActionLabel(stage),
      hint: stage.reason || 'Resolve the upstream dependency first.',
      disabled: true,
      startStage: slash,
    };
  }

  if (slash === '/matter-init') {
    if (stageIsCurrent(stage)) return null;
    return { label: 'Set up matter', hint: 'Creates matter setup files before preparation can continue.', startStage: slash };
  }

  if (slash === '/extract') {
    if (stageIsCurrent(stage)) return null;
    return { label: 'Read documents', hint: 'Runs local document reading before source labels.', startStage: slash };
  }

  if (slash === '/describe_sources') {
    return {
      label: stageIsCurrent(stage) || state === 'stale' ? 'Refresh from Source Labels' : 'Run Source Labels',
      hint: 'Checks source labels and downstream stages; skips current work.',
      primary: !stageIsCurrent(stage),
      startStage: slash,
    };
  }

  if (slash === '/create_listofdates') {
    return {
      label: stageIsCurrent(stage) || state === 'stale' ? 'Refresh from Case Timeline' : 'Build Case Timeline',
      hint: 'Starts at Case Timeline; does not re-read documents when upstream is current.',
      primary: !stageIsCurrent(stage),
      startStage: slash,
    };
  }

  if (slash === '/the_story') {
    return {
      label: stageIsCurrent(stage) || state === 'stale' ? 'Refresh from Matter Story' : 'Write Matter Story',
      hint: 'Starts at Story and continues to downstream diagnosis if needed.',
      primary: !stageIsCurrent(stage),
      startStage: slash,
    };
  }

  if (slash === '/procedural_posture_diagnosis') {
    if (state === 'current_unconfirmed') {
      return {
        label: 'Confirm in Case Analysis card',
        hint: 'The diagnosis is saved; use the confirmation controls above before relying on it.',
        disabled: true,
        startStage: slash,
      };
    }
    if (stageIsCurrent(stage)) return null;
    return {
      label: state === 'stale' ? 'Refresh saved Procedural Diagnosis' : 'Run saved Procedural Diagnosis',
      hint: 'Creates the Case Analysis Markdown/JSON artifact, job, and receipt. Not chat.',
      primary: true,
      startStage: slash,
    };
  }

  return null;
}

function blockedActionLabel(stage: PreparationStage): string {
  if (stage.slash === '/describe_sources') return 'Needs documents first';
  if (stage.slash === '/create_listofdates') return 'Needs Source Labels first';
  if (stage.slash === '/the_story') return 'Needs Case Timeline first';
  if (stage.slash === '/procedural_posture_diagnosis') return 'Needs Matter Story first';
  if (stage.slash === '/extract') return 'Needs matter setup first';
  if (stage.slash === '/matter-init') return 'Needs matter details';
  return 'Blocked';
}

function StageReason({ stage }: { stage: PreparationStage }) {
  const reason = String(stage.reason || '').trim();
  if (!reason || stage.rerunAdvice) return null;
  return <p className="pipeline-stage-reason">{sentenceWithPeriod(reason)}</p>;
}

function StageArtifacts({ stage }: { stage: PreparationStage }) {
  const artifacts = stage.artifacts;
  if (!artifacts || artifacts.length === 0) {
    const message = stageIsBlocked(stage)
      ? 'Output will appear after earlier preparation steps are current.'
      : 'No output document found yet.';
    return <div className="pipeline-artifacts muted">{message}</div>;
  }
  return (
    <div className="pipeline-artifacts">
      {artifacts.slice(0, 4).map((a) => (
        <span key={a} title={technicalPathTitle(a)}>{humanizeArtifactPath(a)}</span>
      ))}
      {artifacts.length > 4 && <span className="muted">+{artifacts.length - 4} more</span>}
    </div>
  );
}

function StageAiRun({ aiRun }: { aiRun?: PreparationStage['aiRun'] }) {
  if (!aiRun) return null;
  const provider = aiRun.returnedProvider || aiRun.provider || '';
  const model = aiRun.returnedModel || aiRun.model || '';
  if (!provider && !model) return null;
  return (
    <details className="pipeline-ai-run">
      <summary>Run receipt</summary>
      <div>
        {provider && <span>{provider}</span>}
        {model && <code>{model}</code>}
      </div>
    </details>
  );
}

function StageRerunHint({ stage }: { stage: PreparationStage }) {
  const advice = stage.rerunAdvice!;
  const state = advice.state || RERUN_ADVICE_STATES.UNKNOWN;
  const stateLabel = rerunStateLabel(state);
  const hint = rerunHintText(advice);
  const meta = rerunHintMeta(stage, advice);

  return (
    <div className={`pipeline-rerun-hint ${rerunStateClass(state)}`}>
      <strong>{stateLabel}</strong>
      <span>{hint}</span>
      {meta.length > 0 && (
        <div className="pipeline-rerun-meta">
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Attention card ───────────────────────────────────────

function AttentionCard({
  matterName,
  refreshKey,
  preparationRun,
}: {
  matterName: string;
  refreshKey: string;
  preparationRun: PreparationRunStatus | null;
}) {
  const [data, setData] = useState<MatterAttention | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPreparing = preparationRun?.state === 'running';

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    if (isPreparing) {
      return () => {
        cancelled = true;
      };
    }
    api
      .getMatterAttention(matterName)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(getErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [matterName, refreshKey, isPreparing]);

  const summary = data?.summary ?? { state: 'clear', blocker: 0, warning: 0, info: 0 };
  const items = data?.items ?? [];
  const visibleItems = items.slice(0, 5);
  const hiddenCount = Math.max(0, items.length - 5);

  return (
    <section className="matter-pipeline-card matter-attention-card">
      {error && (
        <>
          <h2>Preparation Advisory</h2>
          <p className="muted">Preparation advisory is unavailable: {error}</p>
        </>
      )}
      {!error && data === null && (
        <>
          <h2>Preparation Advisory</h2>
          <p className="muted">
            {isPreparing
              ? 'Preparing a fresh advisory. The previous advisory will be replaced when this run finishes.'
              : 'Checking matter-level blockers and warnings…'}
          </p>
        </>
      )}
      {data && (
        <>
          <div className="matter-attention-heading">
            <h2>Preparation Advisory</h2>
            <span className={`pipeline-state ${attentionStateClass(summary.state)}`}>
              {attentionStateLabel(summary)}
            </span>
          </div>
          <p className="muted">
            Warnings gathered from intake, extraction, source labels, chronology, skill runs, and
            matter-scoped command failures.
          </p>
          <AttentionSummaryChips summary={summary} />
          {items.length > 0 ? (
            <>
              <div className="matter-attention-list">
                {visibleItems.map((item, i) => (
                  <AttentionItemRow key={item.id ?? i} item={item} />
                ))}
              </div>
              {hiddenCount > 0 && (
                <p className="matter-attention-more muted">
                  +{hiddenCount} more item{hiddenCount === 1 ? '' : 's'} in the full
                  preparation report.
                </p>
              )}
            </>
          ) : (
            <p className="matter-attention-clear muted">
              No preparation blockers or warnings found for this matter.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function AttentionSummaryChips({ summary }: { summary: AttentionSummary }) {
  const chips: [string, number][] = [
    ['Blockers', summary.blocker || 0],
    ['Warnings', summary.warning || 0],
    ['Info', summary.info || 0],
  ];
  return (
    <div className="matter-attention-summary">
      {chips.map(([label, count]) => (
        <span key={label}>
          <strong>{count}</strong> {label}
        </span>
      ))}
    </div>
  );
}

function AttentionItemRow({ item }: { item: AttentionItem }) {
  const severity = item.severity || 'warning';
  const evidence = Array.isArray(item.evidence) ? item.evidence.slice(0, 2) : [];

  return (
    <article className={`matter-attention-item ${attentionSeverityClass(severity)}`}>
      <div className="matter-attention-item-main">
        <div>
          <strong>{item.title || 'Preparation item'}</strong>
          {item.category && <span className="pipeline-stage-label">{item.category}</span>}
        </div>
        <span className={`pipeline-state ${attentionSeverityStateClass(severity)}`}>
          {attentionSeverityLabel(severity)}
        </span>
      </div>
      {item.detail && <p>{item.detail}</p>}
      {item.action && (
        <div className="matter-attention-action">
          <strong>Action</strong>
          <span>{item.action}</span>
        </div>
      )}
      {evidence.length > 0 && (
        <div className="matter-attention-evidence">
          {evidence.map((entry, i) => (
            <code key={i}>{formatEvidence(entry)}</code>
          ))}
        </div>
      )}
    </article>
  );
}

// ─── Helper functions ─────────────────────────────────────

function preparationHeadlineLabel({
  preparationRun,
  stages,
  error,
}: {
  preparationRun: PreparationRunStatus | null;
  stages: PreparationStage[] | null;
  error: string | null;
}): string {
  if (preparationRun?.state === 'running') return 'Preparing…';
  if (error) return 'Needs review';
  if (!stages) return preparationRun?.state === 'blocked' ? 'Blocked' : 'Checking';
  if (stages.some(stageIsRunnable)) return stages.some(stageNeedsUpdate) ? 'Needs update' : 'Needs preparation';
  if (preparationRun?.state === 'blocked') return 'Blocked';
  if (stages.some(stageIsBlocked)) return 'Blocked';
  if (stages.length > 0 && stages.every(stageIsCurrent)) return 'Prepared';
  return 'Needs review';
}

function preparationHeadlineClass({
  preparationRun,
  stages,
  error,
}: {
  preparationRun: PreparationRunStatus | null;
  stages: PreparationStage[] | null;
  error: string | null;
}): string {
  const label = preparationHeadlineLabel({ preparationRun, stages, error });
  if (label === 'Prepared') return 'present';
  if (label === 'Blocked') return 'failed';
  if (label === 'Preparing…' || label === 'Checking') return 'pending';
  return 'warning';
}

function preparationSummaryText(preparationRun: PreparationRunStatus | null, stages: PreparationStage[] | null = null): string {
  if (preparationRun?.state === 'running') {
    return preparationRun.message || 'Automatic preparation is running. You can keep reviewing the matter while it works.';
  }
  if (stages?.some(stageIsRunnable)) {
    return 'Use the action on the relevant row. Matter Workbench will skip current upstream work and continue through downstream steps as they unblock.';
  }
  if (preparationRun?.state === 'blocked') {
    return 'Automatic preparation stopped. Review the advisory before drafting.';
  }
  if (preparationRun) {
    return 'Automatic preparation has run for this matter. Review the advisory before drafting.';
  }
  return 'Review the preparation status and advisory before drafting.';
}

function stageIsRunnable(stage: PreparationStage): boolean {
  return stage.action === PREPARATION_STAGE_ACTIONS.RUN
    || stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN;
}

function stageNeedsUpdate(stage: PreparationStage): boolean {
  return stage.state === 'stale'
    || stage.rerunAdvice?.state === RERUN_ADVICE_STATES.STALE;
}

function stageIsCurrent(stage: PreparationStage): boolean {
  if (stage.rerunAdvice?.state && stage.rerunAdvice.state !== RERUN_ADVICE_STATES.CURRENT) return false;
  if (stage.state === 'current_unconfirmed') return false;
  return stage.action === PREPARATION_STAGE_ACTIONS.SKIP_CURRENT
    && ['current', 'current_confirmed', 'current_corrected'].includes(stage.state || '');
}

function stageIsBlocked(stage: PreparationStage): boolean {
  return stage.action === PREPARATION_STAGE_ACTIONS.BLOCKED
    || stage.rerunAdvice?.state === RERUN_ADVICE_STATES.FAILED
    || stage.rerunAdvice?.state === RERUN_ADVICE_STATES.MISSING_UPSTREAM;
}

function pipelineStageStateClass(stage: PreparationStage): string {
  if (stageIsBlocked(stage)) return 'failed';
  if (stage.rerunAdvice?.state === RERUN_ADVICE_STATES.STALE || stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN || stage.state === 'current_unconfirmed') return 'warning';
  if (stageIsCurrent(stage)) return 'present';
  return 'not-run';
}

function pipelineStageStateLabel(stage: PreparationStage): string {
  if (stageIsBlocked(stage)) return 'Blocked';
  if (stage.state === 'current_unconfirmed') return 'Needs confirmation';
  if (stage.rerunAdvice?.state === RERUN_ADVICE_STATES.STALE || stage.state === 'stale') return 'Needs update';
  if (stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN) return stage.state === 'missing' ? 'Not started' : 'Needs review';
  if (stage.action === PREPARATION_STAGE_ACTIONS.RUN) return stage.state === 'missing' ? 'Not started' : 'Ready to run';
  return stageIsCurrent(stage) ? 'Done' : 'Needs review';
}

function postureBlockedMessage(status: ProceduralPostureDiagnosisResult): string {
  const blockedReasons = Array.isArray(status.blockedReasons)
    ? status.blockedReasons.filter((reason) => typeof reason === 'string' && reason.trim())
    : [];
  if (blockedReasons.length) return blockedReasons.join(' ');
  return 'Waiting on Case Timeline and Matter Story before diagnosis can run.';
}

function validateMetadata(meta: Record<string, string | undefined>): string[] {
  const required = ['clientName', 'matterName', 'matterType', 'jurisdiction'] as const;
  return required.filter((k) => {
    const v = meta[k];
    return !v || (typeof v === 'string' && !v.trim());
  });
}

function stageDisplayLabel(stage: PreparationStage): string {
  const display = (stage as { display?: { action?: string } }).display;
  if (display?.action) return display.action;
  return stage.label || cleanCommandLabel(stage.slash || '');
}

function stagePill(stage: PreparationStage): string {
  const display = (stage as { display?: { pill?: string } }).display;
  if (display?.pill) return display.pill;
  if (stage.paidProviderCall === true) return 'Uses AI';
  if (stage.paidProviderCall === false) return 'Local';
  return '';
}

const RERUN_STATE_LABELS = {
  [RERUN_ADVICE_STATES.CURRENT]: 'Up to date',
  [RERUN_ADVICE_STATES.STALE]: 'Needs update',
  [RERUN_ADVICE_STATES.MISSING]: 'Not started',
  [RERUN_ADVICE_STATES.FAILED]: 'Needs attention',
  [RERUN_ADVICE_STATES.MISSING_UPSTREAM]: 'Waiting on earlier step',
} as const;

const RERUN_STATE_CLASSES = {
  [RERUN_ADVICE_STATES.CURRENT]: 'current',
  [RERUN_ADVICE_STATES.STALE]: 'stale',
  [RERUN_ADVICE_STATES.MISSING]: 'missing',
  [RERUN_ADVICE_STATES.FAILED]: 'failed',
  [RERUN_ADVICE_STATES.MISSING_UPSTREAM]: 'missing-upstream',
} as const;

const ATTENTION_STATE_CLASSES = {
  blocked: 'failed',
  attention_needed: 'warning',
  clear: 'present',
} as const;

const ATTENTION_SEVERITY_LABELS = {
  blocker: 'Blocker',
  warning: 'Warning',
  info: 'Info',
} as const;

const ATTENTION_SEVERITY_STATE_CLASSES = {
  blocker: 'failed',
  warning: 'warning',
  info: 'not-run',
} as const;

const ATTENTION_SEVERITY_CLASSES = {
  blocker: 'blocker',
  warning: 'warning',
  info: 'info',
} as const;

function rerunStateLabel(state: string): string {
  return lookupString(RERUN_STATE_LABELS, state, 'Status unknown');
}

function rerunStateClass(state: string): string {
  return lookupString(RERUN_STATE_CLASSES, state, 'unknown');
}

function rerunHintText(advice: RerunAdvice): string {
  if (advice.state === RERUN_ADVICE_STATES.STALE) {
    if (advice.dependencyState === CASE_TIMELINE_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED) {
      return 'Source labels changed after this chronology was rendered. A label refresh should be enough; AI chronology regeneration is not required unless the legal facts changed.';
    }
    if (advice.dependencyState === CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED) {
      return 'Source metadata changed after this chronology was rendered. Review the current chronology before deciding whether to regenerate.';
    }
    const reason = sentenceWithPeriod(advice.reason || 'Newer source material exists');
    return `${reason} Review the existing output document, then regenerate deliberately to include newer inputs.`;
  }
  if (advice.shouldConfirm) {
    return 'An output document already exists. The app will ask before replacing it or starting a paid AI action.';
  }
  if (advice.state === RERUN_ADVICE_STATES.MISSING) {
    return 'No output document exists yet; the next run will create one.';
  }
  if (advice.state === RERUN_ADVICE_STATES.FAILED) {
    return 'The existing output metadata could not be read. Review the current file before regenerating.';
  }
  if (advice.state === RERUN_ADVICE_STATES.MISSING_UPSTREAM) {
    return 'Required source material is missing. Complete the earlier step before creating this work product.';
  }
  return advice.reason || 'Review the existing output document before regenerating.';
}

function sentenceWithPeriod(value: string): string {
  const text = (value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function rerunHintMeta(stage: PreparationStage, advice: RerunAdvice): string[] {
  const meta: string[] = [];
  if (advice.lastRunAt) meta.push(`Last run ${formatDateTime(advice.lastRunAt)}`);
  const providerModel = [advice.provider, advice.model].filter(Boolean).join(' / ');
  if (providerModel) meta.push('Run receipt available');
  if (stage.metrics?.rows != null) {
    meta.push(`${stage.metrics.rows} row${stage.metrics.rows === 1 ? '' : 's'}`);
  }
  if (advice.newestInputPath) meta.push(`Newest input ${humanizeArtifactPath(advice.newestInputPath)}`);
  return meta;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function attentionStateLabel(summary: AttentionSummary): string {
  if (summary.state === 'blocked' || summary.blocker) return 'Blocked';
  if (summary.state === 'attention_needed' || summary.warning) return 'Needs attention';
  return 'Clear';
}

function attentionStateClass(state: string): string {
  return lookupString(ATTENTION_STATE_CLASSES, state, 'not-run');
}

function attentionSeverityLabel(severity: string): string {
  return lookupString(ATTENTION_SEVERITY_LABELS, severity, 'Warning');
}

function attentionSeverityStateClass(severity: string): string {
  return lookupString(ATTENTION_SEVERITY_STATE_CLASSES, severity, 'warning');
}

function attentionSeverityClass(severity: string): string {
  return lookupString(ATTENTION_SEVERITY_CLASSES, severity, 'warning');
}

function formatEvidence(entry: string | Record<string, unknown>): string {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  return (
    [
      entry.path,
      entry.source_id,
      entry.file_id,
      entry.row,
      entry.runId,
      entry.status,
      entry.label_status,
      entry.detail,
      entry.value,
      entry.notes,
    ]
  )
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 5)
    .join(' – ');
}
