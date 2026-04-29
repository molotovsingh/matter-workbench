import { getJson, postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import { renderSkillRouterPanel, wireSkillRouterPanel } from "./skill-router-panel.js";

export function createMatterScreens(ctx) {
  const {
    activityExplorer,
    activitySettings,
    addFilesButton,
    breadcrumbs,
    editorContent,
    mattersList,
    mattersPicker,
    workspaceTree,
  } = ctx.elements;

  function setActivityActive(which) {
    activityExplorer.classList.toggle("active", which !== "settings");
    activitySettings.classList.toggle("active", which === "settings");
  }

  function renderMattersList() {
    const mattersState = ctx.getMattersState();
    if (!mattersState.enabled) {
      mattersPicker.hidden = true;
      mattersList.innerHTML = "";
      return;
    }
    mattersPicker.hidden = false;
    if (!mattersState.matters.length) {
      mattersList.innerHTML = '<li class="matters-empty">No matters yet. Click + New Matter to add your first.</li>';
      return;
    }
    mattersList.innerHTML = mattersState.matters.map((matter) => {
      const activeClass = matter.name === mattersState.active ? " active" : "";
      return `<li><button type="button" class="matters-entry${activeClass}" data-matter-name="${escapeHtml(matter.name)}">${escapeHtml(matter.name)}</button></li>`;
    }).join("");
  }

  async function renderSettings() {
    setActivityActive("settings");
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
    editorContent.innerHTML = `
      <h1>Settings</h1>
      <h2>Matters home</h2>
      <p>The folder where your matters live. Each subfolder under this path is one matter.</p>
      <form class="new-matter-form" id="settingsForm">
        <label>
          <span>Path</span>
          <input type="text" id="settingsMattersHome" value="${escapeHtml(currentHome)}" spellcheck="false" autocomplete="off" />
        </label>
        <p style="color:#9aa0a6;font-size:12px;">Changing this reloads the matters list. Existing matters at the old location are untouched on disk; they just stop appearing in the sidebar until you point back at that folder.</p>
        <div class="form-actions">
          <button type="submit" id="settingsSubmit">Save</button>
          <button type="button" class="secondary" id="settingsCancel">Cancel</button>
        </div>
        <div id="settingsError" class="form-error" hidden></div>
      </form>
      ${renderAiSettingsForm(aiSettings, aiSettingsError)}
      ${renderSkillRouterPanel(skillRegistry, skillRegistryError)}
    `;
    const form = document.getElementById("settingsForm");
    const input = document.getElementById("settingsMattersHome");
    const errorBox = document.getElementById("settingsError");
    const submit = document.getElementById("settingsSubmit");
    document.getElementById("settingsCancel").addEventListener("click", ctx.goToExplorer);
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
    wireAiSettingsForm();
    wireSkillRouterPanel();
  }

  function renderFirstRun(defaultPath) {
    setActivityActive("explorer");
    breadcrumbs.textContent = "first run";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>First run</strong><br />Pick where your matters should live.",
      bar: "First Run",
      terminal: "[first-run] awaiting matters home selection",
    });
    editorContent.innerHTML = `
      <h1>Where should your matters live?</h1>
      <p>
        This is the parent folder where each new matter becomes a subfolder.
        You can change it later by editing <code>config.json</code>.
      </p>
      <form class="first-run-form" id="firstRunForm">
        <label>
          <span>Matters home (absolute path)</span>
          <input type="text" id="firstRunInput" value="${escapeHtml(defaultPath || "")}" spellcheck="false" autocomplete="off" />
        </label>
        <div class="form-actions">
          <button type="submit">Continue</button>
        </div>
        <div id="firstRunError" class="form-error" hidden></div>
      </form>
    `;
    const form = document.getElementById("firstRunForm");
    const input = document.getElementById("firstRunInput");
    const errorBox = document.getElementById("firstRunError");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const value = input.value.trim();
      if (!value) {
        errorBox.textContent = "Please enter a path.";
        errorBox.hidden = false;
        return;
      }
      try {
        await postJson("/api/config", { mattersHome: value });
        await ctx.bootstrap();
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      }
    });
    input.focus();
    input.select();
  }

  function renderBlankLanding() {
    setActivityActive("explorer");
    ctx.clearActiveMatter();
    if (addFilesButton) addFilesButton.hidden = true;
    workspaceTree.innerHTML = '<li class="tree-node">Pick a matter from the sidebar.</li>';
    breadcrumbs.textContent = "workbench > pick a matter";
    const mattersState = ctx.getMattersState();
    const hasMatters = mattersState.matters.length > 0;
    editorContent.innerHTML = `
      <h1>Welcome</h1>
      <p>
        ${hasMatters
          ? `You have <strong>${mattersState.matters.length}</strong> matter${mattersState.matters.length === 1 ? "" : "s"} available. Pick one from the sidebar to open it, or click <code>+ New Matter</code> to add a new one.`
          : "No matters yet. Click <code>+ New Matter</code> in the sidebar to create your first."}
      </p>
      <p>Matters home: <code>${escapeHtml(mattersState.mattersHome || "")}</code></p>
    `;
    ctx.setStatus({
      mood: "idle",
      card: hasMatters
        ? "<strong>Ready</strong><br />Pick a matter or create a new one."
        : "<strong>Ready</strong><br />Create your first matter to begin.",
      bar: "No Matter",
      terminal: [
        "[landing] no active matter",
        `[landing] ${mattersState.matters.length} matter(s) available`,
      ],
    });
  }

  function goToExplorer() {
    setActivityActive("explorer");
    if (ctx.getActiveMatter().folderName) {
      ctx.renderSkillOverview();
    } else {
      renderBlankLanding();
    }
  }

  return {
    goToExplorer,
    renderBlankLanding,
    renderFirstRun,
    renderMattersList,
    renderSettings,
    setActivityActive,
  };

  function renderAiSettingsForm(settings, loadError) {
    if (loadError) {
      return `
        <h2>AI settings</h2>
        <p class="form-error">AI settings unavailable: ${escapeHtml(loadError)}</p>
      `;
    }
    const model = settings?.model || "gpt-5.4-mini";
    const maxOutputTokens = settings?.maxOutputTokens || 3000;
    const status = settings?.apiKeyConfigured ? "Configured" : "Missing";
    return `
      <h2>AI settings</h2>
      <p>Local OpenAI direct settings. Provider routing for AI tasks is shown below.</p>
      <form class="new-matter-form" id="aiSettingsForm">
        <dl class="matter-info-card">
          <dt>Provider</dt><dd>${escapeHtml(settings?.provider || "OpenAI")}</dd>
          <dt>API key</dt><dd id="aiKeyStatus">${escapeHtml(status)}</dd>
          <dt>Settings file</dt><dd><code>${escapeHtml(settings?.envPath || ".env")}</code></dd>
        </dl>
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
    `;
  }

  function renderAiProviderStatus(tasks = []) {
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
    return `
      <h2>AI provider routing</h2>
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
    `;
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
}
