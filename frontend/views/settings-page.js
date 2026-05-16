import { getJson, postJson } from "../api-client.js";
import { escapeHtml } from "../dom-utils.js";
import { renderSkillRouterPanel, wireSkillRouterPanel } from "../skill-router-panel.js";

export function createSettingsPageController({ ctx, setActivityActive } = {}) {
  async function renderSettings() {
    const { breadcrumbs, editorContent } = ctx.elements;
    setActivityActive?.("settings");
    const mattersState = ctx.getMattersState();
    breadcrumbs.textContent = "settings";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Settings</strong>",
      bar: "Settings",
      terminal: "[settings] viewing",
    });
    const currentHome = mattersState.mattersHome || "";
    let aiSettings = null;
    let aiSettingsError = "";
    let skillRegistry = null;
    let skillRegistryError = "";
    try {
      aiSettings = await getJson("/api/ai-settings");
    } catch (error) {
      aiSettingsError = error.message;
    }
    try {
      skillRegistry = await getJson("/api/skills");
    } catch (error) {
      skillRegistryError = error.message;
    }
    const readyStatus = getSettingsReadyStatus({ aiSettings, aiSettingsError, skillRegistryError });
    const skillCount = Array.isArray(skillRegistry?.skills) ? skillRegistry.skills.length : 0;
    editorContent.innerHTML = renderSettingsPageHtml({
      aiSettings,
      aiSettingsError,
      currentHome,
      readyStatus,
      skillCount,
      skillRegistry,
      skillRegistryError,
    });
    wireSettingsForm({ ctx });
    wireAiSettingsForm();
    wireSkillRouterPanel();
  }

  return { renderSettings };
}

export function renderSettingsPageHtml({
  aiSettings = null,
  aiSettingsError = "",
  currentHome = "",
  readyStatus = { ready: false, label: "Configuration issues" },
  skillCount = 0,
  skillRegistry = null,
  skillRegistryError = "",
} = {}) {
  return `
    <div class="settings-page">
      <div class="settings-hero">
        <div>
          <h1>Settings</h1>
          <p>Workspace path, AI provider configuration, and skill routing.</p>
        </div>
        <div class="settings-ready-status ${readyStatus.ready ? "ready" : "error"}">
          <span class="settings-ready-dot" aria-hidden="true"></span>
          <span>${escapeHtml(readyStatus.label)}</span>
        </div>
      </div>

      <section class="settings-section">
        <h2>Matters Home</h2>
        <p class="muted">The folder where your matters live. Each subfolder under this path is one matter.</p>
        <form class="new-matter-form settings-card" id="settingsForm">
          <label>
            <span>Path</span>
            <input type="text" id="settingsMattersHome" value="${escapeHtml(currentHome)}" spellcheck="false" autocomplete="off" />
          </label>
          <p class="form-note">Changing this reloads the matters list. Existing matters at the old location are untouched on disk; they just stop appearing on Home until you point back at that folder.</p>
          <div class="form-actions">
            <button type="submit" id="settingsSubmit">Save</button>
            <button type="button" class="secondary" id="settingsCancel">Cancel</button>
          </div>
          <div id="settingsError" class="form-error" hidden></div>
        </form>
      </section>

      ${renderAiSettingsForm(aiSettings, aiSettingsError)}
      ${renderSettingsAdminDetails({
        title: "Skill Router",
        badge: skillRegistryError ? "Error" : `${skillCount} skills`,
        tone: skillRegistryError ? "needs-setup" : "ready",
        body: renderSkillRouterPanel(skillRegistry, skillRegistryError),
      })}
    </div>
  `;
}

export function getSettingsReadyStatus({ aiSettings, aiSettingsError, skillRegistryError }) {
  const tasks = Array.isArray(aiSettings?.aiTasks) ? aiSettings.aiTasks : [];
  const tasksReady = tasks.every((task) => task.ready !== false);
  const apiKeyReady = aiSettings?.apiKeyConfigured !== false;
  const ready = !aiSettingsError && !skillRegistryError && apiKeyReady && tasksReady;
  return {
    ready,
    label: ready ? "All systems ready" : "Configuration issues",
  };
}

function wireSettingsForm({ ctx }) {
  const form = document.getElementById("settingsForm");
  if (!form) return;
  const input = document.getElementById("settingsMattersHome");
  const errorBox = document.getElementById("settingsError");
  const submit = document.getElementById("settingsSubmit");
  document.getElementById("settingsCancel")?.addEventListener("click", () => ctx.goToExplorer?.());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const value = input.value.trim();
    if (!value) {
      errorBox.textContent = "Path is required.";
      errorBox.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = "Saving...";
    try {
      await postJson("/api/config", { mattersHome: value });
      await ctx.bootstrap();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      submit.disabled = false;
      submit.textContent = "Save";
    }
  });
}

function renderSettingsAdminDetails({ title, badge, tone = "ready", body }) {
  return `
    <details class="settings-admin-details">
      <summary>
        <span class="settings-admin-caret" aria-hidden="true">▶</span>
        <span class="settings-admin-title">${escapeHtml(title)}</span>
        <span class="provider-status ${escapeHtml(tone)}">${escapeHtml(badge)}</span>
      </summary>
      <div class="settings-admin-body">
        ${body}
      </div>
    </details>
  `;
}

function renderAiSettingsForm(settings, loadError) {
  if (loadError) {
    return `
      <section class="settings-section">
        <h2>AI Configuration</h2>
        <p class="form-error">AI settings unavailable: ${escapeHtml(loadError)}</p>
      </section>
    `;
  }
  const model = settings?.model || "gpt-5.4-mini";
  const maxOutputTokens = settings?.maxOutputTokens || 3000;
  const status = settings?.apiKeyConfigured ? "Configured" : "Missing";
  return `
    <section class="settings-section">
      <h2>AI Configuration</h2>
      <p class="muted">Local OpenAI direct settings. Provider routing for AI tasks is shown below.</p>
      <dl class="matter-info-card settings-current-card">
        <dt>Provider</dt><dd>${escapeHtml(settings?.provider || "OpenAI")}</dd>
        <dt>API key</dt><dd id="aiKeyStatus">${escapeHtml(status)}</dd>
        <dt>Settings file</dt><dd><code>${escapeHtml(settings?.envPath || ".env")}</code></dd>
      </dl>
      <form class="new-matter-form settings-card" id="aiSettingsForm">
        <label>
          <span>Replace API key</span>
          <input type="password" id="aiApiKey" placeholder="Leave blank to keep current key" spellcheck="false" autocomplete="off" />
        </label>
        <label>
          <span>Model</span>
          <input type="text" id="aiModel" value="${escapeHtml(model)}" spellcheck="false" autocomplete="off" />
        </label>
        <label>
          <span>Max output tokens</span>
          <input type="text" id="aiMaxOutputTokens" value="${escapeHtml(maxOutputTokens)}" inputmode="numeric" autocomplete="off" />
        </label>
        <div class="form-actions">
          <button type="submit" id="aiSettingsSubmit">Save AI settings</button>
          <button type="button" class="secondary" id="aiSettingsTest">Test connection</button>
        </div>
        <div id="aiSettingsMessage" class="form-note"></div>
        <div id="aiSettingsError" class="form-error" hidden></div>
      </form>
      <div id="aiProviderStatus">
        ${renderAiProviderStatus(settings?.aiTasks)}
      </div>
    </section>
  `;
}

function renderAiProviderStatus(tasks = []) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const readyCount = taskList.filter((task) => task.ready !== false).length;
  const allReady = taskList.length ? readyCount === taskList.length : true;
  const badge = taskList.length
    ? (allReady ? "Ready" : "Needs setup")
    : "No tasks";
  const rows = Array.isArray(tasks) && tasks.length
    ? tasks.map((task) => {
      const statusNote = task.ready || !task.note
        ? ""
        : `<br /><span class="muted">${escapeHtml(task.note)}</span>`;
      return `
        <tr>
          <td><strong>${escapeHtml(task.label || task.task || "")}</strong><br /><span class="muted">${escapeHtml(task.surface || "")}</span></td>
          <td><span class="provider-pill ${escapeHtml(providerClass(task.provider))}">${escapeHtml(providerLabel(task.provider))}</span></td>
          <td>${task.model ? `<code>${escapeHtml(task.model)}</code>` : '<span class="muted">Not configured</span>'}</td>
          <td>${task.maxOutputTokens ? escapeHtml(task.maxOutputTokens) : '<span class="muted">-</span>'}</td>
          <td>${task.timeoutMs ? `${escapeHtml(task.timeoutMs)} ms` : '<span class="muted">-</span>'}</td>
          <td>${escapeHtml(task.fallback || "")}</td>
          <td><span class="provider-status ${task.ready ? "ready" : "needs-setup"}">${task.ready ? "Ready" : "Needs setup"}</span>${statusNote}</td>
        </tr>
      `;
    }).join("")
    : '<tr><td colspan="7">No AI task policies found.</td></tr>';
  return renderSettingsAdminDetails({
    title: "AI Provider Routing",
    badge,
    tone: allReady ? "ready" : "needs-setup",
    body: `
      <table class="extract-table provider-status-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Timeout</th>
            <th>Fallback</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `,
  });
}

function providerLabel(provider) {
  if (provider === "openai-direct") return "OpenAI direct";
  if (provider === "openrouter") return "OpenRouter";
  return provider || "Unknown";
}

function providerClass(provider) {
  return provider === "openrouter" ? "openrouter" : provider === "openai-direct" ? "openai-direct" : "unknown";
}

function wireAiSettingsForm() {
  const form = document.getElementById("aiSettingsForm");
  if (!form) return;
  const keyInput = document.getElementById("aiApiKey");
  const modelInput = document.getElementById("aiModel");
  const maxInput = document.getElementById("aiMaxOutputTokens");
  const submit = document.getElementById("aiSettingsSubmit");
  const testButton = document.getElementById("aiSettingsTest");
  const message = document.getElementById("aiSettingsMessage");
  const errorBox = document.getElementById("aiSettingsError");
  const keyStatus = document.getElementById("aiKeyStatus");
  const providerStatus = document.getElementById("aiProviderStatus");

  const showMessage = (text) => {
    message.textContent = text;
    errorBox.hidden = true;
  };
  const showError = (text) => {
    errorBox.textContent = text;
    errorBox.hidden = false;
    message.textContent = "";
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = "Saving...";
    try {
      const body = {
        model: modelInput.value.trim(),
        maxOutputTokens: maxInput.value.trim(),
      };
      const apiKey = keyInput.value.trim();
      if (apiKey) body.apiKey = apiKey;
      const saved = await postJson("/api/ai-settings", body);
      keyInput.value = "";
      keyStatus.textContent = saved.apiKeyConfigured ? "Configured" : "Missing";
      modelInput.value = saved.model;
      maxInput.value = String(saved.maxOutputTokens);
      if (providerStatus) providerStatus.innerHTML = renderAiProviderStatus(saved.aiTasks);
      showMessage("AI settings saved.");
    } catch (error) {
      showError(error.message);
    } finally {
      submit.disabled = false;
      submit.textContent = "Save AI settings";
    }
  });

  testButton.addEventListener("click", async () => {
    testButton.disabled = true;
    testButton.textContent = "Testing...";
    try {
      const result = await postJson("/api/ai-settings/test", {});
      showMessage(`Connection OK using ${result.model} (${result.latencyMs} ms).`);
    } catch (error) {
      showError(error.message);
    } finally {
      testButton.disabled = false;
      testButton.textContent = "Test connection";
    }
  });
}
