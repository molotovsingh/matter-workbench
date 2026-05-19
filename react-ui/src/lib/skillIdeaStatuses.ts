export const SKILL_IDEA_STATUS = {
  INCOMPLETE: 'incomplete',
  READY_FOR_REVIEW: 'ready_for_review',
  PARKED: 'parked',
  DISMISSED: 'dismissed',
} as const;

export type SkillIdeaStatus = (typeof SKILL_IDEA_STATUS)[keyof typeof SKILL_IDEA_STATUS];

export const SKILL_IDEA_STATUS_VALUES = Object.values(SKILL_IDEA_STATUS) as SkillIdeaStatus[];

export const LEGACY_SKILL_IDEA_STATUS_MAP = {
  proposed: SKILL_IDEA_STATUS.INCOMPLETE,
  marked_for_future: SKILL_IDEA_STATUS.PARKED,
} as const;

export function isSkillIdeaStatus(status: string | null | undefined): status is SkillIdeaStatus {
  return SKILL_IDEA_STATUS_VALUES.includes(String(status || '').trim() as SkillIdeaStatus);
}

export function normalizeSkillIdeaStatus(status: string | null | undefined): SkillIdeaStatus {
  const normalized = String(status || '').trim();
  const mapped = LEGACY_SKILL_IDEA_STATUS_MAP[normalized as keyof typeof LEGACY_SKILL_IDEA_STATUS_MAP] || normalized;
  return isSkillIdeaStatus(mapped) ? mapped : SKILL_IDEA_STATUS.INCOMPLETE;
}

export function skillIdeaStatusLabel(status: string | null | undefined): string {
  const normalized = normalizeSkillIdeaStatus(status);
  if (normalized === SKILL_IDEA_STATUS.READY_FOR_REVIEW) return 'Ready to review';
  if (normalized === SKILL_IDEA_STATUS.PARKED) return 'Parked';
  if (normalized === SKILL_IDEA_STATUS.DISMISSED) return 'Dismissed';
  return 'Draft saved';
}
