import { useApp } from '../../store/AppContext';

export default function TitleBar() {
  const { state, toggleTheme } = useApp();

  return (
    <header className="titlebar">
      <div className="title-left">Matter Workbench</div>
      <div className="title-center">
        <div className="title-text">{state.titleText}</div>
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
