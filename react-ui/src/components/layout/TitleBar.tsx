import { useApp } from '../../store/AppContext';

export default function TitleBar() {
  const { state, toggleTheme } = useApp();
  const activeMatterName = state.activeMatter?.name || state.titleText;

  return (
    <header className="titlebar">
      <div className="title-left">Matter Workbench</div>
      <div className="title-center">
        {state.activeMatter ? (
          <div className="active-matter-pill" title={activeMatterName}>
            <span className="active-matter-dot" aria-hidden="true" />
            <span className="active-matter-label">Active matter</span>
            <strong>{activeMatterName}</strong>
          </div>
        ) : (
          <div className="title-text">{state.titleText}</div>
        )}
      </div>
      <div className="title-right">
        <span className="workspace-mode">Local workspace</span>
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${state.theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {state.theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
    </header>
  );
}
