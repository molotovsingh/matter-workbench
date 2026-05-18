import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import type { MatterContextSearchResult } from '../../types';

export default function ContextSearch() {
  const { state } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MatterContextSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setDone(false);
    try {
      const res = await api.searchMatterContext(query);
      setResults(res.results ?? []);
      setDone(true);
    } catch { setDone(true); } finally { setSearching(false); }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
          Skill · /context_search
        </div>
        <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 28, fontWeight: 600, margin: '0 0 5px' }}>Find in matter</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>{state.activeMatter?.name}</p>
      </div>
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the matter context…"
          style={{ flex: 1, padding: '9px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)' }}
        />
        <button className="run-skill-button" type="submit" disabled={searching || !state.activeMatter}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {done && results.length === 0 && <p className="muted">No results found.</p>}
      {results.map((r, i) => (
        <div key={i} style={{ marginBottom: 16, padding: '14px 16px', border: '1px solid var(--border)', background: 'var(--panel)' }}>
          <div style={{ color: 'var(--muted-strong)', lineHeight: 1.55, fontSize: 14, marginBottom: 8 }}>{r.snippet}</div>
          <code style={{ color: 'var(--muted)', fontSize: 11 }}>{sourceLabel(r)}</code>
          {r.document_type && <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--muted)' }}>{r.document_type}</span>}
        </div>
      ))}
    </div>
  );
}

function sourceLabel(result: MatterContextSearchResult): string {
  return result.source_short_label
    || result.source_label
    || result.citation
    || result.source_path
    || result.file_id
    || 'Unlabelled source';
}
