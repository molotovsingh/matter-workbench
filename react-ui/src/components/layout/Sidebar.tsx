import { useApp } from '../../store/AppContext';
import WorkspaceTree from '../workspace/WorkspaceTree';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';

interface Props {
  onNewMatter: () => void;
  onAddFiles: () => void;
}

export default function Sidebar({ onNewMatter, onAddFiles }: Props) {
  const { state, clearActiveMatter, refreshActiveMatterWorkspace, appendTerminal } = useApp();
  const { activeTab, activeMatter } = state;
  const showOperatorChrome = canSeeOperatorSurface(state.authEnabled, state.authUser);

  let title = activeMatter ? 'Matter Home' : 'Home';
  if (activeTab === 'skills') title = 'Skills';
  else if (activeTab === 'activity') title = showOperatorChrome ? 'Activity' : 'Recent work';
  else if (activeTab === 'settings') title = 'Settings';

  async function handleRefresh() {
    if (!activeMatter) return;
    await refreshActiveMatterWorkspace({
      reason: '[workspace] refreshing…',
      successMessage: '[workspace] refreshed',
      failurePrefix: '[workspace] error',
    });
  }

  async function handleClearMatter() {
    try {
      await api.clearActiveMatter();
    } catch (e) {
      appendTerminal([`[workspace] could not clear active matter on server: ${getErrorMessage(e)}`]);
    }
    clearActiveMatter();
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{title}</span>
      </div>

      {!activeMatter && (
        <div className="sidebar-start-note">
          <span>Start from the Home screen.</span>
          <button type="button" onClick={onNewMatter}>Add a new matter</button>
        </div>
      )}

      {activeMatter && (
        <>
          <WorkspaceTree onRefresh={handleRefresh} onAddFiles={onAddFiles} />

          <div style={{ marginTop: 16 }}>
            <button
              className="sidebar-action"
              type="button"
              onClick={handleClearMatter}
              style={{ fontSize: 12, color: 'var(--muted)' }}
            >
              ← All matters
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
