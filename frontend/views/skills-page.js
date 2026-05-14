import { formatSkillIdeaImplementationBriefMarkdown } from "../skill-idea-implementation-brief.js";
import { formatConfigurableRunOutputDocumentState } from "../configurable-skill-run-labels.js";

export function skillsPageSummary(registry = {}, matterStatus = null, configurableSkills = null) {
  const skills = Array.isArray(registry.skills) ? registry.skills : [];
  const configuredSkills = Array.isArray(configurableSkills?.skills)
    ? configurableSkills.skills.map(configurableSkillToCard)
    : [];
  const stages = Array.isArray(matterStatus?.stages) ? matterStatus.stages : [];
  const statusBySlash = new Map(stages.map((stage) => [stage.slash, stage]));
  const withStatus = skills.map((skill) => ({
    ...skill,
    artifactStatus: statusBySlash.get(skill.slash) || null,
  }));
  const builtins = withStatus.filter((skill) => !skill.configurable);
  const registryCustom = withStatus.filter((skill) => skill.configurable);
  const customSource = configuredSkills.length ? configuredSkills : registryCustom;
  const allCustom = markPrimaryCustomSkills(customSource.map((skill) => ({
    ...skill,
    artifactStatus: statusBySlash.get(skill.slash) || skill.artifactStatus || null,
  }))).sort(compareCustomSkills);
  const custom = allCustom.filter((skill) => skill.primary !== false);
  return {
    builtins,
    custom,
    allCustom,
    deterministic: builtins.filter((skill) => String(skill.mode || "").toLowerCase() !== "ai"),
    paidAi: builtins.filter((skill) => skill.paid_provider_call || String(skill.mode || "").toLowerCase() === "ai"),
    matterName: matterStatus?.matterName || "",
    hasMatterStatus: Boolean(matterStatus),
  };
}

export function formatSkillIdeaReviewPacket(idea = {}, registry = {}) {
  const status = normalizeIdeaStatusForView(idea.status);
  const brief = normalizeDesignBriefForView(idea.designBrief);
  const readiness = normalizeReadinessForView(idea.readiness, brief);
  const classification = classifySkillIdeaForReview(idea, registry);
  const matter = idea.matter || {};
  const openQuestions = buildSkillIdeaOpenQuestions({ brief, readiness });
  const statusText = reviewPacketStatusText(status, readiness);
  const checklistText = readiness.ready
    ? "Complete"
    : `Incomplete ${readiness.passedCount}/${readiness.totalCount}`;
  const lines = [
    "# Skill Idea Review Packet",
    "",
    `- Idea id: ${packetValue(idea.id)}`,
    `- Status: ${statusText}`,
    `- Checklist: ${checklistText}`,
    `- Suggested classification: ${classification}`,
    `- Matter: ${packetValue(matter.matterName || matter.folderName)}`,
    `- Matter folder: ${packetValue(matter.folderName)}`,
    "",
    "## Original User Text",
    "",
    packetBlock(idea.text),
    "",
    "## Design Brief",
    "",
    `- Intended user: ${packetValue(brief.intendedUser)}`,
    `- Problem / job to be done: ${packetValue(brief.problem)}`,
    `- Expected inputs: ${packetValue(brief.expectedInputs)}`,
    `- Expected output artifact: ${packetValue(brief.expectedOutputArtifact)}`,
    `- Target lane: ${packetValue(brief.targetLane)}`,
    `- Paid/free posture: ${packetValue(brief.paidPosture)}`,
    `- Risk level: ${packetValue(brief.riskLevel)}`,
    "",
    "## Interview Answers / Notes",
    "",
    packetBlock(brief.notes),
    "",
    "## Readiness Checklist",
    "",
    ...readiness.items.map((item) => `- ${item.passed ? "[x]" : "[ ]"} ${item.label}`),
    "",
    "## Open Questions",
    "",
    ...openQuestions.map((question) => `- ${question}`),
    "",
    "## Boundary",
    "",
    "This is not a runnable skill. No prompt, code, or provider call has been generated.",
  ];
  return `${lines.join("\n")}\n`;
}

export function formatSkillIdeaImplementationBrief(idea = {}, registry = {}) {
  return formatSkillIdeaImplementationBriefMarkdown(idea, registry);
}

export function formatSkillFactoryHealthReport(health = {}) {
  const summary = health.summary || {};
  const issues = Array.isArray(health.issues) ? health.issues : [];
  const checks = Array.isArray(health.checks) ? health.checks : [];
  const lines = [
    "# Skill Factory Health Report",
    "",
    `- State: ${health.state || "unknown"}`,
    `- Checked at: ${health.checkedAt || "Not available"}`,
    `- Ideas: ${summary.ideas ?? 0}`,
    `- Samples: ${summary.samples ?? 0}`,
    `- Configurable skills: ${summary.configurableSkills ?? 0}`,
    `- Active skills: ${summary.activeSkills ?? 0}`,
    `- Errors: ${summary.errors ?? 0}`,
    `- Warnings: ${summary.warnings ?? 0}`,
    "",
    "## Checks",
    "",
    ...checks.map((check) => `- ${check.state === "ok" ? "[x]" : "[ ]"} ${check.label || check.id || "Check"}`),
    "",
    "## Issues",
    "",
    ...(issues.length
      ? issues.map((issue) => `- ${String(issue.severity || "issue").toUpperCase()}: ${issue.message || issue.code || "Unknown issue"}`)
      : ["- None observed."]),
    "",
    "## Boundary",
    "",
    "This is a read-only health report. It does not repair stores, call providers, generate skills, run skills, or write matter artifacts.",
  ];
  return `${lines.join("\n")}\n`;
}

export function formatConfigurableSkillRunReport(run = {}) {
  const outputPaths = run.outputPaths || {};
  const aiRun = run.aiRun || {};
  const lines = [
    "# Custom Skill Run Report",
    "",
    `- Run id: ${packetValue(run.id)}`,
    `- Skill: ${packetValue(run.title || run.slash)}`,
    `- Slash command: ${packetValue(run.slash)}`,
    `- Status: ${packetValue(run.status)}`,
    `- Matter: ${packetValue(run.matterName)}`,
    `- Matter folder: ${packetValue(run.matterFolder)}`,
    `- Started: ${packetValue(run.startedAt)}`,
    `- Finished: ${packetValue(run.finishedAt)}`,
    `- Provider/model: ${packetValue([aiRun.provider, aiRun.model].filter(Boolean).join(" / "))}`,
    `- Output document: ${packetValue(formatConfigurableRunOutputDocumentState(run.overwrite))}`,
    "",
    "## Output Paths",
    "",
    `- Markdown: ${packetValue(outputPaths.markdown)}`,
    `- Metadata: ${packetValue(outputPaths.json)}`,
    "",
    "## Warnings",
    "",
    ...(Array.isArray(run.warnings) && run.warnings.length
      ? run.warnings.map((warning) => `- ${warning}`)
      : ["- None."]),
    "",
    "## Error",
    "",
    run.errorMessage ? `- ${run.errorMessage}` : "- None.",
    "",
    "## Boundary",
    "",
    "This report contains run metadata only. It does not include raw source text, full extraction records, prompts, API keys, or generated Markdown body.",
  ];
  return `${lines.join("\n")}\n`;
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
        <p class="muted">Approved and activated skills created from reviewed samples. Draft or disabled custom skills are not runnable.</p>
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

function renderSkillFactoryHealth(health, escape) {
  if (!health) {
    return `
      <section class="skills-future-card">
        <h2>Skill Factory Health</h2>
        <p class="muted">Health check unavailable.</p>
      </section>
    `;
  }
  const summary = health.summary || {};
  const state = health.state || "unknown";
  const issues = Array.isArray(health.issues) ? health.issues : [];
  const checks = Array.isArray(health.checks) ? health.checks : [];
  return `
    <section class="skills-future-card">
      <div class="skill-card-header">
        <div>
          <h2>Skill Factory Health</h2>
          <p class="muted">Read-only check of saved ideas, samples, and active custom skills.</p>
        </div>
        <span class="pipeline-state ${escape(healthStateClass(state))}">${escape(healthStateLabel(state))}</span>
      </div>
      <dl class="skill-contract skills-summary">
        <div><dt>Ideas</dt><dd>${escape(String(summary.ideas ?? 0))}</dd></div>
        <div><dt>Samples</dt><dd>${escape(String(summary.samples ?? 0))}</dd></div>
        <div><dt>Custom skills</dt><dd>${escape(String(summary.configurableSkills ?? 0))}</dd></div>
        <div><dt>Active</dt><dd>${escape(String(summary.activeSkills ?? 0))}</dd></div>
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
}

function renderSavedIdeas(ideas, escape) {
  const normalized = Array.isArray(ideas) ? ideas : [];
  return `
    <section>
      <h2>Saved Ideas</h2>
      <p class="muted">Non-running idea inbox for possible future skills. These records do not create slash commands, draft skills, provider calls, or runnable skills.</p>
      ${normalized.length ? `
        <div class="skills-grid">
          ${normalized.map((idea) => renderSavedIdeaCard(idea, escape)).join("")}
        </div>
      ` : '<p class="muted">No saved skill ideas yet. Use the Command rail with text like <code>create a skill to summarize pleadings</code>.</p>'}
    </section>
  `;
}

function renderSavedIdeaCard(idea, escape) {
  const status = normalizeIdeaStatusForView(idea.status);
  const matter = idea.matter || {};
  const matterLabel = matter.matterName || matter.folderName || "No matter attached";
  const brief = normalizeDesignBriefForView(idea.designBrief);
  const readiness = normalizeReadinessForView(idea.readiness, brief);
  const canMarkReady = readiness.ready && status !== "ready_for_review" && status !== "dismissed";
  return `
    <article class="skill-card skill-idea-card" id="skill-idea-${escape(idea.id || "")}">
      <div class="skill-card-header">
        <div>
          <div class="skill-slash"><code>proposal</code></div>
          <h3>Saved Skill Idea</h3>
        </div>
        <span class="pipeline-state ${escape(statusClass(status))}">${escape(statusLabel(status))}</span>
      </div>
      <p class="muted">Original idea</p>
      <p>${escape(idea.text || "")}</p>
      <dl class="skill-card-meta">
        <div><dt>Created</dt><dd>${escape(idea.createdAt || "")}</dd></div>
        <div><dt>Matter</dt><dd>${escape(matterLabel)}</dd></div>
        <div><dt>Folder</dt><dd>${escape(matter.folderName || "None")}</dd></div>
        <div><dt>Runtime</dt><dd>Not runnable</dd></div>
      </dl>
      <details class="skill-idea-brief">
        <summary>Design brief <span class="muted">Not runnable yet</span></summary>
        <p class="muted">
          Capture the intended shape of this possible future skill. Saving this brief does not generate prompts, code, draft skills, provider calls, runnable skills, or matter artifacts.
        </p>
        <form class="skill-idea-brief-form" data-skill-idea-brief-form data-skill-idea-id="${escape(idea.id || "")}">
          <label>
            <span>Intended user</span>
            <input type="text" name="intendedUser" value="${escape(brief.intendedUser)}" autocomplete="off" />
          </label>
          <label>
            <span>Problem / job to be done</span>
            <textarea name="problem">${escape(brief.problem)}</textarea>
          </label>
          <label>
            <span>Expected inputs</span>
            <textarea name="expectedInputs">${escape(brief.expectedInputs)}</textarea>
          </label>
          <label>
            <span>Expected output artifact</span>
            <input type="text" name="expectedOutputArtifact" value="${escape(brief.expectedOutputArtifact)}" autocomplete="off" />
          </label>
          <div class="skill-idea-brief-grid">
            ${renderSelectField({
              name: "targetLane",
              label: "Target lane",
              value: brief.targetLane,
              options: [
                ["", "Not chosen"],
                ["10_Library", "10_Library - Analysis Library"],
                ["20_Workshop", "20_Workshop - Strategy Workshop"],
                ["30_Drafts", "30_Drafts - Drafts"],
                ["40_Dispatch", "40_Dispatch - Dispatch"],
              ],
            }, escape)}
            ${renderSelectField({
              name: "paidPosture",
              label: "Paid/free posture",
              value: brief.paidPosture,
              options: [
                ["", "Not chosen"],
                ["free", "Free/local"],
                ["paid", "Paid/provider-backed"],
                ["unknown", "Unknown"],
              ],
            }, escape)}
            ${renderSelectField({
              name: "riskLevel",
              label: "Risk level",
              value: brief.riskLevel,
              options: [
                ["", "Not assessed"],
                ["low", "Low"],
                ["medium", "Medium"],
                ["high", "High"],
              ],
            }, escape)}
          </div>
          <label>
            <span>Notes / acceptance criteria</span>
            <textarea name="notes">${escape(brief.notes)}</textarea>
          </label>
          <div class="form-actions">
            <button type="submit">Save design brief</button>
          </div>
        </form>
      </details>
      ${renderReadinessChecklist(readiness, escape)}
      <div class="form-actions">
        <button type="button" class="secondary" data-skill-idea-copy-packet data-skill-idea-id="${escape(idea.id || "")}">Copy Review Packet</button>
        <button type="button" class="secondary" data-skill-idea-copy-implementation-brief data-skill-idea-id="${escape(idea.id || "")}">Copy Implementation Brief</button>
        <button type="button" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="ready_for_review"${canMarkReady ? "" : " disabled"} title="${readiness.ready ? "Mark this design brief ready for human review." : "Complete every readiness item before marking ready."}">Mark ready for review</button>
        <button type="button" class="secondary" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="parked"${status === "parked" || status === "dismissed" ? " disabled" : ""}>Park idea</button>
        <button type="button" class="secondary" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="dismissed"${status === "dismissed" ? " disabled" : ""}>Dismiss</button>
        <span class="artifact-action-status muted" data-skill-idea-copy-status="${escape(idea.id || "")}"></span>
      </div>
    </article>
  `;
}

function statusLabel(status) {
  if (status === "ready_for_review") return "Ready for review";
  if (status === "parked") return "Parked";
  if (status === "dismissed") return "Dismissed";
  return "Incomplete";
}

function reviewPacketStatusText(status, readiness) {
  const label = statusLabel(status);
  if (status === "incomplete" && readiness.ready) {
    return `${label} - ready to mark for review`;
  }
  return label;
}

function statusClass(status) {
  if (status === "dismissed") return "not-run";
  if (status === "ready_for_review") return "present";
  return "pending";
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

function normalizeIdeaStatusForView(status) {
  if (status === "proposed") return "incomplete";
  if (status === "marked_for_future") return "parked";
  if (["incomplete", "ready_for_review", "parked", "dismissed"].includes(status)) return status;
  return "incomplete";
}

function normalizeDesignBriefForView(designBrief = {}) {
  return {
    intendedUser: designBrief.intendedUser || "",
    problem: designBrief.problem || "",
    expectedInputs: designBrief.expectedInputs || "",
    expectedOutputArtifact: designBrief.expectedOutputArtifact || "",
    targetLane: designBrief.targetLane || "",
    paidPosture: designBrief.paidPosture || "",
    riskLevel: designBrief.riskLevel || "",
    notes: designBrief.notes || "",
  };
}

function renderSelectField({ name, label, value, options }, escape) {
  return `
    <label>
      <span>${escape(label)}</span>
      <select name="${escape(name)}">
        ${options.map(([optionValue, optionLabel]) => `
          <option value="${escape(optionValue)}"${optionValue === value ? " selected" : ""}>${escape(optionLabel)}</option>
        `).join("")}
      </select>
    </label>
  `;
}

function normalizeReadinessForView(readiness, brief) {
  if (readiness && Array.isArray(readiness.items)) {
    return {
      state: readiness.state || (readiness.ready ? "ready_for_review" : "incomplete"),
      ready: Boolean(readiness.ready),
      passedCount: Number(readiness.passedCount || 0),
      totalCount: Number(readiness.totalCount || readiness.items.length),
      items: readiness.items.map((item) => ({
        key: item.key || "",
        label: item.label || item.key || "Readiness item",
        passed: Boolean(item.passed),
      })),
    };
  }
  const items = [
    ["intendedUser", "Intended user present"],
    ["problem", "Problem/job present"],
    ["expectedInputs", "Expected inputs present"],
    ["expectedOutputArtifact", "Expected output artifact present"],
    ["targetLane", "Target lane selected"],
    ["paidPosture", "Paid/free posture selected"],
    ["riskLevel", "Risk level selected"],
    ["notes", "Notes or acceptance criteria present"],
  ].map(([key, label]) => ({
    key,
    label,
    passed: Boolean(brief[key]),
  }));
  const passedCount = items.filter((item) => item.passed).length;
  const ready = passedCount === items.length;
  return {
    state: ready ? "ready_for_review" : "incomplete",
    ready,
    passedCount,
    totalCount: items.length,
    items,
  };
}

function classifySkillIdeaForReview(idea, registry) {
  const primaryText = `${idea?.text || ""}\n${idea?.designBrief?.problem || ""}\n${idea?.designBrief?.expectedOutputArtifact || ""}`;
  const notes = String(idea?.designBrief?.notes || "");
  const targetSkill = extractTargetSkill(notes) || extractTargetSkill(primaryText);
  const knownSlashes = new Set((Array.isArray(registry?.skills) ? registry.skills : [])
    .map((skill) => skill.slash)
    .filter(Boolean));
  if (targetSkill && knownSlashes.has(targetSkill)) return `modification candidate (${targetSkill})`;
  if (targetSkill) return `adjacent skill improvement (${targetSkill})`;
  if (/\b(list\s+of\s+dates|chronolog|timeline|describe\s+sources|source\s+labels?|context\s+search|find|search)\b/i.test(primaryText)) {
    return "adjacent skill improvement";
  }
  return "new skill idea";
}

function extractTargetSkill(text) {
  const match = String(text || "").match(/\bTarget skill:\s*(\/[a-z0-9_-]+)/i);
  return match?.[1] || "";
}

function buildSkillIdeaOpenQuestions({ brief, readiness }) {
  const questions = readiness.items
    .filter((item) => !item.passed)
    .map((item) => `Complete readiness item: ${item.label}.`);
  if (brief.paidPosture === "unknown") questions.push("Confirm whether this should be free/local or paid/provider-backed.");
  if (!brief.expectedOutputArtifact) questions.push("Confirm the durable output artifact, if any.");
  if (!brief.targetLane) questions.push("Confirm the target workspace lane.");
  return questions.length ? questions : ["None from the readiness checklist."];
}

function packetValue(value) {
  const normalized = String(value || "").trim();
  return normalized || "Not specified";
}

function packetBlock(value) {
  const normalized = String(value || "").trim();
  return normalized || "Not specified";
}

function renderReadinessChecklist(readiness, escape) {
  return `
    <div class="skill-idea-readiness">
      <div class="skill-idea-readiness-header">
        <strong>Readiness checklist</strong>
        <span class="pipeline-state ${readiness.ready ? "present" : "pending"}">${readiness.ready ? "Ready for review" : `Incomplete ${readiness.passedCount}/${readiness.totalCount}`}</span>
      </div>
      <ul>
        ${readiness.items.map((item) => `
          <li class="${item.passed ? "passed" : "missing"}">
            <span>${item.passed ? "OK" : "Missing"}</span>
            ${escape(item.label)}
          </li>
        `).join("")}
      </ul>
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

function renderSkillCards(skills, escape, { improvementIdeas = [], configurableSkillRuns = [], allCustomSkills = null } = {}) {
  if (!skills.length) return '<p class="muted">No skills in this section.</p>';
  const customSkillContext = Array.isArray(allCustomSkills) ? allCustomSkills : skills;
  return `
    <div class="skills-grid">
      ${skills.map((skill) => renderSkillCard(skill, escape, { improvementIdeas, configurableSkillRuns, allCustomSkills: customSkillContext })).join("")}
    </div>
  `;
}

function renderSkillCard(skill, escape, { improvementIdeas = [], configurableSkillRuns = [], allCustomSkills = [] } = {}) {
  const status = skill.artifactStatus;
  const state = skill.configurable
    ? customSkillDisplayStatusLabel(skill)
    : status
    ? status.present
      ? "Present"
      : "Not run"
    : skill.matter_required
      ? "No artifact status"
      : "Workspace-level";
  const stateClass = skill.configurable ? customSkillDisplayStatusClass(skill) : status?.present ? "present" : "not-run";
  const outputs = Array.isArray(skill.outputs) && skill.outputs.length
    ? skill.outputs
    : ["No durable output declared"];
  const upstream = Array.isArray(skill.upstream) && skill.upstream.length
    ? skill.upstream.join(", ")
    : "None";
  const provider = skill.paid_provider_call ? "Paid/provider-backed" : "Deterministic/local";
  const rerun = skill.rerun_guarded ? "Rerun guarded" : "No rerun guard";
  const artifacts = Array.isArray(status?.artifacts) ? status.artifacts : [];

  return `
    <article class="skill-card">
      <div class="skill-card-header">
        <div>
          <div class="skill-slash"><code>${escape(skill.slash || "")}</code></div>
          <h3>${escape(skill.title || skill.id || skill.slash || "Skill")}</h3>
        </div>
        <span class="pipeline-state ${escape(stateClass)}">${escape(state)}</span>
      </div>
      <p>${escape(skill.purpose || "No description provided.")}</p>
      <dl class="skill-card-meta">
        <div><dt>Mode</dt><dd>${escape(skill.mode || "")}</dd></div>
        <div><dt>Provider</dt><dd>${escape(provider)}</dd></div>
        <div><dt>Matter</dt><dd>${skill.matter_required ? "Required" : "Not required"}</dd></div>
        <div><dt>Rerun</dt><dd>${escape(rerun)}</dd></div>
        <div><dt>Lane</dt><dd>${skill.default_lane ? `<code>${escape(skill.default_lane)}</code>` : '<span class="muted">None</span>'}</dd></div>
        <div><dt>Runner</dt><dd><code>${escape(skill.runner_key || "")}</code></dd></div>
        <div><dt>Upstream</dt><dd>${escape(upstream)}</dd></div>
        ${skill.configurable ? `<div><dt>Version</dt><dd>${escape(customSkillVersionLabel(skill))}</dd></div>` : ""}
        ${skill.configurable && skill.previous_skill_id ? `<div><dt>Previous</dt><dd>${escape(customSkillLinkedVersionLabel(skill.previous_skill_id, allCustomSkills))}</dd></div>` : ""}
        ${skill.configurable && skill.replaced_by_skill_id ? `<div><dt>Replaced by</dt><dd>${escape(customSkillLinkedVersionLabel(skill.replaced_by_skill_id, allCustomSkills))}</dd></div>` : ""}
      </dl>
      <div class="skill-output-list">
        <strong>Outputs</strong>
        ${outputs.slice(0, 5).map((output) => `<code>${escape(output)}</code>`).join("")}
        ${outputs.length > 5 ? `<span class="muted">+${outputs.length - 5} more</span>` : ""}
      </div>
      ${artifacts.length ? `
        <div class="skill-output-list">
          <strong>Current artifacts</strong>
          ${artifacts.slice(0, 5).map((artifact) => `<code>${escape(artifact)}</code>`).join("")}
          ${artifacts.length > 5 ? `<span class="muted">+${artifacts.length - 5} more</span>` : ""}
        </div>
      ` : ""}
      ${skill.configurable ? renderCustomSkillVersionHistory(skill, allCustomSkills, improvementIdeas, configurableSkillRuns, escape) : ""}
      ${skill.configurable && skill.status === "active" ? renderCustomSkillImprovementIdeas(skill, improvementIdeas, escape) : ""}
      ${renderAiRun(status?.aiRun, escape)}
    </article>
  `;
}

function renderCustomSkillVersionHistory(skill, allCustomSkills, ideas, runs, escape) {
  const versions = customSkillFamilyVersions(skill, allCustomSkills);
  if (!versions.length) return "";
  const activeVersion = versions.find((candidate) => candidate.status === "active") || versions[0];
  const familyRuns = customSkillRunsForFamily(skill, versions, runs);
  const latestRun = familyRuns[0] || null;
  return `
    <details class="skill-output-list custom-skill-version-history" ${skill.status === "active" ? "open" : ""}>
      <summary>
        <strong>Version history</strong>
        <span class="pipeline-state ${escape(customSkillDisplayStatusClass(activeVersion))}">${escape(`${customSkillVersionLabel(activeVersion)} ${customSkillDisplayStatusLabel(activeVersion).toLowerCase()}`)}</span>
      </summary>
      <p class="muted">
        Latest runnable version: <code>${escape(activeVersion.slash || skill.slash || "")}</code>.
        Improve it by typing <code>${escape(`${activeVersion.slash || skill.slash || ""} modify`)}</code> in Quick Actions.
      </p>
      <dl class="skill-card-meta compact">
        <div><dt>Latest run</dt><dd>${escape(latestRun ? `${latestRun.matterName || latestRun.matterFolder || "Unknown matter"} - ${runStatusLabel(latestRun.status)}` : "No runs recorded")}</dd></div>
        <div><dt>Latest output</dt><dd>${latestRun?.outputPaths?.markdown ? `<code>${escape(latestRun.outputPaths.markdown)}</code>` : '<span class="muted">None yet</span>'}</dd></div>
      </dl>
      <ol class="custom-skill-version-list">
        ${versions.map((version) => renderCustomSkillVersionItem(version, ideas, runs, escape)).join("")}
      </ol>
    </details>
  `;
}

function renderCustomSkillVersionItem(skill, ideas, runs, escape) {
  const idea = findIdeaById(ideas, skill.source_idea_id || skill.sourceIdeaId);
  const latestRun = latestRunForSkill(skill, runs);
  const reason = customSkillVersionReason(skill, idea);
  return `
    <li class="custom-skill-version-item ${escape(customSkillDisplayStatusClass(skill))}">
      <div class="skill-card-header">
        <div>
          <strong>${escape(customSkillVersionLabel(skill))} - ${escape(customSkillDisplayStatusLabel(skill))}</strong>
          <p>${escape(reason)}</p>
        </div>
        <span class="pipeline-state ${escape(customSkillDisplayStatusClass(skill))}">${escape(customSkillDisplayStatusLabel(skill))}</span>
      </div>
      <dl class="skill-card-meta compact">
        <div><dt>Sample</dt><dd>${skill.source_sample_id ? `<code>${escape(skill.source_sample_id)}</code>` : '<span class="muted">Unknown</span>'}</dd></div>
        <div><dt>Review matter</dt><dd>${escape(ideaMatterLabel(idea))}</dd></div>
        <div><dt>Activated</dt><dd>${escape(skill.activated_at || skill.activatedAt || "Not activated")}</dd></div>
        <div><dt>Validation</dt><dd>${escape(skill.validation?.status || "Unknown")}</dd></div>
        <div><dt>Last run</dt><dd>${escape(latestRun ? `${latestRun.matterName || latestRun.matterFolder || "Unknown matter"} - ${runStatusLabel(latestRun.status)}` : "No runs recorded")}</dd></div>
      </dl>
    </li>
  `;
}

function renderCustomSkillImprovementIdeas(skill, ideas, escape) {
  const linkedIdeas = findLinkedImprovementIdeas(skill, ideas)
    .filter((idea) => normalizeIdeaStatusForView(idea.status) !== "dismissed")
    .slice(0, 3);
  if (!linkedIdeas.length) {
    return `
      <div class="skill-output-list">
        <strong>Suggested improvements</strong>
        <span class="muted">None saved yet. Run the skill, then type <code>${escape(skill.slash || "")} modify</code> to suggest a revision.</span>
      </div>
    `;
  }
  return `
    <div class="skill-output-list skill-improvement-list">
      <strong>Suggested improvements</strong>
      ${linkedIdeas.map((idea) => renderCustomSkillImprovementIdea(skill, idea, escape)).join("")}
    </div>
  `;
}

function configurableSkillToCard(skill = {}) {
  return {
    schema_version: skill.schema_version || "configurable-skill/v1",
    id: skill.id || "",
    slash: skill.slash || "",
    title: skill.title || skill.slash || "Custom Skill",
    category: "Analyze",
    mode: "AI",
    purpose: skill.description || "",
    matter_required: skill.matterRequired !== false,
    paid_provider_call: skill.paidProviderCall !== false,
    rerun_guarded: true,
    source_backed: skill.sourceBacked || "required",
    inputs: ["matter-context-packet/v1"],
    outputs: skill.outputArtifact ? [skill.outputArtifact] : [],
    upstream: [skill.sourceIdeaId, skill.sourceSampleId].filter(Boolean),
    downstream: [],
    default_lane: skill.targetLane || "",
    runner_key: skill.slash || "",
    version: Number.isInteger(skill.version) ? skill.version : 1,
    family_id: skill.familyId || skill.id || "",
    previous_skill_id: skill.previousSkillId || "",
    replaced_by_skill_id: skill.replacedBySkillId || "",
    superseded_at: skill.supersededAt || "",
    source_idea_id: skill.sourceIdeaId || "",
    source_sample_id: skill.sourceSampleId || "",
    validation: skill.validation || null,
    created_at: skill.createdAt || "",
    updated_at: skill.updatedAt || "",
    activated_at: skill.activatedAt || "",
    configurable: true,
    status: skill.status || "draft",
  };
}

function compareCustomSkills(a, b) {
  const statusRank = { active: 0, draft: 1, disabled: 2 };
  const leftStatus = statusRank[a.status] ?? 9;
  const rightStatus = statusRank[b.status] ?? 9;
  if (leftStatus !== rightStatus) return leftStatus - rightStatus;
  if (a.primary !== b.primary) return a.primary === false ? 1 : -1;
  const leftSlash = String(a.slash || "");
  const rightSlash = String(b.slash || "");
  if (leftSlash !== rightSlash) return leftSlash.localeCompare(rightSlash);
  return Number(b.version || 0) - Number(a.version || 0);
}

function markPrimaryCustomSkills(skills = []) {
  const byKey = new Map();
  const normalized = skills.map((skill) => ({ ...skill, primary: true }));
  for (const skill of normalized) {
    if (skill.status !== "active") continue;
    const key = customSkillGroupingKey(skill);
    const current = byKey.get(key);
    if (!current || comparePrimaryCustomSkill(skill, current) < 0) {
      byKey.set(key, skill);
    }
  }
  const primaryIds = new Set([...byKey.values()].map((skill) => skill.id || skill.slash));
  return normalized.map((skill) => ({
    ...skill,
    primary: skill.status === "active" ? primaryIds.has(skill.id || skill.slash) : false,
  }));
}

function customSkillGroupingKey(skill = {}) {
  const familyId = skill.family_id || skill.familyId || "";
  const hasExplicitLineage = Boolean(
    skill.previous_skill_id
    || skill.previousSkillId
    || skill.replaced_by_skill_id
    || skill.replacedBySkillId
    || (familyId && familyId !== skill.id),
  );
  if (hasExplicitLineage) return `family:${familyId || skill.id || skill.slash || ""}`;
  return [
    "signature",
    normalizeComparableText(skill.title),
    normalizeComparableText((Array.isArray(skill.outputs) ? skill.outputs[0] : skill.outputArtifact) || ""),
    normalizeComparableText(skill.default_lane || skill.targetLane || ""),
  ].join(":");
}

function comparePrimaryCustomSkill(left = {}, right = {}) {
  const leftVersion = Number(left.version || 0);
  const rightVersion = Number(right.version || 0);
  if (leftVersion !== rightVersion) return rightVersion - leftVersion;
  const leftTime = left.activated_at || left.activatedAt || left.updated_at || left.updatedAt || left.created_at || left.createdAt || "";
  const rightTime = right.activated_at || right.activatedAt || right.updated_at || right.updatedAt || right.created_at || right.createdAt || "";
  if (leftTime !== rightTime) return String(rightTime).localeCompare(String(leftTime));
  const leftId = left.id || "";
  const rightId = right.id || "";
  if (leftId !== rightId) return String(rightId).localeCompare(String(leftId));
  return String(left.slash || "").localeCompare(String(right.slash || ""));
}

function normalizeComparableText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function customSkillVersionLabel(skill = {}) {
  const version = Number(skill.version || 1);
  return `v${Number.isFinite(version) && version > 0 ? version : 1}`;
}

function customSkillLinkedVersionLabel(skillId, allCustomSkills) {
  const linked = Array.isArray(allCustomSkills)
    ? allCustomSkills.find((skill) => skill.id === skillId)
    : null;
  if (!linked) return skillId || "Unknown";
  return `${customSkillVersionLabel(linked)} (${linked.status || "unknown"})`;
}

function customSkillFamilyVersions(skill, allCustomSkills) {
  const familyId = customSkillGroupingKey(skill);
  const ids = new Set([familyId, skill.id, skill.previous_skill_id, skill.replaced_by_skill_id].filter(Boolean));
  const versions = Array.isArray(allCustomSkills)
    ? allCustomSkills.filter((candidate) => {
      const candidateFamily = customSkillGroupingKey(candidate);
      return candidateFamily === familyId || ids.has(candidate.id) || ids.has(candidate.previous_skill_id) || ids.has(candidate.replaced_by_skill_id);
    })
    : [skill];
  return versions
    .filter(Boolean)
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
}

function customSkillRunsForFamily(skill, versions, runs) {
  const versionIds = new Set(versions.map((version) => version.id).filter(Boolean));
  const slashes = new Set(versions.map((version) => version.slash).filter(Boolean));
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => versionIds.has(run.skillId) || slashes.has(run.slash) || run.slash === skill.slash)
    .sort((a, b) => String(b.startedAt || b.finishedAt || "").localeCompare(String(a.startedAt || a.finishedAt || "")));
}

function latestRunForSkill(skill, runs) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run.skillId === skill.id || (skill.status === "active" && run.slash === skill.slash))
    .sort((a, b) => String(b.startedAt || b.finishedAt || "").localeCompare(String(a.startedAt || a.finishedAt || "")))[0] || null;
}

function customSkillVersionReason(skill, idea) {
  if (idea) {
    const changeText = improvementIdeaChangeText(skill, idea);
    if (changeText) return changeText;
    if (idea.text) return idea.text;
    if (idea.designBrief?.problem) return idea.designBrief.problem;
  }
  if (skill.previous_skill_id || skill.previousSkillId) {
    return "Created from an approved revised sample for this skill.";
  }
  return "Created from the first approved sample for this skill.";
}

function findIdeaById(ideas, ideaId) {
  if (!ideaId || !Array.isArray(ideas)) return null;
  return ideas.find((idea) => idea.id === ideaId) || null;
}

function ideaMatterLabel(idea) {
  const matter = idea?.matter || {};
  return matter.matterName || matter.folderName || "Not recorded";
}

function runStatusLabel(status) {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "running") return "Running";
  return status || "Unknown";
}

function renderCustomSkillImprovementIdea(skill, idea, escape) {
  const status = normalizeIdeaStatusForView(idea.status);
  const matter = idea.matter || {};
  const matterLabel = matter.matterName || matter.folderName || "No matter attached";
  const changeText = improvementIdeaChangeText(skill, idea);
  return `
    <div class="skill-improvement-item">
      <div class="skill-card-header">
        <div>
          <span class="muted">Suggested improvement</span>
          <p>${escape(changeText || idea.text || "")}</p>
        </div>
        <span class="pipeline-state ${escape(statusClass(status))}">${escape(statusLabel(status))}</span>
      </div>
      <dl class="skill-card-meta">
        <div><dt>Matter</dt><dd>${escape(matterLabel)}</dd></div>
        <div><dt>Created</dt><dd>${escape(idea.createdAt || "")}</dd></div>
      </dl>
      <div class="form-actions">
        <a class="button secondary" href="#skill-idea-${escape(idea.id || "")}">Open idea</a>
        <button type="button" class="secondary" data-skill-idea-copy-packet data-skill-idea-id="${escape(idea.id || "")}">Copy review packet</button>
        <button type="button" class="secondary" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="dismissed"${status === "dismissed" ? " disabled" : ""}>Dismiss</button>
      </div>
    </div>
  `;
}

function findLinkedImprovementIdeas(skill, ideas) {
  const slash = String(skill?.slash || "").trim();
  if (!slash || !Array.isArray(ideas)) return [];
  return ideas
    .filter((idea) => improvementIdeaTargetsSkill(idea, slash))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function improvementIdeaTargetsSkill(idea, slash) {
  const text = String(idea?.text || "");
  const notes = String(idea?.designBrief?.notes || "");
  const target = extractTargetSkill(notes) || extractTargetSkill(text);
  if (target && target === slash) return true;
  const escapedSlash = slash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*Improve\\s+${escapedSlash}\\s*:`, "i").test(text);
}

function improvementIdeaChangeText(skill, idea) {
  const slash = String(skill?.slash || "").trim();
  const text = String(idea?.text || "").trim();
  if (slash && text.toLowerCase().startsWith(`improve ${slash.toLowerCase()}:`)) {
    return text.slice(`Improve ${slash}:`.length).trim();
  }
  const notes = String(idea?.designBrief?.notes || "");
  const match = notes.match(/\bWhat should change:\s*([^\n]+)/i);
  return match?.[1]?.trim() || text;
}

function customSkillStatusLabel(status) {
  if (status === "active") return "Active";
  if (status === "disabled") return "Disabled";
  return "Draft";
}

function customSkillDisplayStatusLabel(skill = {}) {
  if (skill.status === "active" && skill.primary === false) return "Superseded";
  return customSkillStatusLabel(skill.status);
}

function customSkillStatusClass(status) {
  if (status === "active") return "present";
  if (status === "disabled") return "not-run";
  return "pending";
}

function customSkillDisplayStatusClass(skill = {}) {
  if (skill.status === "active" && skill.primary === false) return "pending";
  return customSkillStatusClass(skill.status);
}

function renderAiRun(aiRun, escape) {
  if (!aiRun) return "";
  const provider = aiRun.returnedProvider || aiRun.provider || "";
  const model = aiRun.returnedModel || aiRun.model || "";
  if (!provider && !model) return "";
  return `
    <div class="pipeline-ai-run">
      ${provider ? `<span>${escape(provider)}</span>` : ""}
      ${model ? `<code>${escape(model)}</code>` : ""}
    </div>
  `;
}
