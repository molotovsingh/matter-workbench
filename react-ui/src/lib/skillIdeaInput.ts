export const SKILL_IDEA_INPUT_PATTERNS = [
  '^create (?:a )?new skil{1,2} (?:for|to|that|which) (.+)$',
  '^create (?:a )?skil{1,2} (?:for|to|that|which) (.+)$',
  '^make (?:a )?new skil{1,2} (?:for|to|that|which) (.+)$',
  '^make (?:a )?skil{1,2} (?:for|to|that|which) (.+)$',
  '^build (?:a )?new skil{1,2} (?:for|to|that|which) (.+)$',
  '^build (?:a )?skil{1,2} (?:for|to|that|which) (.+)$',
  '^new skil{1,2} (?:for|to|that|which) (.+)$',
  '^new skil{1,2} (.+)$',
  '^i need a skil{1,2} that (.+)$',
  '^i want a (?:new )?skil{1,2} (?:for|to|that|which) (.+)$',
  '^can we make a skil{1,2} for (.+)$',
] as const;

const EMPTY_SKILL_IDEA_PROMPTS = new Set([
  '/new_skill',
  '/new-skill',
  '/newskill',
  'new skill',
  'create skill',
  'create a skill',
  'create new skill',
  'create a new skill',
  'make skill',
  'make a skill',
  'make new skill',
  'make a new skill',
  'design skill',
  'design a skill',
  'i want to make a new skill',
  'i think i want to make a new skill',
]);

export function parseSkillIdeaText(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const normalized = normalizeSkillIdeaInput(raw);
  if (EMPTY_SKILL_IDEA_PROMPTS.has(normalized)) return '';
  for (const pattern of SKILL_IDEA_INPUT_PATTERNS) {
    const match = normalized.match(new RegExp(pattern));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export function normalizeSkillIdeaInput(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
