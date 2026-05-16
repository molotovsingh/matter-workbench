import { escapeHtml } from "./dom-utils.js";
import {
  formatSampleProvider,
  getSampleMatter,
  getSampleMarkdown,
  getSampleState,
  getSampleVersion,
  getSampleWarnings,
  renderSampleLedger,
} from "./skill-sample-review.js";

export function renderSkillReadyHtml(skill = {}) {
  return `
      <h1>Skill Ready</h1>
      <section class="skill-router-result">
        <h2>${escapeHtml(skill.title || "Custom Skill")}</h2>
        <p>You can use this skill by typing <code>${escapeHtml(skill.slash || "")}</code>.</p>
        <dl class="skill-card-meta">
          <div><dt>Status</dt><dd>${escapeHtml(skill.status || "active")}</dd></div>
          <div><dt>Output</dt><dd><code>${escapeHtml(skill.outputArtifact || "")}</code></dd></div>
          <div><dt>Lane</dt><dd><code>${escapeHtml(skill.targetLane || "")}</code></dd></div>
          <div><dt>Version</dt><dd>${escapeHtml(String(skill.version || 1))}</dd></div>
        </dl>
        <p class="muted">Running the skill writes only its configured matter artifact after explicit command execution.</p>
      </section>
    `;
}

export function renderCreatedSkillCommandRailHtml(skill = {}) {
  return `
      <section class="command-interview" aria-live="polite">
        <h3>Skill Ready</h3>
        <p>You can use <code>${escapeHtml(skill.slash || "")}</code> on any selected matter.</p>
        <p class="muted">Switch matters first if you want to run it somewhere else.</p>
        <dl class="skill-card-meta">
          <div><dt>Skill</dt><dd>${escapeHtml(skill.title || "Custom Skill")}</dd></div>
          <div><dt>Output</dt><dd><code>${escapeHtml(skill.outputArtifact || "")}</code></dd></div>
        </dl>
        <div class="command-interview-actions">
          <button type="button" data-created-skill-action="run">Run now</button>
          <button type="button" class="secondary" data-created-skill-action="open-skills">Open Skills</button>
          <button type="button" class="secondary" data-created-skill-action="start-another">Start another idea</button>
        </div>
      </section>
    `;
}

export function renderSkillSampleOutputHtml(sample, { version, approved, sampleReview = {} } = {}) {
  const sampleState = getSampleState(sample);
  const warnings = getSampleWarnings(sample);
  const sampleApproved = approved || sampleState === "approved_current";
  const sampleStale = sampleState === "stale" || sampleState === "approved_stale";
  const statusText = sampleState === "approved_stale"
    ? "Approved earlier, now stale. Regenerate before creating a skill."
    : sampleApproved
      ? "Sample approved. Creation and validation required before the skill is runnable."
      : sampleStale
        ? "Stale after design brief changes. Regenerate before approval."
        : "Awaiting review";
  return `
      <h1>Sample Output</h1>
      <p class="muted">Review sample only. This did not create a runnable skill, prompt, code, slash command, or matter artifact.</p>
      <section class="skill-router-result">
        <h2>Sample v${Number(version || getSampleVersion(sample, 1))}${sampleApproved ? " - approved" : ""}</h2>
        <dl class="skill-card-meta">
          <div><dt>Provider</dt><dd>${escapeHtml(formatSampleProvider(sample))}</dd></div>
          <div><dt>Matter</dt><dd>${escapeHtml(getSampleMatter(sample).matterName || getSampleMatter(sample).folderName || "Selected matter")}</dd></div>
          <div><dt>Status</dt><dd>${escapeHtml(statusText)}</dd></div>
        </dl>
        ${warnings.length ? `
          <div class="sample-warning-list" role="note">
            <strong>Sample warnings</strong>
            <ul>
              ${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
            </ul>
          </div>
        ` : ""}
        <pre class="skill-sample-markdown">${escapeHtml(getSampleMarkdown(sample))}</pre>
        ${renderSampleLedger(sampleReview, { central: true })}
      </section>
    `;
}
