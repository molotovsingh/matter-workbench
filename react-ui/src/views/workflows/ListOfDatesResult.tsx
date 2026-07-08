import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { CASE_TIMELINE_DEPENDENCY_STATES } from '../../lib/caseTimelineDependencyState';
import { lawyerFacingSourceLabel, readableSourcePath } from '../../lib/sourceLabels';
import RerunConfirmDialog from '../../components/RerunConfirmDialog';
import { useLatestValue } from '../../hooks/useLatestValue';
import type { ChronologyEntry } from '../../types';

export default function ListOfDatesResult() {
  const { state, appendTerminal, refreshActiveMatterWorkspace } = useApp();
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const [entries, setEntries] = useState<ChronologyEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  function handleRunClick() {
    setConfirming(true);
  }

  async function executeRun() {
    if (!state.activeMatter) return;
    const matterName = state.activeMatter.name;
    setConfirming(false);
    setRunning(true); setError(''); setDone(false);
    appendTerminal(['[list-of-dates] building Case Timeline…']);
    try {
      const result = await api.runCreateListOfDates({ matterName });
      if (activeMatterNameRef.current !== matterName) return;
      setEntries(result.entries ?? []);
      setDone(true);
      appendTerminal([`[list-of-dates] ${result.entries?.length ?? 0} entries created`]);
      await refreshActiveMatterWorkspace({
        expectedMatterName: matterName,
        failurePrefix: '[workspace] refresh failed after Case Timeline update',
      });
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      setError(getErrorMessage(e));
    } finally {
      if (activeMatterNameRef.current === matterName) setRunning(false);
    }
  }

  async function executeLabelRefresh() {
    if (!state.activeMatter) return;
    const matterName = state.activeMatter.name;
    setConfirming(false);
    setRunning(true);
    setError('');
    appendTerminal(['[list-of-dates] refreshing source labels without AI…']);
    try {
      const result = await api.refreshListOfDatesLabels({ matterName, dryRun: false });
      if (activeMatterNameRef.current !== matterName) return;
      setEntries(result.entries ?? []);
      setDone(true);
      appendTerminal([`[list-of-dates] refreshed labels for ${result.entries?.length ?? 0} entries`]);
      await refreshActiveMatterWorkspace({
        expectedMatterName: matterName,
        failurePrefix: '[workspace] refresh failed after Case Timeline update',
      });
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      const message = getErrorMessage(e);
      setError(message);
      appendTerminal([`[list-of-dates] label refresh failed: ${message}`]);
    } finally {
      if (activeMatterNameRef.current === matterName) setRunning(false);
    }
  }

  return (
    <div>
      <div className="document-preview-header" style={{ marginBottom: 24 }}>
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Library workflow
          </div>
          <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 28, fontWeight: 600, margin: '0 0 5px' }}>Build Case Timeline</h1>
          <p className="document-path">{state.activeMatter?.name}</p>
        </div>
        <div className="document-actions">
          <button className="run-skill-button" type="button" onClick={handleRunClick} disabled={running || confirming || !state.activeMatter}>
            {running ? 'Generating…' : done ? 'Regenerate' : 'Generate'}
            {' '}
            <span>Uses AI</span>
          </button>
        </div>
      </div>

      {confirming && (
        <div style={{ marginTop: 20 }}>
          <RerunConfirmDialog
            skill="/create_case_timeline"
            title={`Review Case Timeline before regenerating — ${state.activeMatter?.name}`}
            matterName={state.activeMatter?.name}
            confirmLabel="Regenerate Case Timeline"
            cancelLabel="Keep current Case Timeline"
            extraActions={(advice) => advice.dependencyState === CASE_TIMELINE_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED
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
    .map((source) => lawyerFacingSourceLabel({
      label: source.source_label
        || source.source_short_label
        || source.original_name
        || readableSourcePath(source.source_path)
        || '',
      citation: source.citation,
      fallback: 'Unlabelled source',
    }))
    .filter(Boolean);
  return [...new Set(labels)].slice(0, 3);
}
