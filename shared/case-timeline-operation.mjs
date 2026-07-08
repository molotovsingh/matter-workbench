export const CASE_TIMELINE_SKILL_ID = "create_case_timeline";
export const CASE_TIMELINE_SKILL_SLASH = "/create_case_timeline";
export const CASE_TIMELINE_STAGE_ID = "case-timeline";
export const CASE_TIMELINE_API_ROUTE = "/api/case-timeline";
export const CASE_TIMELINE_REFRESH_LABELS_API_ROUTE = "/api/case-timeline/refresh-labels";

export const LEGACY_LIST_OF_DATES_SKILL_ID = "create_listofdates";
export const LEGACY_LIST_OF_DATES_SKILL_SLASH = "/create_listofdates";
export const LEGACY_LIST_OF_DATES_STAGE_ID = "create-listofdates";
export const LEGACY_LIST_OF_DATES_API_ROUTE = "/api/create-listofdates";
export const LEGACY_LIST_OF_DATES_REFRESH_LABELS_API_ROUTE = "/api/create-listofdates/refresh-labels";

export function normalizeCaseTimelineSkillSlash(value = "") {
  const text = String(value || "").trim();
  const slash = text.startsWith("/") ? text : text ? `/${text}` : "";
  const normalized = slash.toLowerCase().replace(/-/g, "_");
  if ([
    CASE_TIMELINE_SKILL_SLASH,
    "/case_timeline",
    LEGACY_LIST_OF_DATES_SKILL_SLASH,
    "/listofdates",
  ].includes(normalized)) {
    return CASE_TIMELINE_SKILL_SLASH;
  }
  return slash;
}

export function isCaseTimelineSkillSlash(value = "") {
  return normalizeCaseTimelineSkillSlash(value) === CASE_TIMELINE_SKILL_SLASH;
}
