import { useApp } from '../../store/AppContext';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';

interface Props {
  onLogout?: () => void;
}

export default function TitleBar({ onLogout }: Props) {
  const { state, toggleTheme } = useApp();
  const activeMatterName = state.activeMatter?.name || state.titleText;
  const workspaceModeLabel = state.config?.workspaceModeLabel || 'Local workspace';
  const releaseText = releaseBadgeText(state.config?.release);
  const releaseTitle = releaseBadgeTitle(state.config?.release);
  const showOperatorChrome = canSeeOperatorSurface(state.authEnabled, state.authUser);

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
        {releaseText && (
          <span className="release-badge" title={releaseTitle}>
            {releaseText}
          </span>
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

function releaseBadgeText(release: { label?: string; commit?: string; date?: string } | null | undefined) {
  const label = String(release?.label || '').trim();
  const commit = String(release?.commit || '').trim();
  const date = releaseBadgeDate(release?.date);
  const shortCommit = commit ? commit.slice(0, 7) : '';
  return [label, date, shortCommit].filter(Boolean).join(' | ');
}

function releaseBadgeTitle(release: { label?: string; commit?: string; date?: string; note?: string } | null | undefined) {
  const parts = [
    releaseBadgeText(release),
    release?.note ? String(release.note).trim() : '',
    release?.date ? `Released ${String(release.date).trim()}` : '',
    release?.commit ? `Commit ${String(release.commit).trim()}` : '',
  ].filter(Boolean);
  return parts.join(' - ');
}

function releaseBadgeDate(dateValue: string | undefined) {
  const match = String(dateValue || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLabel = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];
  return monthLabel && day >= 1 && day <= 31 ? `${monthLabel} ${day}` : '';
}
