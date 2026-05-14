import { normalizeCommandInput } from "./command-parsing.js";

export function findActiveConfigurableSkillBySlash(skills = [], slash = "") {
  const normalizedSlash = normalizeCommandInput(slash);
  if (!normalizedSlash.startsWith("/")) return null;
  return Array.isArray(skills)
    ? skills.find((skill) => (
      skill?.configurable
      && skill.status === "active"
      && normalizeCommandInput(skill.slash) === normalizedSlash
    )) || null
    : null;
}

export function parseConfigurableSkillRevisionCommand(input) {
  const text = String(input || "").trim();
  const commandFirstMatch = text.match(/^(\/[a-z0-9_-]+)\s+(improve|revise|change|modify)\b(?:\s+(.*))?$/i);
  const actionFirstMatch = text.match(/\b(improve|revise|change|modify)\s+(\/[a-z0-9_-]+)\b(?:\s+(.*))?$/i);
  const targetSlash = normalizeCommandInput(commandFirstMatch?.[1] || actionFirstMatch?.[2] || "");
  if (!targetSlash) return null;
  const revisionText = String(commandFirstMatch?.[3] || actionFirstMatch?.[3] || "")
    .replace(/^(to|so|because|that)\s+/i, "")
    .trim();
  return { targetSlash, revisionText };
}

export function isConfigurableSkillOutputReplacementCommand(input) {
  const normalized = normalizeCommandInput(input);
  return normalized === "run again"
    || normalized === "overwrite"
    || normalized === "overwrite artifact"
    || normalized === "replace output"
    || normalized === "replace output document"
    || normalized === "replace document";
}
