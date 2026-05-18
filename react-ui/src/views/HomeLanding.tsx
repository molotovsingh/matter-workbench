import { useState } from 'react';
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
}

export default function HomeLanding({ onNewMatter, onOpenMatter, onViewAllMatters, onCommand }: Props) {
  const { state, dispatch, switchActiveMatter } = useApp();
  const { matters, resumeMatterName, activeMatter } = state;
  const [loading, setLoading] = useState(false);

  const canResume = Boolean(
    resumeMatterName && matters.some((m: Matter) => m.name === resumeMatterName),
  );
  const preview = matters.slice(0, 3);

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

  if (activeMatter) {
    return <MatterOverview onCommand={onCommand} />;
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
          <button className="home-card-link" type="button" onClick={onViewAllMatters}>
            View all matters →
          </button>
        </section>

        <section className="home-card">
          <div className="home-card-header">
            <h2>Quick actions</h2>
          </div>
          <div className="home-quick-actions">
            <button type="button" onClick={onViewAllMatters}>
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
    </section>
  );
}
