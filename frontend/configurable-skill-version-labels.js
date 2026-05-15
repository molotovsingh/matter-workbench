export function formatConfigurableSkillVersionLabel(skill = {}) {
  const version = Number(skill.version || 1);
  return `v${Number.isFinite(version) && version > 0 ? version : 1}`;
}

export function formatConfigurableSkillDisplayName(skill = {}, fallback = "Custom Skill") {
  const title = String(skill.title || skill.slash || fallback || "Custom Skill").trim() || "Custom Skill";
  const versionLabel = formatConfigurableSkillVersionLabel(skill);
  return titleHasVersionSuffix(title) ? title : `${title} ${versionLabel}`;
}

function titleHasVersionSuffix(title) {
  return /\bv\d+\s*$/i.test(String(title || "").trim());
}
