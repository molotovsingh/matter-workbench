export function skillsPageSummary(registry = {}, matterStatus = null) {
  const skills = Array.isArray(registry.skills) ? registry.skills : [];
  const stages = Array.isArray(matterStatus?.stages) ? matterStatus.stages : [];
  const statusBySlash = new Map(stages.map((stage) => [stage.slash, stage]));
  const builtins = skills.map((skill) => ({
    ...skill,
    status: statusBySlash.get(skill.slash) || null,
  }));
  return {
    builtins,
    deterministic: builtins.filter((skill) => String(skill.mode || "").toLowerCase() !== "ai"),
    paidAi: builtins.filter((skill) => skill.paid_provider_call || String(skill.mode || "").toLowerCase() === "ai"),
    matterName: matterStatus?.matterName || "",
    hasMatterStatus: Boolean(matterStatus),
  };
}

export function renderSkillsPageHtml({
  registry = {},
  matterStatus = null,
  skillIdeas = null,
  loadError = "",
  statusError = "",
  skillIdeasError = "",
  activeMatter = {},
} = {}, escapeHtml) {
  const summary = skillsPageSummary(registry, matterStatus);
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
      ${renderSkillsStats(summary, escapeHtml)}
      ${renderSavedIdeas(skillIdeas?.ideas || [], escapeHtml)}
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
        <h2>Coming Later: Configurable Skills</h2>
        <p>
          User-created and editable skills are future work. This page does not create, modify, activate, validate, or run draft skills.
        </p>
        <ul>
          <li>No new skill creation.</li>
          <li>No draft revisions, golden validation, or activation.</li>
          <li>No chat, Q&amp;A, provider call, or matter artifact write.</li>
        </ul>
      </section>
    </div>
  `;
}

function renderSavedIdeas(ideas, escape) {
  const normalized = Array.isArray(ideas) ? ideas : [];
  return `
    <section>
      <h2>Saved Ideas</h2>
      <p class="muted">Non-running proposal inbox for possible future skills. These records do not create slash commands, draft skills, provider calls, or activation.</p>
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
    <article class="skill-card skill-idea-card">
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
          Capture the intended shape of this possible future skill. Saving this brief does not generate prompts, code, draft skills, provider calls, activation, or matter artifacts.
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
        <button type="button" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="ready_for_review"${canMarkReady ? "" : " disabled"} title="${readiness.ready ? "Mark this design brief ready for human review." : "Complete every readiness item before marking ready."}">Mark ready for review</button>
        <button type="button" class="secondary" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="parked"${status === "parked" || status === "dismissed" ? " disabled" : ""}>Park idea</button>
        <button type="button" class="secondary" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="dismissed"${status === "dismissed" ? " disabled" : ""}>Dismiss</button>
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

function statusClass(status) {
  if (status === "dismissed") return "not-run";
  if (status === "ready_for_review") return "present";
  return "pending";
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

function renderSkillCards(skills, escape) {
  if (!skills.length) return '<p class="muted">No skills in this section.</p>';
  return `
    <div class="skills-grid">
      ${skills.map((skill) => renderSkillCard(skill, escape)).join("")}
    </div>
  `;
}

function renderSkillCard(skill, escape) {
  const status = skill.status;
  const state = status
    ? status.present
      ? "Present"
      : "Not run"
    : skill.matter_required
      ? "No artifact status"
      : "Workspace-level";
  const stateClass = status?.present ? "present" : "not-run";
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
      ${renderAiRun(status?.aiRun, escape)}
    </article>
  `;
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
