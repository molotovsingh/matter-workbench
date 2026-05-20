import type { SkillRouterDecision } from '../types';

const SKILL_FACTORY_DECISIONS = new Set(['new_skill', 'adjacent_skill']);

export function shouldStartSkillIdeaSessionFromIntent(decision: SkillRouterDecision | null | undefined): boolean {
  if (!decision) return false;
  if (decision.user_gate_required) return false;
  if (decision.matched_skill) return false;
  return SKILL_FACTORY_DECISIONS.has(String(decision.decision || '').trim());
}

export function formatIntentDiscoveryGuidance(decision: SkillRouterDecision | null | undefined): string {
  if (!decision) return 'Could not classify that request. Try again, or say whether this is a one-time task or a reusable skill.';
  if (decision.suggested_next_action) return decision.suggested_next_action;
  if (decision.decision === 'transient_copilot') {
    return 'This looks like a one-time matter task. Use the assistant for the immediate answer, or say you want a reusable skill for future matters.';
  }
  if (decision.decision === 'modify_existing_skill' || decision.recommended_action === 'modify_existing_skill') {
    return decision.matched_skill
      ? `This sounds like a change to ${decision.matched_skill}, not a new skill. Open Skills and modify the existing workflow.`
      : 'This sounds like a change to an existing skill, not a new skill.';
  }
  if (decision.decision === 'run_existing_skill' || decision.recommended_action === 'run_existing_skill') {
    return decision.matched_skill
      ? `This is already covered by ${decision.matched_skill}. Use that skill unless you need a different reusable output.`
      : 'This looks covered by an existing skill.';
  }
  if (decision.user_gate_required) {
    return decision.reason || 'This may overlap with an existing workflow. Confirm whether to use/improve the existing skill or create a separate one.';
  }
  return decision.reason || 'Say whether this is a one-time matter task or a reusable skill for future matters.';
}
