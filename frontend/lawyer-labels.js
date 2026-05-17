let skillDisplayByCommand = new Map();

const ARTIFACT_LABELS = Object.freeze([
  [/^matter\.json$/i, "Matter metadata"],
  [/File Register\.csv$/i, "File Register"],
  [/Extraction Log\.csv$/i, "Extraction Log"],
  [/Source Index\.json$/i, "Source Labels record"],
  [/List of Dates\.md$/i, "List of Dates"],
  [/List of Dates\.json$/i, "List of Dates data"],
  [/List of Dates\.csv$/i, "List of Dates spreadsheet"],
  [/List of Dates Candidates\.json$/i, "Internal chronology candidates"],
]);

export function setLawyerLabelRegistry(registryOrSkills = {}) {
  const skills = Array.isArray(registryOrSkills)
    ? registryOrSkills
    : Array.isArray(registryOrSkills?.skills)
      ? registryOrSkills.skills
      : [];
  skillDisplayByCommand = new Map(skills
    .filter((skill) => skill?.slash && skill.display)
    .map((skill) => [normalizeCommand(skill.slash), normalizeDisplay(skill.display)]));
}

export function lawyerActionLabel(commandOrSkill, fallback = "Action") {
  return resolveDisplay(commandOrSkill)?.action || cleanFallback(fallbackFrom(commandOrSkill, fallback));
}

export function lawyerActionResultLabel(commandOrSkill, fallback = "Result") {
  const display = resolveDisplay(commandOrSkill);
  return display?.artifact || display?.action || cleanFallback(fallbackFrom(commandOrSkill, fallback));
}

export function lawyerActionRunningLabel(commandOrSkill, fallback = "Running") {
  return resolveDisplay(commandOrSkill)?.running || cleanFallback(fallbackFrom(commandOrSkill, fallback));
}

export function lawyerActionCompleteLabel(commandOrSkill, fallback = "Complete") {
  return resolveDisplay(commandOrSkill)?.complete || cleanFallback(fallbackFrom(commandOrSkill, fallback));
}

export function lawyerActionPill(commandOrSkill, { paidProviderCall = null } = {}) {
  const display = resolveDisplay(commandOrSkill);
  if (display?.pill) return display.pill;
  if (typeof commandOrSkill === "object" && commandOrSkill && typeof commandOrSkill.paid_provider_call === "boolean") {
    return commandOrSkill.paid_provider_call ? "Uses AI" : "Local";
  }
  if (paidProviderCall === true) return "Uses AI";
  if (paidProviderCall === false) return "Local";
  return "";
}

export function lawyerAiPostureLabel(value) {
  return value ? "Uses paid AI" : "Local";
}

export function lawyerModeLabel(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "deterministic") return "Local";
  if (normalized === "ai") return "Uses AI";
  return cleanFallback(mode);
}

export function lawyerArtifactLabel(artifactPath = "") {
  const path = String(artifactPath || "").trim();
  if (!path) return "Output";
  const match = ARTIFACT_LABELS.find(([pattern]) => pattern.test(path));
  if (match) return match[1];
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() || path;
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Output";
}

export function normalizeCommand(command = "") {
  const value = String(command || "").trim();
  if (!value) return "";
  return value.startsWith("/") ? value : `/${value}`;
}

function resolveDisplay(commandOrSkill) {
  const direct = normalizeDisplay(commandOrSkill?.display);
  if (direct) return direct;
  const command = typeof commandOrSkill === "object" && commandOrSkill
    ? commandOrSkill.slash
    : commandOrSkill;
  return skillDisplayByCommand.get(normalizeCommand(command)) || null;
}

function normalizeDisplay(display) {
  if (!display || typeof display !== "object" || Array.isArray(display)) return null;
  const normalized = {};
  for (const key of ["action", "artifact", "running", "complete", "pill"]) {
    if (typeof display[key] === "string" && display[key].trim()) {
      normalized[key] = display[key].trim();
    }
  }
  return Object.keys(normalized).length ? normalized : null;
}

function fallbackFrom(commandOrSkill, fallback) {
  if (typeof commandOrSkill === "object" && commandOrSkill) {
    return commandOrSkill.title || commandOrSkill.label || commandOrSkill.slash || fallback;
  }
  if (fallback && !["Action", "Result", "Running", "Complete"].includes(fallback)) return fallback;
  return commandOrSkill || fallback;
}

function cleanFallback(value = "") {
  return String(value || "")
    .replace(/^\/+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Action";
}
