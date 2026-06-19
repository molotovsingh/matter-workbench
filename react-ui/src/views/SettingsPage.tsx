import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { cleanCommandLabel } from '../lib/nativeCommands';
import { COPILOT_MODEL_PRESETS, copilotPresetValue, findCopilotPreset } from '../lib/copilotModels';
import { canSeeOperatorSurface } from '../lib/lawyerMode';
import type { AiSettings, PrivateBetaUser, Skill, SystemHealthReport } from '../types';

function findCopilotTask(settings: AiSettings | null) {
  return settings?.aiTasks?.find((task) => task.task === 'copilot_answer') || null;
}

export default function SettingsPage() {
  const { state, dispatch, appendTerminal } = useApp();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [formProvider, setFormProvider] = useState<string>('openrouter');
  const [formApiKey, setFormApiKey] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formMaxTokens, setFormMaxTokens] = useState('3000');
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; model?: string; latency?: number } | null>(null);
  const [aiLoadError, setAiLoadError] = useState('');
  const [aiSaveError, setAiSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copilotProvider, setCopilotProvider] = useState('openrouter');
  const [copilotModel, setCopilotModel] = useState('openai/gpt-4.1');
  const [copilotApiKey, setCopilotApiKey] = useState('');
  const [copilotSaving, setCopilotSaving] = useState(false);
  const [copilotSaveError, setCopilotSaveError] = useState('');

  const [mattersHome, setMattersHome] = useState('');
  const [mattersHomeEdit, setMattersHomeEdit] = useState('');
  const [runtimeStorageMode, setRuntimeStorageMode] = useState<'filesystem' | 'postgres'>('filesystem');
  const [mattersHomeSaving, setMattersHomeSaving] = useState(false);
  const [mattersHomeError, setMattersHomeError] = useState('');

  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsError, setSkillsError] = useState('');
  const [systemHealth, setSystemHealth] = useState<SystemHealthReport | null>(null);
  const [systemHealthError, setSystemHealthError] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [betaUsers, setBetaUsers] = useState<PrivateBetaUser[]>([]);
  const [betaUsersError, setBetaUsersError] = useState('');
  const [betaUsersLoading, setBetaUsersLoading] = useState(false);
  const [betaActionBusy, setBetaActionBusy] = useState('');
  const [newTesterEmail, setNewTesterEmail] = useState('');
  const [newTesterName, setNewTesterName] = useState('');
  const [temporaryPasswordNotice, setTemporaryPasswordNotice] = useState('');

  const isSuperuser = state.authUser?.role === 'superuser';
  const canReviewSystemHealth = canSeeOperatorSurface(state.authEnabled, state.authUser);

  const loadSettingsData = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoadingSettings(true);
    setMattersHomeError('');
    setAiLoadError('');
    setSkillsError('');
    setSystemHealthError('');
    setBetaUsersError('');

    const [configResult, aiResult, skillsResult, systemHealthResult] = await Promise.allSettled([
      api.getConfig(),
      canReviewSystemHealth ? api.getAiSettings() : Promise.resolve(null),
      api.getSkills(),
      canReviewSystemHealth ? api.getSystemHealth() : Promise.resolve(null),
    ]);

    if (isCancelled()) return;

    if (configResult.status === 'fulfilled') {
      setRuntimeStorageMode(configResult.value.runtimeStorageMode || 'filesystem');
      if (configResult.value.mattersHome) {
        setMattersHome(configResult.value.mattersHome);
        setMattersHomeEdit(configResult.value.mattersHome);
      }
    } else {
      setMattersHomeError(getErrorMessage(configResult.reason));
    }

    if (aiResult.status === 'fulfilled' && aiResult.value) {
      const nextSettings = aiResult.value;
      setSettings(nextSettings);
      if (nextSettings.provider) setFormProvider(nextSettings.provider);
      if (nextSettings.model) setFormModel(nextSettings.model);
      const task = findCopilotTask(nextSettings);
      if (task?.provider) setCopilotProvider(task.provider);
      if (task?.model) setCopilotModel(task.model);
    } else if (aiResult.status === 'rejected') {
      setAiLoadError(getErrorMessage(aiResult.reason));
    } else {
      setSettings(null);
    }

    if (skillsResult.status === 'fulfilled') {
      setSkills(skillsResult.value.skills ?? []);
    } else {
      setSkillsError(getErrorMessage(skillsResult.reason));
    }

    if (systemHealthResult.status === 'fulfilled') {
      setSystemHealth(systemHealthResult.value);
    } else if (canReviewSystemHealth) {
      setSystemHealthError(getErrorMessage(systemHealthResult.reason));
    } else {
      setSystemHealth(null);
    }

    if (isSuperuser) {
      setBetaUsersLoading(true);
      const usersResult = await api.getPrivateBetaUsers()
        .then((result) => ({ status: 'fulfilled' as const, value: result }))
        .catch((reason) => ({ status: 'rejected' as const, reason }));
      if (isCancelled()) return;
      if (usersResult.status === 'fulfilled') {
        setBetaUsers(usersResult.value.users ?? []);
      } else {
        setBetaUsersError(getErrorMessage(usersResult.reason));
      }
      setBetaUsersLoading(false);
    } else {
      setBetaUsers([]);
    }

    setLoadingSettings(false);
  }, [canReviewSystemHealth, isSuperuser]);

  useEffect(() => {
    let cancelled = false;
    void loadSettingsData(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadSettingsData]);

  async function handleSaveMattersHome(e: React.FormEvent) {
    e.preventDefault();
    if (!mattersHomeEdit.trim()) return;
    setMattersHomeSaving(true);
    setMattersHomeError('');
    try {
      await api.setConfig({ mattersHome: mattersHomeEdit.trim() });
      setMattersHome(mattersHomeEdit.trim());
      appendTerminal(['[settings] matters home updated']);
      const mattersResult = await api.getMatters();
      dispatch({ type: 'SET_MATTERS', payload: mattersResult.matters ?? [] });
    } catch (err) {
      setMattersHomeError(getErrorMessage(err));
    } finally {
      setMattersHomeSaving(false);
    }
  }

  async function handleSaveAi(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setAiSaveError('');
    try {
      await api.saveAiSettings({
        provider: formProvider,
        apiKey: formApiKey || undefined,
        model: formModel || undefined,
        maxOutputTokens: formMaxTokens ? Number(formMaxTokens) : undefined,
      });
      const updated = await api.getAiSettings();
      setSettings(updated);
      setEditing(false);
      setFormApiKey('');
      appendTerminal(['[settings] AI settings saved']);
    } catch (err) {
      setAiSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function applyCopilotSettings(nextSettings: AiSettings) {
    const task = findCopilotTask(nextSettings);
    if (!task) return;
    if (task.provider) setCopilotProvider(task.provider);
    if (task.model) setCopilotModel(task.model);
  }

  function handleCopilotPresetChange(value: string) {
    const preset = COPILOT_MODEL_PRESETS.find((p) => copilotPresetValue(p.provider, p.model) === value);
    if (!preset) return;
    setCopilotProvider(preset.provider);
    setCopilotModel(preset.model);
  }

  async function handleSaveCopilot(e: React.FormEvent) {
    e.preventDefault();
    setCopilotSaving(true);
    setCopilotSaveError('');
    try {
      const updated = await api.saveAiSettings({
        copilotProvider,
        copilotModel,
        copilotApiKey: copilotApiKey || undefined,
      });
      setSettings(updated);
      applyCopilotSettings(updated);
      setCopilotApiKey('');
      appendTerminal([`[settings] Matter Copilot saved: ${findCopilotPreset(copilotProvider, copilotModel)?.label || 'Custom'}`]);
    } catch (err) {
      setCopilotSaveError(getErrorMessage(err));
    } finally {
      setCopilotSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testAiSettings({
        provider: formProvider,
        apiKey: formApiKey || undefined,
        model: formModel || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: getErrorMessage(err) });
    } finally {
      setTesting(false);
    }
  }

  async function refreshBetaUsers() {
    if (!isSuperuser) return;
    setBetaUsersLoading(true);
    setBetaUsersError('');
    try {
      const result = await api.getPrivateBetaUsers();
      setBetaUsers(result.users ?? []);
    } catch (err) {
      setBetaUsersError(getErrorMessage(err));
    } finally {
      setBetaUsersLoading(false);
    }
  }

  async function handleCreateTester(e: React.FormEvent) {
    e.preventDefault();
    const username = newTesterEmail.trim();
    if (!username) return;
    setBetaActionBusy(`create:${username}`);
    setBetaUsersError('');
    setTemporaryPasswordNotice('');
    try {
      const result = await api.createPrivateBetaTester({
        username,
        displayName: newTesterName.trim() || undefined,
      });
      setNewTesterEmail('');
      setNewTesterName('');
      setTemporaryPasswordNotice(`Temporary password for ${result.user.username}: ${result.temporaryPassword || '(not returned)'}`);
      appendTerminal([`[settings] beta tester added: ${result.user.username}`]);
      await refreshBetaUsers();
    } catch (err) {
      setBetaUsersError(getErrorMessage(err));
    } finally {
      setBetaActionBusy('');
    }
  }

  async function handleResetTesterPassword(username: string) {
    setBetaActionBusy(`reset:${username}`);
    setBetaUsersError('');
    setTemporaryPasswordNotice('');
    try {
      const result = await api.resetPrivateBetaTesterPassword(username);
      setTemporaryPasswordNotice(`Temporary password for ${result.user.username}: ${result.temporaryPassword || '(not returned)'}`);
      appendTerminal([`[settings] beta tester password reset: ${result.user.username}`]);
      await refreshBetaUsers();
    } catch (err) {
      setBetaUsersError(getErrorMessage(err));
    } finally {
      setBetaActionBusy('');
    }
  }

  async function handleSetTesterDisabled(username: string, disabled: boolean) {
    setBetaActionBusy(`${disabled ? 'disable' : 'enable'}:${username}`);
    setBetaUsersError('');
    setTemporaryPasswordNotice('');
    try {
      const result = disabled
        ? await api.disablePrivateBetaTester(username)
        : await api.enablePrivateBetaTester(username);
      appendTerminal([`[settings] beta tester ${disabled ? 'removed' : 'reactivated'}: ${result.user.username}`]);
      await refreshBetaUsers();
    } catch (err) {
      setBetaUsersError(getErrorMessage(err));
    } finally {
      setBetaActionBusy('');
    }
  }

  const systemHealthNeedsAttention = systemHealth?.status === 'warning' || systemHealth?.status === 'error';
  const overallReady = canReviewSystemHealth
    ? !systemHealthNeedsAttention && (settings?.apiKeyConfigured ?? false) && (settings?.aiTasks?.every(t => t.ready) ?? false)
    : !mattersHomeError && !skillsError;
  const copilotTask = findCopilotTask(settings);
  const copilotPreset = COPILOT_MODEL_PRESETS.some((p) => p.provider === copilotProvider && p.model === copilotModel)
    ? copilotPresetValue(copilotProvider, copilotModel)
    : '';
  const currentCopilotPreset = findCopilotPreset(copilotTask?.provider || copilotProvider, copilotTask?.model || copilotModel);
  const isRuntimeDbWorkspace = runtimeStorageMode === 'postgres';

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>Settings</h1>
          <p>{canReviewSystemHealth ? 'Matter folder, system health, and advanced routing.' : 'Matter storage and workspace preferences.'}</p>
        </div>
        <div className={`settings-ready-status${overallReady ? ' ready' : ' error'}`}>
          <span className="settings-ready-dot" />
          {overallReady ? 'All systems ready' : 'Configuration issues'}
        </div>
      </div>

      {(aiLoadError || skillsError || systemHealthError || (!mattersHome && mattersHomeError)) && (
        <div className="run-failure-card" style={{ marginBottom: 18 }}>
          <strong>Some settings data could not be loaded</strong>
          <button
            type="button"
            className="run-skill-button secondary"
            onClick={() => { void loadSettingsData(); }}
            disabled={loadingSettings}
          >
            {loadingSettings ? 'Retrying…' : 'Retry loading settings'}
          </button>
        </div>
      )}

      {canReviewSystemHealth && (
        <div className="settings-section">
          <h2>System Health</h2>
          <div className="settings-card" style={{ display: 'grid', gap: 12 }}>
            {systemHealth ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <strong>{systemHealthNeedsAttention ? 'System health needs attention' : 'All systems ready'}</strong>
                    <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                      {systemHealth.summary?.checks ?? systemHealth.checks.length} read-only checks · {systemHealth.runtime?.storageMode || runtimeStorageMode} storage
                    </div>
                  </div>
                  <span className={`provider-status ${systemHealth.status === 'ok' ? 'ready' : 'needs-setup'}`}>
                    {systemHealth.status === 'ok' ? 'Ready' : systemHealth.status === 'error' ? 'Errors' : 'Warnings'}
                  </span>
                </div>
                {systemHealth.recommendations && systemHealth.recommendations.length > 0 && (
                  <ul className="skill-idea-sample-warnings" style={{ margin: 0 }}>
                    {systemHealth.recommendations.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
                <details>
                  <summary style={{ cursor: 'pointer' }}>Technical health checks</summary>
                  <div className="table-scroll" style={{ marginTop: 12 }}>
                    <table className="extract-table">
                      <thead>
                        <tr>
                          <th>Check</th>
                          <th>Area</th>
                          <th>Status</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {systemHealth.checks.map((check) => (
                          <tr key={check.id}>
                            <td>{check.label}</td>
                            <td>{check.category}</td>
                            <td>
                              <span className={`provider-status ${check.status === 'ok' ? 'ready' : 'needs-setup'}`}>
                                {check.status}
                              </span>
                            </td>
                            <td>{check.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <div>
                <strong>System health unavailable</strong>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                  {systemHealthError || 'Loading read-only system checks…'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Matters Home ──────────────────────────── */}
      <div className="settings-section">
        <h2>{isRuntimeDbWorkspace ? 'Matter storage' : 'Matters Home'}</h2>
        <div className="settings-card">
          {isRuntimeDbWorkspace ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <span className="settings-label">Workspace mode</span>
              <strong>DB workspace</strong>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Matters, uploaded files, and generated work products are stored through the runtime database. There is no local matters folder to configure for this beta instance.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSaveMattersHome} style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">Matters folder path</span>
                <input
                  type="text"
                  value={mattersHomeEdit}
                  onChange={(e) => setMattersHomeEdit(e.target.value)}
                  placeholder="/path/to/matters"
                  required
                  className="settings-input"
                />
              </label>
              {mattersHomeError && <div className="form-warning">{mattersHomeError}</div>}
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Changing this reloads the matters list. Existing matters at the old location are untouched on disk.
              </p>
              <div className="form-actions">
                <button type="submit" disabled={mattersHomeSaving}>
                  {mattersHomeSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setMattersHomeEdit(mattersHome);
                    setMattersHomeError('');
                  }}
                  disabled={mattersHomeSaving}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {isSuperuser && (
        <div className="settings-section">
          <h2>Beta access</h2>
          <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
            Add or remove access for private beta testers. Temporary passwords are shown once after add or reset.
          </p>
          <div className="settings-card" style={{ display: 'grid', gap: 16 }}>
            <form onSubmit={handleCreateTester} style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 10, alignItems: 'end' }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span className="settings-label">Tester email</span>
                  <input
                    type="email"
                    value={newTesterEmail}
                    onChange={(e) => setNewTesterEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="settings-input"
                    required
                  />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span className="settings-label">Display name</span>
                  <input
                    type="text"
                    value={newTesterName}
                    onChange={(e) => setNewTesterName(e.target.value)}
                    placeholder="Optional"
                    className="settings-input"
                  />
                </label>
                <button type="submit" disabled={Boolean(betaActionBusy)}>
                  {betaActionBusy.startsWith('create:') ? 'Adding…' : 'Add tester'}
                </button>
              </div>
            </form>

            {temporaryPasswordNotice && (
              <div className="form-info" style={{ userSelect: 'text' }}>
                {temporaryPasswordNotice}
              </div>
            )}
            {betaUsersError && <div className="form-warning">{betaUsersError}</div>}

            <div className="table-scroll">
              <table className="extract-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {betaUsers.map((user) => {
                    const isBusy = betaActionBusy.endsWith(`:${user.username}`);
                    const isProtectedSuperuser = user.role === 'superuser' && !user.disabled;
                    return (
                      <tr key={user.username}>
                        <td>
                          <strong>{user.displayName || user.username}</strong>
                          {user.displayName && <div className="muted" style={{ fontSize: 12 }}>{user.username}</div>}
                        </td>
                        <td>{user.role}</td>
                        <td>
                          <span className={`provider-status ${user.disabled ? 'needs-setup' : 'ready'}`}>
                            {user.disabled ? 'Access removed' : 'Active'}
                          </span>
                        </td>
                        <td>
                          <div className="form-actions" style={{ marginTop: 0 }}>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => { void handleResetTesterPassword(user.username); }}
                              disabled={Boolean(betaActionBusy) || user.disabled}
                            >
                              {isBusy && betaActionBusy.startsWith('reset:') ? 'Resetting…' : 'Reset password'}
                            </button>
                            {user.disabled ? (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => { void handleSetTesterDisabled(user.username, false); }}
                                disabled={Boolean(betaActionBusy)}
                              >
                                {isBusy && betaActionBusy.startsWith('enable:') ? 'Restoring…' : 'Restore access'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => { void handleSetTesterDisabled(user.username, true); }}
                                disabled={Boolean(betaActionBusy) || isProtectedSuperuser}
                                title={isProtectedSuperuser ? 'The active superuser account cannot be removed here.' : undefined}
                              >
                                {isBusy && betaActionBusy.startsWith('disable:') ? 'Removing…' : 'Remove access'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!betaUsers.length && (
                    <tr>
                      <td colSpan={4} className="muted">
                        {betaUsersLoading ? 'Loading beta testers…' : 'No beta testers configured.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {canReviewSystemHealth && (
        <>
          {/* ─── AI Configuration ──────────────────────── */}
          <div className="settings-section">
        <h2>AI Configuration</h2>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
          The AI connection used by governed workbench tasks. Advanced routing details are shown below.
        </p>
        {aiLoadError && <div className="form-warning" style={{ marginBottom: 14 }}>Could not load AI settings: {aiLoadError}</div>}

        {settings && (
          <div className="settings-card" style={{ marginBottom: 14 }}>
            <form onSubmit={handleSaveCopilot} style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <strong>Matter Copilot</strong>
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
                    Source-backed chat answers only. Skills and List of Dates keep their governed routes.
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 5 }}>
                    Current: {currentCopilotPreset?.label || 'Custom'}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>
                    Route: {copilotTask?.provider || copilotProvider} / <code>{copilotTask?.model || copilotModel}</code>
                  </div>
                </div>
                <span className={`provider-status ${copilotTask?.ready ? 'ready' : 'needs-setup'}`}>
                  {copilotTask?.ready ? 'Ready' : 'Needs setup'}
                </span>
              </div>

              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">Copilot strength</span>
                <select
                  value={copilotPreset}
                  onChange={(e) => handleCopilotPresetChange(e.target.value)}
                  className="settings-input"
                >
                  {!copilotPreset && <option value="">Custom: {copilotProvider} / {copilotModel}</option>}
                  {COPILOT_MODEL_PRESETS.map((preset) => (
                    <option key={copilotPresetValue(preset.provider, preset.model)} value={copilotPresetValue(preset.provider, preset.model)}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span className="settings-label">Provider</span>
                  <input type="text" value={copilotProvider} readOnly className="settings-input" />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span className="settings-label">Model id</span>
                  <input type="text" value={copilotModel} readOnly className="settings-input" />
                </label>
              </div>

              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">
                  {copilotProvider === 'openrouter' ? 'OpenRouter API key' : 'OpenAI API key'}
                </span>
                <input
                  type="password"
                  value={copilotApiKey}
                  onChange={(e) => setCopilotApiKey(e.target.value)}
                  placeholder="Leave blank to keep existing key"
                  className="settings-input"
                />
              </label>

              {copilotTask?.note && !copilotTask.ready && (
                <div className="form-warning">{copilotTask.note}</div>
              )}
              {copilotSaveError && <div className="form-warning">{copilotSaveError}</div>}

              <div className="form-actions">
                <button type="submit" disabled={copilotSaving}>
                  {copilotSaving ? 'Testing setting…' : 'Test and save Copilot setting'}
                </button>
              </div>
            </form>
          </div>
        )}

        {settings && !editing && (
          <div className="settings-card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong>{settings.apiKeyConfigured ? 'AI connection configured' : 'AI connection not configured'}</strong>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
                  {settings.apiKeyConfigured ? 'Ready for workbench tasks' : 'Add an API key before running AI tasks'}
                </div>
              </div>
              <span className={`provider-status ${settings.apiKeyConfigured ? 'ready' : 'needs-setup'}`}>
                {settings.apiKeyConfigured ? 'Ready' : 'Needs setup'}
              </span>
            </div>
            <details style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              <summary style={{ cursor: 'pointer' }}>Technical connection details</summary>
              <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                <span>Provider: {settings.provider ?? 'Not configured'}</span>
                {settings.model && <span>Model: <code>{settings.model}</code></span>}
                <span>API key: {settings.apiKeyConfigured ? 'Configured' : 'Missing'}</span>
                {settings.envPath && <span>Settings file: <code>{settings.envPath}</code></span>}
              </div>
            </details>
            <div style={{ marginTop: 12 }}>
              <button className="run-skill-button secondary" type="button" onClick={() => setEditing(true)}>
                Edit
              </button>
            </div>
          </div>
        )}

        {(!settings || editing) && (
          <div className="settings-card">
            <form onSubmit={handleSaveAi} style={{ display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">Provider</span>
                <select
                  value={formProvider}
                  onChange={(e) => setFormProvider(e.target.value)}
                  className="settings-input"
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="openai-direct">OpenAI direct</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">API Key</span>
                <input
                  type="password"
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  placeholder={editing ? '(leave blank to keep existing)' : 'sk-…'}
                  className="settings-input"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">Model</span>
                <input
                  type="text"
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                  placeholder="e.g. gpt-5.4-mini"
                  className="settings-input"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">Max output tokens</span>
                <input
                  type="number"
                  value={formMaxTokens}
                  onChange={(e) => setFormMaxTokens(e.target.value)}
                  placeholder="3000"
                  className="settings-input"
                />
              </label>

              {testResult && (
                <div className={testResult.ok ? 'form-info' : 'form-warning'}>
                  {testResult.ok
                    ? `Connection successful${testResult.model ? ` · ${testResult.model}` : ''}${testResult.latency ? ` · ${testResult.latency}ms` : ''}`
                    : testResult.error}
                </div>
              )}

              {aiSaveError && <div className="form-warning">{aiSaveError}</div>}

              <div className="form-actions">
                <button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save AI settings'}
                </button>
                <button type="button" className="secondary" onClick={handleTest} disabled={testing}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                {editing && (
                  <button type="button" className="secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </div>

      {/* ─── Advanced AI Routing ───────────────────── */}
      {settings?.aiTasks && settings.aiTasks.length > 0 && (
        <div className="settings-section">
          <details>
            <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0 }}>Advanced AI Routing</h2>
              <span className={`provider-status ${settings.aiTasks!.every(t => t.ready) ? 'ready' : 'needs-setup'}`}>
                {settings.aiTasks!.every(t => t.ready) ? 'All ready' : 'Needs setup'}
              </span>
            </summary>
            <div className="table-scroll" style={{ marginTop: 14 }}>
              <table className="extract-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Tokens</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.aiTasks!.map((t) => (
                    <tr key={t.task}>
                      <td>{t.label || t.task}</td>
                      <td>
                        <span className={`provider-pill ${t.provider || 'unknown'}`}>
                          {t.provider || 'unknown'}
                        </span>
                      </td>
                      <td>{t.model ? <code>{t.model}</code> : <span className="muted">Not configured</span>}</td>
                      <td>{t.maxOutputTokens ?? '—'}</td>
                      <td>
                        <span className={`provider-status ${t.ready ? 'ready' : 'needs-setup'}`}>
                          {t.ready ? 'Ready' : 'Needs setup'}
                        </span>
                        {t.note && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{t.note}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

        </>
      )}

      {/* ─── Skill Registry ──────────────────────────── */}
      <div className="settings-section">
        <details>
          <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Skill Registry</h2>
            <span className={`provider-status ${skillsError ? 'needs-setup' : 'ready'}`}>
              {skillsError ? 'Error' : `${skills.length} skills`}
            </span>
          </summary>
          {skillsError ? (
            <p className="muted" style={{ marginTop: 12 }}>Could not load skill registry: {skillsError}</p>
          ) : skills.length > 0 ? (
            <div className="table-scroll" style={{ marginTop: 14 }}>
              <table className="extract-table">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Category</th>
                    <th>Mode</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((s) => (
                    <tr key={s.slash}>
                      <td>
                        <strong>{s.display?.action || s.title || cleanCommandLabel(s.slash)}</strong>
                        {s.slash && (
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                            <code>{s.slash}</code>
                          </div>
                        )}
                      </td>
                      <td>{s.category || '—'}</td>
                      <td>{s.mode || '—'}</td>
                      <td>{s.purpose || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>No skills registered.</p>
          )}
        </details>
      </div>
    </div>
  );
}
