import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { writeClipboardText } from '../lib/clipboard';
import {
  canOpenSkillRunOutputForMatter,
  formatConfigurableRunOutputDocumentState,
  formatConfigurableSkillRunReport,
  humanizeRunOutputPath,
  receiptForRun,
  skillRunOutputExistsInWorkspace,
} from '../lib/configurableSkillRunReport';
import { getErrorMessage } from '../lib/errors';
import { filePreviewTitle, loadTextFilePreview } from '../lib/filePreview';
import { useLatestValue } from '../hooks/useLatestValue';
import type { ActiveMatter, JobStatus, PrivateBetaFeedback, SkillRun } from '../types';

interface DayGroup {
  label: string;
  runs: SkillRun[];
}

export default function ActivityPage() {
  const { state, dispatch, appendTerminal } = useApp();
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const [runs, setRuns] = useState<SkillRun[]>([]);
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [feedback, setFeedback] = useState<PrivateBetaFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadActivityRuns = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoading(true);
    setLoadError('');
    try {
      const [runResult, jobResult, feedbackResult] = await Promise.all([
        api.getSkillRuns(100),
        api.getJobs(100),
        api.getPrivateBetaFeedback(100),
      ]);
      if (isCancelled()) return;
      setRuns(runResult.runs || []);
      setJobs(jobResult.jobs || []);
      setFeedback(feedbackResult.feedback || []);
    } catch (e) {
      if (isCancelled()) return;
      setLoadError(getErrorMessage(e));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadActivityRuns(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadActivityRuns]);

  const activeMatterName = state.activeMatter?.name ?? '';
  const visibleRuns = activeMatterName
    ? runs.filter((run) => run.matterFolder === activeMatterName || run.matterName === activeMatterName)
    : runs;
  const visibleJobs = activeMatterName
    ? jobs.filter((job) => job.matterName === activeMatterName)
    : jobs;
  const visibleFeedback = activeMatterName
    ? feedback.filter((item) => item.context?.activeMatterName === activeMatterName || item.context?.activeMatterFolder === activeMatterName)
    : feedback;
  const succeeded = visibleRuns.filter((r) => receiptForRun(r).isCompletedWork);
  const needsAttention = visibleRuns.filter((r) => receiptForRun(r).needsAttention);
  const missingOutput = visibleRuns.filter((r) => receiptForRun(r).receiptState === 'output_missing');
  const failed = visibleRuns.filter((r) => receiptForRun(r).receiptState === 'failed');
  const running = visibleRuns.filter((r) => receiptForRun(r).receiptState === 'running');
  const failedJobs = visibleJobs.filter((job) => job.status === 'failed');
  const runningJobs = visibleJobs.filter((job) => job.status === 'running');
  const newFeedback = visibleFeedback.filter((item) => item.status === 'new');
  const queuedFeedback = visibleFeedback.filter((item) => item.sync?.status === 'queued');
  const cancelled = visibleRuns.filter((r) => receiptForRun(r).receiptState === 'cancelled');
  const workCompleted = succeeded;
  const dayGroups = groupRunsByDay(workCompleted);

  async function handleCopyReport(run: SkillRun) {
    try {
      await writeClipboardText(formatConfigurableSkillRunReport(run));
      appendTerminal([`[activity] copied run report: ${run.slash || run.title || run.id}`]);
    } catch (e) {
      appendTerminal([`[activity] copy failed: ${getErrorMessage(e)}`]);
    }
  }

  async function handleCopyFeedbackPacket(feedbackItem: PrivateBetaFeedback) {
    try {
      await writeClipboardText(formatPrivateBetaFeedbackReport(feedbackItem));
      appendTerminal([`[activity] copied feedback packet: ${feedbackItem.id}`]);
    } catch (e) {
      appendTerminal([`[activity] feedback copy failed: ${getErrorMessage(e)}`]);
    }
  }

  async function handleRetryFeedbackSync() {
    try {
      const result = await api.syncPrivateBetaFeedback();
      appendTerminal([`[feedback] sync retry: ${result.sent} sent, ${result.queued} queued`]);
      await loadActivityRuns();
    } catch (e) {
      appendTerminal([`[feedback] sync retry failed: ${getErrorMessage(e)}`]);
    }
  }

  async function handleOpenOutput(run: SkillRun) {
    const matterName = state.activeMatter?.name ?? null;
    if (!canOpenSkillRunOutputForMatter(run, state.activeMatter) || !matterName) {
      appendTerminal([`[activity] output is in another matter: ${run.matterFolder || run.matterName || 'unknown matter'}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Switch to the run matter before opening that output.' });
      return;
    }
    const outputPath = run.outputPaths?.markdown;
    if (!outputPath) return;
    try {
      const preview = await loadTextFilePreview(outputPath, (path) => api.getFile(path, matterName));
      if (activeMatterNameRef.current !== matterName) return;
      dispatch({ type: 'SET_ACTIVE_FILE', payload: outputPath });
      dispatch({ type: 'SET_BREADCRUMBS', payload: filePreviewTitle(outputPath) });
      dispatch({ type: 'SET_COMMAND_COPY', payload: `Viewing: ${filePreviewTitle(outputPath)}` });
      dispatch({ type: 'SET_FILE_PREVIEW', payload: preview });
      dispatch({ type: 'SET_VIEW', payload: 'file-preview' });
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      const message = getErrorMessage(e);
      appendTerminal([`[activity] output preview failed for ${outputPath}: ${message}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `Could not open output: ${message}` });
    }
  }

  return (
    <div className="activity-page">
      <div className="activity-hero">
        <div>
          <h1>Activity</h1>
          <p>What ran, what it produced, and whether it worked.</p>
        </div>
        <div className="activity-summary">
          {succeeded.length > 0 && <span className="completed">{succeeded.length} succeeded</span>}
          {missingOutput.length > 0 && <span className="warning">{missingOutput.length} output missing</span>}
          {(running.length + runningJobs.length) > 0 && <span className="running">{running.length + runningJobs.length} running</span>}
          {(failed.length + failedJobs.length) > 0 && <span className="failed">{failed.length + failedJobs.length} failed</span>}
          {newFeedback.length > 0 && <span className="warning">{newFeedback.length} feedback</span>}
          {queuedFeedback.length > 0 && <span className="warning">{queuedFeedback.length} sync queued</span>}
          {!loading && visibleRuns.length === 0 && visibleJobs.length === 0 && visibleFeedback.length === 0 && <span className="muted">No runs yet</span>}
        </div>
      </div>

      {state.activeMatter && (
        <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
          Showing activity for matter folder: <strong>{state.activeMatter.name}</strong>
        </p>
      )}

      {!loading && !loadError && newFeedback.length > 0 && (
        <div className="activity-feedback-alert">
          <div>
            <strong>New tester feedback</strong>
            <p>
              {newFeedback.length} note{newFeedback.length === 1 ? '' : 's'} waiting for review. Copy a packet below when you want to triage it.
            </p>
          </div>
          <span>{newFeedback.length}</span>
        </div>
      )}

      {loading && <p className="muted">Loading activity…</p>}
      {loadError && (
        <div className="run-failure-card" style={{ marginBottom: 18 }}>
          <strong>Activity could not be loaded</strong>
          <p>{loadError}</p>
          <button
            type="button"
            className="run-skill-button secondary"
            onClick={() => { void loadActivityRuns(); }}
            disabled={loading}
          >
            {loading ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}

      {!loading && !loadError && visibleFeedback.length > 0 && (
        <section className="activity-section">
          <div className="activity-section-heading">
            <h2>Beta Feedback</h2>
            {queuedFeedback.length > 0 && (
              <button type="button" className="run-skill-button secondary" onClick={handleRetryFeedbackSync}>
                Retry sync
              </button>
            )}
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Tester notes captured inside the app. These are triage packets, not legal work product.
          </p>
          <div className="activity-day-list attention">
            {visibleFeedback.map((item) => (
              <FeedbackCard key={item.id} feedback={item} onCopy={handleCopyFeedbackPacket} />
            ))}
          </div>
        </section>
      )}

      {!loading && !loadError && needsAttention.length > 0 && (
        <section className="activity-section">
          <h2>Needs Attention</h2>
          <div className="activity-day-list attention">
            {needsAttention.map((run) => (
              <RunCard key={run.id} run={run} activeMatter={state.activeMatter} onCopy={handleCopyReport} onOpen={handleOpenOutput} />
            ))}
          </div>
        </section>
      )}

      {!loading && !loadError && visibleJobs.length > 0 && (
        <section className="activity-section">
          <h2>Matter Jobs</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Long-running matter work recorded by the local job ledger.
          </p>
          <div className="activity-day-list quiet">
            {visibleJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </section>
      )}

      {!loading && !loadError && dayGroups.length > 0 && (
        <section className="activity-section">
          <h2>Work Completed</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            The work product of each run stays in the matter folder on disk.
          </p>
          {dayGroups.map((group, i) => (
            <details key={group.label} className="activity-day-group" open={i === 0}>
              <summary>
                <span>{group.label}</span>
                <span className="muted">{group.runs.length} run{group.runs.length === 1 ? '' : 's'}</span>
              </summary>
              <div className="activity-day-list">
                {group.runs.map((run) => (
                  <RunCard key={run.id} run={run} activeMatter={state.activeMatter} onCopy={handleCopyReport} onOpen={handleOpenOutput} />
                ))}
              </div>
            </details>
          ))}
        </section>
      )}

      {!loading && !loadError && cancelled.length > 0 && (
        <section className="activity-section">
          <details className="activity-cancelled-runs">
            <summary>
              Cancelled Runs <span className="muted">{cancelled.length}</span>
            </summary>
            <div className="activity-day-list quiet">
              {cancelled.map((run) => (
                <RunCard key={run.id} run={run} activeMatter={state.activeMatter} compact onCopy={handleCopyReport} onOpen={handleOpenOutput} />
              ))}
            </div>
          </details>
        </section>
      )}

      {!loading && state.terminalLines.length > 0 && (
        <section className="activity-section">
          <details className="activity-system-log">
            <summary>
              System Log <span className="muted">{Math.min(state.terminalLines.length, 20)} recent</span>
            </summary>
            <ol style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
              {state.terminalLines.slice(-20).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </details>
        </section>
      )}

      {!loading && visibleRuns.length === 0 && visibleJobs.length === 0 && visibleFeedback.length === 0 && (
        <div style={{ marginTop: 40, color: 'var(--muted)', fontSize: 14 }}>
          <p>No skill runs yet. Run a skill from the Home tab or command box.</p>
        </div>
      )}
    </div>
  );
}

function FeedbackCard({ feedback, onCopy }: { feedback: PrivateBetaFeedback; onCopy: (feedback: PrivateBetaFeedback) => void }) {
  const createdTime = formatTime(feedback.createdAt);
  const syncStatus = formatFeedbackSyncStatus(feedback.sync?.status);
  const syncClass = feedbackSyncClass(feedback.sync?.status);
  return (
    <article className="activity-card warning">
      <div className="activity-card-main">
        <div className="activity-card-copy">
          <div className="activity-title-row">
            <h3>{formatFeedbackChoice(feedback.choice)}</h3>
            <span className="pipeline-state warning">{feedback.classification}</span>
            <span className={`pipeline-state ${syncClass}`}>{syncStatus}</span>
          </div>
          <div className="activity-run-line">
            {feedback.context?.activeMatterName && <span>{feedback.context.activeMatterName}</span>}
            {feedback.context?.screen && <span>{feedback.context.screen}</span>}
            <span>{feedback.status}</span>
          </div>
          <p style={{ margin: '8px 0 0', color: 'var(--text)', fontSize: 13, lineHeight: 1.45 }}>
            {feedback.tryingToDo}
          </p>
          {feedback.happenedInstead && (
            <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 12, lineHeight: 1.45 }}>
              {feedback.happenedInstead}
            </p>
          )}
          <div className="feedback-card-context">
            {feedback.context?.runtimeMode && <span>{feedback.context.runtimeMode}</span>}
            {feedback.context?.currentView && <span>{feedback.context.currentView}</span>}
            {feedback.context?.viewport && <span>{feedback.context.viewport}</span>}
          </div>
        </div>
        <time style={{ color: 'var(--muted-light)', fontSize: 11, flexShrink: 0, marginTop: 2 }}>
          {createdTime}
        </time>
      </div>
      <div className="activity-card-actions">
        <button className="run-skill-button secondary" type="button" onClick={() => onCopy(feedback)}>
          Copy packet
        </button>
        <details className="activity-run-details">
          <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 12 }}>Details</summary>
          <dl className="skill-card-meta">
            <div><dt>ID</dt><dd>{feedback.id}</dd></div>
            <div><dt>classification</dt><dd>{feedback.classification}</dd></div>
            <div><dt>Status</dt><dd>{feedback.status}</dd></div>
            <div><dt>Sync</dt><dd>{syncStatus}</dd></div>
            {feedback.sync?.attempts !== undefined && <div><dt>Sync attempts</dt><dd>{feedback.sync.attempts}</dd></div>}
            {feedback.sync?.lastError && <div><dt>Sync error</dt><dd>{feedback.sync.lastError}</dd></div>}
            {feedback.context?.route && <div><dt>Route</dt><dd>{feedback.context.route}</dd></div>}
          </dl>
        </details>
      </div>
    </article>
  );
}

function formatPrivateBetaFeedbackReport(feedback: PrivateBetaFeedback): string {
  const lines = [
    'Private beta feedback',
    '',
    `ID: ${feedback.id}`,
    `Created: ${feedback.createdAt}`,
    `Choice: ${formatFeedbackChoice(feedback.choice)}`,
    `Classification: ${feedback.classification}`,
    `Status: ${feedback.status}`,
    `Sync: ${formatFeedbackSyncStatus(feedback.sync?.status)}`,
  ];
  if (feedback.context?.activeMatterName) lines.push(`Matter: ${feedback.context.activeMatterName}`);
  if (feedback.context?.screen) lines.push(`Screen: ${feedback.context.screen}`);
  if (feedback.context?.route) lines.push(`Route: ${feedback.context.route}`);
  lines.push('', 'What were you trying to do?', feedback.tryingToDo);
  if (feedback.happenedInstead) lines.push('', 'What happened instead?', feedback.happenedInstead);
  if (feedback.context?.recentActivity?.length) {
    lines.push('', 'Recent activity');
    for (const line of feedback.context.recentActivity) lines.push(`- ${line}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatFeedbackChoice(choice: string): string {
  if (choice === 'did_not_work') return 'Something did not work';
  if (choice === 'confused') return 'I got confused';
  if (choice === 'want_something') return 'I want this to do something';
  return choice || 'Feedback';
}

function formatFeedbackSyncStatus(status?: string): string {
  if (status === 'sent') return 'Sent to mothership';
  if (status === 'queued') return 'Queued for sync';
  if (status === 'failed') return 'Sync failed';
  if (status === 'not_configured') return 'Local only';
  return 'Sync unknown';
}

function feedbackSyncClass(status?: string): string {
  if (status === 'sent') return 'completed';
  if (status === 'queued') return 'warning';
  if (status === 'failed') return 'failed';
  return 'running';
}

function JobCard({ job }: { job: JobStatus }) {
  const finishedTime = job.finishedAt ? formatTime(job.finishedAt) : null;
  const startedTime = formatTime(job.startedAt);
  const statusClass = jobStatusClass(job.status);
  return (
    <article className={`activity-card compact ${statusClass}`}>
      <div className="activity-card-main">
        <div className="activity-card-copy">
          <div className="activity-title-row">
            <h3>{job.label || humanizeJobKind(job.kind)}</h3>
            <span className={`pipeline-state ${statusClass}`}>{formatJobStatus(job.status)}</span>
          </div>
          <div className="activity-run-line">
            {job.matterName && <span>{job.matterName}</span>}
            <span>{humanizeJobKind(job.kind)}</span>
            {job.resultState && <span>{job.resultState}</span>}
          </div>
          {job.errorMessage && (
            <p style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0' }}>{job.errorMessage}</p>
          )}
        </div>
        <time style={{ color: 'var(--muted-light)', fontSize: 11, flexShrink: 0, marginTop: 2 }}>
          {finishedTime || startedTime}
        </time>
      </div>
    </article>
  );
}

function RunCard({
  run,
  activeMatter,
  compact = false,
  onCopy,
  onOpen,
}: {
  run: SkillRun;
  activeMatter: ActiveMatter | null;
  compact?: boolean;
  onCopy: (run: SkillRun) => void;
  onOpen: (run: SkillRun) => void;
}) {
  const title = run.title || run.slash || 'Custom skill run';
  const receipt = receiptForRun(run);
  const finishedTime = run.finishedAt ? formatTime(run.finishedAt) : null;
  const startedTime = formatTime(run.startedAt);
  const outputPath = run.outputPaths?.markdown;
  const canOpen = canOpenSkillRunOutputForMatter(run, activeMatter);
  const outputExists = skillRunOutputExistsInWorkspace(run, activeMatter);

  return (
    <article className={`activity-card${compact ? ' compact' : ''} ${receipt.statusClass}`}>
      <div className="activity-card-main">
        <div className="activity-card-copy">
          <div className="activity-title-row">
            <h3>{title}</h3>
            <span className={`pipeline-state ${receipt.statusClass}`}>{receipt.statusLabel}</span>
          </div>
          <div className="activity-run-line">
            {run.matterName && <span>{run.matterName}</span>}
            {outputPath && <span>{humanizeRunOutputPath(outputPath)}</span>}
          </div>
        </div>
        <time style={{ color: 'var(--muted-light)', fontSize: 11, flexShrink: 0, marginTop: 2 }}>
          {finishedTime || startedTime}
        </time>
      </div>
      {!compact && (
        <div className="activity-card-actions">
          {canOpen && outputExists && (
            <button className="run-skill-button secondary" type="button" onClick={() => onOpen(run)}>
              Open output
            </button>
          )}
          {canOpen && outputPath && !outputExists && (
            <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>Output missing</span>
          )}
          <button className="run-skill-button secondary" type="button" onClick={() => onCopy(run)}>
            Copy report
          </button>
          <details className="activity-run-details">
            <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 12 }}>Details</summary>
            <dl className="skill-card-meta">
              <div><dt>Matter</dt><dd>{run.matterName || run.matterFolder || '—'}</dd></div>
              {outputPath && <div><dt>Output</dt><dd>{humanizeRunOutputPath(outputPath)}</dd></div>}
              <div><dt>Output document</dt><dd>{formatConfigurableRunOutputDocumentState(run.overwrite)}</dd></div>
              {run.aiRun?.provider && <div><dt>Provider</dt><dd>{run.aiRun.provider}{run.aiRun.model ? ` / ${run.aiRun.model}` : ''}</dd></div>}
              <div><dt>Started</dt><dd>{new Date(run.startedAt).toLocaleString()}</dd></div>
              {run.finishedAt && <div><dt>Finished</dt><dd>{new Date(run.finishedAt).toLocaleString()}</dd></div>}
              {run.errorMessage && <div><dt>Error</dt><dd style={{ color: 'var(--danger)' }}>{run.errorMessage}</dd></div>}
            </dl>
          </details>
        </div>
      )}
    </article>
  );
}

function groupRunsByDay(runs: SkillRun[]): DayGroup[] {
  const groups = new Map<string, SkillRun[]>();
  for (const run of runs) {
    const key = dayKey(run.finishedAt || run.startedAt);
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).map(([key, dayRuns]) => ({
    label: dayLabel(key),
    runs: dayRuns,
  }));
}

function dayKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function jobStatusClass(status: string): string {
  if (status === 'succeeded') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  if (status === 'cancelled') return 'cancelled';
  return 'unknown';
}

function formatJobStatus(status: string): string {
  if (status === 'succeeded') return 'Complete';
  if (status === 'failed') return 'Failed';
  if (status === 'running') return 'Running';
  if (status === 'cancelled') return 'Cancelled';
  return status || 'Unknown';
}

function humanizeJobKind(kind: string): string {
  return (kind || 'job')
    .split('_')
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '')
    .join(' ');
}
