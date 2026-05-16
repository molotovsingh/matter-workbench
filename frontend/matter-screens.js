import { getJson, postJson } from "./api-client.js";
import { writeClipboardText } from "./clipboard.js";
import { escapeHtml } from "./dom-utils.js";
import { filterMatters } from "./matter-search.js";
import { renderActivityPageHtml } from "./views/activity-page.js";
import { createHomeLandingController } from "./views/home-landing.js";
import { createSettingsPageController } from "./views/settings-page.js";
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
    let skillFactoryHealth = null;
    let skillFactoryHealthError = "";
    let configurableSkills = null;
    let configurableSkillsError = "";
    let configurableSkillRuns = null;
    let configurableSkillRunsError = "";
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
      skillIdeasError,
      skillFactoryHealth,
      skillFactoryHealthError,
      configurableSkills,
      configurableSkillsError,
      configurableSkillRuns,
      configurableSkillRunsError,
      activeMatter: ctx.getActiveMatter(),
    }, escapeHtml);
    wireSkillsPageCommandActions();
    wireSkillFactoryHealthActions({ skillFactoryHealth });
    wireSkillIdeaActions({
      ideas: skillIdeas?.ideas || [],
      registry,
    });
  }

  function wireSkillsPageCommandActions() {
    editorContent.querySelectorAll?.("[data-skill-card-command]")?.forEach((button) => {
      button.addEventListener("click", () => {
        const command = button.dataset.skillCardCommand || "";
        if (!command) return;
        if (ctx.elements.aiCommandInput) ctx.elements.aiCommandInput.value = command;
        ctx.runCommand?.(command);
      });
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
      activityLogLines: ctx.getActivityLogLines?.({ limit: 20 }) || [],
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
