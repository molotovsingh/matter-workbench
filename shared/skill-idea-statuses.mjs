export const SKILL_IDEA_STATUS = Object.freeze({
  INCOMPLETE: "incomplete",
  READY_FOR_REVIEW: "ready_for_review",
  PARKED: "parked",
  CREATED: "created",
  DISMISSED: "dismissed",
});

export const SKILL_IDEA_STATUS_VALUES = Object.freeze(Object.values(SKILL_IDEA_STATUS));

export const LEGACY_SKILL_IDEA_STATUS_MAP = Object.freeze({
  proposed: SKILL_IDEA_STATUS.INCOMPLETE,
  marked_for_future: SKILL_IDEA_STATUS.PARKED,
});

export function isSkillIdeaStatus(status) {
  return SKILL_IDEA_STATUS_VALUES.includes(String(status || "").trim());
}

export function normalizeSkillIdeaStatus(status) {
  const normalized = String(status || "").trim();
  const mapped = LEGACY_SKILL_IDEA_STATUS_MAP[normalized] || normalized;
  return isSkillIdeaStatus(mapped) ? mapped : SKILL_IDEA_STATUS.INCOMPLETE;
}
