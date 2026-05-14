import { getJson, postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import { renderSkillRouterPanel, wireSkillRouterPanel } from "./skill-router-panel.js";
import { renderActivityPageHtml } from "./views/activity-page.js";
import {
  formatConfigurableSkillRunReport,
  formatSkillFactoryHealthReport,
  formatSkillIdeaImplementationBrief,
  formatSkillIdeaReviewPacket,
  renderSkillsPageHtml,
} from "./views/skills-page.js";

export function createMatterScreens(ctx) {
  const {
    activityExplorer,
    activityActivity,
    activitySettings,
    activitySkills,
    addFilesButton,
    breadcrumbs,
    editorContent,
    mattersList,
    mattersPicker,
    mattersSearchInput,
    mattersSearchMeta,
    workspaceTree,
  } = ctx.elements;
  let matterSearchQuery = "";

  function setActivityActive(which) {
    activityExplorer.classList.toggle("active", which === "explorer");
    activitySkills?.classList.toggle("active", which === "skills");
    activityActivity?.classList.toggle("active", which === "activity");
    activitySettings.classList.toggle("active", which === "settings");
  }

  function renderMattersList() {
    const mattersState = ctx.getMattersState();
    if (!mattersState.enabled) {
      mattersPicker.hidden = true;
      mattersList.innerHTML = "";
      if (mattersSearchInput) mattersSearchInput.value = "";
      if (mattersSearchMeta) mattersSearchMeta.textContent = "";
      return;
    }
    mattersPicker.hidden = false;
    syncMatterSearchInput();
    if (!mattersState.matters.length) {
      mattersList.innerHTML = '<li class="matters-empty">No matters yet. Click + New Matter to add your first.</li>';
      if (mattersSearchMeta) mattersSearchMeta.textContent = "";
      return;
    }
    const filteredMatters = filterMatters(mattersState.matters, matterSearchQuery);
    if (mattersSearchMeta) {
      mattersSearchMeta.textContent = matterSearchQuery
        ? `${filteredMatters.length} of ${mattersState.matters.length} matters`
        : `${mattersState.matters.length} matters`;
    }
    if (!filteredMatters.length) {
      mattersList.innerHTML = `<li class="matters-empty">No matters match "${escapeHtml(matterSearchQuery)}".</li>`;
      return;
    }
    mattersList.innerHTML = filteredMatters.map((matter) => {
      const activeClass = matter.name === mattersState.active ? " active" : "";
      return `<li><button type="button" class="matters-entry${activeClass}" data-matter-name="${escapeHtml(matter.name)}">${escapeHtml(matter.name)}</button></li>`;
    }).join("");
  }

  function setMatterSearchQuery(value = "") {
    matterSearchQuery = String(value || "").trim();
    renderMattersList();
  }

  function syncMatterSearchInput() {
    if (!mattersSearchInput || document.activeElement === mattersSearchInput) return;
    mattersSearchInput.value = matterSearchQuery;
  }

  function filterMatters(matters = [], query = "") {
    const normalizedQuery = normalizeMatterSearchText(query);
    if (!normalizedQuery) return matters;
    return matters.filter((matter) => normalizeMatterSearchText([
      matter.name,
      matter.folderName,
      matter.inputLabel,
      matter.clientName,
      matter.oppositeParty,
      matter.matterName,
    ].filter(Boolean).join(" ")).includes(normalizedQuery));
  }

  function normalizeMatterSearchText(value = "") {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
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

  async function renderSkills() {
    setActivityActive("skills");
    breadcrumbs.textContent = "skills";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Skills</strong><br />Viewing read-only built-in skill contracts.",
      bar: "Skills",
      terminal: "[skills] viewing registry",
    });
    editorContent.innerHTML = `
      <h1>Skills</h1>
      <p class="muted">Loading built-in skill contracts...</p>
    `;

    let registry = {};
    let loadError = "";
    let matterStatus = null;
    let statusError = "";
    let skillIdeas = null;
    let skillIdeasError = "";
    let skillFactoryHealth = null;
    let skillFactoryHealthError = "";
    let configurableSkills = null;
    let configurableSkillsError = "";
    try {
      registry = await getJson("/api/skills");
    } catch (error) {
      loadError = error.message;
    }
    try {
      skillIdeas = await getJson("/api/skill-ideas");
    } catch (error) {
      skillIdeasError = error.message;
    }
    try {
      skillFactoryHealth = await getJson("/api/skill-factory-health");
    } catch (error) {
      skillFactoryHealthError = error.message;
    }
    try {
      configurableSkills = await getJson("/api/configurable-skills");
    } catch (error) {
      configurableSkillsError = error.message;
    }
    if (ctx.getActiveMatter().folderName) {
      try {
        matterStatus = await getJson("/api/matter-status");
      } catch (error) {
        statusError = error.message;
      }
    }
    editorContent.innerHTML = renderSkillsPageHtml({
      registry,
      matterStatus,
      loadError,
      statusError,
      skillIdeas,
      skillIdeasError,
      skillFactoryHealth,
      skillFactoryHealthError,
      configurableSkills,
      configurableSkillsError,
      activeMatter: ctx.getActiveMatter(),
    }, escapeHtml);
    wireSkillFactoryHealthActions({ skillFactoryHealth });
    wireSkillIdeaActions({
      ideas: skillIdeas?.ideas || [],
      registry,
    });
  }

  async function renderActivity() {
    setActivityActive("activity");
    breadcrumbs.textContent = "activity";
    ctx.setStatus({
      mood: "idle",
      card: "<strong>Activity</strong><br />Viewing custom skill run receipts.",
      bar: "Activity",
      terminal: "[activity] viewing custom skill runs",
    });
    editorContent.innerHTML = `
      <h1>Activity</h1>
      <p class="muted">Loading recent custom skill runs...</p>
    `;

    let configurableSkillRuns = null;
    let configurableSkillRunsError = "";
    try {
      configurableSkillRuns = await getJson("/api/configurable-skills/runs?limit=100");
    } catch (error) {
      configurableSkillRunsError = error.message;
    }
    editorContent.innerHTML = renderActivityPageHtml({
      configurableSkillRuns,
      configurableSkillRunsError,
      activeMatter: ctx.getActiveMatter(),
    }, escapeHtml);
    wireConfigurableSkillRunActions({ configurableSkillRuns });
  }

  function wireConfigurableSkillRunActions({ configurableSkillRuns = null } = {}) {
    const runsById = new Map((Array.isArray(configurableSkillRuns?.runs) ? configurableSkillRuns.runs : [])
      .map((run) => [run.id, run]));
    editorContent.querySelectorAll?.("[data-configurable-run-copy]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const runId = button.dataset.configurableRunCopy;
        const run = runsById.get(runId);
        if (!run) return;
        button.disabled = true;
        try {
          await writeClipboardText(formatConfigurableSkillRunReport(run));
          ctx.setStatus({
            mood: "idle",
            card: "<strong>Run report copied</strong><br />Metadata only. No provider call or matter artifact write occurred.",
            bar: "Run Report Copied",
            terminal: `[skills] copied run report for ${run.slash || run.id}`,
          });
        } catch (error) {
          ctx.setStatus({
            mood: "idle",
            card: `<strong>Run report copy failed</strong><br />${escapeHtml(error.message)}`,
            bar: "Run Report Failed",
            terminal: `[skills] run report copy failed: ${error.message}`,
          });
        } finally {
          button.disabled = false;
        }
      });
    });
    editorContent.querySelectorAll?.("[data-activity-open-output]")?.forEach((button) => {
      button.addEventListener("click", () => {
        const filePath = button.dataset.activityOpenOutput || "";
        if (!filePath || !ctx.openFilePreview) return;
        ctx.openFilePreview(filePath, "true", "markdown");
      });
    });
  }

  function wireSkillFactoryHealthActions({ skillFactoryHealth = null } = {}) {
    const button = editorContent.querySelector?.("[data-skill-factory-copy-health]");
    if (!button) return;
    button.addEventListener("click", async () => {
      const status = editorContent.querySelector("[data-skill-factory-copy-health-status]");
      if (!skillFactoryHealth) {
        setArtifactActionStatus(status, "Health report unavailable.", true);
        return;
      }
      button.disabled = true;
      setArtifactActionStatus(status, "Copying health report...");
      try {
        await writeClipboardText(formatSkillFactoryHealthReport(skillFactoryHealth));
        setArtifactActionStatus(status, "Health report copied.");
        ctx.setStatus({
          mood: "idle",
          card: "<strong>Health report copied</strong><br />Read-only. No provider call, skill run, repair, or matter artifact write occurred.",
          bar: "Skill Factory Health Copied",
          terminal: "[skills] copied skill factory health report",
        });
      } catch (error) {
        setArtifactActionStatus(status, `Copy failed: ${error.message}`, true);
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Health report copy failed</strong><br />${escapeHtml(error.message)}`,
          bar: "Skill Factory Health Failed",
          terminal: `[skills] health report copy failed: ${error.message}`,
        });
      } finally {
        button.disabled = false;
      }
    });
  }

  function wireSkillIdeaActions({ ideas = [], registry = {} } = {}) {
    const ideaById = new Map((Array.isArray(ideas) ? ideas : [])
      .map((idea) => [idea.id, idea]));
    editorContent.querySelectorAll?.("[data-skill-idea-copy-packet]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.skillIdeaId;
        const idea = ideaById.get(id);
        const status = editorContent.querySelector(`[data-skill-idea-copy-status="${cssEscape(id || "")}"]`);
        if (!idea) {
          setArtifactActionStatus(status, "Idea not found.", true);
          return;
        }
        button.disabled = true;
        setArtifactActionStatus(status, "Copying review packet...");
        try {
          await writeClipboardText(formatSkillIdeaReviewPacket(idea, registry));
          setArtifactActionStatus(status, "Review packet copied.");
          ctx.setStatus({
            mood: "idle",
            card: "<strong>Review packet copied</strong><br />No provider call, prompt generation, or matter artifact write occurred.",
            bar: "Skill Idea Packet Copied",
            terminal: `[skill-ideas] copied review packet for ${id}`,
          });
        } catch (error) {
          setArtifactActionStatus(status, `Copy failed: ${error.message}`, true);
          ctx.setStatus({
            mood: "idle",
            card: `<strong>Review packet copy failed</strong><br />${escapeHtml(error.message)}`,
            bar: "Skill Idea Copy Failed",
            terminal: `[skill-ideas] copy failed: ${error.message}`,
          });
        } finally {
          button.disabled = false;
        }
      });
    });

    editorContent.querySelectorAll?.("[data-skill-idea-copy-implementation-brief]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.skillIdeaId;
        const idea = ideaById.get(id);
        const status = editorContent.querySelector(`[data-skill-idea-copy-status="${cssEscape(id || "")}"]`);
        if (!idea) {
          setArtifactActionStatus(status, "Idea not found.", true);
          return;
        }
        button.disabled = true;
        setArtifactActionStatus(status, "Copying implementation brief...");
        try {
          await writeClipboardText(formatSkillIdeaImplementationBrief(idea, registry));
          setArtifactActionStatus(status, "Implementation brief copied.");
          ctx.setStatus({
            mood: "idle",
            card: "<strong>Implementation brief copied</strong><br />Governance-only. No skill, prompt, provider call, or matter artifact was created.",
            bar: "Implementation Brief Copied",
            terminal: `[skill-ideas] copied implementation brief for ${id}`,
          });
        } catch (error) {
          setArtifactActionStatus(status, `Copy failed: ${error.message}`, true);
          ctx.setStatus({
            mood: "idle",
            card: `<strong>Implementation brief copy failed</strong><br />${escapeHtml(error.message)}`,
            bar: "Implementation Brief Failed",
            terminal: `[skill-ideas] implementation brief copy failed: ${error.message}`,
          });
        } finally {
          button.disabled = false;
        }
      });
    });

    editorContent.querySelectorAll?.("[data-skill-idea-brief-form]")?.forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const id = form.dataset.skillIdeaId;
        if (!id) return;
        const submit = form.querySelector("button[type='submit']");
        const originalText = submit?.textContent || "Save design brief";
        if (submit) {
          submit.disabled = true;
          submit.textContent = "Saving...";
        }
        try {
          const formData = new FormData(form);
          await postJson(`/api/skill-ideas/${encodeURIComponent(id)}/design-brief`, {
            designBrief: {
              intendedUser: formData.get("intendedUser") || "",
              problem: formData.get("problem") || "",
              expectedInputs: formData.get("expectedInputs") || "",
              expectedOutputArtifact: formData.get("expectedOutputArtifact") || "",
              targetLane: formData.get("targetLane") || "",
              paidPosture: formData.get("paidPosture") || "",
              riskLevel: formData.get("riskLevel") || "",
              notes: formData.get("notes") || "",
            },
          });
          ctx.setStatus({
            mood: "idle",
            card: "<strong>Design brief saved</strong><br />Still not runnable. No provider call or matter artifact was created.",
            bar: "Skill Idea Saved",
            terminal: `[skill-ideas] saved design brief for ${id}`,
          });
          await renderSkills();
        } catch (error) {
          if (submit) {
            submit.disabled = false;
            submit.textContent = originalText;
          }
          ctx.setStatus({
            mood: "idle",
            card: `<strong>Design brief save failed</strong><br />${escapeHtml(error.message)}`,
            bar: "Skill Idea Failed",
            terminal: `[skill-ideas] design brief failed: ${error.message}`,
          });
        }
      });
    });

    editorContent.querySelectorAll?.("[data-skill-idea-id][data-skill-idea-status]")?.forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.skillIdeaId;
        const status = button.dataset.skillIdeaStatus;
        if (!id || !status) return;
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = "Saving...";
        try {
          await postJson(`/api/skill-ideas/${encodeURIComponent(id)}/status`, { status });
          await renderSkills();
        } catch (error) {
          button.disabled = false;
          button.textContent = originalText;
          ctx.setStatus({
            mood: "idle",
            card: `<strong>Skill idea update failed</strong><br />${escapeHtml(error.message)}`,
            bar: "Skill Idea Failed",
            terminal: `[skill-ideas] update failed: ${error.message}`,
          });
        }
      });
    });
  }

  function setArtifactActionStatus(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("form-error", Boolean(isError));
  }

  async function writeClipboardText(text) {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall back to the hidden textarea path below.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (!document.execCommand("copy")) throw new Error("clipboard copy was rejected");
    } finally {
      textarea.remove();
    }
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
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
    if (ctx.elements.titleText) ctx.elements.titleText.textContent = "No matter selected";
    if (ctx.elements.bottomMeta) ctx.elements.bottomMeta.textContent = "No matter selected";
    workspaceTree.innerHTML = '<li class="tree-node">Pick a matter from the sidebar.</li>';
    breadcrumbs.textContent = "No matter selected";
    const mattersState = ctx.getMattersState();
    const hasMatters = mattersState.matters.length > 0;
    editorContent.innerHTML = `
      <h1>No matter selected</h1>
      <p>
        ${hasMatters
          ? `You have <strong>${mattersState.matters.length}</strong> matter${mattersState.matters.length === 1 ? "" : "s"} available. Pick a matter from the sidebar to begin.`
          : "No matters yet. Click <code>+ New Matter</code> in the sidebar to create your first."}
      </p>
      ${mattersState.mattersHome ? `
        <details class="local-folder-details">
          <summary>Show local folder</summary>
          <p><code>${escapeHtml(mattersState.mattersHome)}</code></p>
        </details>
      ` : ""}
    `;
    ctx.setStatus({
      mood: "idle",
      card: hasMatters
        ? "<strong>Pick a matter</strong><br />Choose a matter from the sidebar to begin."
        : "<strong>Ready</strong><br />Create your first matter to begin.",
      bar: "Pick a matter to begin",
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
    renderActivity,
    renderSkills,
    renderSettings,
    setActivityActive,
    setMatterSearchQuery,
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
