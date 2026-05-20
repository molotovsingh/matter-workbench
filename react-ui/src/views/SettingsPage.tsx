import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { cleanCommandLabel } from '../lib/nativeCommands';
import { COPILOT_MODEL_PRESETS, copilotPresetValue } from '../lib/copilotModels';
import type { AiSettings, Skill } from '../types';

function findCopilotTask(settings: AiSettings | null) {
  return settings?.aiTasks?.find((task) => task.task === 'copilot_answer') || null;
}

export default function SettingsPage() {
  const { dispatch, appendTerminal } = useApp();
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
  const [copilotProvider, setCopilotProvider] = useState('openai-direct');
  const [copilotModel, setCopilotModel] = useState('gpt-5.4-mini');
  const [copilotApiKey, setCopilotApiKey] = useState('');
  const [copilotSaving, setCopilotSaving] = useState(false);
  const [copilotSaveError, setCopilotSaveError] = useState('');

  const [mattersHome, setMattersHome] = useState('');
  const [mattersHomeEdit, setMattersHomeEdit] = useState('');
  const [mattersHomeSaving, setMattersHomeSaving] = useState(false);
  const [mattersHomeError, setMattersHomeError] = useState('');

  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsError, setSkillsError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getConfig().then((c) => {
      if (cancelled) return;
      if (c.mattersHome) {
        setMattersHome(c.mattersHome);
        setMattersHomeEdit(c.mattersHome);
      }
    }).catch((e) => {
      if (cancelled) return;
      const message = getErrorMessage(e);
      setMattersHomeError(message);
      appendTerminal([`[settings] config load failed: ${message}`]);
    });

    api.getAiSettings().then((s) => {
      if (cancelled) return;
      setSettings(s);
      if (s.provider) setFormProvider(s.provider);
      if (s.model) setFormModel(s.model);
      applyCopilotSettings(s);
    }).catch((e) => {
      if (cancelled) return;
      const message = getErrorMessage(e);
      setAiLoadError(message);
      appendTerminal([`[settings] AI settings load failed: ${message}`]);
    });

    api.getSkills().then((s) => {
      if (cancelled) return;
      setSkills(s.skills ?? []);
    }).catch((e) => {
      if (cancelled) return;
      setSkillsError(getErrorMessage(e));
    });
    return () => {
      cancelled = true;
    };
  }, [appendTerminal]);

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
      appendTerminal([`[settings] Matter Copilot model saved: ${copilotProvider} / ${copilotModel}`]);
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

  const overallReady = (settings?.apiKeyConfigured ?? false) && (settings?.aiTasks?.every(t => t.ready) ?? false);
  const copilotTask = findCopilotTask(settings);
  const copilotPreset = COPILOT_MODEL_PRESETS.some((p) => p.provider === copilotProvider && p.model === copilotModel)
    ? copilotPresetValue(copilotProvider, copilotModel)
    : '';

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>Settings</h1>
          <p>Matter folder, AI connection, and advanced routing.</p>
        </div>
        <div className={`settings-ready-status${overallReady ? ' ready' : ' error'}`}>
          <span className="settings-ready-dot" />
          {overallReady ? 'All systems ready' : 'Configuration issues'}
        </div>
      </div>

      {/* ─── Matters Home ──────────────────────────── */}
      <div className="settings-section">
        <h2>Matters Home</h2>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
          The folder where your matters live. Each subfolder under this path is one matter.
        </p>
        <div className="settings-card">
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
        </div>
      </div>

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
                    Current: {copilotTask?.provider || copilotProvider} / <code>{copilotTask?.model || copilotModel}</code>
                  </div>
                </div>
                <span className={`provider-status ${copilotTask?.ready ? 'ready' : 'needs-setup'}`}>
                  {copilotTask?.ready ? 'Ready' : 'Needs setup'}
                </span>
              </div>

              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">Copilot model</span>
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
                  {copilotSaving ? 'Testing model…' : 'Test and save Copilot model'}
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
