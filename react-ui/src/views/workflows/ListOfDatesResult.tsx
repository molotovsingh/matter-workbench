import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { LIST_OF_DATES_DEPENDENCY_STATES } from '../../lib/listOfDatesDependencyState';
import RerunConfirmDialog from '../../components/RerunConfirmDialog';
import type { ChronologyEntry } from '../../types';

export default function ListOfDatesResult() {
  const { state, appendTerminal, refreshActiveMatterWorkspace } = useApp();
  const [entries, setEntries] = useState<ChronologyEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  function handleRunClick() {
    if (done) {
      setConfirming(true);
    } else {
      executeRun();
    }
  }

  async function executeRun() {
    if (!state.activeMatter) return;
    setConfirming(false);
    setRunning(true); setError(''); setDone(false);
    appendTerminal(['[list-of-dates] generating…']);
    try {
      const result = await api.runCreateListOfDates({ matterName: state.activeMatter.name });
      setEntries(result.entries ?? []);
      setDone(true);
      appendTerminal([`[list-of-dates] ${result.entries?.length ?? 0} entries`]);
      await refreshActiveMatterWorkspace({ failurePrefix: '[workspace] refresh failed after List of Dates update' });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  async function executeLabelRefresh() {
    if (!state.activeMatter) return;
    setConfirming(false);
    setRunning(true);
    setError('');
    appendTerminal(['[list-of-dates] refreshing labels without AI…']);
    try {
      const result = await api.refreshListOfDatesLabels({ dryRun: false });
      setEntries(result.entries ?? []);
      setDone(true);
      appendTerminal([`[list-of-dates] refreshed labels for ${result.entries?.length ?? 0} entries`]);
      await refreshActiveMatterWorkspace({ failurePrefix: '[workspace] refresh failed after List of Dates update' });
    } catch (e) {
      const message = getErrorMessage(e);
      setError(message);
      appendTerminal([`[list-of-dates] label refresh failed: ${message}`]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="document-preview-header" style={{ marginBottom: 24 }}>
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Skill · /create_listofdates
          </div>
          <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 28, fontWeight: 600, margin: '0 0 5px' }}>Create list of dates</h1>
          <p className="document-path">{state.activeMatter?.name}</p>
        </div>
        <div className="document-actions">
          <button className="run-skill-button" type="button" onClick={handleRunClick} disabled={running || confirming || !state.activeMatter}>
            {running ? 'Generating…' : done ? 'Re-generate' : 'Generate'}
            <span>Uses AI</span>
          </button>
        </div>
      </div>

      {confirming && (
        <div style={{ marginTop: 20 }}>
          <RerunConfirmDialog
            skill="/create_listofdates"
            title={`Review List of Dates before regenerating — ${state.activeMatter?.name}`}
            confirmLabel="Regenerate List of Dates"
            cancelLabel="Keep current List of Dates"
            extraActions={(advice) => advice.dependencyState === LIST_OF_DATES_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED
              ? [{ id: 'refresh-labels', label: 'Refresh labels only' }]
              : []}
            onConfirm={executeRun}
            onCancel={() => setConfirming(false)}
            onAction={(actionId) => {
              if (actionId === 'refresh-labels') executeLabelRefresh();
            }}
          />
        </div>
      )}

      {error && <div className="run-failure-card"><strong>Error</strong>{error}</div>}

      {done && entries.length === 0 && <p className="muted">No dates found.</p>}

      {done && entries.length > 0 && (
        <>
          <div className="chronology-summary">
            <span>{entries.length} events</span>
          </div>
          <div className="chronology-table">
            <div className="chronology-header">
              <span>Date</span><span>Event</span><span>Relevance</span><span>Source</span>
            </div>
            {entries.map((entry, i) => (
              <div key={i} className="chronology-row">
                <time>{entry.date_iso || entry.date || entry.date_text || '—'}</time>
                <p>{entry.event || entry.description || '—'}</p>
                <div className={`chronology-relevance${entry.legal_relevance || entry.relevance ? ' has-value' : ''}`}>
                  {entry.legal_relevance || entry.relevance || '—'}
                </div>
                <div className="chronology-source">
                  {sourceLabels(entry).map((label) => <span key={label}>{label}</span>)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function sourceLabels(entry: ChronologyEntry): string[] {
  const sources = entry.supporting_sources?.length ? entry.supporting_sources : [entry];
  const labels = sources
    .map((source) => source.source_short_label || source.source_label || source.source_path || source.citation || '')
    .filter(Boolean);
  return [...new Set(labels)].slice(0, 3);
}
