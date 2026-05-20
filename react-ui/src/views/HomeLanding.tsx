import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { getErrorMessage } from '../lib/errors';
import type { Matter } from '../types';
import MatterOverview from './MatterOverview';

function timeAwareGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  return 'Good evening.';
}

interface Props {
  onNewMatter: () => void;
  onOpenMatter: (name: string) => void;
  onViewAllMatters: () => void;
  onCommand: (command: string) => void;
  onRunPreparationAgain: (matterName: string) => void;
  showMatterBrowser?: boolean;
}

export default function HomeLanding({
  onNewMatter,
  onOpenMatter,
  onViewAllMatters,
  onCommand,
  onRunPreparationAgain,
  showMatterBrowser = false,
}: Props) {
  const { state, dispatch, switchActiveMatter } = useApp();
  const { matters, resumeMatterName, activeMatter } = state;
  const [loading, setLoading] = useState(false);
  const [matterBrowserOpen, setMatterBrowserOpen] = useState(showMatterBrowser);
  const [matterQuery, setMatterQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  const canResume = Boolean(
    resumeMatterName && matters.some((m: Matter) => m.name === resumeMatterName),
  );
  const preview = matters.slice(0, 3);
  const browserMatters = useMemo(() => {
    const q = matterQuery.trim().toLowerCase();
    if (!q) return matters;
    return matters.filter((m: Matter) => [
      m.name,
      m.clientName,
      m.matterType,
      m.status,
      m.folderPath,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q)));
  }, [matters, matterQuery]);

  useEffect(() => {
    if (!showMatterBrowser) return;
    setMatterBrowserOpen(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [showMatterBrowser]);

  async function handleOpenMatter(name: string) {
    if (loading) return;
    setLoading(true);
    try {
      await switchActiveMatter(name, {
        successMessage: false,
        failureMessage: (e) => `[error] ${getErrorMessage(e)}`,
      });
      dispatch({ type: 'SET_RESUME_MATTER', payload: name });
      onOpenMatter(name);
    } catch {
      // switchActiveMatter already reports the error in the activity strip.
    } finally {
      setLoading(false);
    }
  }

  function handleShowMatterBrowser() {
    onViewAllMatters();
    setMatterBrowserOpen(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  if (activeMatter) {
    return <MatterOverview onCommand={onCommand} onRunPreparationAgain={onRunPreparationAgain} />;
  }

  return (
    <section className="landing-home">
      <div className="landing-kicker">Home</div>
      <h1>{timeAwareGreeting()}</h1>
      <p className="landing-lede">
        {matters.length > 0
          ? 'Choose a matter to begin, or use the assistant to prepare documents, search cases, or run an action.'
          : 'Create your first matter to begin.'}
      </p>

      {canResume && (
        <button
          className="home-continue-card"
          type="button"
          onClick={() => handleOpenMatter(resumeMatterName!)}
          disabled={loading}
        >
          <span className="home-card-kicker">Continue where you left off</span>
          <strong>{resumeMatterName}</strong>
          <span>Open this matter</span>
          <span className="home-continue-arrow" aria-hidden="true">→</span>
        </button>
      )}

      <div className="home-dashboard-grid">
        <section className="home-card">
          <div className="home-card-header">
            <h2>Available matters</h2>
            <span>{matters.length} total</span>
          </div>
          {preview.length > 0 ? (
            <ul className="home-matter-list">
              {preview.map((m) => (
                <li key={m.name}>
                  <button type="button" onClick={() => handleOpenMatter(m.name)} disabled={loading}>
                    <span className="home-matter-dot" aria-hidden="true" />
                    <strong>{m.name}</strong>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ padding: '14px 18px' }}>No matters yet.</p>
          )}
          <button className="home-card-link" type="button" onClick={handleShowMatterBrowser}>
            View all matters →
          </button>
        </section>

        <section className="home-card">
          <div className="home-card-header">
            <h2>Quick actions</h2>
          </div>
          <div className="home-quick-actions">
            <button type="button" onClick={handleShowMatterBrowser}>
              <strong>Find a matter</strong>
              <span>Browse and open an existing matter</span>
            </button>
            <button type="button" onClick={onNewMatter}>
              <strong>New matter</strong>
              <span>Create a new matter folder</span>
            </button>
          </div>
        </section>
      </div>

      {matterBrowserOpen && (
        <section className="home-card home-matter-browser" aria-label="Find a matter">
          <div className="home-card-header">
            <h2>Find a matter</h2>
            <span>{matterQuery ? `${browserMatters.length} of ${matters.length}` : `${matters.length} total`}</span>
          </div>
          <div className="home-matter-browser-search">
            <label htmlFor="homeMatterSearch">Search matters</label>
            <input
              id="homeMatterSearch"
              ref={searchRef}
              type="search"
              placeholder="Search by matter, client, type, or folder"
              value={matterQuery}
              onChange={(e) => setMatterQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <ul className="home-matter-list">
            {browserMatters.length > 0 ? browserMatters.map((m) => (
              <li key={m.name}>
                <button type="button" onClick={() => handleOpenMatter(m.name)} disabled={loading}>
                  <span className="home-matter-dot" aria-hidden="true" />
                  <strong>{m.name}</strong>
                </button>
              </li>
            )) : (
              <li className="home-matter-empty">No matters found.</li>
            )}
          </ul>
        </section>
      )}
    </section>
  );
}
