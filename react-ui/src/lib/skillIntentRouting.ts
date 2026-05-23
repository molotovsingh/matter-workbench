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
  if (decision.user_gate_required) {
    if (isExistingSkillChoice(decision)) {
      if (!isConfigurableExistingSkillChoice(decision) && decision.matched_skill) {
        return `This is already covered by ${decision.matched_skill}. Use the existing skill unless you need a separate reusable output with a clear reason.`;
      }
      return decision.matched_skill
        ? `This sounds like a change to ${decision.matched_skill}. Choose whether to improve the existing skill, or create a separate reusable skill with a reason.`
        : 'This sounds like a change to an existing skill. Choose whether to improve it, or create a separate reusable skill with a reason.';
    }
    if (decision.decision === 'new_skill' || decision.decision === 'adjacent_skill' || decision.decision === 'needs_user_approval') {
      return 'I need one choice before continuing: should I answer this once for the current matter, or help you build a reusable skill for future matters?';
    }
    return directUserFacingText(decision.reason)
      || 'I need one choice before continuing. Use the existing workflow, or create a separate reusable skill with a reason.';
  }
  if (decision.decision === 'transient_copilot') {
    return 'This is a one-time matter question, not a reusable skill. I will answer from the active matter context and keep it chat-only.';
  }
  if (isUserFacingNextAction(decision.suggested_next_action)) return decision.suggested_next_action || '';
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
  return directUserFacingText(decision.reason) || 'Say whether this is a one-time matter task or a reusable skill for future matters.';
}

export function intentChoiceLabels(decision: SkillRouterDecision | null | undefined): { primary: string; secondary: string } {
  if (isExistingSkillChoice(decision)) {
    if (!isConfigurableExistingSkillChoice(decision)) {
      return {
        primary: 'Use existing skill',
        secondary: 'Create separate skill',
      };
    }
    return {
      primary: 'Improve existing skill',
      secondary: 'Create separate skill',
    };
  }
  return {
    primary: 'Answer once',
    secondary: 'Build reusable skill',
  };
}

export function isExistingSkillChoice(decision: SkillRouterDecision | null | undefined): boolean {
  if (!decision) return false;
  return decision.decision === 'modify_existing_skill'
    || decision.recommended_action === 'modify_existing_skill'
    || decision.recommended_action === 'run_existing_skill';
}

export function isConfigurableExistingSkillChoice(decision: SkillRouterDecision | null | undefined): boolean {
  if (!isExistingSkillChoice(decision)) return false;
  return decision?.matched_skill_card?.configurable === true;
}

export function shouldAutoStartConfigurableSkillImprovement(
  decision: SkillRouterDecision | null | undefined,
  userRequest: string,
): boolean {
  if (!decision?.matched_skill) return false;
  if (!isConfigurableExistingSkillChoice(decision)) return false;
  if (decision.decision !== 'modify_existing_skill' && decision.recommended_action !== 'modify_existing_skill') {
    return false;
  }

  const text = String(userRequest || '').trim();
  if (!text) return false;
  if (/\b(create|build|new|separate|another)\b[\s\S]{0,80}\b(skill|workflow)\b/i.test(text)) {
    return false;
  }
  return /\b(improve|change|update|modify|revise|refine|adjust|tweak|rewrite|rework)\b/i.test(text);
}

export function formatIntentDiscoveryReason(value: string | undefined, fallback = ''): string {
  return directUserFacingText(value) || fallback;
}

function isUserFacingNextAction(value: string | undefined): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^(ask|tell|instruct)\s+(the\s+)?user\b/i.test(text)) return false;
  if (/\buser should\b/i.test(text)) return false;
  return true;
}

function directUserFacingText(value: string | undefined): string {
  const text = String(value || '').trim();
  return isUserFacingNextAction(text) ? text : '';
}
