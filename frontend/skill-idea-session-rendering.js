import { escapeHtml } from "./dom-utils.js";
import {
  formatSampleProvider,
  getSampleAiRun,
  getSampleMatter,
  getSampleWarnings,
  getSampleVersion,
  isSampleStale,
  renderSampleLedger,
} from "./skill-sample-review.js";

export function describeInterviewPlanner(interview) {
  const planner = interview?.planner || null;
  if (planner?.used) {
    return {
      source: "model",
      model: [planner.provider, planner.model].filter(Boolean).join(" / "),
      fallbackReason: "",
    };
  }
  if (planner) {
    return {
      source: "deterministic fallback",
      model: "",
      fallbackReason: String(planner.reason || "").trim(),
    };
  }
  return {
    source: "deterministic",
    model: "",
    fallbackReason: "",
  };
}

export function renderSkillIdeaUnderstood(interview = {}) {
  return `
        <div class="skill-idea-understood">
          <strong>What I understood</strong>
          <p>${escapeHtml(interview.understood)}</p>
          ${renderInterviewPlannerInfo(interview)}
          ${renderDefaultAssumptions(interview)}
          ${interview.targetSkill ? `<p class="muted">Likely related skill: <code>${escapeHtml(interview.targetSkill)}</code></p>` : ""}
        </div>
    `;
}

export function renderInterviewPlannerInfo(interview = {}) {
  const plannerInfo = describeInterviewPlanner(interview);
  const plannerLabel = plannerInfo.model || plannerInfo.source;
  const reason = plannerInfo.fallbackReason
    ? `<br /><span>Fallback reason: ${escapeHtml(plannerInfo.fallbackReason)}</span>`
    : "";
  return `<p class="muted">Planner: ${escapeHtml(plannerLabel)}${reason}</p>`;
}

export function renderDefaultAssumptions(interview = {}) {
  const assumptions = Array.isArray(interview.defaultAssumptions) ? interview.defaultAssumptions : [];
  if (!assumptions.length) return "";
  return `
      <ul class="command-interview-answers">
        ${assumptions.map((assumption) => `<li><span>Default</span><strong>${escapeHtml(assumption)}</strong></li>`).join("")}
      </ul>
    `;
}

export function renderQuestionExamples(question = {}) {
  const examples = Array.isArray(question.examples) ? question.examples.filter(Boolean) : [];
  if (examples.length) {
    return `<p class="muted">Examples: ${escapeHtml(examples.join(", "))}.</p>`;
  }
  return question.placeholder ? `<p class="muted">${escapeHtml(question.placeholder)}</p>` : "";
}

export function renderAnsweredQuestions(interview = {}, answers = {}) {
  const questions = Array.isArray(interview.questions) ? interview.questions : [];
  const answered = questions
    .filter((question) => answers[question.id])
    .map((question) => `
        <li>
          <span>${escapeHtml(question.label)}</span>
          <strong>${escapeHtml(answers[question.id])}</strong>
        </li>
      `).join("");
  if (!answered) return "";
  return `
      <ul class="command-interview-answers">
        ${answered}
      </ul>
    `;
}

export function renderSavedSkillIdeaChecklist(readiness = {}) {
  const items = Array.isArray(readiness.items) ? readiness.items : [];
  if (!items.length) return "";
  return `
      <div class="skill-idea-readiness">
        <div class="skill-idea-readiness-header">
          <strong>Readiness checklist</strong>
          <span class="pipeline-state ${readiness.ready ? "present" : "pending"}">${readiness.ready ? "Complete" : "Incomplete"}</span>
        </div>
        <ul>
          ${items.map((item) => `
            <li class="${item.passed ? "passed" : "missing"}">
              <span>${item.passed ? "OK" : "Missing"}</span>
              ${escapeHtml(item.label || item.key || "Readiness item")}
            </li>
          `).join("")}
        </ul>
      </div>
    `;
}

export function renderReadySkillIdeaSessionHtml({ interview = {}, answers = {}, activeMatter = {}, errorMessage = "" } = {}) {
  const hasMatter = Boolean(activeMatter?.folderName);
  const primaryLabel = hasMatter ? "Generate sample from this matter" : "Pick matter to test this skill";
  return `
        <section class="command-interview" aria-live="polite">
          <h3>Ready to generate a sample output</h3>
          <p class="muted">Not runnable yet. The next step is to test this idea against a matter. ${hasMatter ? "The idea will be saved before sample generation." : "Pick a matter to test this skill."}</p>
          ${renderSkillIdeaUnderstood(interview)}
          ${Array.isArray(interview.questions) && interview.questions.length === 0 ? '<p class="muted">No follow-up questions were needed because the initial request already contains a detailed skill specification.</p>' : ""}
          ${renderAnsweredQuestions(interview, answers)}
          ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ""}
          <div class="command-interview-actions">
            <button type="button" data-skill-interview-action="generate-sample"${hasMatter ? "" : " disabled"}>${escapeHtml(primaryLabel)}</button>
            <button type="button" class="secondary" data-skill-interview-action="edit">Edit answers</button>
            <button type="button" class="secondary" data-skill-interview-action="cancel">Cancel</button>
          </div>
        </section>
      `;
}

export function renderActiveSkillIdeaQuestionHtml({ interview = {}, answers = {}, questionIndex = 0, errorMessage = "" } = {}) {
  const question = Array.isArray(interview.questions) ? interview.questions[questionIndex] || {} : {};
  return `
      <section class="command-interview" aria-live="polite">
        <h3>Skill idea interview</h3>
        <p class="muted">Unsaved interview. Finish or save before refreshing.</p>
        ${renderSkillIdeaUnderstood(interview)}
        <div class="command-interview-question">
          <strong>Question ${questionIndex + 1}</strong>
          <p>${escapeHtml(question.label || "")}</p>
          ${question.help ? `<p>${escapeHtml(question.help)}</p>` : ""}
          ${renderQuestionExamples(question)}
        </div>
        ${renderAnsweredQuestions(interview, answers)}
        ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ""}
        <div class="command-interview-actions">
          <button type="button" class="secondary" data-skill-interview-action="cancel">Cancel</button>
        </div>
      </section>
    `;
}

export function renderSavedSkillIdeaSessionHtml({
  idea = {},
  interview = {},
  answers = {},
  sampleReview = {},
  createdSkill = null,
  activeMatter = {},
  errorMessage = "",
} = {}) {
  const brief = idea.designBrief || {};
  const readiness = idea.readiness || {};
  const status = String(idea.status || "incomplete");
  const checklistReady = Boolean(readiness.ready);
  const statusText = status === "ready_for_review"
    ? "Ready to review"
    : checklistReady
      ? "Draft complete"
      : "Draft saved";
  const checklistText = checklistReady
    ? "Complete"
    : `Needs details ${Number(readiness.passedCount || 0)}/${Number(readiness.totalCount || 0)}`;
  return `
      <section class="command-interview" aria-live="polite">
        <h3>Saved skill idea</h3>
        <p class="muted">Not runnable yet. No prompt, code, slash command, activation, or matter artifact has been generated.</p>
        ${renderSkillIdeaUnderstood(interview)}
        <dl class="skill-card-meta">
          <div><dt>Status</dt><dd>${escapeHtml(statusText)}</dd></div>
          <div><dt>Checklist</dt><dd>${escapeHtml(checklistText)}</dd></div>
          <div><dt>Output</dt><dd>${escapeHtml(brief.expectedOutputArtifact || "Not specified")}</dd></div>
          <div><dt>Lane</dt><dd>${escapeHtml(brief.targetLane || "Not specified")}</dd></div>
          <div><dt>Risk</dt><dd>${escapeHtml(brief.riskLevel || "Not assessed")}</dd></div>
        </dl>
        <details class="skill-idea-brief" open>
          <summary>Design brief <span class="muted">Not runnable yet</span></summary>
          <dl class="skill-card-meta">
            <div><dt>User</dt><dd>${escapeHtml(brief.intendedUser || "Not specified")}</dd></div>
            <div><dt>Problem</dt><dd>${escapeHtml(brief.problem || "Not specified")}</dd></div>
            <div><dt>Inputs</dt><dd>${escapeHtml(brief.expectedInputs || "Not specified")}</dd></div>
            <div><dt>Paid/free</dt><dd>${escapeHtml(brief.paidPosture || "Not specified")}</dd></div>
          </dl>
          ${brief.notes ? `<p class="muted">${escapeHtml(brief.notes)}</p>` : ""}
        </details>
        ${renderAnsweredQuestions(interview, answers)}
        ${renderSavedSkillIdeaChecklist(readiness)}
        ${renderSavedSkillIdeaSampleReviewHtml({ sampleReview, createdSkill, activeMatter })}
        ${errorMessage ? `<p class="form-error">${escapeHtml(errorMessage)}</p>` : ""}
        <div class="command-interview-actions">
          ${renderSampleReviewButtonsHtml({ sampleReview, createdSkill, activeMatter })}
          <button type="button" data-skill-interview-action="copy-packet">Copy Review Packet</button>
          <button type="button" class="secondary" data-skill-interview-action="mark-ready"${checklistReady && status !== "ready_for_review" ? "" : " disabled"}>Mark ready for review</button>
          <button type="button" class="secondary" data-skill-interview-action="edit">Edit answers</button>
          <button type="button" class="secondary" data-skill-interview-action="open-skills">Open in Skills</button>
          <button type="button" class="secondary" data-skill-interview-action="start-another">Start another idea</button>
        </div>
      </section>
    `;
}

export function renderSavedSkillIdeaSampleReviewHtml({ sampleReview = {}, createdSkill = null, activeMatter = {} } = {}) {
  const activeSample = sampleReview.activeSample || null;
  const sampleMatter = getSampleMatter(activeSample);
  const matterName = activeSample
    ? sampleMatter.matterName || sampleMatter.folderName || ""
    : activeMatter?.metadata?.matterName || activeMatter?.folderName || "";
  const matterFolder = activeSample
    ? sampleMatter.folderName || ""
    : activeMatter?.folderName || "";
  const sampleVersion = activeSample ? getSampleVersion(activeSample, Array.isArray(sampleReview.samples) ? sampleReview.samples.length : 1) : 0;
  const approved = Boolean(sampleReview.approved);
  const stale = Boolean(sampleReview.stale);
  const generating = Boolean(sampleReview.generating);
  const readySkill = createdSkill || sampleReview.createdSkill || null;
  const sampleStatus = generating
    ? `Generating sample from ${matterName || matterFolder || "the selected matter"}. This may take a minute. No matter files will be changed.`
    : stale
    ? sampleReview.staleReason || "Design brief changed after this sample was generated. Regenerate the sample before approving it."
    : readySkill?.slash
      ? `Skill Ready. Use ${readySkill.slash}.`
    : approved
      ? "Sample approved. Skill creation can be retried from this approved sample."
    : activeSample
      ? `Sample v${sampleVersion || 1} ready for review. Type feedback to regenerate, or choose Looks useful to try creating the skill.`
      : matterFolder
        ? "Generate an AI sample output from the selected test matter."
        : "Pick a matter to generate a sample output.";
  return `
      <div class="skill-idea-sample-review">
        <h4>Sample output review</h4>
        ${generating ? '<div class="sample-progress" role="status">Generating sample output...</div>' : ""}
        <p class="muted">${escapeHtml(sampleStatus)}</p>
        ${readySkill?.slash ? `<p><strong>Skill Ready</strong>: type <code>${escapeHtml(readySkill.slash)}</code> to run it.</p>` : ""}
        <dl class="skill-card-meta">
          <div><dt>Test matter</dt><dd>${escapeHtml(matterName || "No matter selected")}</dd></div>
          <div><dt>Matter folder</dt><dd>${escapeHtml(matterFolder || "Pick a matter first")}</dd></div>
          <div><dt>Sample</dt><dd>${activeSample ? escapeHtml(`v${sampleVersion || 1}`) : "Not generated"}</dd></div>
        </dl>
        ${renderSampleWarnings(activeSample)}
        ${getSampleAiRun(activeSample).provider || getSampleAiRun(activeSample).model ? `
          <p class="muted">Sample provider: ${escapeHtml(formatSampleProvider(activeSample))}</p>
        ` : ""}
        <p class="muted">Sample generation may call the configured AI provider. A skill becomes runnable only after sample approval, overlap check, and validation succeed.</p>
        ${renderSampleLedger(sampleReview)}
      </div>
    `;
}

export function renderSampleReviewButtonsHtml({ sampleReview = {}, createdSkill = null, activeMatter = {} } = {}) {
  const hasMatter = Boolean(activeMatter?.folderName);
  const activeSample = sampleReview.activeSample || null;
  const approved = Boolean(sampleReview.approved);
  const stale = Boolean(sampleReview.stale) || isSampleStale(activeSample);
  const generating = Boolean(sampleReview.generating);
  const readySkill = createdSkill || sampleReview.createdSkill || null;
  const generateLabel = activeSample ? "Needs changes - regenerate" : "Generate sample from this matter";
  const generateAction = activeSample ? "regenerate-sample" : "generate-sample";
  if (readySkill?.slash) {
    return `
        <button type="button" data-skill-interview-action="run-created-skill">Run now</button>
        <button type="button" class="secondary" data-skill-interview-action="copy-sample"${activeSample ? "" : " disabled"}>Copy Sample</button>
      `;
  }
  return `
      <button type="button" data-skill-interview-action="${generateAction}"${hasMatter && !approved && !generating ? "" : " disabled"}>${escapeHtml(generating ? "Generating sample..." : generateLabel)}</button>
      ${approved && !stale
        ? '<button type="button" data-skill-interview-action="create-skill">Try creating skill again</button>'
        : `<button type="button" class="secondary" data-skill-interview-action="approve-sample"${activeSample && !stale && !generating ? "" : " disabled"}>Looks useful - try creating skill</button>`}
      <button type="button" class="secondary" data-skill-interview-action="copy-sample"${activeSample ? "" : " disabled"}>Copy Sample</button>
    `;
}

function renderSampleWarnings(sample) {
  const warnings = getSampleWarnings(sample);
  if (!warnings.length) return "";
  return `
    <div class="sample-warning-list" role="note">
      <strong>Sample warnings</strong>
      <ul>
        ${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
      </ul>
    </div>
  `;
}
