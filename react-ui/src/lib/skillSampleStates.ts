export const SKILL_SAMPLE_STATE = {
  CURRENT: 'current',
  STALE: 'stale',
  APPROVED_CURRENT: 'approved_current',
  APPROVED_STALE: 'approved_stale',
} as const;

export type SkillSampleState = (typeof SKILL_SAMPLE_STATE)[keyof typeof SKILL_SAMPLE_STATE];

export const SKILL_SAMPLE_STATE_VALUES = Object.values(SKILL_SAMPLE_STATE) as SkillSampleState[];

export function isSkillSampleState(state: string | null | undefined): state is SkillSampleState {
  return SKILL_SAMPLE_STATE_VALUES.includes(String(state || '').trim() as SkillSampleState);
}

export function normalizeSkillSampleState(sample: {
  state?: string | null;
  approved?: boolean;
  current?: boolean;
} = {}): SkillSampleState {
  const state = String(sample.state || '').trim();
  if (isSkillSampleState(state)) return state;
  if (sample.approved && sample.current === false) return SKILL_SAMPLE_STATE.APPROVED_STALE;
  if (sample.approved) return SKILL_SAMPLE_STATE.APPROVED_CURRENT;
  if (sample.current === false) return SKILL_SAMPLE_STATE.STALE;
  return SKILL_SAMPLE_STATE.CURRENT;
}

export function isSkillSampleStaleState(state: string | null | undefined): boolean {
  return state === SKILL_SAMPLE_STATE.STALE || state === SKILL_SAMPLE_STATE.APPROVED_STALE;
}
