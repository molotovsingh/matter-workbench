import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuthStatus, getReport, listInstallations, logout, setAuthRequiredHandler } from './api/client';
import { LoginView } from './views/LoginView';
import { FleetView } from './views/FleetView';
import { InstallationView } from './views/InstallationView';
import { TriageView } from './views/TriageView';
import type { AuthStatus, InstallationsResponse, MothershipReport, ViewKey } from './types';
import { ApiError } from './api/client';

const WINDOW_OPTIONS = [7, 30, 90] as const;

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState('');
  const [view, setView] = useState<ViewKey>('fleet');
  const [sinceDays, setSinceDays] = useState<number>(30);
  const [installations, setInstallations] = useState<InstallationsResponse>({ sinceDays: 30, installations: [] });
  const [report, setReport] = useState<MothershipReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [selectedInstallation, setSelectedInstallation] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState('');

  const handleAuthRequired = useCallback(() => {
    setAuth({ enabled: true, authenticated: false, user: null });
    setDataError('Session expired. Please sign in again.');
  }, []);

  useEffect(() => {
    setAuthRequiredHandler(handleAuthRequired);
    return () => { setAuthRequiredHandler(null); };
  }, [handleAuthRequired]);

  useEffect(() => {
    let cancelled = false;
    async function checkAuth() {
      try {
        const status = await getAuthStatus();
        if (!cancelled) setAuth(status);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Could not reach the mothership.';
          setAuthError(message);
          setDataError(message);
          setAuth({ enabled: false, authenticated: false, user: null });
        }
      }
    }
    void checkAuth();
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setDataError('');
    try {
      const [installs, rep] = await Promise.all([
        listInstallations(sinceDays),
        getReport(sinceDays),
      ]);
      setInstallations(installs);
      setReport(rep);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not load fleet data.';
      setDataError(message);
    } finally {
      setLoading(false);
    }
  }, [sinceDays]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 60_000);
    return () => window.clearInterval(id);
  }, [auth?.authenticated, refresh]);

  const handleLoggedIn = useCallback(() => {
    setDataError('');
    void getAuthStatus().then((status) => setAuth(status));
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    const status = await getAuthStatus();
    setAuth(status);
  }, []);

  const openInstallation = useCallback((installationId: string) => {
    setSelectedInstallation(installationId);
    setView('installation');
  }, []);

  const availableUsers = useMemo(() => {
    if (!report) return [];
    const users = new Set<string>();
    for (const item of report.items) {
      if (item.user) users.add(item.user);
    }
    for (const snap of report.heartbeats.snapshots) {
      for (const journey of snap.journeys) {
        if (journey.user) users.add(journey.user);
      }
    }
    return [...users].sort();
  }, [report]);

  if (!auth) {
    return (
      <div className="loading-screen">
        <p>Checking access…</p>
        {authError && <div className="form-error">{authError}</div>}
      </div>
    );
  }

  if (auth.enabled && !auth.authenticated) {
    return <LoginView onLoggedIn={handleLoggedIn} initialError={dataError} authMode={auth.authMode} />;
  }

  const navItems: { key: ViewKey; label: string }[] = [
    { key: 'fleet', label: 'Fleet' },
    { key: 'triage', label: 'Triage' },
  ];

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="app-bar-brand">
          <strong>Mothership Console</strong>
          <span className="muted small">{auth.user?.username || 'operator'}</span>
        </div>
        <nav className="app-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`nav-button ${view === item.key ? 'active' : ''}`}
              onClick={() => { setView(item.key); setSelectedInstallation(null); }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="app-bar-actions">
          <label className="window-selector">
            <span className="muted small">User</span>
            <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
              <option value="">All users</option>
              {availableUsers.map((user) => (
                <option key={user} value={user}>{user}</option>
              ))}
            </select>
          </label>
          <label className="window-selector">
            <span className="muted small">Window</span>
            <select value={sinceDays} onChange={(event) => setSinceDays(Number(event.target.value))}>
              {WINDOW_OPTIONS.map((days) => (
                <option key={days} value={days}>{days}d</option>
              ))}
            </select>
          </label>
          <button className="secondary" onClick={() => { void refresh(); }} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="link-button" onClick={() => { void handleLogout(); }}>Sign out</button>
        </div>
      </header>

      <main className="app-main">
        {view === 'fleet' && report && (
          <FleetView
            installations={installations}
            report={report}
            loading={loading}
            error={dataError}
            userFilter={userFilter}
            onOpenInstallation={openInstallation}
          />
        )}
        {view === 'fleet' && !report && (
          <p className="muted">{dataError || 'Loading fleet…'}</p>
        )}
        {view === 'installation' && selectedInstallation && (
          <InstallationView
            installationId={selectedInstallation}
            sinceDays={sinceDays}
            userFilter={userFilter}
            onBack={() => { setView('fleet'); setSelectedInstallation(null); }}
            onRevoked={() => { setView('fleet'); setSelectedInstallation(null); void refresh(); }}
          />
        )}
        {view === 'triage' && report && (
          <TriageView
            report={report}
            loading={loading}
            userFilter={userFilter}
            onOpenInstallation={openInstallation}
            onChanged={() => { void refresh(); }}
          />
        )}
        {view === 'triage' && !report && (
          <p className="muted">{dataError || 'Loading triage…'}</p>
        )}
      </main>
    </div>
  );
}
