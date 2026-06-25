import { useApp } from '../../store/AppContext';
import WorkspaceTree from '../workspace/WorkspaceTree';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';
import type { ActiveTab } from '../../types';

interface Props {
  onNewMatter: () => void;
  onAddFiles: () => void;
  onViewAllMatters: () => void;
  onLogout?: () => void;
}

const APP_TABS: Array<{ id: ActiveTab; icon: string; label: string; lawyerLabel?: string; operatorOnly?: boolean }> = [
  { id: 'skills', icon: '✦', label: 'Skills' },
  { id: 'activity', icon: '⌁', label: 'Activity', lawyerLabel: 'Recent work' },
  { id: 'settings', icon: '⚙', label: 'Settings', operatorOnly: true },
];

export default function Sidebar({ onNewMatter, onAddFiles, onViewAllMatters, onLogout }: Props) {
  const { state, dispatch, refreshActiveMatterWorkspace } = useApp();
  const { activeMatter } = state;
  const showOperatorChrome = canSeeOperatorSurface(state.authEnabled, state.authUser);
  const visibleTabs = APP_TABS.filter((tab) => !tab.operatorOnly || showOperatorChrome);
  // Settings lives in the pinned bottom footer next to Sign out, not in the
  // main App nav list, so account/session controls read as one group.
  const navTabs = visibleTabs.filter((tab) => tab.id !== 'settings');
  const settingsTab = visibleTabs.find((tab) => tab.id === 'settings');
  const showSignOut = Boolean(state.authUser && onLogout);
  const showFooter = Boolean(settingsTab) || showSignOut;

  function returnToMatterHome() {
    dispatch({ type: 'SET_TAB', payload: 'home' });
    dispatch({ type: 'RESET_MATTER_TRANSIENT_VIEW' });
    dispatch({ type: 'SET_BREADCRUMBS', payload: activeMatter?.name || 'Home' });
  }

  function handleTabClick(tab: ActiveTab) {
    dispatch({ type: 'SET_TAB', payload: tab });
    dispatch({ type: 'SET_BREADCRUMBS', payload: tab === 'home' ? activeMatter?.name || 'Home' : tabLabel(tab, showOperatorChrome) });
  }

  async function handleRefresh() {
    if (!activeMatter) return;
    await refreshActiveMatterWorkspace({
      reason: '[workspace] refreshing…',
      successMessage: '[workspace] refreshed',
      failurePrefix: '[workspace] error',
    });
  }

  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <button
        className="sidebar-brand"
        type="button"
        aria-label={activeMatter ? 'Go to Matter Home' : 'Go to Matter Workbench home'}
        onClick={returnToMatterHome}
      >
        <strong>Matter</strong>
        <span>Workbench</span>
      </button>

      <section className="sidebar-section" aria-label="Active matter">
        <div className="sidebar-label">Active Matter</div>
        {activeMatter ? (
          <button
            className="active-matter-card"
            type="button"
            title="Return to this matter’s overview"
            onClick={returnToMatterHome}
          >
            <small>Matter Home</small>
            <strong>{activeMatter.name}</strong>
          </button>
        ) : (
          <div className="sidebar-empty-card">
            <small>No matter selected</small>
            <span>Start from the Home screen.</span>
          </div>
        )}
      </section>

      {activeMatter && (
        <section className="sidebar-section matter-record-section" aria-label="Matter record">
          <div className="sidebar-label">Matter Record</div>
          <div className="record-actions" aria-label="Matter record actions">
            <button className="record-action primary" type="button" title="Add documents to this matter" onClick={onAddFiles}>
              <span aria-hidden="true">＋</span>Add files
            </button>
            <button className="record-action" type="button" title="Refresh the matter record" onClick={() => { void handleRefresh(); }}>
              <span aria-hidden="true">↻</span>Refresh
            </button>
          </div>
          {showOperatorChrome && (
            <>
              <button
                className={`technical-toggle${state.showTechnicalFiles ? ' active' : ''}`}
                type="button"
                title="Show technical files and logs — operator only"
                aria-pressed={state.showTechnicalFiles}
                onClick={() => dispatch({ type: 'SET_SHOW_TECHNICAL', payload: !state.showTechnicalFiles })}
              >
                <span aria-hidden="true">{state.showTechnicalFiles ? '☑' : '☐'}</span>
                <span>{state.showTechnicalFiles ? 'Hide technical' : 'Show technical'}</span>
              </button>
              <span className="operator-note">Show technical: operator only</span>
            </>
          )}
          <WorkspaceTree onRefresh={handleRefresh} onAddFiles={onAddFiles} showActions={false} />
        </section>
      )}

      <div className="sidebar-spacer" />

      <nav className="sidebar-section" aria-label="App navigation">
        <div className="sidebar-label">App</div>
        <button
          className={`nav-item${state.activeView === 'find-matter' ? ' active' : ''}`}
          type="button"
          title="See all matters or open another matter"
          onClick={onViewAllMatters}
        >
          <span className="nav-icon" aria-hidden="true">⌗</span>
          <span>All matters</span>
        </button>
        <button className="nav-item" type="button" title="Start a new matter" onClick={onNewMatter}>
          <span className="nav-icon" aria-hidden="true">＋</span>
          <span>New matter</span>
        </button>
        {navTabs.map((tab) => {
          const label = tab.id === 'home' && activeMatter
            ? 'Matter Home'
            : showOperatorChrome ? tab.label : (tab.lawyerLabel || tab.label);
          return (
            <button
              key={tab.id}
              className={`nav-item${state.activeTab === tab.id ? ' active' : ''}`}
              type="button"
              title={label}
              onClick={() => handleTabClick(tab.id)}
            >
              <span className="nav-icon" aria-hidden="true">{tab.icon}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {showFooter && (
        <div className="sidebar-footer" aria-label="Account">
          {settingsTab && (
            <button
              className={`nav-item${state.activeTab === 'settings' ? ' active' : ''}`}
              type="button"
              title="Settings"
              onClick={() => handleTabClick('settings')}
            >
              <span className="nav-icon" aria-hidden="true">{settingsTab.icon}</span>
              <span>{settingsTab.label}</span>
            </button>
          )}
          {showSignOut && (
            <button
              className="nav-item nav-item-signout"
              type="button"
              title="Sign out"
              onClick={onLogout}
            >
              <span className="nav-icon" aria-hidden="true">⎋</span>
              <span>Sign out</span>
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

function tabLabel(tab: ActiveTab, showOperatorChrome: boolean) {
  if (tab === 'home') return 'Home';
  const match = APP_TABS.find((candidate) => candidate.id === tab);
  if (!match) return tab;
  return showOperatorChrome ? match.label : (match.lawyerLabel || match.label);
}
