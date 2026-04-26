import { postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";

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

  function renderSettings() {
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
}
