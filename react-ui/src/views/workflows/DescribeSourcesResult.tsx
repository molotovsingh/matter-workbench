import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import RerunConfirmDialog from '../../components/RerunConfirmDialog';

interface SourceRow {
  short_label?: string;
  display_label?: string;
  document_type?: string;
  needs_review?: boolean;
  warnings?: number;
  file_id?: string;
}

interface DescribeResult {
  recordsRead?: number;
  sourcesLabeled?: number;
  warningCount?: number;
  needsReviewCount?: number;
  outputPath?: string;
  sources?: SourceRow[];
  provider?: string;
  returnedProvider?: string;
  model?: string;
  returnedModel?: string;
}

export default function DescribeSourcesResult() {
  const { state, dispatch, appendTerminal } = useApp();
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
      setResult(raw as DescribeResult);
      dispatch({ type: 'SET_STATUS_BAR', payload: 'Source Labels Complete' });
      appendTerminal(['[source-index] complete']);
    } catch (e) {
      setError((e as Error).message);
      dispatch({ type: 'SET_STATUS_BAR', payload: 'Source Labels Failed' });
      appendTerminal([`[source-index] error: ${(e as Error).message}`]);
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

  return (
    <div>
      <div className="document-preview-header">
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Skill · /describe_sources
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
            <dd>{result.recordsRead ?? '—'}</dd>
            <dt>Sources labeled</dt>
            <dd>{result.sourcesLabeled ?? sources.length}</dd>
            <dt>Warnings</dt>
            <dd>{result.warningCount ?? 0}</dd>
            <dt>Needs review</dt>
            <dd>{result.needsReviewCount ?? 0}</dd>
          </dl>

          {result.outputPath && (
            <div style={{ marginTop: 16 }}>
              <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 4 }}>
                Saved record
              </div>
              <code>{result.outputPath}</code>
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
                    <th>File ID</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSources.map((row, i) => (
                    <tr key={i}>
                      <td>{row.short_label || row.display_label || '—'}</td>
                      <td>{row.document_type || '—'}</td>
                      <td>{row.needs_review ? 'Yes' : 'No'}</td>
                      <td>{row.warnings ?? 0}</td>
                      <td><code>{row.file_id || '—'}</code></td>
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
              {(result.returnedProvider || result.provider) && (
                <><dt>AI Provider</dt><dd>{result.returnedProvider || result.provider}</dd></>
              )}
              {(result.returnedModel || result.model) && (
                <><dt>Model</dt><dd><code>{result.returnedModel || result.model}</code></dd></>
              )}
              {result.outputPath && (
                <><dt>Record path</dt><dd><code>{result.outputPath}</code></dd></>
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
