import { useApp } from '../../store/AppContext';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';
import type { ActiveTab } from '../../types';

const TABS: Array<{ id: ActiveTab; icon: string; label: string; lawyerLabel?: string; operatorOnly?: boolean }> = [
  { id: 'home', icon: '⌂', label: 'Home' },
  { id: 'skills', icon: '✦', label: 'Skills' },
  { id: 'activity', icon: '◔', label: 'Activity', lawyerLabel: 'Recent work' },
  { id: 'settings', icon: '⚙', label: 'Settings', operatorOnly: true },
];

export default function ActivityBar() {
  const { state, dispatch } = useApp();
  const showOperatorChrome = canSeeOperatorSurface(state.authEnabled, state.authUser);
  const visibleTabs = TABS.filter((tab) => !tab.operatorOnly || showOperatorChrome);

  function handleTabClick(tabId: ActiveTab) {
    dispatch({ type: 'SET_TAB', payload: tabId });
    if (tabId === 'home') {
      dispatch({ type: 'RESET_MATTER_TRANSIENT_VIEW' });
      dispatch({ type: 'SET_BREADCRUMBS', payload: state.activeMatter?.name || 'Home' });
    }
  }

  return (
    <aside className="activity-bar">
      <button
        className="activity-logo"
        type="button"
        aria-label={state.activeMatter ? 'Go to Matter Home' : 'Go to Matter Workbench home'}
        onClick={() => { handleTabClick('home'); }}
      >
        <strong>Matter</strong>
        <span>Workbench</span>
      </button>
      {visibleTabs.map((tab) => {
        const label = tab.id === 'home' && state.activeMatter
          ? 'Matter Home'
          : showOperatorChrome ? tab.label : (tab.lawyerLabel || tab.label);
        return (
        <button
          key={tab.id}
          className={`activity-item${state.activeTab === tab.id ? ' active' : ''}`}
          type="button"
          title={label}
          onClick={() => { handleTabClick(tab.id); }}
        >
          <span className="activity-icon" aria-hidden="true">{tab.icon}</span>
          <span className="activity-label">{label}</span>
        </button>
        );
      })}
      <div className="activity-spacer" />
    </aside>
  );
}
