import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../store/AppContext';
import { getErrorMessage } from '../lib/errors';
import type { AuthUser, Matter } from '../types';
import MatterOverview from './MatterOverview';

function titleCaseName(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function getDisplayName(user: AuthUser | null) {
  const raw = user?.displayName?.trim() || user?.username?.trim() || '';
  if (!raw) return '';
  const localName = raw.includes('@') ? raw.split('@')[0] : raw;
  const normalized = localName.replace(/[_-]+/g, ' ').trim();
  if (!normalized) return '';
  return titleCaseName(normalized).split(/\s+/)[0] || '';
}

function timeAwareGreeting(displayName = '') {
  const h = new Date().getHours();
  const prefix = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return displayName ? `${prefix}, ${displayName}.` : `${prefix}.`;
}

function formatArchivedDate(value?: string) {
  const raw = value?.trim();
  if (!raw) return 'Archived date not recorded';
  const normalized = raw
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return `Archived ${raw}`;
  return `Archived ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

interface Props {
  onNewMatter: () => void;
  onOpenMatter: (name: string) => void;
  onViewAllMatters: () => void;
  onCommand: (command: string) => void;
  onRunNeededPreparation: (matterName: string, startStage?: string) => void;
  onForceFullPreparation: (matterName: string, reason: string) => void;
  showMatterBrowser?: boolean;
}

export default function HomeLanding({
  onNewMatter,
  onOpenMatter,
  onViewAllMatters,
  onCommand,
  onRunNeededPreparation,
  onForceFullPreparation,
  showMatterBrowser = false,
}: Props) {
  const { state, dispatch, switchActiveMatter, appendTerminal } = useApp();
  const { matters, activeMatter } = state;
  const [loading, setLoading] = useState(false);
  const [matterBrowserOpen, setMatterBrowserOpen] = useState(showMatterBrowser);
  const [learnOpen, setLearnOpen] = useState(true);
  const [matterQuery, setMatterQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [reopeningMatter, setReopeningMatter] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const displayName = getDisplayName(state.authUser);
  const activeMatters = useMemo(() => matters.filter((m) => m.status !== 'archived'), [matters]);
  const archivedMatters = useMemo(() => matters.filter((m) => m.status === 'archived'), [matters]);
  const visibleMatters = showArchived ? archivedMatters : activeMatters;
  const matterStartSummary = activeMatters.length > 0
    ? `${activeMatters.length} active matter(s) are in the record.`
    : archivedMatters.length > 0
      ? `${archivedMatters.length} archived matter(s) can be reopened.`
      : 'Open a matter once one has been created.';
  const browserMatters = useMemo(() => {
    const q = matterQuery.trim().toLowerCase();
    if (!q) return visibleMatters;
    return visibleMatters.filter((m: Matter) => [
      m.name,
      m.clientName,
      m.matterType,
      m.status,
      m.folderPath,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q)));
  }, [visibleMatters, matterQuery]);

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

  async function handleReopenMatter(name: string) {
    if (loading || reopeningMatter) return;
    setLoading(true);
    setReopeningMatter(name);
    try {
      await api.reopenMatter(name);
      const refreshed = await api.getMatters({ includeArchived: true });
      dispatch({ type: 'SET_MATTERS', payload: refreshed.matters ?? [] });
      await switchActiveMatter(name, {
        startMessage: `[matter] reopening "${name}"…`,
        successMessage: `[matter] reopened "${name}" — history and file IDs were preserved`,
        failureMessage: (e) => `[error] ${getErrorMessage(e)}`,
      });
      dispatch({ type: 'SET_RESUME_MATTER', payload: name });
      setShowArchived(false);
      onOpenMatter(name);
    } catch (error) {
      appendTerminal([`[matter] reopen failed: ${getErrorMessage(error)}`]);
    } finally {
      setReopeningMatter(null);
      setLoading(false);
    }
  }

  function handleShowMatterBrowser() {
    onViewAllMatters();
    setMatterBrowserOpen(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  if (activeMatter) {
    return <MatterOverview onCommand={onCommand} onRunNeededPreparation={onRunNeededPreparation} onForceFullPreparation={onForceFullPreparation} />;
  }

  return (
    <section className="landing-home">
      <div className="landing-kicker">Home</div>
      <h1>{timeAwareGreeting(displayName)}</h1>
      <p className="landing-question">What do you want to do today?</p>
      <p className="landing-lede">
        Start with a matter, or take a minute to understand what the workbench does.
      </p>

      <div className="home-start-actions" aria-label="Start options">
        <button className="home-start-action" type="button" onClick={onNewMatter}>
          <strong>Add a new matter</strong>
          <span>Upload a fresh case record and let preparation begin.</span>
        </button>
        <button className="home-start-action" type="button" onClick={handleShowMatterBrowser}>
          <strong>Find an existing matter</strong>
          <span>{matterStartSummary}</span>
        </button>
        <button
          className="home-start-action"
          type="button"
          aria-expanded={learnOpen}
          onClick={() => setLearnOpen((current) => !current)}
        >
          <strong>Learn how this works</strong>
          <span>See the simple version before using the app.</span>
        </button>
      </div>

      {learnOpen && (
        <section className="home-learn-panel" aria-label="Learn how this works">
          <h2>Learn how this works</h2>
          <p>
            Matter Workbench helps you turn uploaded records into a prepared matter. It reads files,
            builds a source record, builds a Case Timeline, and gives you a cautious matter assistant
            that answers from the record.
          </p>
          <ul>
            <li>Add or find a matter first.</li>
            <li>Let preparation finish before relying on drafts or analysis.</li>
            <li>Use skills for repeatable legal work; use the assistant for one-off questions.</li>
          </ul>
        </section>
      )}

      {matterBrowserOpen && (
        <section className="home-card home-matter-browser" aria-label="Find a matter">
          <div className="home-card-header">
            <h2>Find a matter</h2>
            <span>{matterQuery ? `${browserMatters.length} of ${visibleMatters.length}` : `${visibleMatters.length} ${showArchived ? 'archived' : 'active'}`}</span>
          </div>
          {archivedMatters.length > 0 && (
            <div className="home-matter-browser-tabs" role="group" aria-label="Matter lifecycle filter">
              <button type="button" className={!showArchived ? 'active' : ''} onClick={() => setShowArchived(false)}>
                Active ({activeMatters.length})
              </button>
              <button type="button" className={showArchived ? 'active' : ''} onClick={() => setShowArchived(true)}>
                Archived ({archivedMatters.length})
              </button>
            </div>
          )}
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
          {showArchived && (
            <div className="home-matter-archive-note">
              Archived matters are closed from active work, not deleted. Reopen restores the matter with its existing file IDs and history.
            </div>
          )}
          <ul className="home-matter-list">
            {browserMatters.length > 0 ? browserMatters.map((m) => {
              const archived = m.status === 'archived';
              const reopening = reopeningMatter === m.name;
              return (
                <li key={m.name}>
                  <div className={`home-matter-row${archived ? ' archived' : ''}`}>
                    <button
                      className="home-matter-main"
                      type="button"
                      onClick={() => { archived ? void handleReopenMatter(m.name) : void handleOpenMatter(m.name); }}
                      disabled={loading}
                      aria-label={archived ? `Reopen ${m.name}` : `Open ${m.name}`}
                    >
                      <span className="home-matter-dot" aria-hidden="true" />
                      <span className="home-matter-title-block">
                        <strong>{m.name}</strong>
                        {archived && <small>{formatArchivedDate(m.archivedAt)}</small>}
                        {archived && m.archiveReason && <small>Reason: {m.archiveReason}</small>}
                        {archived && (m.archivedByDisplayName || m.archivedBy) && <small>Archived by {m.archivedByDisplayName || m.archivedBy}</small>}
                      </span>
                    </button>
                    {archived && (
                      <button
                        className="home-matter-reopen"
                        type="button"
                        onClick={() => { void handleReopenMatter(m.name); }}
                        disabled={loading}
                        aria-label={`Reopen matter ${m.name}`}
                      >
                        {reopening ? 'Reopening…' : 'Reopen'}
                      </button>
                    )}
                  </div>
                </li>
              );
            }) : (
              <li className="home-matter-empty">No matters found.</li>
            )}
          </ul>
        </section>
      )}
    </section>
  );
}
