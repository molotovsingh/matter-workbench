import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import type { ExtractFileResult } from '../../types';

export default function ExtractResult() {
  const { state, appendTerminal } = useApp();
  const [rows, setRows] = useState<ExtractFileResult[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleRun() {
    if (!state.activeMatter) return;
    setRunning(true);
    setError('');
    setDone(false);
    appendTerminal(['[extract] running…']);
    try {
      const result = await api.runExtract({ matterName: state.activeMatter.name });
      setRows(result.fileResults ?? []);
      setDone(true);
      appendTerminal(['[extract] complete']);
    } catch (e) {
      setError((e as Error).message);
      appendTerminal([`[extract] error: ${(e as Error).message}`]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="document-preview-header">
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Skill · /extract
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
            <span>/extract</span>
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
                <th>File ID</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td><code>{row.original_name || row.source_path || row.file_id}</code></td>
                  <td><code>{row.file_id || ''}</code></td>
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
          Extract organises files from the inbox into structured matter folders, using AI to identify document types and assign canonical names.
        </p>
      )}
    </div>
  );
}
