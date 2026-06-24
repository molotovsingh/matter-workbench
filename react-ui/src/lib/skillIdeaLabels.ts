import type { SkillIdea } from '../types';

export function skillIdeaDisplayTitle(idea: SkillIdea): string {
  const text = humanizeSkillIdeaLabel(idea.text);
  if (isUsefulSkillIdeaLabel(text)) return text;

  const problem = humanizeSkillIdeaLabel(idea.designBrief?.problem);
  if (isUsefulSkillIdeaLabel(problem)) return problem;

  return 'Unfinished skill idea';
}

function humanizeSkillIdeaLabel(value: unknown): string {
  let label = cleanLabelText(value);
  if (!label) return '';

  label = label
    .replace(/^create\s+(?:a\s+)?reusable\s+skill\s+(?:to|that|which)\s+/i, '')
    .replace(/^create\s+(?:a\s+)?skill\s+(?:to|that|which)\s+/i, '')
    .replace(/^new\s+skill\s+(?:to|that|which)\s+/i, '')
    .replace(/^produce\s+/i, '')
    .replace(/^it\s+should\s+/i, '')
    .replace(/^a\s+comparison\b/i, 'Comparison')
    .trim();

  return capitalizeFirst(label);
}

function cleanLabelText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function capitalizeFirst(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isUsefulSkillIdeaLabel(value: string): boolean {
  if (!value) return false;
  if (/^unknown$/i.test(value)) return false;
  if (/^unknown(?:$|\s*[;:,.!?-])/i.test(value)) return false;
  if (/^(?:skill idea )?not yet provided$/i.test(value)) return false;
  if (/^skill idea(?: text)? is required$/i.test(value)) return false;
  return true;
}
