import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { cleanCommandLabel } from '../lib/nativeCommands';
import { COPILOT_MODEL_PRESETS, copilotPresetValue, findCopilotPreset } from '../lib/copilotModels';
import { canSeeOperatorSurface } from '../lib/lawyerMode';
import { findCopilotTask } from '../lib/aiSettingsTasks';
import { SystemHealthPanel, systemHealthNeedsAttention } from '../components/settings/SystemHealthPanel';
import { BetaAccessPanel } from '../components/settings/BetaAccessPanel';
import { CopilotSettingsPanel } from '../components/settings/CopilotSettingsPanel';
import type { AiSettings, PrivateBetaUser, Skill, SystemHealthReport } from '../types';

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

  async function handleSaveMattersHome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mattersHomeEdit.trim()) return;
    setMattersHomeSaving(true);
    setMattersHomeError('');
    try {
      await api.setConfig({ mattersHome: mattersHomeEdit.trim() });
      setMattersHome(mattersHomeEdit.trim());
      appendTerminal(['[settings] matters home updated']);
      const mattersResult = await api.getMatters({ includeArchived: true });
      dispatch({ type: 'SET_MATTERS', payload: mattersResult.matters ?? [] });
    } catch (err) {
      setMattersHomeError(getErrorMessage(err));
    } finally {
      setMattersHomeSaving(false);
    }
  }

  async function handleSaveAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    const preset = COPILOT_MODEL_PRESETS.find((item) => copilotPresetValue(item.provider, item.model) === value);
    if (!preset) return;
    setCopilotProvider(preset.provider);
    setCopilotModel(preset.model);
  }

  async function handleSaveCopilot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  async function handleCreateTester(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  const overallReady = canReviewSystemHealth
    ? !systemHealthNeedsAttention(systemHealth) && (settings?.apiKeyConfigured ?? false) && (settings?.aiTasks?.every((task) => task.ready) ?? false)
    : !mattersHomeError && !skillsError;
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
        <SystemHealthPanel
          systemHealth={systemHealth}
          systemHealthError={systemHealthError}
          runtimeStorageMode={runtimeStorageMode}
        />
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
                  onChange={(event) => setMattersHomeEdit(event.target.value)}
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
        <BetaAccessPanel
          users={betaUsers}
          error={betaUsersError}
          loading={betaUsersLoading}
          actionBusy={betaActionBusy}
          newTesterEmail={newTesterEmail}
          newTesterName={newTesterName}
          temporaryPasswordNotice={temporaryPasswordNotice}
          onNewTesterEmailChange={setNewTesterEmail}
          onNewTesterNameChange={setNewTesterName}
          onCreateTester={handleCreateTester}
          onResetTesterPassword={(username) => { void handleResetTesterPassword(username); }}
          onSetTesterDisabled={(username, disabled) => { void handleSetTesterDisabled(username, disabled); }}
        />
      )}

      {canReviewSystemHealth && (
        <CopilotSettingsPanel
          settings={settings}
          editing={editing}
          formProvider={formProvider}
          formApiKey={formApiKey}
          formModel={formModel}
          formMaxTokens={formMaxTokens}
          testResult={testResult}
          aiLoadError={aiLoadError}
          aiSaveError={aiSaveError}
          saving={saving}
          testing={testing}
          copilotProvider={copilotProvider}
          copilotModel={copilotModel}
          copilotApiKey={copilotApiKey}
          copilotSaving={copilotSaving}
          copilotSaveError={copilotSaveError}
          onEditingChange={setEditing}
          onFormProviderChange={setFormProvider}
          onFormApiKeyChange={setFormApiKey}
          onFormModelChange={setFormModel}
          onFormMaxTokensChange={setFormMaxTokens}
          onCopilotPresetChange={handleCopilotPresetChange}
          onCopilotApiKeyChange={setCopilotApiKey}
          onSaveCopilot={handleSaveCopilot}
          onSaveAi={handleSaveAi}
          onTest={() => { void handleTest(); }}
        />
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
                  {skills.map((skill) => (
                    <tr key={skill.slash}>
                      <td>
                        <strong>{skill.display?.action || skill.title || cleanCommandLabel(skill.slash)}</strong>
                        {skill.slash && (
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                            <code>{skill.slash}</code>
                          </div>
                        )}
                      </td>
                      <td>{skill.category || '—'}</td>
                      <td>{skill.mode || '—'}</td>
                      <td>{skill.purpose || '—'}</td>
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
