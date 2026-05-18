import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { lookupString } from '../lib/lookup';
import type {
  PipelineStage,
  RerunAdvice,
  MatterAttention,
  AttentionItem,
  AttentionSummary,
} from '../types';

const LIST_OF_DATES_DEPENDENCY_STATES = {
  LABEL_REFRESH_NEEDED: 'label_refresh_needed',
  CHRONOLOGY_REVIEW_NEEDED: 'chronology_review_needed',
};

interface Props {
  onCommand: (command: string) => void;
}

export default function MatterOverview({ onCommand }: Props) {
  const { state } = useApp();
  const matter = state.activeMatter!;
  const meta = matter.metadata ?? {};

  const missingFields = validateMetadata(meta as Record<string, string | undefined>);

  return (
    <div>
      <section className="matter-overview-hero">
        <h1>{meta.matterName?.trim() || matter.name}</h1>
        <p>
          {matter.fileCount ?? '—'} files and {matter.directoryCount ?? '—'} folders loaded from
          local workspace.
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
          Missing metadata: {missingFields.join(', ')}. Edit <code>matter.json</code> on disk and
          refresh, or recreate the matter via <code>Add new matter</code>.
        </p>
      )}

      <PipelineCard matterName={matter.name} />

      <div className="form-actions matter-run-actions">
        <SkillButton command="/prepare_matter" onClick={onCommand} />
        <SkillButton
          command="/matter-init"
          onClick={onCommand}
          disabled={missingFields.length > 0}
        />
        <SkillButton command="/extract" onClick={onCommand} secondary />
        <SkillButton command="/describe_sources" onClick={onCommand} secondary />
        <SkillButton command="/create_listofdates" onClick={onCommand} secondary />
        <SkillButton command="/doctor" onClick={onCommand} secondary />
      </div>

      <details style={{ marginTop: 28 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 13, fontWeight: 500 }}>
          Diagnostics
        </summary>
        <div style={{ marginTop: 12 }}>
          <AttentionCard matterName={matter.name} />
        </div>
      </details>
    </div>
  );
}

// ─── Pipeline card ────────────────────────────────────────

function PipelineCard({ matterName }: { matterName: string }) {
  const [stages, setStages] = useState<PipelineStage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStages(null);
    setError(null);
    api
      .getMatterStatus()
      .then((s) => setStages(Array.isArray(s.stages) ? s.stages : []))
      .catch((e) => setError(getErrorMessage(e)));
  }, [matterName]);

  return (
    <section className="matter-pipeline-card">
      <h2>Matter readiness</h2>
      {error && <p className="muted">Matter readiness is unavailable: {error}</p>}
      {!error && stages === null && (
        <p className="muted">Checking what has already been prepared for this matter…</p>
      )}
      {stages && stages.length === 0 && <p className="muted">No pipeline status available.</p>}
      {stages && stages.length > 0 && (
        <>
          <p className="muted">
            Based on files already saved for this matter. Missing work products are shown as not
            started.
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

function StageRow({ stage }: { stage: PipelineStage }) {
  const stateClass = stage.present ? 'present' : 'not-run';
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
          {stage.present ? 'Done' : 'Not started'}
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
        <code key={a}>{a}</code>
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
    <div className="pipeline-ai-run">
      {provider && <span>{provider}</span>}
      {model && <code>{model}</code>}
    </div>
  );
}

function StageRerunHint({ stage }: { stage: PipelineStage }) {
  const advice = stage.rerunAdvice!;
  const state = advice.state || 'unknown';
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

function AttentionCard({ matterName }: { matterName: string }) {
  const [data, setData] = useState<MatterAttention | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .getMatterAttention()
      .then(setData)
      .catch((e) => setError(getErrorMessage(e)));
  }, [matterName]);

  const summary = data?.summary ?? { state: 'clear', blocker: 0, warning: 0, info: 0 };
  const items = data?.items ?? [];
  const visibleItems = items.slice(0, 5);
  const hiddenCount = Math.max(0, items.length - 5);

  return (
    <section className="matter-pipeline-card matter-attention-card">
      {error && (
        <>
          <h2>Developer attention</h2>
          <p className="muted">Developer attention is unavailable: {error}</p>
        </>
      )}
      {!error && data === null && (
        <>
          <h2>Developer attention</h2>
          <p className="muted">Checking matter-level blockers and warnings…</p>
        </>
      )}
      {data && (
        <>
          <div className="matter-attention-heading">
            <h2>Developer attention</h2>
            <span className={`pipeline-state ${attentionStateClass(summary.state)}`}>
              {attentionStateLabel(summary)}
            </span>
          </div>
          <p className="muted">
            Read-only diagnostics gathered from intake, extraction, source labels, chronology, skill
            runs, and command failures.
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
                  matter-attention report.
                </p>
              )}
            </>
          ) : (
            <p className="matter-attention-clear muted">
              No developer blockers or warnings found for this matter.
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
          <strong>{item.title || 'Developer attention needed'}</strong>
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

const LAWYER_LABELS: Record<string, string> = {
  '/prepare_matter': 'Prepare matter',
  '/matter-init': 'Set up matter',
  '/extract': 'Extract documents',
  '/describe_sources': 'Label sources',
  '/create_listofdates': 'Create list of dates',
  '/doctor': 'Run diagnostics',
  '/context_search': 'Search matter context',
  '/context_preview': 'Preview context',
};

const RERUN_STATE_LABELS = {
  current: 'Up to date',
  stale: 'Needs update',
  missing: 'Not started',
  failed: 'Needs attention',
  missing_upstream: 'Waiting on earlier step',
} as const;

const RERUN_STATE_CLASSES = {
  current: 'current',
  stale: 'stale',
  missing: 'missing',
  failed: 'failed',
  missing_upstream: 'missing-upstream',
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

function cleanCommandLabel(command: string): string {
  if (LAWYER_LABELS[command]) return LAWYER_LABELS[command];
  return (command || 'Action')
    .replace(/^\/+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Action';
}

function commandPill(command: string): string {
  const local = ['/prepare_matter', '/matter-init', '/extract', '/doctor', '/context_search', '/context_preview'];
  if (local.includes(command)) return 'Local';
  return 'Uses AI';
}

function rerunStateLabel(state: string): string {
  return lookupString(RERUN_STATE_LABELS, state, 'Status unknown');
}

function rerunStateClass(state: string): string {
  return lookupString(RERUN_STATE_CLASSES, state, 'unknown');
}

function rerunHintText(advice: RerunAdvice): string {
  if (advice.state === 'stale') {
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
  if (advice.state === 'missing') {
    return 'No output document exists yet; the next run will create one.';
  }
  if (advice.state === 'failed') {
    return 'The existing output metadata could not be read. Review the current file before regenerating.';
  }
  if (advice.state === 'missing_upstream') {
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
  if (providerModel) meta.push(providerModel);
  if (stage.metrics?.rows != null) {
    meta.push(`${stage.metrics.rows} row${stage.metrics.rows === 1 ? '' : 's'}`);
  }
  if (advice.newestInputPath) meta.push(`Newest input ${advice.newestInputPath}`);
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
