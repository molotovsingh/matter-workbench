import { useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { writeClipboardText } from '../../lib/clipboard';
import { getErrorMessage } from '../../lib/errors';
import type { MatterContextPreview } from '../../types';

export default function ContextPreview() {
  const { state, dispatch, appendTerminal } = useApp();
  const [data, setData] = useState<MatterContextPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(false);

  async function loadContext() {
    if (!state.activeMatter) return;
    setLoading(true);
    setError('');
    dispatch({ type: 'SET_STATUS_BAR', payload: 'Context Preview Running' });
    appendTerminal(['[context] loading preview…']);
    try {
      const data = await api.getMatterContext();
      setData(data);
      dispatch({ type: 'SET_STATUS_BAR', payload: 'Context Preview Ready' });
      appendTerminal([
        `[context] sources: ${data.counts?.sources ?? 0}`,
        `[context] evidence blocks: ${data.counts?.evidence_blocks_included ?? 0} included, ${data.counts?.evidence_blocks_omitted ?? 0} omitted`,
        '[context] provider calls: none',
      ]);
    } catch (e) {
      setError(getErrorMessage(e));
      dispatch({ type: 'SET_STATUS_BAR', payload: 'Context Preview Failed' });
      appendTerminal([`[context] error: ${getErrorMessage(e)}`]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeMatter?.name]);

  async function handleCopy() {
    if (!data) return;
    setCopying(true);
    const report = buildContextReport(data);
    try {
      await writeClipboardText(report);
      appendTerminal(['[context] report copied']);
    } catch {
      appendTerminal(['[context] copy failed']);
    } finally {
      setCopying(false);
    }
  }

  const topSources = (data?.top_sources ?? []).slice(0, 12);
  const libraryArtifacts = data?.library_artifacts ?? [];
  const warnings = data?.warnings ?? [];

  return (
    <div>
      <div className="document-preview-header">
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Skill · /context_preview
          </div>
          <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 28, fontWeight: 600, margin: '0 0 5px', lineHeight: 1.15 }}>
            Context Preview
          </h1>
          <p className="document-path">
            Read-only preview of the matter's evidence boundary. Does not call an AI provider and does not show raw source text.
          </p>
        </div>
        <div className="document-actions">
          <button
            className="run-skill-button"
            type="button"
            onClick={handleCopy}
            disabled={copying || !data}
          >
            {copying ? 'Copying…' : 'Copy Context Report'}
          </button>
        </div>
      </div>

      {error && <div className="run-failure-card"><strong>Error</strong>{error}</div>}

      {loading && !data && (
        <p className="muted" style={{ marginTop: 16 }}>Loading context preview…</p>
      )}

      {!state.activeMatter && (
        <p className="muted" style={{ marginTop: 16 }}>No matter loaded. Select a matter to view context.</p>
      )}

      {data && (
        <>
          <dl className="skill-contract">
            <dt>Matter name</dt>
            <dd>{data.matter?.matter_name || data.matter?.folder_name || state.activeMatter?.name || '—'}</dd>
            {data.matter?.folder_name && (
              <><dt>Matter folder</dt><dd><code>{data.matter.folder_name}</code></dd></>
            )}
            <dt>Sources</dt>
            <dd>{data.counts?.sources ?? 0}</dd>
            <dt>Evidence blocks</dt>
            <dd>{data.counts?.evidence_blocks_included ?? 0} included, {data.counts?.evidence_blocks_omitted ?? 0} omitted by bounds</dd>
            <dt>Library artifacts</dt>
            <dd>{data.counts?.library_artifacts ?? libraryArtifacts.length}</dd>
            <dt>Source Labels</dt>
            <dd>{data.source_index_present ? 'Present' : 'Missing'}</dd>
            {data.limits?.max_blocks != null && (
              <><dt>Block cap</dt><dd>{String(data.limits.max_blocks)}</dd></>
            )}
            {data.generated_at && (
              <><dt>Generated</dt><dd>{new Date(data.generated_at).toLocaleString()}</dd></>
            )}
          </dl>

          {warnings.length > 0 ? (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 8 }}>
                Warnings
              </h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--warning-text)' }}>
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>No context warnings.</p>
          )}

          {topSources.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 8 }}>
                Top sources
              </h3>
              <div className="table-scroll">
                <table className="extract-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Source Label</th>
                      <th>Type</th>
                      <th>Sample Citations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSources.map((s, i) => (
                      <tr key={i}>
                        <td><code>{s.file_id || '—'}</code></td>
                        <td>{s.source_short_label || s.source_label || '—'}</td>
                        <td>{s.document_type || '—'}</td>
                        <td>
                          {s.sample_citations && s.sample_citations.length > 0
                            ? s.sample_citations.map((c, ci) => <code key={ci} style={{ marginRight: 4 }}>{c}</code>)
                            : <span className="muted">No sampled citation</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {libraryArtifacts.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 8 }}>
                Library artifacts
              </h3>
              <div className="table-scroll">
                <table className="extract-table">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Kind</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {libraryArtifacts.map((a, i) => (
                      <tr key={i}>
                        <td><code>{a.path || '—'}</code></td>
                        <td>{a.kind || '—'}</td>
                        <td>{a.summary || a.kind || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function buildContextReport(data: MatterContextPreview): string {
  const lines: string[] = [
    `# Context Preview: ${data.matter?.matter_name || data.matter?.folder_name || 'Unknown'}`,
    '',
    `- Sources: ${data.counts?.sources ?? 0}`,
    `- Evidence blocks: ${data.counts?.evidence_blocks_included ?? 0} included, ${data.counts?.evidence_blocks_omitted ?? 0} omitted`,
    `- Library artifacts: ${data.counts?.library_artifacts ?? 0}`,
    `- Source Labels: ${data.source_index_present ? 'Present' : 'Missing'}`,
    '',
  ];
  if (data.warnings?.length) {
    lines.push('## Warnings', ...data.warnings.map((w) => `- ${w}`), '');
  }
  if (data.top_sources?.length) {
    lines.push('## Top Sources');
    for (const s of data.top_sources) {
      lines.push(`- ${s.source_short_label || s.source_label || s.file_id || '—'} (${s.document_type || '—'})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
