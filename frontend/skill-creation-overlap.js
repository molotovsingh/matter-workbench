import { escapeHtml } from "./dom-utils.js";
import {
  buildSkillCreationOverlapRequest as buildSkillCreationOverlapRequestFromPolicy,
  isBlockingSkillOverlapDecision,
  isSkillImprovementIdea as isSkillImprovementIdeaFromPolicy,
  parseSkillCreationOverlapJustification,
} from "../shared/skill-creation-overlap-policy.mjs";

export {
  isBlockingSkillOverlapDecision,
  parseSkillCreationOverlapJustification,
};

export function isSkillImprovementIdea(args = {}) {
  return isSkillImprovementIdeaFromPolicy(args);
}

export function isSkillImprovementIdeaSession(session, idea) {
  return isSkillImprovementIdeaFromPolicy({ session, idea });
}

export function buildSkillCreationOverlapRequest(args = {}, legacyIdea = undefined) {
  if (arguments.length > 1) {
    return buildSkillCreationOverlapRequestFromPolicy({
      session: args,
      idea: legacyIdea,
    });
  }
  return buildSkillCreationOverlapRequestFromPolicy(args);
}

export function renderSkillCreationOverlapGateHtml({
  decision = {},
  userRequest = "",
  overrideJustification = "",
  errorMessage = "",
} = {}) {
  const matchedSkill = decision.matched_skill || "none";
  const confidence = Number.isFinite(decision.confidence)
    ? `${Math.round(decision.confidence * 100)}%`
    : "n/a";
  return `
    <section class="command-interview command-router-result" aria-live="polite">
      <h3>Existing skill may already cover this</h3>
      <p class="muted">Skill creation is paused. This does not modify your approved sample or the active skill list.</p>
      <p><code>${escapeHtml(userRequest)}</code></p>
      <dl class="skill-card-meta">
        <div><dt>Matched skill</dt><dd><code>${escapeHtml(matchedSkill)}</code></dd></div>
        <div><dt>Recommended action</dt><dd>${escapeHtml(decision.recommended_action || "")}</dd></div>
        <div><dt>Confidence</dt><dd>${escapeHtml(confidence)}</dd></div>
        <div><dt>Reason</dt><dd>${escapeHtml(decision.reason || "")}</dd></div>
        <div><dt>Next action</dt><dd>${escapeHtml(decision.suggested_next_action || "Use the existing skill, improve it, or justify why this is a distinct new skill.")}</dd></div>
      </dl>
      <form class="ai-command-override-form" data-skill-overlap-form>
        <label>
          <span>Why is this a separate new skill?</span>
          <textarea data-skill-overlap-justification spellcheck="true" placeholder="Explain the distinct purpose, inputs, output artifact, workflow stage, legal setting, or audience.">${escapeHtml(overrideJustification || "")}</textarea>
        </label>
        <div class="command-interview-actions">
          <button type="submit">Re-check and create skill</button>
          <button type="button" class="secondary" data-skill-overlap-action="cancel">Cancel</button>
        </div>
        <div class="form-error" data-skill-overlap-error${errorMessage ? "" : " hidden"}>${escapeHtml(errorMessage)}</div>
      </form>
    </section>
  `;
}
