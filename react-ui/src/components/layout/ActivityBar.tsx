import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';
import type { ActiveTab } from '../../types';

const TABS: Array<{ id: ActiveTab; icon: string; label: string; lawyerLabel?: string; operatorOnly?: boolean }> = [
  { id: 'home', icon: '⌂', label: 'Home' },
  { id: 'skills', icon: '✦', label: 'Skills' },
  { id: 'activity', icon: '◔', label: 'Activity', lawyerLabel: 'Recent work' },
  { id: 'settings', icon: '⚙', label: 'Settings', operatorOnly: true },
];

export default function ActivityBar() {
  const { state, dispatch, clearActiveMatter, appendTerminal } = useApp();
  const showOperatorChrome = canSeeOperatorSurface(state.authUser);
  const visibleTabs = TABS.filter((tab) => !tab.operatorOnly || showOperatorChrome);

  async function handleTabClick(tabId: ActiveTab) {
    if (tabId === 'home' && state.activeMatter) {
      try {
        await api.clearActiveMatter();
      } catch (e) {
        appendTerminal([`[workspace] could not clear active matter on server: ${getErrorMessage(e)}`]);
      }
      clearActiveMatter();
    }
    dispatch({ type: 'SET_TAB', payload: tabId });
  }

  return (
    <aside className="activity-bar">
      <button
        className="activity-logo"
        type="button"
        aria-label="Go to Matter Workbench home"
        onClick={() => { void handleTabClick('home'); }}
      >
        <strong>Matter</strong>
        <span>Workbench</span>
      </button>
      {visibleTabs.map((tab) => {
        const label = showOperatorChrome ? tab.label : (tab.lawyerLabel || tab.label);
        return (
        <button
          key={tab.id}
          className={`activity-item${state.activeTab === tab.id ? ' active' : ''}`}
          type="button"
          title={label}
          onClick={() => { void handleTabClick(tab.id); }}
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
