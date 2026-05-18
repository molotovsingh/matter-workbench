export const SKILL_CREATION_OVERLAP_OVERRIDE_MIN_CHARS = 12;

export const SKILL_CREATION_OVERLAP_BLOCKING_DECISIONS = Object.freeze([
  "needs_user_approval",
]);

export const SKILL_CREATION_OVERLAP_BLOCKING_RECOMMENDED_ACTIONS = Object.freeze([
  "modify_existing_skill",
  "run_existing_skill",
]);

export function isSkillImprovementIdea({ session = null, idea = {} } = {}) {
  const mode = String(session?.interview?.mode || "").trim();
  const notes = String(idea?.designBrief?.notes || session?.interview?.designBrief?.notes || "");
  const text = String(idea?.text || session?.interview?.originalText || "");
  return mode === "modify_existing_skill"
    || /proposal type:\s*improve existing skill/i.test(notes)
    || /^improve\s+\/[a-z0-9_-]+:/i.test(text);
}

export function buildSkillCreationOverlapRequest({ session = null, idea = {} } = {}) {
  const brief = idea?.designBrief || session?.interview?.designBrief || {};
  return [
    idea?.text || session?.interview?.originalText || "",
    brief.problem ? `Problem: ${brief.problem}` : "",
    brief.expectedInputs ? `Inputs: ${brief.expectedInputs}` : "",
    brief.expectedOutputArtifact ? `Output: ${brief.expectedOutputArtifact}` : "",
    brief.targetLane ? `Lane: ${brief.targetLane}` : "",
  ].filter(Boolean).join("\n");
}

export function isBlockingSkillOverlapDecision(decision = {}, { overrideJustification = "" } = {}) {
  if (hasSkillCreationOverlapOverride(overrideJustification)) return false;
  return Boolean(
    decision.user_gate_required
    || decision.mece_violation
    || SKILL_CREATION_OVERLAP_BLOCKING_DECISIONS.includes(decision.decision)
    || decision.recommended_action === "modify_existing_skill"
    || (decision.matched_skill && SKILL_CREATION_OVERLAP_BLOCKING_RECOMMENDED_ACTIONS.includes(decision.recommended_action)),
  );
}

export function parseSkillCreationOverlapJustification(input) {
  const text = String(input || "").trim();
  const match = text.match(/^(?:justify\s+new\s+skill|create\s+separate\s+skill\s+with\s+reason|create\s+separate\s+skill\s+anyway|create\s+separate\s+skill|separate\s+skill|distinct\s+because|separate\s+because|create\s+anyway\s+because)\s*[:,-]?\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function hasSkillCreationOverlapOverride(overrideJustification = "") {
  return String(overrideJustification || "").replace(/\s+/g, " ").trim().length >= SKILL_CREATION_OVERLAP_OVERRIDE_MIN_CHARS;
}
