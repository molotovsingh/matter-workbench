import type { SkillIdea, SkillIdeaDesignBrief, SkillRouterDecision } from '../types';

export const SKILL_CREATION_OVERLAP_OVERRIDE_MIN_CHARS = 12;

export const SKILL_CREATION_OVERLAP_BLOCKING_DECISIONS = [
  'needs_user_approval',
] as const;

export const SKILL_CREATION_OVERLAP_BLOCKING_RECOMMENDED_ACTIONS = [
  'modify_existing_skill',
  'run_existing_skill',
] as const;

export function buildSkillCreationOverlapRequest(
  idea: SkillIdea,
  brief: SkillIdeaDesignBrief | undefined,
): string {
  return [
    idea.text,
    brief?.problem ? `Problem: ${brief.problem}` : '',
    brief?.expectedInputs ? `Inputs: ${brief.expectedInputs}` : '',
    brief?.expectedOutputArtifact ? `Output: ${brief.expectedOutputArtifact}` : '',
    brief?.targetLane ? `Lane: ${brief.targetLane}` : '',
  ].filter(Boolean).join('\n');
}

export function isBlockingSkillOverlapDecision(
  decision: SkillRouterDecision,
  overlapOverrideJustification = '',
): boolean {
  if (hasSkillCreationOverlapOverride(overlapOverrideJustification)) return false;
  const blockingDecisions: readonly string[] = SKILL_CREATION_OVERLAP_BLOCKING_DECISIONS;
  const blockingRecommendedActions: readonly string[] = SKILL_CREATION_OVERLAP_BLOCKING_RECOMMENDED_ACTIONS;
  return Boolean(
    decision.user_gate_required
    || decision.mece_violation
    || blockingDecisions.includes(decision.decision)
    || decision.recommended_action === 'modify_existing_skill'
    || (
      decision.matched_skill
      && blockingRecommendedActions.includes(decision.recommended_action || '')
    ),
  );
}

export function hasSkillCreationOverlapOverride(overlapOverrideJustification = ''): boolean {
  return overlapOverrideJustification.replace(/\s+/g, ' ').trim().length >= SKILL_CREATION_OVERLAP_OVERRIDE_MIN_CHARS;
}
