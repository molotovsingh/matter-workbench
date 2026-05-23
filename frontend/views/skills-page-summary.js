export function skillsPageSummary(registry = {}, matterStatus = null, configurableSkills = null) {
  const skills = Array.isArray(registry.skills) ? registry.skills : [];
  const configuredSkills = Array.isArray(configurableSkills?.skills)
    ? configurableSkills.skills.map(configurableSkillToCard)
    : [];
  const stages = Array.isArray(matterStatus?.stages) ? matterStatus.stages : [];
  const statusBySlash = new Map(stages.map((stage) => [stage.slash, stage]));
  const withStatus = skills.map((skill) => ({
    ...skill,
    artifactStatus: statusBySlash.get(skill.slash) || null,
  }));
  const builtins = withStatus.filter((skill) => !skill.configurable);
  const builtinGroups = groupBuiltinsByProductSurface(builtins);
  const registryCustom = withStatus.filter((skill) => skill.configurable);
  const customSource = configuredSkills.length ? configuredSkills : registryCustom;
  const allCustom = markPrimaryCustomSkills(customSource.map((skill) => ({
    ...skill,
    artifactStatus: statusBySlash.get(skill.slash) || skill.artifactStatus || null,
  }))).sort(compareCustomSkills);
  const custom = allCustom.filter((skill) => skill.primary !== false);
  return {
    builtins,
    nativeBuiltins: builtinGroups.nativeLegal,
    setupBuiltins: builtinGroups.setup,
    utilityBuiltins: builtinGroups.utility,
    custom,
    allCustom,
    deterministic: builtins.filter((skill) => String(skill.mode || "").toLowerCase() !== "ai"),
    paidAi: builtins.filter((skill) => skill.paid_provider_call || String(skill.mode || "").toLowerCase() === "ai"),
    matterName: matterStatus?.matterName || "",
    hasMatterStatus: Boolean(matterStatus),
  };
}

function groupBuiltinsByProductSurface(builtins = []) {
  const groups = {
    nativeLegal: [],
    setup: [],
    utility: [],
  };
  for (const skill of builtins) {
    const surface = String(skill.product_surface || "").trim();
    if (surface === "native_legal") {
      groups.nativeLegal.push(skill);
    } else if (surface === "setup" || surface === "readiness") {
      groups.setup.push(skill);
    } else {
      groups.utility.push(skill);
    }
  }
  return groups;
}

export function customSkillGroupingKey(skill = {}) {
  const familyId = skill.family_id || skill.familyId || "";
  const hasExplicitLineage = Boolean(
    skill.previous_skill_id
    || skill.previousSkillId
    || skill.replaced_by_skill_id
    || skill.replacedBySkillId
    || (familyId && familyId !== skill.id),
  );
  if (hasExplicitLineage) return `family:${familyId || skill.id || skill.slash || ""}`;
  return [
    "signature",
    normalizeComparableText(skill.title),
    normalizeComparableText((Array.isArray(skill.outputs) ? skill.outputs[0] : skill.outputArtifact) || ""),
    normalizeComparableText(skill.default_lane || skill.targetLane || ""),
  ].join(":");
}

function configurableSkillToCard(skill = {}) {
  return {
    schema_version: skill.schema_version || "configurable-skill/v1",
    id: skill.id || "",
    slash: skill.slash || "",
    title: skill.title || skill.slash || "Custom Skill",
    category: "Analyze",
    mode: "AI",
    purpose: skill.description || "",
    matter_required: skill.matterRequired !== false,
    paid_provider_call: skill.paidProviderCall !== false,
    rerun_guarded: true,
    source_backed: skill.sourceBacked || "required",
    inputs: ["matter-context-packet/v1"],
    outputs: skill.outputArtifact ? [skill.outputArtifact] : [],
    upstream: [skill.sourceIdeaId, skill.sourceSampleId].filter(Boolean),
    downstream: [],
    default_lane: skill.targetLane || "",
    runner_key: skill.slash || "",
    version: Number.isInteger(skill.version) ? skill.version : 1,
    family_id: skill.familyId || skill.id || "",
    previous_skill_id: skill.previousSkillId || "",
    replaced_by_skill_id: skill.replacedBySkillId || "",
    superseded_at: skill.supersededAt || "",
    source_idea_id: skill.sourceIdeaId || "",
    source_sample_id: skill.sourceSampleId || "",
    validation: skill.validation || null,
    created_at: skill.createdAt || "",
    updated_at: skill.updatedAt || "",
    activated_at: skill.activatedAt || "",
    configurable: true,
    status: skill.status || "draft",
  };
}

function compareCustomSkills(a, b) {
  const statusRank = { active: 0, suspended: 1, draft: 2, archived: 3, disabled: 4 };
  const leftStatus = statusRank[a.status] ?? 9;
  const rightStatus = statusRank[b.status] ?? 9;
  if (leftStatus !== rightStatus) return leftStatus - rightStatus;
  if (a.primary !== b.primary) return a.primary === false ? 1 : -1;
  const leftSlash = String(a.slash || "");
  const rightSlash = String(b.slash || "");
  if (leftSlash !== rightSlash) return leftSlash.localeCompare(rightSlash);
  return Number(b.version || 0) - Number(a.version || 0);
}

function markPrimaryCustomSkills(skills = []) {
  const byKey = new Map();
  const normalized = skills.map((skill) => ({ ...skill, primary: true }));
  for (const skill of normalized) {
    if (skill.status !== "active") continue;
    const key = customSkillGroupingKey(skill);
    const current = byKey.get(key);
    if (!current || comparePrimaryCustomSkill(skill, current) < 0) {
      byKey.set(key, skill);
    }
  }
  const primaryIds = new Set([...byKey.values()].map((skill) => skill.id || skill.slash));
  return normalized.map((skill) => ({
    ...skill,
    primary: skill.status === "active" ? primaryIds.has(skill.id || skill.slash) : false,
  }));
}

function comparePrimaryCustomSkill(left = {}, right = {}) {
  const leftVersion = Number(left.version || 0);
  const rightVersion = Number(right.version || 0);
  if (leftVersion !== rightVersion) return rightVersion - leftVersion;
  const leftTime = left.activated_at || left.activatedAt || left.updated_at || left.updatedAt || left.created_at || left.createdAt || "";
  const rightTime = right.activated_at || right.activatedAt || right.updated_at || right.updatedAt || right.created_at || right.createdAt || "";
  if (leftTime !== rightTime) return String(rightTime).localeCompare(String(leftTime));
  const leftId = left.id || "";
  const rightId = right.id || "";
  if (leftId !== rightId) return String(rightId).localeCompare(String(leftId));
  return String(left.slash || "").localeCompare(String(right.slash || ""));
}

function normalizeComparableText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}
