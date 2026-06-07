import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import type { ActiveTab } from '../../types';

const TABS: Array<{ id: ActiveTab; icon: string; label: string }> = [
  { id: 'home', icon: '⌂', label: 'Home' },
  { id: 'skills', icon: '✦', label: 'Skills' },
  { id: 'activity', icon: '◔', label: 'Activity' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

export default function ActivityBar() {
  const { state, dispatch, clearActiveMatter, appendTerminal } = useApp();

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
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`activity-item${state.activeTab === tab.id ? ' active' : ''}`}
          type="button"
          title={tab.label}
          onClick={() => { void handleTabClick(tab.id); }}
        >
          <span className="activity-icon" aria-hidden="true">{tab.icon}</span>
          <span className="activity-label">{tab.label}</span>
        </button>
      ))}
      <div className="activity-spacer" />
    </aside>
  );
}
