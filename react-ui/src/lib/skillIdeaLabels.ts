import type { SkillIdea } from '../types';

export function skillIdeaDisplayTitle(idea: SkillIdea): string {
  const text = cleanLabelText(idea.text);
  if (isUsefulSkillIdeaLabel(text)) return text;

  const problem = cleanLabelText(idea.designBrief?.problem);
  if (isUsefulSkillIdeaLabel(problem)) return problem;

  return 'Unfinished skill idea';
}

function cleanLabelText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isUsefulSkillIdeaLabel(value: string): boolean {
  if (!value) return false;
  if (/^unknown$/i.test(value)) return false;
  if (/^create a reusable skill to unknown\b/i.test(value)) return false;
  if (/^(?:skill idea )?not yet provided$/i.test(value)) return false;
  if (/^skill idea(?: text)? is required$/i.test(value)) return false;
  return true;
}
