import { escapeHtml } from "./dom-utils.js";
import {
  buildSkillCreationOverlapRequest as buildSkillCreationOverlapRequestFromPolicy,
  hasSkillCreationOverlapOverride,
  isBlockingSkillOverlapDecision,
  isSkillImprovementIdea as isSkillImprovementIdeaFromPolicy,
  parseSkillCreationOverlapJustification,
} from "../shared/skill-creation-overlap-policy.mjs";

export {
  hasSkillCreationOverlapOverride,
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
  const matchedTitle = decision.matched_skill_card?.title || decision.matched_skill_card?.display?.action || matchedSkill;
  const confidence = Number.isFinite(decision.confidence)
    ? `${Math.round(decision.confidence * 100)}%`
    : "n/a";
  return `
    <section class="command-interview command-router-result" aria-live="polite">
      <h3>This may already be covered</h3>
      <p class="muted">Your idea and approved sample are saved. No runnable skill has been created yet.</p>
      <p><code>${escapeHtml(userRequest)}</code></p>
      <dl class="skill-card-meta">
        <div><dt>Closest match</dt><dd>${escapeHtml(matchedTitle)}${matchedSkill && matchedSkill !== "none" ? ` <code>${escapeHtml(matchedSkill)}</code>` : ""}</dd></div>
        <div><dt>Suggested path</dt><dd>${escapeHtml(decision.suggested_next_action || "Use or improve the existing skill unless this idea has a different output, audience, or workflow stage.")}</dd></div>
        <div><dt>Confidence</dt><dd>${escapeHtml(confidence)}</dd></div>
        <div><dt>Reason</dt><dd>${escapeHtml(decision.reason || "")}</dd></div>
      </dl>
      <div class="command-interview-actions skill-overlap-choice-actions">
        <button type="button" data-skill-overlap-action="use-existing"${matchedSkill === "none" ? " disabled" : ""}>Use existing skill</button>
        <button type="button" class="secondary" data-skill-overlap-action="improve-existing"${matchedSkill === "none" ? " disabled" : ""}>Improve existing skill</button>
        <button type="button" class="secondary" data-skill-overlap-action="create-separate">Create separate skill anyway</button>
        <button type="button" class="secondary" data-skill-overlap-action="park">Park idea</button>
      </div>
      <form class="ai-command-override-form" data-skill-overlap-form hidden>
        <label>
          <span>Why should this be a separate custom skill?</span>
          <textarea data-skill-overlap-justification spellcheck="true" placeholder="Example: This produces a workshop issue review, not the Library List of Dates document.">${escapeHtml(overrideJustification || "")}</textarea>
        </label>
        <div class="command-interview-actions">
          <button type="submit">Re-check and create skill</button>
          <button type="button" class="secondary" data-skill-overlap-action="hide-separate">Back</button>
        </div>
        <div class="form-error" data-skill-overlap-error${errorMessage ? "" : " hidden"}>${escapeHtml(errorMessage)}</div>
      </form>
      <div class="form-note" data-skill-overlap-message></div>
    </section>
  `;
}
