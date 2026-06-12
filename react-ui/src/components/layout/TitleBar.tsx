import { useApp } from '../../store/AppContext';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';

interface Props {
  onLogout?: () => void;
}

export default function TitleBar({ onLogout }: Props) {
  const { state, toggleTheme } = useApp();
  const activeMatterName = state.activeMatter?.name || state.titleText;
  const workspaceModeLabel = state.config?.workspaceModeLabel || 'Local workspace';
  const showOperatorChrome = canSeeOperatorSurface(state.authUser);

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
        {showOperatorChrome && (
          <span className="workspace-mode">{workspaceModeLabel}</span>
        )}
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${state.theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {state.theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        {state.authUser && onLogout && (
          <button className="private-beta-logout" type="button" onClick={onLogout}>
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
