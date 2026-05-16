import {
  formatConfigurableSkillDisplayName,
  formatConfigurableSkillVersionLabel,
} from "../configurable-skill-version-labels.js";
import { customSkillGroupingKey } from "./skills-page-summary.js";
import {
  extractTargetSkill,
  normalizeIdeaStatusForView,
  statusClass,
  statusLabel,
} from "./skills-page-saved-ideas.js";

export function renderSkillCards(skills, escape, { improvementIdeas = [], configurableSkillRuns = [], allCustomSkills = null, variant = "cards" } = {}) {
  if (!skills.length) return '<p class="muted">No skills in this section.</p>';
  const customSkillContext = Array.isArray(allCustomSkills) ? allCustomSkills : skills;
  if (variant === "active-custom") {
    return `
      <div class="active-custom-skills-list">
        ${skills.map((skill) => renderActiveCustomSkillCard(skill, escape, { improvementIdeas, configurableSkillRuns, allCustomSkills: customSkillContext })).join("")}
      </div>
    `;
  }
  if (variant === "builtin-list") {
    return `
      <div class="builtin-skills-list">
        ${skills.map((skill) => renderBuiltinSkillRow(skill, escape)).join("")}
      </div>
    `;
  }
  return `
    <div class="skills-grid">
      ${skills.map((skill) => renderSkillCard(skill, escape, { improvementIdeas, configurableSkillRuns, allCustomSkills: customSkillContext })).join("")}
    </div>
  `;
}

function renderActiveCustomSkillCard(skill, escape, { improvementIdeas = [], configurableSkillRuns = [], allCustomSkills = [] } = {}) {
  const outputs = Array.isArray(skill.outputs) && skill.outputs.length
    ? skill.outputs
    : ["No durable output declared"];
  const output = outputs[0] || "";
  const versions = customSkillFamilyVersions(skill, allCustomSkills);
  const familyRuns = customSkillRunsForFamily(skill, versions, configurableSkillRuns);
  const latestRun = familyRuns[0] || null;
  const slash = skill.slash || "";
  const improveCommand = `${slash} modify`;
  return `
    <article class="active-custom-skill-card">
      <div class="active-custom-skill-header">
        <div class="active-custom-skill-title">
          <h3>${escape(customSkillBaseTitle(skill))}</h3>
          <span>${escape(customSkillVersionLabel(skill))}</span>
        </div>
        <span class="pipeline-state ${escape(customSkillDisplayStatusClass(skill))}">${escape(customSkillDisplayStatusLabel(skill))}</span>
      </div>
      <p>${escape(skill.purpose || "No description provided.")}</p>
      <div class="active-custom-skill-path">
        <code>${escape(slash)}</code>
        <span>→</span>
        <span>${output ? `<code>${escape(output)}</code>` : '<span class="muted">No output declared</span>'}</span>
      </div>
      <div class="active-custom-skill-run">
        ${latestRun
          ? `Last run: ${escape(latestRun.matterName || latestRun.matterFolder || "Unknown matter")} - <strong>${escape(runStatusLabel(latestRun.status))}</strong>${latestRun.startedAt || latestRun.finishedAt ? ` <span>${escape(formatRunTime(latestRun.startedAt || latestRun.finishedAt))}</span>` : ""}`
          : "No runs recorded"}
      </div>
      <div class="active-custom-skill-actions">
        <button type="button" data-skill-card-command="${escape(slash)}">Run</button>
        <button type="button" class="secondary" data-skill-card-command="${escape(improveCommand)}">Improve</button>
      </div>
      ${renderCustomSkillVersionHistory(skill, allCustomSkills, improvementIdeas, configurableSkillRuns, escape, { open: false })}
    </article>
  `;
}

function renderBuiltinSkillRow(skill, escape) {
  const status = skill.artifactStatus;
  const state = status
    ? status.present
      ? "Present"
      : "Not run"
    : skill.matter_required
      ? "No artifact status"
      : "Workspace-level";
  const stateClass = status?.present ? "present" : "not-run";
  const surfaceLabel = builtinSurfaceLabel(skill);
  return `
    <article class="builtin-skill-row">
      <div>
        <h3>${escape(skill.title || skill.id || skill.slash || "Skill")}</h3>
        <p>${escape(skill.purpose || "No description provided.")}</p>
      </div>
      <div class="builtin-skill-command">
        <code>${escape(skill.slash || "")}</code>
        ${surfaceLabel ? `<span>${escape(surfaceLabel)}</span>` : ""}
      </div>
      <span class="pipeline-state ${escape(stateClass)}">${escape(state)}</span>
    </article>
  `;
}

function builtinSurfaceLabel(skill = {}) {
  const surface = String(skill.product_surface || "").trim();
  if (surface === "native_legal") return "Native legal";
  if (surface === "readiness") return "Readiness";
  if (surface === "setup") return "Setup";
  if (surface === "utility") return "Utility";
  if (surface === "maintenance") return "Maintenance";
  return "";
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
          <h3>${escape(skill.configurable ? customSkillDisplayName(skill) : skill.title || skill.id || skill.slash || "Skill")}</h3>
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

function renderCustomSkillVersionHistory(skill, allCustomSkills, ideas, runs, escape, { open = skill.status === "active" } = {}) {
  const versions = customSkillFamilyVersions(skill, allCustomSkills);
  if (!versions.length) return "";
  const activeVersion = versions.find((candidate) => candidate.status === "active") || versions[0];
  const familyRuns = customSkillRunsForFamily(skill, versions, runs);
  const latestRun = familyRuns[0] || null;
  return `
    <details class="skill-output-list custom-skill-version-history" ${open ? "open" : ""}>
      <summary>
        <strong>Version history</strong>
        <span class="pipeline-state ${escape(customSkillDisplayStatusClass(activeVersion))}">${escape(`${customSkillVersionLabel(activeVersion)} ${customSkillDisplayStatusLabel(activeVersion).toLowerCase()}`)}</span>
      </summary>
      <p class="muted">
        Latest runnable version: ${escape(customSkillDisplayName(activeVersion))}. Type <code>${escape(activeVersion.slash || skill.slash || "")}</code> to run it.
        Improve it by typing <code>${escape(`${activeVersion.slash || skill.slash || ""} modify`)}</code> in the command box.
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

function customSkillVersionLabel(skill = {}) {
  return formatConfigurableSkillVersionLabel(skill);
}

function customSkillDisplayName(skill = {}) {
  return formatConfigurableSkillDisplayName(skill);
}

function customSkillBaseTitle(skill = {}) {
  const title = String(skill.title || skill.slash || "Custom Skill").trim() || "Custom Skill";
  return title.replace(/\s+v\d+\s*$/i, "");
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

function formatRunTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
