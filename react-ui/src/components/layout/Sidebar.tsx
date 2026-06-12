import { useApp } from '../../store/AppContext';
import WorkspaceTree from '../workspace/WorkspaceTree';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';
import { SIDEBAR_NATIVE_COMMANDS } from '../../lib/nativeCommands';

interface Props {
  onNewMatter: () => void;
  onAddFiles: () => void;
  onSlashSkill: (command: string) => void;
}

export default function Sidebar({ onNewMatter, onAddFiles, onSlashSkill }: Props) {
  const { state, clearActiveMatter, refreshActiveMatterWorkspace, appendTerminal } = useApp();
  const { activeTab, activeMatter } = state;
  const showOperatorChrome = canSeeOperatorSurface(state.authEnabled, state.authUser);

  let title = 'Home';
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
