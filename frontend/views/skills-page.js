import { formatSkillIdeaImplementationBriefMarkdown } from "../skill-idea-implementation-brief.js";
import { renderSkillCards } from "./skills-page-cards.js";
import {
  formatSkillFactoryHealthReport,
  renderSkillFactoryHealth,
} from "./skills-page-health.js";
import { skillsPageSummary } from "./skills-page-summary.js";
import {
  renderSavedIdeas,
} from "./skills-page-saved-ideas.js";

export { formatConfigurableSkillRunReport } from "./configurable-skill-run-report.js";
export { formatSkillFactoryHealthReport } from "./skills-page-health.js";
export { formatSkillIdeaReviewPacket } from "./skills-page-saved-ideas.js";
export { skillsPageSummary } from "./skills-page-summary.js";

export function formatSkillIdeaImplementationBrief(idea = {}, registry = {}) {
  return formatSkillIdeaImplementationBriefMarkdown(idea, registry);
}

export function renderSkillsPageHtml({
  registry = {},
  matterStatus = null,
  configurableSkills = null,
  configurableSkillRuns = null,
  skillIdeas = null,
  skillIdeaSamplesById = {},
  skillFactoryHealth = null,
  loadError = "",
  statusError = "",
  skillIdeasError = "",
  skillIdeaSamplesError = "",
  skillFactoryHealthError = "",
  configurableSkillsError = "",
  configurableSkillRunsError = "",
  activeMatter = {},
} = {}, escapeHtml) {
  const summary = skillsPageSummary(registry, matterStatus, configurableSkills);
  const matterNote = activeMatter?.folderName
    ? `Status is derived from existing outputs in <code>${escapeHtml(activeMatter.folderName)}</code>.`
    : "No matter is selected. Showing built-in contracts in planning mode; output status appears after you pick a matter.";
  const registryError = loadError
    ? `<p class="form-error">Skills unavailable: ${escapeHtml(loadError)}</p>`
    : "";
  const statusWarning = statusError
    ? `<p class="form-warning">Matter status unavailable: ${escapeHtml(statusError)}</p>`
    : "";
  const ideasWarning = skillIdeasError
    ? `<p class="form-warning">Saved ideas unavailable: ${escapeHtml(skillIdeasError)}</p>`
    : "";

  return `
    <div class="skills-page">
      <section class="skills-hero">
        <div>
          <h1>Skills</h1>
          <p>What skills can you use, and what ideas are still being developed?</p>
        </div>
        ${renderSkillsStats(summary, skillIdeas?.ideas || [], escapeHtml)}
      </section>
      ${registryError}
      ${statusWarning}
      ${ideasWarning}
      ${skillIdeaSamplesError ? `<p class="form-warning">Some generated samples could not be loaded: ${escapeHtml(skillIdeaSamplesError)}</p>` : ""}
      ${skillFactoryHealthError ? `<p class="form-warning">Skill factory health unavailable: ${escapeHtml(skillFactoryHealthError)}</p>` : ""}
      ${configurableSkillsError ? `<p class="form-warning">Custom skills unavailable: ${escapeHtml(configurableSkillsError)}</p>` : ""}
      ${configurableSkillRunsError ? `<p class="form-warning">Custom skill run history unavailable: ${escapeHtml(configurableSkillRunsError)}</p>` : ""}
      <section class="skills-section">
        <h2>Native Skills</h2>
        <p class="muted">Core legal workflows that ship with the app. Start here before creating custom one-off skills.</p>
        <p class="muted">${matterNote}</p>
        ${renderSkillCards(summary.nativeBuiltins, escapeHtml, { variant: "builtin-list" })}
      </section>
      <section class="skills-section">
        <h2>Your Skills</h2>
        <p class="muted">Skills you created and can run on any active matter. Only the latest approved version is shown as runnable; earlier versions are kept in history.</p>
        ${renderSkillCards(summary.custom, escapeHtml, {
          variant: "active-custom",
          improvementIdeas: skillIdeas?.ideas || [],
          configurableSkillRuns: configurableSkillRuns?.runs || [],
          allCustomSkills: summary.allCustom || summary.custom,
        })}
      </section>
      ${renderSavedIdeas(skillIdeas?.ideas || [], escapeHtml, { compact: true, samplesByIdea: skillIdeaSamplesById })}
      <section class="skills-section">
        <h2>Supporting Tools</h2>
        <p class="muted">Setup, search, and maintenance capabilities that support the native legal skills.</p>
        ${renderBuiltinSkillGroup({
          title: "Setup and readiness",
          description: "Matter setup, document reading, and guarded preparation steps. They support legal skills but should not compete with them.",
          skills: summary.setupBuiltins,
          escape: escapeHtml,
        })}
        ${renderBuiltinSkillGroup({
          title: "Utilities and maintenance",
          description: "Search, context preview, and workspace health tools.",
          skills: summary.utilityBuiltins,
          escape: escapeHtml,
        })}
      </section>
      ${renderSkillFactoryHealth(skillFactoryHealth, escapeHtml, { collapsed: true })}
    </div>
  `;
}

function renderBuiltinSkillGroup({ title, description, skills, escape }) {
  if (!Array.isArray(skills) || !skills.length) return "";
  return `
    <div class="builtin-skill-group">
      <h3>${escape(title)}</h3>
      <p class="muted">${escape(description)}</p>
      ${renderSkillCards(skills, escape, { variant: "builtin-list" })}
    </div>
  `;
}

function renderSkillsStats(summary, ideas, escape) {
  const normalizedIdeas = Array.isArray(ideas) ? ideas : [];
  const activeIdeas = normalizedIdeas.filter((idea) => idea?.status !== "dismissed");
  return `
    <div class="skills-page-counts" aria-label="Skills summary">
      <span>${summary.nativeBuiltins.length} native</span>
      <span>${summary.custom.length} custom</span>
      <span>${activeIdeas.length} ideas</span>
      <span>${summary.hasMatterStatus ? escape(summary.matterName || "Matter selected") : "Planning mode"}</span>
    </div>
  `;
}
