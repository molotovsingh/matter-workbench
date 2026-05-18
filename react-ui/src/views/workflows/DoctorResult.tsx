import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import type { DoctorIssue } from '../../types';

export default function DoctorResult() {
  const { state, appendTerminal } = useApp();
  const [issues, setIssues] = useState<DoctorIssue[]>([]);
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [done, setDone] = useState(false);
  const [fixDone, setFixDone] = useState(false);
  const [error, setError] = useState('');

  async function handleScan() {
    if (!state.activeMatter) return;
    setScanning(true);
    setError('');
    setDone(false);
    setFixDone(false);
    appendTerminal(['[doctor] scanning…']);
    try {
      const result = await api.runDoctorScan({ matterName: state.activeMatter.name });
      setIssues((result.issues ?? []).map((i) => ({ ...i, selected: i.severity !== 'info' })));
      setDone(true);
      appendTerminal([`[doctor] found ${result.issues?.length ?? 0} issue(s)`]);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setScanning(false);
    }
  }

  async function handleFix() {
    if (!state.activeMatter) return;
    const selected = issues.filter((i) => i.selected).map((i) => i.id);
    if (selected.length === 0) return;
    setFixing(true);
    appendTerminal([`[doctor] fixing ${selected.length} issue(s)…`]);
    try {
      await api.runDoctorFix({ matterName: state.activeMatter.name, issueIds: selected });
      setFixDone(true);
      appendTerminal(['[doctor] fixes applied']);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setFixing(false);
    }
  }

  function toggleIssue(id: string) {
    setIssues((prev) => prev.map((i) => i.id === id ? { ...i, selected: !i.selected } : i));
  }

  const selectedCount = issues.filter((i) => i.selected).length;

  return (
    <div>
      <div className="document-preview-header">
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Skill · /doctor
          </div>
          <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 28, fontWeight: 600, margin: '0 0 5px', lineHeight: 1.15 }}>
            Check matter
          </h1>
          <p className="document-path">{state.activeMatter?.name}</p>
        </div>
        <div className="document-actions">
          <button className="run-skill-button" type="button" onClick={handleScan} disabled={scanning || !state.activeMatter}>
            {scanning ? 'Scanning…' : done ? 'Re-scan' : 'Scan matter'}
            <span>/doctor</span>
          </button>
        </div>
      </div>

      {error && <div className="run-failure-card"><strong>Error</strong>{error}</div>}
      {fixDone && <div className="form-info">Fixes applied successfully.</div>}

      {done && issues.length === 0 && (
        <div className="form-info" style={{ marginTop: 20 }}>No issues found. The matter looks healthy.</div>
      )}

      {done && issues.length > 0 && (
        <>
          <div className="doctor-issues">
            {issues.map((issue) => (
              <div key={issue.id} className="doctor-issue">
                <div className="doctor-issue-toggle">
                  <input
                    type="checkbox"
                    className="doctor-issue-checkbox"
                    id={`issue-${issue.id}`}
                    checked={!!issue.selected}
                    onChange={() => toggleIssue(issue.id)}
                  />
                  <label htmlFor={`issue-${issue.id}`} style={{ cursor: 'pointer' }}>
                    <span className={`doctor-issue-badge doctor-severity-${issue.severity}`}>{issue.severity}</span>
                    <span className="doctor-issue-title">{issue.title}</span>
                  </label>
                </div>
                <div className="doctor-issue-body">{issue.description}</div>
                {issue.fixDescription && (
                  <div className="doctor-fix-description">Fix: {issue.fixDescription}</div>
                )}
              </div>
            ))}
          </div>
          {selectedCount > 0 && (
            <div className="form-actions">
              <button type="button" onClick={handleFix} disabled={fixing}>
                {fixing ? 'Applying…' : `Apply ${selectedCount} fix${selectedCount !== 1 ? 'es' : ''}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
