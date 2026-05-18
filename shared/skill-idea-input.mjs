export const SKILL_IDEA_INPUT_PATTERNS = Object.freeze([
  "^create (?:a )?new skil{1,2} (?:for|to|that|which) (.+)$",
  "^create (?:a )?skil{1,2} (?:for|to|that|which) (.+)$",
  "^make (?:a )?new skil{1,2} (?:for|to|that|which) (.+)$",
  "^make (?:a )?skil{1,2} (?:for|to|that|which) (.+)$",
  "^build (?:a )?new skil{1,2} (?:for|to|that|which) (.+)$",
  "^build (?:a )?skil{1,2} (?:for|to|that|which) (.+)$",
  "^new skil{1,2} (?:for|to|that|which) (.+)$",
  "^new skil{1,2} (.+)$",
  "^i need a skil{1,2} that (.+)$",
  "^i want a (?:new )?skil{1,2} (?:for|to|that|which) (.+)$",
  "^can we make a skil{1,2} for (.+)$",
]);

export function parseSkillIdeaInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const normalized = normalizeSkillIdeaInput(raw);
  for (const pattern of SKILL_IDEA_INPUT_PATTERNS) {
    const match = normalized.match(new RegExp(pattern));
    if (match?.[1]?.trim()) {
      return {
        type: "skill_idea",
        text: raw.replace(/\s+/g, " "),
        idea: match[1].trim(),
      };
    }
  }
  return null;
}

export function normalizeSkillIdeaInput(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
