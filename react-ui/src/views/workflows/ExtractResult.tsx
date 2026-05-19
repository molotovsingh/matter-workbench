import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { readableSourcePath } from '../../lib/sourceLabels';
import { useLatestValue } from '../../hooks/useLatestValue';
import type { ExtractFileResult } from '../../types';

export default function ExtractResult() {
  const { state, appendTerminal, refreshActiveMatterWorkspace } = useApp();
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const [rows, setRows] = useState<ExtractFileResult[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleRun() {
    if (!state.activeMatter) return;
    const matterName = state.activeMatter.name;
    setRunning(true);
    setError('');
    setDone(false);
    appendTerminal(['[extract] running…']);
    try {
      const result = await api.runExtract({ matterName });
      if (activeMatterNameRef.current !== matterName) return;
      setRows(result.fileResults ?? []);
      setDone(true);
      appendTerminal(['[extract] complete']);
      await refreshActiveMatterWorkspace({
        expectedMatterName: matterName,
        failurePrefix: '[workspace] refresh failed after Extract update',
      });
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      setError(getErrorMessage(e));
      appendTerminal([`[extract] error: ${getErrorMessage(e)}`]);
    } finally {
      if (activeMatterNameRef.current === matterName) setRunning(false);
    }
  }

  return (
    <div>
      <div className="document-preview-header">
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Document reading
          </div>
          <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 28, fontWeight: 600, margin: '0 0 5px', lineHeight: 1.15 }}>
            Extract documents
          </h1>
          <p className="document-path">{state.activeMatter?.name}</p>
        </div>
        <div className="document-actions">
          <button
            className="run-skill-button"
            type="button"
            onClick={handleRun}
            disabled={running || !state.activeMatter}
          >
            {running ? 'Extracting…' : done ? 'Re-run' : 'Run extract'}
            {' '}
            <span>Local</span>
          </button>
        </div>
      </div>

      {error && <div className="run-failure-card"><strong>Error</strong>{error}</div>}

      {done && rows.length > 0 && (
        <div className="table-scroll">
          <table className="extract-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td><code>{row.original_name || readableSourcePath(row.source_path) || 'Source record'}</code></td>
                  <td>{row.status}</td>
                  <td>{row.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {done && rows.length === 0 && (
        <p className="muted">No files were extracted.</p>
      )}

      {!done && !running && (
        <p style={{ color: 'var(--muted-strong)', fontSize: 14, marginTop: 16 }}>
          Extract reads supported source files and creates structured text records for later review.
        </p>
      )}
    </div>
  );
}
