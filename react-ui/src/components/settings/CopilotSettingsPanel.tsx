import type { FormEventHandler } from 'react';
import { CUSTOM_COPILOT_PRESET_VALUE, COPILOT_MODEL_PRESETS, copilotPresetValue, findCopilotPreset } from '../../lib/copilotModels';
import { findCopilotTask } from '../../lib/aiSettingsTasks';
import type { AiSettings } from '../../types';

type TestResult = { ok: boolean; error?: string; model?: string; latency?: number } | null;

type CopilotSettingsPanelProps = {
  settings: AiSettings | null;
  editing: boolean;
  formProvider: string;
  formApiKey: string;
  formModel: string;
  formMaxTokens: string;
  testResult: TestResult;
  aiLoadError: string;
  aiSaveError: string;
  saving: boolean;
  testing: boolean;
  copilotProvider: string;
  copilotModel: string;
  copilotApiKey: string;
  copilotSaving: boolean;
  copilotSaveError: string;
  allowCustomCopilotModel: boolean;
  onEditingChange: (editing: boolean) => void;
  onFormProviderChange: (value: string) => void;
  onFormApiKeyChange: (value: string) => void;
  onFormModelChange: (value: string) => void;
  onFormMaxTokensChange: (value: string) => void;
  onCopilotPresetChange: (value: string) => void;
  onCopilotProviderChange: (value: string) => void;
  onCopilotModelChange: (value: string) => void;
  onCopilotApiKeyChange: (value: string) => void;
  onSaveCopilot: FormEventHandler<HTMLFormElement>;
  onSaveAi: FormEventHandler<HTMLFormElement>;
  onTest: () => void;
};

export function CopilotSettingsPanel({
  settings,
  editing,
  formProvider,
  formApiKey,
  formModel,
  formMaxTokens,
  testResult,
  aiLoadError,
  aiSaveError,
  saving,
  testing,
  copilotProvider,
  copilotModel,
  copilotApiKey,
  copilotSaving,
  copilotSaveError,
  allowCustomCopilotModel,
  onEditingChange,
  onFormProviderChange,
  onFormApiKeyChange,
  onFormModelChange,
  onFormMaxTokensChange,
  onCopilotPresetChange,
  onCopilotProviderChange,
  onCopilotModelChange,
  onCopilotApiKeyChange,
  onSaveCopilot,
  onSaveAi,
  onTest,
}: CopilotSettingsPanelProps) {
  const copilotTask = findCopilotTask(settings);
  const copilotPreset = COPILOT_MODEL_PRESETS.some((preset) => preset.provider === copilotProvider && preset.model === copilotModel)
    ? copilotPresetValue(copilotProvider, copilotModel)
    : '';
  const copilotSelectorValue = copilotPreset || (allowCustomCopilotModel ? CUSTOM_COPILOT_PRESET_VALUE : '');
  const customCopilotSelected = copilotSelectorValue === CUSTOM_COPILOT_PRESET_VALUE;
  const currentCopilotPreset = findCopilotPreset(copilotTask?.provider || copilotProvider, copilotTask?.model || copilotModel);

  return (
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
            <form onSubmit={onSaveCopilot} style={{ display: 'grid', gap: 14 }}>
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
                  value={copilotSelectorValue}
                  onChange={(event) => onCopilotPresetChange(event.target.value)}
                  className="settings-input"
                >
                  {!copilotPreset && !allowCustomCopilotModel && <option value="">Custom: {copilotProvider} / {copilotModel}</option>}
                  {COPILOT_MODEL_PRESETS.map((preset) => (
                    <option key={copilotPresetValue(preset.provider, preset.model)} value={copilotPresetValue(preset.provider, preset.model)}>
                      {preset.label}
                    </option>
                  ))}
                  {allowCustomCopilotModel && (
                    <option value={CUSTOM_COPILOT_PRESET_VALUE}>Custom model id…</option>
                  )}
                </select>
              </label>

              {allowCustomCopilotModel && customCopilotSelected && (
                <div className="form-warning">
                  Superuser override for controlled bakeoffs only. This changes transient Matter Copilot answers, not skills or durable source-backed artifacts.
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span className="settings-label">Provider</span>
                  {allowCustomCopilotModel && customCopilotSelected ? (
                    <select
                      value={copilotProvider}
                      onChange={(event) => onCopilotProviderChange(event.target.value)}
                      className="settings-input"
                    >
                      <option value="openrouter">OpenRouter</option>
                      <option value="openai-direct">OpenAI direct</option>
                    </select>
                  ) : (
                    <input type="text" value={copilotProvider} readOnly className="settings-input" />
                  )}
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span className="settings-label">Model id</span>
                  <input
                    type="text"
                    value={copilotModel}
                    onChange={(event) => onCopilotModelChange(event.target.value)}
                    readOnly={!allowCustomCopilotModel || !customCopilotSelected}
                    placeholder={copilotProvider === 'openrouter' ? 'e.g. openai/gpt-5.5-pro' : 'e.g. gpt-5.5-pro'}
                    className="settings-input"
                  />
                </label>
              </div>

              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">
                  {copilotProvider === 'openrouter' ? 'OpenRouter API key' : 'OpenAI API key'}
                </span>
                <input
                  type="password"
                  value={copilotApiKey}
                  onChange={(event) => onCopilotApiKeyChange(event.target.value)}
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
              <button className="run-skill-button secondary" type="button" onClick={() => onEditingChange(true)}>
                Edit
              </button>
            </div>
          </div>
        )}

        {(!settings || editing) && (
          <div className="settings-card">
            <form onSubmit={onSaveAi} style={{ display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">Provider</span>
                <select
                  value={formProvider}
                  onChange={(event) => onFormProviderChange(event.target.value)}
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
                  onChange={(event) => onFormApiKeyChange(event.target.value)}
                  placeholder={editing ? '(leave blank to keep existing)' : 'sk-…'}
                  className="settings-input"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">Model</span>
                <input
                  type="text"
                  value={formModel}
                  onChange={(event) => onFormModelChange(event.target.value)}
                  placeholder="e.g. gpt-5.4-mini"
                  className="settings-input"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="settings-label">Max output tokens</span>
                <input
                  type="number"
                  value={formMaxTokens}
                  onChange={(event) => onFormMaxTokensChange(event.target.value)}
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
                <button type="button" className="secondary" onClick={onTest} disabled={testing}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                {editing && (
                  <button type="button" className="secondary" onClick={() => onEditingChange(false)}>
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
              <span className={`provider-status ${settings.aiTasks.every((task) => task.ready) ? 'ready' : 'needs-setup'}`}>
                {settings.aiTasks.every((task) => task.ready) ? 'All ready' : 'Needs setup'}
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
                  {settings.aiTasks.map((task) => (
                    <tr key={task.task}>
                      <td>{task.label || task.task}</td>
                      <td>
                        <span className={`provider-pill ${task.provider || 'unknown'}`}>
                          {task.provider || 'unknown'}
                        </span>
                      </td>
                      <td>{task.model ? <code>{task.model}</code> : <span className="muted">Not configured</span>}</td>
                      <td>{task.maxOutputTokens ?? '—'}</td>
                      <td>
                        <span className={`provider-status ${task.ready ? 'ready' : 'needs-setup'}`}>
                          {task.ready ? 'Ready' : 'Needs setup'}
                        </span>
                        {task.note && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{task.note}</span>}
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
  );
}
