import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import type { AiSettings, Skill } from '../types';

export default function SettingsPage() {
  const { dispatch, appendTerminal } = useApp();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [formProvider, setFormProvider] = useState<string>('openrouter');
  const [formApiKey, setFormApiKey] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formMaxTokens, setFormMaxTokens] = useState('3000');
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; model?: string; latency?: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [mattersHome, setMattersHome] = useState('');
  const [mattersHomeEdit, setMattersHomeEdit] = useState('');
  const [mattersHomeSaving, setMattersHomeSaving] = useState(false);
  const [mattersHomeError, setMattersHomeError] = useState('');

  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsError, setSkillsError] = useState('');

  useEffect(() => {
    api.getConfig().then((c) => {
      if (c.mattersHome) {
        setMattersHome(c.mattersHome);
        setMattersHomeEdit(c.mattersHome);
      }
    }).catch(() => null);

    api.getAiSettings().then((s) => {
      setSettings(s);
      if (s.provider) setFormProvider(s.provider);
      if (s.model) setFormModel(s.model);
    }).catch(() => null);

    api.getSkills().then((s) => {
      setSkills(s.skills ?? []);
    }).catch((e) => setSkillsError((e as Error).message));
  }, []);

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
      setMattersHomeError((err as Error).message);
    } finally {
      setMattersHomeSaving(false);
    }
  }

  async function handleSaveAi(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
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
      alert(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
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
      setTestResult(result as typeof testResult);
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const overallReady = (settings?.apiKeyConfigured ?? false) && (settings?.aiTasks?.every(t => t.ready) ?? false);

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>Settings</h1>
          <p>Workspace path, AI provider configuration, and skill routing.</p>
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
                onClick={() => setMattersHomeEdit(mattersHome)}
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
          Local OpenAI-compatible settings. Provider routing for AI tasks is shown below.
        </p>

        {settings && !editing && (
          <div className="settings-card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong>{settings.provider ?? 'Not configured'}</strong>
                {settings.model && (
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{settings.model}</div>
                )}
              </div>
              <span className={`provider-status ${settings.apiKeyConfigured ? 'ready' : 'needs-setup'}`}>
                {settings.apiKeyConfigured ? 'Ready' : 'Needs setup'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              API key: {settings.apiKeyConfigured ? 'Configured' : 'Missing'}
              {settings.envPath && (
                <span> · <code>{settings.envPath}</code></span>
              )}
            </div>
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

      {/* ─── AI Provider Routing ───────────────────── */}
      {settings?.aiTasks && settings.aiTasks.length > 0 && (
        <div className="settings-section">
          <details>
            <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0 }}>AI Provider Routing</h2>
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

      {/* ─── Skill Router ──────────────────────────── */}
      <div className="settings-section">
        <details>
          <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Skill Router</h2>
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
                      <td><code>{s.slash}</code></td>
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
