import { useApp } from '../../store/AppContext';
import MatterPicker from '../matters/MatterPicker';
import WorkspaceTree from '../workspace/WorkspaceTree';
import { api, adaptTree } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { SIDEBAR_NATIVE_COMMANDS } from '../../lib/nativeCommands';

interface Props {
  onNewMatter: () => void;
  onAddFiles: () => void;
  onSlashSkill: (command: string) => void;
}

export default function Sidebar({ onNewMatter, onAddFiles, onSlashSkill }: Props) {
  const { state, dispatch, setActiveMatter, appendTerminal } = useApp();
  const { activeTab, activeMatter } = state;

  let title = 'Home';
  if (activeTab === 'skills') title = 'Skills';
  else if (activeTab === 'activity') title = 'Activity';
  else if (activeTab === 'settings') title = 'Settings';

  async function handleRefresh() {
    if (!activeMatter) return;
    appendTerminal(['[workspace] refreshing…']);
    try {
      const ws = await api.getWorkspace();
      setActiveMatter({
        ...activeMatter,
        fileCount: ws.fileCount,
        directoryCount: ws.directoryCount,
        workspace: adaptTree(ws.tree),
      });
      appendTerminal(['[workspace] refreshed']);
    } catch (e) {
      appendTerminal([`[workspace] error: ${getErrorMessage(e)}`]);
    }
  }

  async function handleClearMatter() {
    try {
      await api.clearActiveMatter();
    } catch (e) {
      appendTerminal([`[workspace] could not clear active matter on server: ${getErrorMessage(e)}`]);
    }
    dispatch({ type: 'SET_ACTIVE_MATTER', payload: null });
    dispatch({ type: 'SET_TITLE', payload: 'No matter selected' });
    dispatch({ type: 'SET_BREADCRUMBS', payload: 'Home' });
    dispatch({ type: 'SET_STATUS_BAR', payload: 'Pick a matter to begin' });
    dispatch({ type: 'SET_ACTIVE_FILE', payload: null });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{title}</span>
      </div>

      <MatterPicker onNewMatter={onNewMatter} />

      {activeMatter && (
        <>
          <details className="slash-section matter-actions-section">
            <summary className="matter-actions-summary">
              <span className="tree-heading">Matter Actions</span>
              <span className="matter-actions-count">{SIDEBAR_NATIVE_COMMANDS.length} actions</span>
            </summary>
            <div className="matter-actions-list">
              {SIDEBAR_NATIVE_COMMANDS.map((s) => (
                <button
                  key={s.command}
                  className="slash-skill"
                  type="button"
                  data-skill={s.command}
                  onClick={() => onSlashSkill(s.command)}
                >
                  <span className="slash-label">{s.label}</span>
                </button>
              ))}
            </div>
          </details>

          <WorkspaceTree onRefresh={handleRefresh} onAddFiles={onAddFiles} />

          <div style={{ marginTop: 16 }}>
            <button
              className="sidebar-action"
              type="button"
              onClick={handleClearMatter}
              style={{ fontSize: 12, color: 'var(--muted)' }}
            >
              ← Go home
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
