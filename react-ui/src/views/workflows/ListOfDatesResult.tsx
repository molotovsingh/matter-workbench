import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import RerunConfirmDialog from '../../components/RerunConfirmDialog';

interface ChronologyEntry {
  date: string;
  description: string;
  relevance?: string;
  source?: string;
  sourceFile?: string;
}

export default function ListOfDatesResult() {
  const { state, appendTerminal } = useApp();
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
      const r = result as { entries?: ChronologyEntry[] };
      setEntries(r.entries ?? []);
      setDone(true);
      appendTerminal([`[list-of-dates] ${r.entries?.length ?? 0} entries`]);
    } catch (e) {
      setError((e as Error).message);
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
            onConfirm={executeRun}
            onCancel={() => setConfirming(false)}
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
                <time>{entry.date}</time>
                <p>{entry.description}</p>
                <div className={`chronology-relevance${entry.relevance ? ` ${entry.relevance}` : ''}`}>
                  {entry.relevance ?? '—'}
                </div>
                <div className="chronology-source">
                  {entry.source && <span>{entry.source}</span>}
                  {entry.sourceFile && <span>{entry.sourceFile}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
