import {
  formatSampleProvider,
  formatSampleStateLabel,
  getSampleId,
  getSampleMarkdown,
  getSampleMatter,
  getSampleState,
  getSampleVersion,
  getSampleWarnings,
  normalizeUiSample,
} from "../skill-sample-review.js";
import { redactSensitiveText } from "../secret-redaction.js";

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
    `- Expected output document: ${packetValue(brief.expectedOutputArtifact)}`,
    `- Target workspace area: ${packetValue(brief.targetLane)}`,
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

export function renderSavedIdeas(ideas, escape, { compact = false, samplesByIdea = {} } = {}) {
  const normalized = Array.isArray(ideas) ? ideas : [];
  if (compact) return renderCompactSavedIdeas(normalized, escape, { samplesByIdea });
  return `
    <section>
      <h2>Saved Ideas</h2>
      <p class="muted">Non-running idea inbox for possible future skills. These records do not create slash commands, draft skills, provider calls, or runnable skills.</p>
      ${normalized.length ? `
        <div class="skills-grid">
          ${normalized.map((idea) => renderSavedIdeaCard(idea, escape, { samplesByIdea })).join("")}
        </div>
      ` : '<p class="muted">No saved skill ideas yet. Use the Command rail with text like <code>create a skill to summarize pleadings</code>.</p>'}
    </section>
  `;
}

function renderCompactSavedIdeas(ideas, escape, { samplesByIdea = {} } = {}) {
  const activeIdeas = ideas.filter((idea) => normalizeIdeaStatusForView(idea.status) !== "dismissed");
  const dismissedIdeas = ideas.filter((idea) => normalizeIdeaStatusForView(idea.status) === "dismissed");
  return `
    <section class="skills-section">
      <h2>Ideas</h2>
      <p class="muted">These are not runnable yet. Each idea needs a sample and review before it becomes a skill.</p>
      ${ideas.length ? `
        <div class="skill-ideas-list">
          ${activeIdeas.length
            ? activeIdeas.map((idea) => renderSavedIdeaRow(idea, escape, { samplesByIdea })).join("")
            : '<p class="muted skill-ideas-empty">No active skill ideas.</p>'}
          ${dismissedIdeas.length ? `
            <details class="skill-ideas-dismissed">
              <summary>Show ${dismissedIdeas.length} dismissed idea${dismissedIdeas.length === 1 ? "" : "s"}</summary>
              ${dismissedIdeas.map((idea) => renderSavedIdeaRow(idea, escape, { samplesByIdea })).join("")}
            </details>
          ` : ""}
        </div>
      ` : '<p class="muted">No saved skill ideas yet. Use the Command rail with text like <code>new skill</code>.</p>'}
    </section>
  `;
}

export function statusLabel(status) {
  if (status === "ready_for_review") return "Ready for review";
  if (status === "parked") return "Parked";
  if (status === "dismissed") return "Dismissed";
  return "Incomplete";
}

export function statusClass(status) {
  if (status === "dismissed") return "not-run";
  if (status === "ready_for_review") return "present";
  return "pending";
}

export function normalizeIdeaStatusForView(status) {
  if (status === "proposed") return "incomplete";
  if (status === "marked_for_future") return "parked";
  if (["incomplete", "ready_for_review", "parked", "dismissed"].includes(status)) return status;
  return "incomplete";
}

export function extractTargetSkill(text) {
  const match = String(text || "").match(/\bTarget skill:\s*(\/[a-z0-9_-]+)/i);
  return match?.[1] || "";
}

function renderSavedIdeaCard(idea, escape, { samplesByIdea = {} } = {}) {
  const status = normalizeIdeaStatusForView(idea.status);
  const matter = idea.matter || {};
  const matterLabel = matter.matterName || matter.folderName || "No matter attached";
  const brief = normalizeDesignBriefForView(idea.designBrief);
  const readiness = normalizeReadinessForView(idea.readiness, brief);
  const latestSample = latestSampleForIdea(idea, samplesByIdea);
  const progress = ideaProgress({ status, readiness, latestSample });
  const canMarkReady = readiness.ready && status !== "ready_for_review" && status !== "dismissed";
  return `
    <article class="skill-card skill-idea-card" id="skill-idea-${escape(idea.id || "")}">
      <div class="skill-card-header">
        <div>
          <div class="skill-slash"><code>proposal</code></div>
          <h3>Saved Skill Idea</h3>
        </div>
        <span class="pipeline-state ${escape(progress.className)}">${escape(progress.label)}</span>
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
          Capture the intended shape of this possible future skill. Saving this brief does not generate prompts, code, draft skills, provider calls, runnable skills, or matter files.
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
            <span>Expected output document</span>
            <input type="text" name="expectedOutputArtifact" value="${escape(brief.expectedOutputArtifact)}" autocomplete="off" />
          </label>
          <div class="skill-idea-brief-grid">
            ${renderSelectField({
              name: "targetLane",
              label: "Workspace area",
              value: brief.targetLane,
              options: [
                ["", "Not chosen"],
                ["10_Library", "Source Record (10_Library)"],
                ["20_Workshop", "Case Analysis (20_Workshop)"],
                ["30_Drafts", "Drafts (30_Drafts)"],
                ["40_Dispatch", "Ready to Send (40_Dispatch)"],
              ],
            }, escape)}
            ${renderSelectField({
              name: "paidPosture",
              label: "AI cost posture",
              value: brief.paidPosture,
              options: [
                ["", "Not chosen"],
                ["free", "Local / no paid AI"],
                ["paid", "Uses paid AI"],
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
      ${renderIdeaSampleSummary(idea, latestSample, escape)}
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

function renderSavedIdeaRow(idea, escape, { samplesByIdea = {} } = {}) {
  const status = normalizeIdeaStatusForView(idea.status);
  const matter = idea.matter || {};
  const matterLabel = matter.matterName || matter.folderName || "No matter attached";
  const brief = normalizeDesignBriefForView(idea.designBrief);
  const readiness = normalizeReadinessForView(idea.readiness, brief);
  const latestSample = latestSampleForIdea(idea, samplesByIdea);
  const progress = ideaProgress({ status, readiness, latestSample });
  const canMarkReady = readiness.ready && status !== "ready_for_review" && status !== "dismissed";
  return `
    <article class="skill-idea-row" id="skill-idea-${escape(idea.id || "")}">
      <div class="skill-idea-row-main">
        <div>
          <p>${escape(idea.text || "")}</p>
          <div class="skill-idea-row-meta">
            <span>${escape(matterLabel)}</span>
            <span>${escape(formatIdeaDate(idea.createdAt || idea.updatedAt || ""))}</span>
            ${latestSample ? `<span>${escape(sampleMetaText(latestSample))}</span>` : ""}
          </div>
        </div>
        <span class="pipeline-state ${escape(progress.className)}">${escape(progress.label)}</span>
      </div>
      <details class="skill-idea-row-details">
        <summary>
          Review details
          <span class="pipeline-state ${escape(progress.className)}">${escape(progress.label)}</span>
        </summary>
        <p class="muted">This idea is not runnable. Reviewing it here does not create a slash command, call a provider, or write a matter file.</p>
        <details class="skill-idea-brief">
          <summary>Design brief <span class="muted">Not runnable yet</span></summary>
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
              <span>Expected output document</span>
              <input type="text" name="expectedOutputArtifact" value="${escape(brief.expectedOutputArtifact)}" autocomplete="off" />
            </label>
            <div class="skill-idea-brief-grid">
              ${renderSelectField({
                name: "targetLane",
                label: "Workspace area",
                value: brief.targetLane,
                options: [
                  ["", "Not chosen"],
                  ["10_Library", "Source Record (10_Library)"],
                  ["20_Workshop", "Case Analysis (20_Workshop)"],
                  ["30_Drafts", "Drafts (30_Drafts)"],
                  ["40_Dispatch", "Ready to Send (40_Dispatch)"],
                ],
              }, escape)}
              ${renderSelectField({
                name: "paidPosture",
                label: "AI cost posture",
                value: brief.paidPosture,
                options: [
                  ["", "Not chosen"],
                  ["free", "Local / no paid AI"],
                  ["paid", "Uses paid AI"],
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
        ${renderIdeaSampleSummary(idea, latestSample, escape)}
        <div class="form-actions">
          <button type="button" class="secondary" data-skill-idea-copy-packet data-skill-idea-id="${escape(idea.id || "")}">Copy Review Packet</button>
          <button type="button" class="secondary" data-skill-idea-copy-implementation-brief data-skill-idea-id="${escape(idea.id || "")}">Copy Implementation Brief</button>
          <button type="button" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="ready_for_review"${canMarkReady ? "" : " disabled"} title="${readiness.ready ? "Mark this design brief ready for human review." : "Complete every readiness item before marking ready."}">Mark ready for review</button>
          <button type="button" class="secondary" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="parked"${status === "parked" || status === "dismissed" ? " disabled" : ""}>Park idea</button>
          <button type="button" class="secondary" data-skill-idea-id="${escape(idea.id || "")}" data-skill-idea-status="dismissed"${status === "dismissed" ? " disabled" : ""}>Dismiss</button>
          <span class="artifact-action-status muted" data-skill-idea-copy-status="${escape(idea.id || "")}"></span>
        </div>
      </details>
    </article>
  `;
}

function reviewPacketStatusText(status, readiness) {
  const label = statusLabel(status);
  if (status === "incomplete" && readiness.ready) {
    return "Draft complete - ready to mark for review";
  }
  return label;
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
    ["expectedOutputArtifact", "Expected output document present"],
    ["targetLane", "Workspace area selected"],
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

function buildSkillIdeaOpenQuestions({ brief, readiness }) {
  const questions = readiness.items
    .filter((item) => !item.passed)
    .map((item) => `Complete readiness item: ${item.label}.`);
  if (brief.paidPosture === "unknown") questions.push("Confirm whether this should be free/local or paid/provider-backed.");
  if (!brief.expectedOutputArtifact) questions.push("Confirm the durable output document, if any.");
  if (!brief.targetLane) questions.push("Confirm the target workspace area.");
  return questions.length ? questions : ["None from the readiness checklist."];
}

function packetValue(value) {
  const normalized = String(value || "").trim();
  return redactSensitiveText(normalized || "Not specified");
}

function packetBlock(value) {
  const normalized = String(value || "").trim();
  return redactSensitiveText(normalized || "Not specified");
}

function formatIdeaDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderReadinessChecklist(readiness, escape) {
  return `
    <div class="skill-idea-readiness">
      <div class="skill-idea-readiness-header">
        <strong>Readiness checklist</strong>
        <span class="pipeline-state ${readiness.ready ? "present" : "pending"}">${readiness.ready ? "Complete" : `Needs details ${readiness.passedCount}/${readiness.totalCount}`}</span>
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

function ideaProgress({ status, readiness, latestSample } = {}) {
  if (status === "dismissed") return { label: "Dismissed", className: "not-run" };
  if (status === "parked") return { label: "Parked", className: "not-run" };
  if (latestSample) {
    const sampleState = getSampleState(latestSample);
    if (sampleState === "approved_current") return { label: "Sample approved", className: "present" };
    if (sampleState === "approved_stale" || sampleState === "stale") return { label: "Sample stale", className: "warning" };
    return { label: "Sample generated", className: "present" };
  }
  if (status === "ready_for_review") return { label: "Ready to review", className: "present" };
  if (readiness?.ready) return { label: "Draft complete", className: "present" };
  return { label: "Draft saved", className: "pending" };
}

function latestSampleForIdea(idea, samplesByIdea = {}) {
  const samples = samplesForIdea(idea, samplesByIdea);
  return samples.length
    ? [...samples].sort((a, b) => getSampleVersion(b, 0) - getSampleVersion(a, 0))[0]
    : null;
}

function samplesForIdea(idea, samplesByIdea = {}) {
  const id = String(idea?.id || "").trim();
  if (!id) return [];
  const raw = typeof samplesByIdea.get === "function" ? samplesByIdea.get(id) : samplesByIdea[id];
  const samples = Array.isArray(raw) ? raw : Array.isArray(raw?.samples) ? raw.samples : [];
  return samples.map(normalizeUiSample);
}

function renderIdeaSampleSummary(idea, sample, escape) {
  if (!sample) return "";
  const sampleId = getSampleId(sample);
  const sampleState = getSampleState(sample);
  const warnings = getSampleWarnings(sample);
  const matter = getSampleMatter(sample);
  const markdown = getSampleMarkdown(sample);
  const previewLimit = 4000;
  const truncated = markdown.length > previewLimit;
  const preview = truncated
    ? `${markdown.slice(0, previewLimit)}\n\n[Preview truncated. Copy sample for the full markdown.]`
    : markdown;
  return `
    <section class="skill-idea-sample-summary" aria-label="Generated sample">
      <div class="skill-idea-sample-summary-head">
        <div>
          <strong>Sample generated</strong>
          <p class="muted">Review the latest sample before deciding whether this should become a skill.</p>
        </div>
        <span class="sample-state ${escape(sampleState)}">${escape(formatSampleStateLabel(sampleState))}</span>
      </div>
      <dl class="skill-card-meta compact">
        <div><dt>Sample</dt><dd>v${escape(String(getSampleVersion(sample, 1)))}</dd></div>
        <div><dt>Matter</dt><dd>${escape(matter.matterName || matter.folderName || "Selected matter")}</dd></div>
        <div><dt>Provider</dt><dd>${escape(formatSampleProvider(sample))}</dd></div>
      </dl>
      ${warnings.length ? `
        <div class="sample-warning-list" role="note">
          <strong>Sample warnings</strong>
          <ul>
            ${warnings.map((warning) => `<li>${escape(warning)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
      <details class="skill-idea-sample-preview">
        <summary>View latest sample</summary>
        <pre class="skill-sample-preview-markdown">${escape(preview || "Sample markdown unavailable.")}</pre>
      </details>
      <div class="form-actions compact">
        <button type="button" class="secondary" data-skill-idea-copy-sample data-skill-idea-id="${escape(idea.id || "")}" data-sample-id="${escape(sampleId)}"${sampleId ? "" : " disabled"}>Copy Sample</button>
      </div>
    </section>
  `;
}

function sampleMetaText(sample) {
  const state = getSampleState(sample);
  if (state === "approved_current") return `Sample v${getSampleVersion(sample, 1)} approved`;
  if (state === "approved_stale" || state === "stale") return `Sample v${getSampleVersion(sample, 1)} stale`;
  return `Sample v${getSampleVersion(sample, 1)} generated`;
}
