import { escapeHtml } from "./dom-utils.js";

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
