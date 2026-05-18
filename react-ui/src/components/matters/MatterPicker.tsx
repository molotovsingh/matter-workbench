import { useMemo } from 'react';
import { useApp } from '../../store/AppContext';
import { api, adaptTree } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';

interface Props {
  onNewMatter: () => void;
}

export default function MatterPicker({ onNewMatter }: Props) {
  const { state, dispatch, setActiveMatter, appendTerminal } = useApp();
  const { matters, matterSearchQuery, activeMatter } = state;

  const filtered = useMemo(() => {
    if (!matterSearchQuery.trim()) return matters;
    const q = matterSearchQuery.toLowerCase();
    return matters.filter((m) => m.name.toLowerCase().includes(q));
  }, [matters, matterSearchQuery]);

  async function handleSelectMatter(name: string) {
    if ((activeMatter?.folderName || activeMatter?.name) === name) return;
    appendTerminal([`[matter] switching to "${name}"…`]);
    try {
      const ws = await api.switchMatter(name);
      setActiveMatter({
        name: ws.metadata?.matterName || ws.folderName || name,
        folderName: ws.folderName || name,
        folderPath: ws.inputLabel || '',
        clientName: ws.metadata?.clientName,
        matterType: ws.metadata?.matterType,
        workspace: adaptTree(ws.tree),
        metadata: ws.metadata,
        fileCount: ws.fileCount,
        directoryCount: ws.directoryCount,
      });
      dispatch({ type: 'SET_TAB', payload: 'home' });
      appendTerminal([`[matter] loaded "${name}" — ${ws.fileCount} files, ${ws.directoryCount} folders`]);
    } catch (e) {
      appendTerminal([`[matter] error: ${getErrorMessage(e)}`]);
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
