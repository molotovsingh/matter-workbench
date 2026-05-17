import { redactSensitiveText } from "../secret-redaction.js";

export function formatSkillFactoryHealthReport(health = {}) {
  const summary = health.summary || {};
  const issues = Array.isArray(health.issues) ? health.issues : [];
  const checks = Array.isArray(health.checks) ? health.checks : [];
  const lines = [
    "# Skill Factory Health Report",
    "",
    `- State: ${redactSensitiveText(health.state || "unknown")}`,
    `- Checked at: ${redactSensitiveText(health.checkedAt || "Not available")}`,
    `- Ideas: ${summary.ideas ?? 0}`,
    `- Samples: ${summary.samples ?? 0}`,
    `- Stored custom skill records: ${summary.configurableSkills ?? 0}`,
    `- Stored active versions: ${summary.activeSkills ?? 0}`,
    `- Errors: ${summary.errors ?? 0}`,
    `- Warnings: ${summary.warnings ?? 0}`,
    "",
    "## Checks",
    "",
    ...checks.map((check) => `- ${check.state === "ok" ? "[x]" : "[ ]"} ${redactSensitiveText(check.label || check.id || "Check")}`),
    "",
    "## Issues",
    "",
    ...(issues.length
      ? issues.map((issue) => `- ${redactSensitiveText(String(issue.severity || "issue").toUpperCase())}: ${redactSensitiveText(issue.message || issue.code || "Unknown issue")}`)
      : ["- None observed."]),
    "",
    "## Boundary",
    "",
    "This is a read-only health report. It does not repair stores, call providers, generate skills, run skills, or write matter files.",
  ];
  return `${lines.join("\n")}\n`;
}

export function renderSkillFactoryHealth(health, escape, { collapsed = false } = {}) {
  if (!health) {
    const unavailable = `
      <section class="skills-future-card">
        <h2>Skill Factory Health</h2>
        <p class="muted">Health check unavailable.</p>
      </section>
    `;
    return collapsed
      ? `<details class="skills-admin-details"><summary><span>Skill Factory Health</span><span class="pipeline-state not-run">Unknown</span></summary>${unavailable}</details>`
      : unavailable;
  }
  const summary = health.summary || {};
  const state = health.state || "unknown";
  const issues = Array.isArray(health.issues) ? health.issues : [];
  const checks = Array.isArray(health.checks) ? health.checks : [];
  const body = `
    <section class="skills-future-card">
      <div class="skill-card-header">
        <div>
          <h2>Skill Factory Health</h2>
          <p class="muted">Read-only check of saved ideas, samples, and stored skill records.</p>
        </div>
        <span class="pipeline-state ${escape(healthStateClass(state))}">${escape(healthStateLabel(state))}</span>
      </div>
      <dl class="skill-contract skills-summary">
        <div><dt>Ideas</dt><dd>${escape(String(summary.ideas ?? 0))}</dd></div>
        <div><dt>Samples</dt><dd>${escape(String(summary.samples ?? 0))}</dd></div>
        <div><dt>Stored custom skill records</dt><dd>${escape(String(summary.configurableSkills ?? 0))}</dd></div>
        <div><dt>Stored active versions</dt><dd>${escape(String(summary.activeSkills ?? 0))}</dd></div>
        <div><dt>Issues</dt><dd>${escape(`${summary.errors ?? 0} errors / ${summary.warnings ?? 0} warnings`)}</dd></div>
      </dl>
      <div class="skill-idea-readiness">
        <div class="skill-idea-readiness-header">
          <strong>Checks</strong>
          <span class="pipeline-state ${escape(healthStateClass(state))}">${escape(healthStateLabel(state))}</span>
        </div>
        <ul>
          ${checks.slice(0, 8).map((check) => `
            <li class="${check.state === "ok" ? "passed" : "missing"}">
              <span>${check.state === "ok" ? "OK" : "Check"}</span>
              ${escape(check.label || check.id || "Health check")}
            </li>
          `).join("")}
        </ul>
      </div>
      ${issues.length ? `
        <div class="skill-output-list">
          <strong>Issues</strong>
          ${issues.slice(0, 5).map((issue) => `<code>${escape(`${issue.severity || "issue"}: ${issue.message || issue.code || "Unknown issue"}`)}</code>`).join("")}
          ${issues.length > 5 ? `<span class="muted">+${issues.length - 5} more</span>` : ""}
        </div>
      ` : '<p class="muted">No store integrity issues observed.</p>'}
      <div class="form-actions">
        <button type="button" class="secondary" data-skill-factory-copy-health>Copy Health Report</button>
        <span class="artifact-action-status muted" data-skill-factory-copy-health-status></span>
      </div>
    </section>
  `;
  if (!collapsed) return body;
  return `
    <details class="skills-admin-details">
      <summary>
        <span>Skill Factory Health</span>
        <span class="pipeline-state ${escape(healthStateClass(state))}">${escape(healthStateLabel(state))}</span>
      </summary>
      ${body}
    </details>
  `;
}

function healthStateLabel(state) {
  if (state === "ok") return "OK";
  if (state === "warning") return "Warnings";
  if (state === "error") return "Errors";
  return "Unknown";
}

function healthStateClass(state) {
  if (state === "ok") return "present";
  if (state === "warning") return "pending";
  return "not-run";
}
