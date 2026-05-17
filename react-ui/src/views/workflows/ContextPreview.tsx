import { useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';

interface ContextSource {
  file_id?: string;
  short_label?: string;
  display_label?: string;
  document_type?: string;
  sample_citations?: string[];
}

interface LibraryArtifact {
  path?: string;
  kind?: string;
  summary?: string;
  heading?: string;
}

interface ContextData {
  matterName?: string;
  matterFolder?: string;
  sourcesCount?: number;
  includedBlocks?: number;
  omittedBlocks?: number;
  libraryArtifactsCount?: number;
  sourceLabelsPresent?: boolean;
  blockCap?: number;
  generatedAt?: string;
  warnings?: string[];
  topSources?: ContextSource[];
  libraryArtifacts?: LibraryArtifact[];
}

export default function ContextPreview() {
  const { state, dispatch, appendTerminal } = useApp();
  const [data, setData] = useState<ContextData | null>(null);
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
      const raw = await api.getMatterContext();
      const d = raw as ContextData;
      setData(d);
      dispatch({ type: 'SET_STATUS_BAR', payload: 'Context Preview Ready' });
      appendTerminal([
        `[context] sources: ${d.sourcesCount ?? 0}`,
        `[context] evidence blocks: ${d.includedBlocks ?? 0} included, ${d.omittedBlocks ?? 0} omitted`,
        '[context] provider calls: none',
      ]);
    } catch (e) {
      setError((e as Error).message);
      dispatch({ type: 'SET_STATUS_BAR', payload: 'Context Preview Failed' });
      appendTerminal([`[context] error: ${(e as Error).message}`]);
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
      await navigator.clipboard.writeText(report);
      appendTerminal(['[context] report copied']);
    } catch {
      appendTerminal(['[context] copy failed']);
    } finally {
      setCopying(false);
    }
  }

  const topSources = (data?.topSources ?? []).slice(0, 12);
  const libraryArtifacts = data?.libraryArtifacts ?? [];
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
            <dd>{data.matterName || state.activeMatter?.name || '—'}</dd>
            {data.matterFolder && (
              <><dt>Matter folder</dt><dd><code>{data.matterFolder}</code></dd></>
            )}
            <dt>Sources</dt>
            <dd>{data.sourcesCount ?? 0}</dd>
            <dt>Evidence blocks</dt>
            <dd>{data.includedBlocks ?? 0} included, {data.omittedBlocks ?? 0} omitted by bounds</dd>
            <dt>Library artifacts</dt>
            <dd>{data.libraryArtifactsCount ?? libraryArtifacts.length}</dd>
            <dt>Source Labels</dt>
            <dd>{data.sourceLabelsPresent ? 'Present' : 'Missing'}</dd>
            {data.blockCap != null && (
              <><dt>Block cap</dt><dd>{data.blockCap}</dd></>
            )}
            {data.generatedAt && (
              <><dt>Generated</dt><dd>{new Date(data.generatedAt).toLocaleString()}</dd></>
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
                        <td>{s.short_label || s.display_label || '—'}</td>
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
                        <td>{a.summary || a.heading || a.kind || '—'}</td>
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

function buildContextReport(data: ContextData): string {
  const lines: string[] = [
    `# Context Preview: ${data.matterName || 'Unknown'}`,
    '',
    `- Sources: ${data.sourcesCount ?? 0}`,
    `- Evidence blocks: ${data.includedBlocks ?? 0} included, ${data.omittedBlocks ?? 0} omitted`,
    `- Library artifacts: ${data.libraryArtifactsCount ?? 0}`,
    `- Source Labels: ${data.sourceLabelsPresent ? 'Present' : 'Missing'}`,
    '',
  ];
  if (data.warnings?.length) {
    lines.push('## Warnings', ...data.warnings.map((w) => `- ${w}`), '');
  }
  if (data.topSources?.length) {
    lines.push('## Top Sources');
    for (const s of data.topSources) {
      lines.push(`- ${s.short_label || s.display_label || s.file_id || '—'} (${s.document_type || '—'})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
