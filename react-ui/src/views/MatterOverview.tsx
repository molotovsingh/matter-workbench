import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { lookupString } from '../lib/lookup';
import { LIST_OF_DATES_DEPENDENCY_STATES } from '../lib/listOfDatesDependencyState';
import { cleanCommandLabel, commandPill, OVERVIEW_NATIVE_COMMANDS } from '../lib/nativeCommands';
import { humanizeArtifactPath, technicalPathTitle } from '../lib/presentationLabels';
import { RERUN_ADVICE_STATES } from '../lib/rerunAdviceState';
import type {
  PipelineStage,
  RerunAdvice,
  MatterAttention,
  AttentionItem,
  AttentionSummary,
  PreparationRunStatus,
} from '../types';

interface Props {
  onCommand: (command: string) => void;
  onRunPreparationAgain: (matterName: string) => void;
}

export default function MatterOverview({ onCommand, onRunPreparationAgain }: Props) {
  const { state } = useApp();
  const matter = state.activeMatter!;
  const meta = matter.metadata ?? {};
  const preparationRun = state.preparationRun?.matterName === matter.name ? state.preparationRun : null;
  const preparationRefreshKey = preparationRun
    ? `${preparationRun.state}:${preparationRun.finishedAt || preparationRun.startedAt}`
    : '';

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
        {meta.briefDescription?.trim() && (
          <>
            <dt>Description</dt>
            <dd>{meta.briefDescription}</dd>
          </>
        )}
      </dl>

      {missingFields.length > 0 && (
        <p className="form-error">
          Missing metadata: {missingFields.join(', ')}. Update the matter details file
          (<code>matter.json</code>) and refresh, or recreate the matter via <code>Add new matter</code>.
        </p>
      )}

      <PipelineCard
        matterName={matter.name}
        preparationRun={preparationRun}
        refreshKey={preparationRefreshKey}
        onRunPreparationAgain={onRunPreparationAgain}
      />

      <div className="form-actions matter-run-actions">
        {OVERVIEW_NATIVE_COMMANDS.map((command) => (
          <SkillButton
            key={command.command}
            command={command.command}
            onClick={onCommand}
            disabled={command.command === '/matter-init' && missingFields.length > 0}
            secondary={command.overviewPlacement === 'secondary'}
          />
        ))}
      </div>

      <AttentionCard matterName={matter.name} refreshKey={preparationRefreshKey} preparationRun={preparationRun} />
    </div>
  );
}

// ─── Pipeline card ────────────────────────────────────────

function PipelineCard({
  matterName,
  preparationRun,
  refreshKey,
  onRunPreparationAgain,
}: {
  matterName: string;
  preparationRun: PreparationRunStatus | null;
  refreshKey: string;
  onRunPreparationAgain: (matterName: string) => void;
}) {
  const [stages, setStages] = useState<PipelineStage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStages(null);
    setError(null);
    api
      .getMatterStatus(matterName)
      .then((s) => {
        if (cancelled) return;
        setStages(Array.isArray(s.stages) ? s.stages : []);
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
            onClick={() => onRunPreparationAgain(matterName)}
            disabled={preparationRun?.state === 'running'}
          >
            Run preparation again
          </button>
        </div>
      </div>
      <p className="muted">
        {preparationSummaryText(preparationRun)}
      </p>
      {preparationRun && <PreparationProgress run={preparationRun} />}
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
              <StageRow key={stage.slash || stage.label} stage={stage} />
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

function StageRow({ stage }: { stage: PipelineStage }) {
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
      <StageArtifacts artifacts={stage.artifacts} />
      <StageAiRun aiRun={stage.aiRun} />
      {stage.rerunAdvice && <StageRerunHint stage={stage} />}
    </div>
  );
}

function StageArtifacts({ artifacts }: { artifacts?: string[] }) {
  if (!artifacts || artifacts.length === 0) {
    return <div className="pipeline-artifacts muted">No output document found.</div>;
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

function StageAiRun({ aiRun }: { aiRun?: PipelineStage['aiRun'] }) {
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

function StageRerunHint({ stage }: { stage: PipelineStage }) {
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

// ─── Skill action buttons ─────────────────────────────────

function SkillButton({
  command,
  onClick,
  secondary = false,
  disabled = false,
}: {
  command: string;
  onClick: (cmd: string) => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const label = cleanCommandLabel(command);
  const pill = commandPill(command);
  return (
    <button
      type="button"
      className={`run-skill-button${secondary ? ' secondary' : ''}`}
      disabled={disabled}
      onClick={() => onClick(command)}
    >
      {label} {pill && <span>{pill}</span>}
    </button>
  );
}

// ─── Helper functions ─────────────────────────────────────

function preparationHeadlineLabel({
  preparationRun,
  stages,
  error,
}: {
  preparationRun: PreparationRunStatus | null;
  stages: PipelineStage[] | null;
  error: string | null;
}): string {
  if (preparationRun?.state === 'running') return 'Preparing…';
  if (preparationRun?.state === 'blocked') return 'Blocked';
  if (error) return 'Needs review';
  if (!stages) return 'Checking';
  if (stages.some((stage) => stage.rerunAdvice?.state === RERUN_ADVICE_STATES.FAILED || stage.rerunAdvice?.state === RERUN_ADVICE_STATES.MISSING_UPSTREAM)) return 'Blocked';
  if (stages.length > 0 && stages.every(stageIsCurrent)) return 'Prepared';
  return 'Needs review';
}

function preparationHeadlineClass({
  preparationRun,
  stages,
  error,
}: {
  preparationRun: PreparationRunStatus | null;
  stages: PipelineStage[] | null;
  error: string | null;
}): string {
  const label = preparationHeadlineLabel({ preparationRun, stages, error });
  if (label === 'Prepared') return 'present';
  if (label === 'Blocked') return 'failed';
  if (label === 'Preparing…' || label === 'Checking') return 'pending';
  return 'warning';
}

function preparationSummaryText(preparationRun: PreparationRunStatus | null): string {
  if (preparationRun?.state === 'running') {
    return 'Automatic preparation is running. You can keep reviewing the matter while it works.';
  }
  if (preparationRun?.state === 'blocked') {
    return 'Automatic preparation stopped. Review the advisory before drafting.';
  }
  if (preparationRun) {
    return 'Automatic preparation has run for this matter. Review the advisory before drafting.';
  }
  return 'Review the preparation status and advisory before drafting.';
}

function stageIsCurrent(stage: PipelineStage): boolean {
  if (!stage.present) return false;
  const adviceState = stage.rerunAdvice?.state || RERUN_ADVICE_STATES.CURRENT;
  return adviceState === RERUN_ADVICE_STATES.CURRENT;
}

function pipelineStageStateClass(stage: PipelineStage): string {
  if (stage.rerunAdvice?.state === RERUN_ADVICE_STATES.FAILED || stage.rerunAdvice?.state === RERUN_ADVICE_STATES.MISSING_UPSTREAM) return 'failed';
  if (stage.rerunAdvice?.state === RERUN_ADVICE_STATES.STALE) return 'warning';
  return stage.present ? 'present' : 'not-run';
}

function pipelineStageStateLabel(stage: PipelineStage): string {
  if (stage.rerunAdvice?.state === RERUN_ADVICE_STATES.FAILED || stage.rerunAdvice?.state === RERUN_ADVICE_STATES.MISSING_UPSTREAM) return 'Blocked';
  if (stage.rerunAdvice?.state === RERUN_ADVICE_STATES.STALE) return 'Needs review';
  return stage.present ? 'Done' : 'Needs review';
}

function validateMetadata(meta: Record<string, string | undefined>): string[] {
  const required = ['clientName', 'matterName', 'matterType', 'jurisdiction'] as const;
  return required.filter((k) => {
    const v = meta[k];
    return !v || (typeof v === 'string' && !v.trim());
  });
}

function stageDisplayLabel(stage: PipelineStage): string {
  if (stage.display?.action) return stage.display.action;
  return stage.label || cleanCommandLabel(stage.slash || stage.name || '');
}

function stagePill(stage: PipelineStage): string {
  if (stage.display?.pill) return stage.display.pill;
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
    if (advice.dependencyState === LIST_OF_DATES_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED) {
      return 'Source labels changed after this chronology was rendered. A label refresh should be enough; AI chronology regeneration is not required unless the legal facts changed.';
    }
    if (advice.dependencyState === LIST_OF_DATES_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED) {
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

function rerunHintMeta(stage: PipelineStage, advice: RerunAdvice): string[] {
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
