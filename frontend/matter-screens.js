import { getJson, postJson } from "./api-client.js";
import { escapeHtml } from "./dom-utils.js";
import { filterMatters } from "./matter-search.js";
import { wireActivityPageActions, wireSkillsPageActions } from "./skills-page-actions.js";
import { renderActivityPageHtml } from "./views/activity-page.js";
import { createHomeLandingController } from "./views/home-landing.js";
import { createSettingsPageController } from "./views/settings-page.js";
import { renderSkillsPageHtml } from "./views/skills-page.js";
import { setLawyerLabelRegistry } from "./lawyer-labels.js";

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
    if (mattersPicker) mattersPicker.hidden = true;
    if (!mattersState.enabled) {
      mattersList.innerHTML = "";
      if (mattersSearchInput) mattersSearchInput.value = "";
      if (mattersSearchMeta) mattersSearchMeta.textContent = "";
      return;
    }
    if (!mattersSearchInput && !mattersSearchMeta && !mattersList) return;
    syncMatterSearchInput();
    if (!mattersState.matters.length) {
      mattersList.innerHTML = '<li class="matters-empty">No matters yet. Click Add new matter to add your first.</li>';
      if (mattersSearchMeta) mattersSearchMeta.textContent = "";
      return;
    }
    if (!matterSearchQuery) {
      mattersList.innerHTML = "";
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

  function resetMatterSearchUi() {
    matterSearchQuery = "";
    if (mattersSearchInput) mattersSearchInput.value = "";
    if (mattersSearchMeta) mattersSearchMeta.textContent = "";
    if (mattersList) mattersList.innerHTML = "";
  }

  const homeLanding = createHomeLandingController({
    ctx,
    setActivityActive,
    resetMatterSearch: resetMatterSearchUi,
  });
  const { renderSettings } = createSettingsPageController({ ctx, setActivityActive });

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
    let skillIdeaSamplesById = {};
    let skillIdeaSamplesError = "";
    let skillFactoryHealth = null;
    let skillFactoryHealthError = "";
    let configurableSkills = null;
    let configurableSkillsError = "";
    let configurableSkillRuns = null;
    let configurableSkillRunsError = "";
    try {
      registry = await getJson("/api/skills");
      setLawyerLabelRegistry(registry);
    } catch (error) {
      loadError = error.message;
    }
    try {
      skillIdeas = await getJson("/api/skill-ideas");
    } catch (error) {
      skillIdeasError = error.message;
    }
    if (Array.isArray(skillIdeas?.ideas) && skillIdeas.ideas.length) {
      const loadedSamples = await loadSkillIdeaSamples(skillIdeas.ideas);
      skillIdeaSamplesById = loadedSamples.samplesById;
      skillIdeaSamplesError = loadedSamples.error;
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
    try {
      configurableSkillRuns = await getJson("/api/configurable-skills/runs?limit=100");
    } catch (error) {
      configurableSkillRunsError = error.message;
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
      skillIdeaSamplesById,
      skillIdeasError,
      skillIdeaSamplesError,
      skillFactoryHealth,
      skillFactoryHealthError,
      configurableSkills,
      configurableSkillsError,
      configurableSkillRuns,
      configurableSkillRunsError,
      activeMatter: ctx.getActiveMatter(),
    }, escapeHtml);
    wireSkillsPageActions({
      configurableSkillRuns,
      ctx,
      editorContent,
      registry,
      renderSkills,
      skillFactoryHealth,
      skillIdeaSamplesById,
      skillIdeas: skillIdeas?.ideas || [],
    });
  }

  async function loadSkillIdeaSamples(ideas = []) {
    const entries = await Promise.allSettled((Array.isArray(ideas) ? ideas : [])
      .filter((idea) => idea?.id)
      .map(async (idea) => {
        const payload = await getJson(`/api/skill-ideas/${encodeURIComponent(idea.id)}/samples`);
        return [idea.id, Array.isArray(payload.samples) ? payload.samples : []];
      }));
    const samplesById = {};
    let failed = 0;
    for (const entry of entries) {
      if (entry.status === "fulfilled") {
        const [ideaId, samples] = entry.value;
        samplesById[ideaId] = samples;
      } else {
        failed += 1;
      }
    }
    return {
      samplesById,
      error: failed ? `${failed} sample ledger${failed === 1 ? "" : "s"} unavailable.` : "",
    };
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
      activityLogLines: ctx.getActivityLogLines?.({ limit: 20 }) || [],
    }, escapeHtml);
    wireActivityPageActions({ configurableSkillRuns, ctx, editorContent });
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
    homeLanding.renderBlankLanding();
  }

  async function goToExplorer() {
    setActivityActive("explorer");
    const currentMatterName = ctx.getActiveMatter().folderName || "";
    if (currentMatterName) {
      ctx.setResumeMatterName?.(currentMatterName);
      try {
        const clearServerActiveMatter = ctx.clearActiveMatterOnServer || (() => postJson("/api/active-matter/clear"));
        await clearServerActiveMatter();
      } catch (error) {
        ctx.setStatus({
          mood: "idle",
          card: `<strong>Home unavailable</strong><br />${escapeHtml(error.message)}`,
          bar: "Home Failed",
          terminal: `[home] clear active matter failed: ${error.message}`,
        });
        return;
      }
    }
    renderBlankLanding();
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
}
