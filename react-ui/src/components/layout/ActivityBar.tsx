import { useApp } from '../../store/AppContext';
import type { ActiveTab } from '../../types';

const TABS: Array<{ id: ActiveTab; icon: string; label: string }> = [
  { id: 'home', icon: '⌂', label: 'Home' },
  { id: 'skills', icon: '✦', label: 'Skills' },
  { id: 'activity', icon: '◔', label: 'Activity' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

export default function ActivityBar() {
  const { state, dispatch } = useApp();

  return (
    <aside className="activity-bar">
      <div className="activity-logo">
        <strong>Matter</strong>
        <span>Workbench</span>
      </div>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`activity-item${state.activeTab === tab.id ? ' active' : ''}`}
          type="button"
          title={tab.label}
          onClick={() => dispatch({ type: 'SET_TAB', payload: tab.id })}
        >
          <span className="activity-icon" aria-hidden="true">{tab.icon}</span>
          <span className="activity-label">{tab.label}</span>
        </button>
      ))}
      <div className="activity-spacer" />
    </aside>
  );
}
