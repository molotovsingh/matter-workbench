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
  skillFactoryHealth = null,
  loadError = "",
  statusError = "",
  skillIdeasError = "",
  skillFactoryHealthError = "",
  configurableSkillsError = "",
  configurableSkillRunsError = "",
  activeMatter = {},
} = {}, escapeHtml) {
  const summary = skillsPageSummary(registry, matterStatus, configurableSkills);
  const matterNote = activeMatter?.folderName
    ? `Status is derived from existing artifacts in <code>${escapeHtml(activeMatter.folderName)}</code>.`
    : "No matter is selected. Showing built-in contracts in planning mode; artifact status appears after you pick a matter.";
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
      <h1>Skills</h1>
      <p>
        Read-only supervision surface for built-in skills. This page describes what each skill can do, where outputs normally live, and whether a selected matter already has the expected artifacts.
      </p>
      <p class="muted">${matterNote}</p>
      ${registryError}
      ${statusWarning}
      ${ideasWarning}
      ${skillFactoryHealthError ? `<p class="form-warning">Skill factory health unavailable: ${escapeHtml(skillFactoryHealthError)}</p>` : ""}
      ${configurableSkillsError ? `<p class="form-warning">Custom skills unavailable: ${escapeHtml(configurableSkillsError)}</p>` : ""}
      ${configurableSkillRunsError ? `<p class="form-warning">Custom skill run history unavailable: ${escapeHtml(configurableSkillRunsError)}</p>` : ""}
      ${renderSkillsStats(summary, escapeHtml)}
      ${renderSkillFactoryHealth(skillFactoryHealth, escapeHtml)}
      ${renderSavedIdeas(skillIdeas?.ideas || [], escapeHtml)}
      <section>
        <h2>Custom Skills</h2>
        <p class="muted">Approved and activated skills created from reviewed samples. The visible skill name includes its version. The slash command stays stable and runs the latest approved version; earlier versions are kept in history.</p>
        ${renderSkillCards(summary.custom, escapeHtml, {
          improvementIdeas: skillIdeas?.ideas || [],
          configurableSkillRuns: configurableSkillRuns?.runs || [],
          allCustomSkills: summary.allCustom || summary.custom,
        })}
      </section>
      <section>
        <h2>Built-in Skills</h2>
        <p class="muted">These are code-backed capabilities. They are not editable from the app.</p>
        ${renderSkillCards(summary.builtins, escapeHtml)}
      </section>
      <section>
        <h2>Paid AI Skills</h2>
        <p class="muted">These may call configured providers. Existing rerun guardrails remain owned by the skill runtime.</p>
        ${renderSkillCards(summary.paidAi, escapeHtml)}
      </section>
      <section>
        <h2>Deterministic Skills</h2>
        <p class="muted">These run locally without provider calls.</p>
        ${renderSkillCards(summary.deterministic, escapeHtml)}
      </section>
      <section class="skills-future-card">
        <h2>Coming Later: Skill Builder Expansion</h2>
        <p>
          The app can show activated custom skills here. Broader editing, rollback, and automated skill-generation workflows remain staged work.
        </p>
        <ul>
          <li>No direct editing of active skill definitions from this page.</li>
          <li>No runnable draft skills.</li>
          <li>No chat, Q&amp;A, provider call, or matter artifact write.</li>
        </ul>
      </section>
    </div>
  `;
}

function renderSkillsStats(summary, escape) {
  return `
    <dl class="skill-contract skills-summary">
      <div>
        <dt>Built-ins</dt>
        <dd>${summary.builtins.length}</dd>
      </div>
      <div>
        <dt>Custom</dt>
        <dd>${summary.custom.length}</dd>
      </div>
      <div>
        <dt>Paid AI</dt>
        <dd>${summary.paidAi.length}</dd>
      </div>
      <div>
        <dt>Deterministic</dt>
        <dd>${summary.deterministic.length}</dd>
      </div>
      <div>
        <dt>Matter status</dt>
        <dd>${summary.hasMatterStatus ? escape(summary.matterName || "Loaded") : "Planning mode"}</dd>
      </div>
    </dl>
  `;
}
