export const LEGAL_SOURCE_ID_PATTERN = String.raw`(?:WEB|STATUTE)-\d{4}`;
export const LEGAL_SOURCE_ID_RE = new RegExp(`^${LEGAL_SOURCE_ID_PATTERN}$`, "i");
export const LEGAL_SOURCE_ID_GLOBAL_RE = new RegExp(`\\b${LEGAL_SOURCE_ID_PATTERN}\\b`, "gi");
export const STATUTE_SOURCE_ID_RE = /^STATUTE-\d{4}$/i;

export function normalizeLegalSourceId(value = "") {
  const id = String(value || "").trim().toUpperCase();
  return LEGAL_SOURCE_ID_RE.test(id) ? id : "";
}

export function isLegalSourceId(value = "") {
  return Boolean(normalizeLegalSourceId(value));
}

export function isStatuteSourceId(value = "") {
  return STATUTE_SOURCE_ID_RE.test(String(value || "").trim());
}

export function extractLegalSourceIds(value = "") {
  const ids = [];
  for (const match of String(value || "").matchAll(LEGAL_SOURCE_ID_GLOBAL_RE)) {
    const id = normalizeLegalSourceId(match[0]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
