import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';

interface SkillRun {
  id: string;
  skillId?: string;
  title?: string;
  slash?: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  matterName?: string;
  matterFolder?: string;
  outputPaths?: { markdown?: string; json?: string };
  aiRun?: { provider?: string; model?: string; task?: string };
  warnings?: string[];
  overwrite?: string;
  errorMessage?: string;
}

interface DayGroup {
  label: string;
  runs: SkillRun[];
}

export default function ActivityPage() {
  const { state, dispatch } = useApp();
  const [runs, setRuns] = useState<SkillRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getSkillRuns(100)
      .then((r) => setRuns((r.runs as SkillRun[]) || []))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const succeeded = runs.filter((r) => r.status === 'succeeded');
  const failed = runs.filter((r) => r.status === 'failed');
  const running = runs.filter((r) => r.status === 'running');
  const cancelled = runs.filter((r) => r.status === 'cancelled');
  const needsAttention = [...failed, ...running];
  const workCompleted = succeeded;
  const dayGroups = groupRunsByDay(workCompleted);

  function handleCopyReport(run: SkillRun) {
    const outputPath = run.outputPaths?.markdown;
    const lines = [
      `Skill: ${run.slash || run.title || 'unknown'}`,
      `Matter: ${run.matterName || '—'}`,
      `Status: ${run.status}`,
      outputPath ? `Output: ${outputPath}` : '',
      `Started: ${run.startedAt}`,
      run.finishedAt ? `Finished: ${run.finishedAt}` : '',
      run.errorMessage ? `Error: ${run.errorMessage}` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(lines).catch(() => null);
  }

  function handleOpenOutput(run: SkillRun) {
    if (!run.outputPaths?.markdown) return;
    dispatch({ type: 'SET_FILE_PREVIEW', payload: { path: run.outputPaths.markdown, type: 'text' } });
    dispatch({ type: 'SET_VIEW', payload: 'file-preview' });
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
          {running.length > 0 && <span className="running">{running.length} running</span>}
          {failed.length > 0 && <span className="failed">{failed.length} failed</span>}
          {!loading && runs.length === 0 && <span className="muted">No runs yet</span>}
        </div>
      </div>

      {state.activeMatter && (
        <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
          Showing activity for matter folder: <strong>{state.activeMatter.name}</strong>
        </p>
      )}

      {loading && <p className="muted">Loading activity…</p>}

      {!loading && needsAttention.length > 0 && (
        <section className="activity-section">
          <h2>Needs Attention</h2>
          <div className="activity-day-list attention">
            {needsAttention.map((run) => (
              <RunCard key={run.id} run={run} onCopy={handleCopyReport} onOpen={handleOpenOutput} />
            ))}
          </div>
        </section>
      )}

      {!loading && dayGroups.length > 0 && (
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
                  <RunCard key={run.id} run={run} onCopy={handleCopyReport} onOpen={handleOpenOutput} />
                ))}
              </div>
            </details>
          ))}
        </section>
      )}

      {!loading && cancelled.length > 0 && (
        <section className="activity-section">
          <details className="activity-cancelled-runs">
            <summary>
              Cancelled Runs <span className="muted">{cancelled.length}</span>
            </summary>
            <div className="activity-day-list quiet">
              {cancelled.map((run) => (
                <RunCard key={run.id} run={run} compact onCopy={handleCopyReport} onOpen={handleOpenOutput} />
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

      {!loading && runs.length === 0 && (
        <div style={{ marginTop: 40, color: 'var(--muted)', fontSize: 14 }}>
          <p>No skill runs yet. Run a skill from the Home tab or command box.</p>
        </div>
      )}
    </div>
  );
}

function RunCard({
  run,
  compact = false,
  onCopy,
  onOpen,
}: {
  run: SkillRun;
  compact?: boolean;
  onCopy: (run: SkillRun) => void;
  onOpen: (run: SkillRun) => void;
}) {
  const title = run.title || run.slash || 'Custom skill run';
  const statusClass = run.status === 'succeeded' ? 'present' : run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'not-run' : 'pending';
  const statusLabel = run.status === 'succeeded' ? 'Succeeded' : run.status === 'failed' ? 'Failed' : run.status === 'cancelled' ? 'Cancelled' : 'Running';
  const finishedTime = run.finishedAt ? formatTime(run.finishedAt) : null;
  const startedTime = formatTime(run.startedAt);
  const outputPath = run.outputPaths?.markdown;
  const canOpen = run.status === 'succeeded' && outputPath;

  return (
    <article className={`activity-card${compact ? ' compact' : ''} ${statusClass}`}>
      <div className="activity-card-main">
        <div className="activity-card-copy">
          <div className="activity-title-row">
            <h3>{title}</h3>
            <span className={`pipeline-state ${statusClass}`}>{statusLabel}</span>
          </div>
          <div className="activity-run-line">
            {run.matterName && <span>{run.matterName}</span>}
            {outputPath && <span>{humanizeOutputPath(outputPath)}</span>}
          </div>
        </div>
        <time style={{ color: 'var(--muted-light)', fontSize: 11, flexShrink: 0, marginTop: 2 }}>
          {finishedTime || startedTime}
        </time>
      </div>
      {!compact && (
        <div className="activity-card-actions">
          {canOpen && (
            <button className="run-skill-button secondary" type="button" onClick={() => onOpen(run)}>
              Open output
            </button>
          )}
          <button className="run-skill-button secondary" type="button" onClick={() => onCopy(run)}>
            Copy report
          </button>
          <details className="activity-run-details">
            <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 12 }}>Details</summary>
            <dl className="skill-card-meta">
              <div><dt>Matter</dt><dd>{run.matterName || run.matterFolder || '—'}</dd></div>
              {outputPath && <div><dt>Output</dt><dd>{humanizeOutputPath(outputPath)}</dd></div>}
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

function humanizeOutputPath(path: string): string {
  if (/source.*index/i.test(path)) return 'Source Record';
  if (/list.*of.*dates/i.test(path)) return 'Case Chronology';
  if (/file.*register/i.test(path)) return 'File Register';
  if (/extraction.*log/i.test(path)) return 'Extraction Log';
  return path.split('/').pop() || path;
}
