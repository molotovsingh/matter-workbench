import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import RerunConfirmDialog from '../../components/RerunConfirmDialog';
import type { DescribeSourcesResult as DescribeResult } from '../../types';

export default function DescribeSourcesResult() {
  const { state, dispatch, appendTerminal, refreshActiveMatterWorkspace } = useApp();
  const [result, setResult] = useState<DescribeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  function handleRunClick() {
    if (result) {
      setConfirming(true);
    } else {
      executeRun();
    }
  }

  async function executeRun() {
    if (!state.activeMatter) return;
    setConfirming(false);
    setRunning(true);
    setError('');
    dispatch({ type: 'SET_STATUS_BAR', payload: 'Source Labels Running' });
    appendTerminal(['[source-index] calling AI provider…']);
    try {
      const raw = await api.runDescribeSources({ matterName: state.activeMatter.name });
      setResult(raw);
      dispatch({ type: 'SET_STATUS_BAR', payload: 'Source Labels Complete' });
      appendTerminal(['[source-index] complete']);
      await refreshActiveMatterWorkspace({ failurePrefix: '[workspace] refresh failed after Source Labels update' });
    } catch (e) {
      setError(getErrorMessage(e));
      dispatch({ type: 'SET_STATUS_BAR', payload: 'Source Labels Failed' });
      appendTerminal([`[source-index] error: ${getErrorMessage(e)}`]);
    } finally {
      setRunning(false);
    }
  }

  function handleBack() {
    dispatch({ type: 'SET_VIEW', payload: 'home' });
    dispatch({ type: 'SET_TAB', payload: 'home' });
  }

  const sources = result?.sources ?? [];
  const visibleSources = sources.slice(0, 12);
  const warningCount = sources.reduce((sum, source) => {
    if (Array.isArray(source.warnings)) return sum + source.warnings.length;
    return sum + Number(source.warnings || 0);
  }, 0);
  const needsReviewCount = sources.filter((source) => source.needs_review).length;

  return (
    <div>
      <div className="document-preview-header">
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Library workflow
          </div>
          <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 28, fontWeight: 600, margin: '0 0 5px', lineHeight: 1.15 }}>
            {result ? 'Source Labels created' : 'Source Labels'}
          </h1>
          <p className="document-path">{state.activeMatter?.name}</p>
        </div>
        <div className="document-actions">
          <button
            className="run-skill-button"
            type="button"
            onClick={handleRunClick}
            disabled={running || confirming || !state.activeMatter}
          >
            {running ? 'Running…' : result ? 'Regenerate source labels' : 'Run describe sources'}
            <span>Uses AI</span>
          </button>
          {result && (
            <button className="run-skill-button secondary" type="button" onClick={handleBack}>
              Back to overview
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div style={{ marginTop: 20 }}>
          <RerunConfirmDialog
            skill="/describe_sources"
            title={`Review source labels before regenerating — ${state.activeMatter?.name}`}
            confirmLabel="Regenerate source labels"
            cancelLabel="Keep current source labels"
            onConfirm={executeRun}
            onCancel={() => setConfirming(false)}
          />
        </div>
      )}

      {error && (
        <div className="run-failure-card">
          <strong>Error</strong>{error}
          <button className="run-skill-button secondary" type="button" onClick={executeRun} style={{ marginTop: 8 }}>
            Try again
          </button>
        </div>
      )}

      {result && (
        <>
          <dl className="skill-contract">
            <dt>Records read</dt>
            <dd>{result.counts?.recordsRead ?? '—'}</dd>
            <dt>Sources labeled</dt>
            <dd>{result.counts?.descriptors ?? sources.length}</dd>
            <dt>Warnings</dt>
            <dd>{warningCount}</dd>
            <dt>Needs review</dt>
            <dd>{needsReviewCount}</dd>
          </dl>

          {result.outputPaths?.json && (
            <div style={{ marginTop: 16 }}>
              <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 4 }}>
                Saved record
              </div>
              <code>{result.outputPaths.json}</code>
            </div>
          )}

          {visibleSources.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 24 }}>
              <table className="extract-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Type</th>
                    <th>Review</th>
                    <th>Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSources.map((row, i) => (
                    <tr key={i}>
                      <td>{row.source_short_label || row.short_label || row.source_label || row.display_label || '—'}</td>
                      <td>{row.document_type || '—'}</td>
                      <td>{row.needs_review ? 'Yes' : 'No'}</td>
                      <td>{Array.isArray(row.warnings) ? row.warnings.length : row.warnings ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sources.length > 12 && (
                <p className="muted" style={{ marginTop: 8 }}>
                  Showing 12 of {sources.length} sources.
                </p>
              )}
            </div>
          )}

          <details style={{ marginTop: 20 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>Run details</summary>
            <dl className="skill-contract" style={{ marginTop: 8 }}>
              {(result.aiRun?.returnedProvider || result.aiRun?.provider) && (
                <><dt>AI Provider</dt><dd>{result.aiRun.returnedProvider || result.aiRun.provider}</dd></>
              )}
              {(result.aiRun?.returnedModel || result.aiRun?.model) && (
                <><dt>Model</dt><dd><code>{result.aiRun.returnedModel || result.aiRun.model}</code></dd></>
              )}
              {result.outputPaths?.json && (
                <><dt>Record path</dt><dd><code>{result.outputPaths.json}</code></dd></>
              )}
            </dl>
          </details>
        </>
      )}

      {!result && !running && !error && (
        <p style={{ color: 'var(--muted-strong)', fontSize: 14, marginTop: 16 }}>
          Describe Sources uses AI to label each extracted document with a short description,
          document type, and review flag. The labels power the chronology and context views.
        </p>
      )}
    </div>
  );
}
