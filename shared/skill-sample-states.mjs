export const SKILL_SAMPLE_STATE = Object.freeze({
  CURRENT: "current",
  STALE: "stale",
  APPROVED_CURRENT: "approved_current",
  APPROVED_STALE: "approved_stale",
});

export const SKILL_SAMPLE_STATE_VALUES = Object.freeze(Object.values(SKILL_SAMPLE_STATE));

export function isSkillSampleState(state) {
  return SKILL_SAMPLE_STATE_VALUES.includes(String(state || "").trim());
}

export function normalizeSkillSampleState(sample = {}) {
  const state = String(sample?.state || "").trim();
  if (isSkillSampleState(state)) return state;
  if (sample?.approved && sample?.current === false) return SKILL_SAMPLE_STATE.APPROVED_STALE;
  if (sample?.approved) return SKILL_SAMPLE_STATE.APPROVED_CURRENT;
  if (sample?.current === false) return SKILL_SAMPLE_STATE.STALE;
  return SKILL_SAMPLE_STATE.CURRENT;
}

export function isSkillSampleStaleState(state) {
  return state === SKILL_SAMPLE_STATE.STALE || state === SKILL_SAMPLE_STATE.APPROVED_STALE;
}
