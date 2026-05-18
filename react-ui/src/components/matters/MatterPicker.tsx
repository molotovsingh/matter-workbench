import { useMemo } from 'react';
import { useApp } from '../../store/AppContext';

interface Props {
  onNewMatter: () => void;
}

export default function MatterPicker({ onNewMatter }: Props) {
  const { state, dispatch, switchActiveMatter } = useApp();
  const { matters, matterSearchQuery, activeMatter } = state;

  const filtered = useMemo(() => {
    if (!matterSearchQuery.trim()) return matters;
    const q = matterSearchQuery.toLowerCase();
    return matters.filter((m) => m.name.toLowerCase().includes(q));
  }, [matters, matterSearchQuery]);

  async function handleSelectMatter(name: string) {
    if ((activeMatter?.folderName || activeMatter?.name) === name) return;
    try {
      await switchActiveMatter(name);
      dispatch({ type: 'SET_TAB', payload: 'home' });
    } catch {
      // switchActiveMatter already reports the matter-specific error in the activity strip.
    }
  }

  return (
    <section className="matters-picker">
      <div className="tree-heading-row">
        <button className="sidebar-action primary" type="button" onClick={onNewMatter}>
          + New Matter
        </button>
      </div>
      <div className="matter-search">
        <label htmlFor="mattersSearchInput">Search matters</label>
        <input
          id="mattersSearchInput"
          type="search"
          placeholder="Search matters"
          autoComplete="off"
          spellCheck={false}
          value={matterSearchQuery}
          onChange={(e) => dispatch({ type: 'SET_MATTER_SEARCH', payload: e.target.value })}
        />
        <div className="matter-search-meta">
          {matterSearchQuery ? `${filtered.length} of ${matters.length}` : `${matters.length} matters`}
        </div>
      </div>
      <ul className="matters-list">
        {filtered.length === 0 ? (
          <li><span className="matters-empty">No matters found</span></li>
        ) : (
          filtered.map((m) => (
            <li key={m.name}>
              <button
                type="button"
                className={(activeMatter?.folderName || activeMatter?.name) === m.name ? 'active' : ''}
                onClick={() => handleSelectMatter(m.name)}
              >
                {m.name}
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
